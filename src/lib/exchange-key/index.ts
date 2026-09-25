// API ANAHTARI KABULÜ (G06 · P-1, S-1, S-2, S-4, S-6, S-7, S-8). `exchange_keys`'e yazan TEK yol (kapı: scripts/gate-exchange-key.mjs). Sıra KESİN, atlanamaz:
//   (1) biçim: keyType "ed25519" ve PEM gerçekten Ed25519 özel anahtarı (S-4) → (2) yetki denetimi: GET /sapi/v1/account/apiRestrictions, G05 boğazından, sınıf DISCOVERY,
//   imzalı (./sign.ts) → (3) P-1 kapısı: enableWithdrawals ya da permitsUniversalTransfer true → RET; enableReading false → RET (yetki denetlenemez) →
//   (4) G03 zarfları satıra yazılır (düz metin yazma yolu YOK) → (5) verified_at, ip_restrict, enable_* ham yanıttan; last_order_at boş (S-6 sayacı başlamadı).
// Reddedilen anahtar HİÇBİR yere yazılmaz: veritabanı, log, hata mesajı, dönüş değeri. Sonuç yalnız {ok:false, reason, permission?} taşır; bu modülde console YOKTUR (S-2).
// Düz metin ömrü (S-1): girdi tamponları ilk iş olarak G03 zarfına alınır ve sıfırlanır; sonraki her kullanım (tür/parmak izi, imza, başlık) withDecrypted içindedir.
import { z } from "zod";
import { getDb } from "@/db/client";
import { getBinance, type BinanceClient } from "@/lib/binance";
import type { Usage } from "@/lib/binance/budget";
import { RECV_WINDOW_MS, signedTimestamp, type ClockDeps } from "@/lib/binance/time";
import { encryptField, keyringFromEnv, type Keyring, type StoredField } from "@/lib/crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { inspectPrivateKey, withSignedCall } from "./sign";

/** Yetki denetimi çağrısı. Ağırlık 1 (IP): Binance belgesi "Weight(IP): 1"; sapi ağırlığı ayrı sayaçtır (X-SAPI-USED-IP-WEIGHT-1M) — B2'de başlıktan ölçülecek. */
export const RESTRICTIONS_CALL = { path: "/sapi/v1/account/apiRestrictions", cls: "DISCOVERY", weight: 1 } as const;
export { RECV_WINDOW_MS }; // imzalı isteğin geçerlilik penceresi — damga ve pencere aynı yerde (src/lib/binance/time.ts), buradan yeniden dışa verilir
/** S-6 (ölçüldü, ANAYASA): IP kısıtsız + okuma dışı yetki + 30 gün emirsiz ⇒ Binance anahtarı siler. */
export const KEY_IDLE_DELETE_DAYS = 30;
/** AÇIK — A-1'de yok, UYDURULDU (sicil, geri alınabilir): silinmeden bu kadar gün önce KEY_EXPIRING uyarısı. 7 gün: bir hafta karar payı. Anlamsız emir GÖNDERİLMEZ (S-6). */
export const KEY_IDLE_WARN_DAYS = 7;

const inputSchema = z.object({ label: z.string().min(1).max(64), keyType: z.string().min(1).max(32), apiKey: z.string().min(1).max(256), privateKeyPem: z.string().min(1).max(8192) });
const restrictionsSchema = z.object({ ipRestrict: z.boolean(), enableReading: z.boolean(), enableSpotAndMarginTrading: z.boolean(), enableFutures: z.boolean(), enableWithdrawals: z.boolean(), permitsUniversalTransfer: z.boolean() }).passthrough();
export type Restrictions = z.infer<typeof restrictionsSchema>;
export type Permission = "enableWithdrawals" | "permitsUniversalTransfer" | "enableReading";
export type RejectReason = "BAD_INPUT" | "KEY_TYPE_NOT_ED25519" | "PRIVATE_KEY_NOT_ED25519" | "CLOCK_UNSYNCED" | "RESTRICTIONS_UNAVAILABLE" | "RESTRICTIONS_UNREADABLE" | "P1_WITHDRAWALS" | "P1_UNIVERSAL_TRANSFER" | "READ_DISABLED";
export type AcceptResult =
  | { ok: true; id: number; fingerprint: string; restrictions: Restrictions; usage: Usage[] }
  | { ok: false; reason: RejectReason; permission?: Permission; detail?: string; status?: number; sent?: boolean };
export const REJECT_STATUS: Record<RejectReason, number> = { BAD_INPUT: 400, KEY_TYPE_NOT_ED25519: 422, PRIVATE_KEY_NOT_ED25519: 422, CLOCK_UNSYNCED: 503, RESTRICTIONS_UNAVAILABLE: 503, RESTRICTIONS_UNREADABLE: 502, P1_WITHDRAWALS: 422, P1_UNIVERSAL_TRANSFER: 422, READ_DISABLED: 422 };
export type NewExchangeKeyRow = Omit<Prisma.ExchangeKeyCreateInput, "positions">;
/** Yazma yüzeyi: üretimde Prisma (getDb); kapı/kanarya sahte ya da shadow depo enjekte eder (S-9). Yalnız create — güncelleme yolu bu turda yok. */
export interface KeyStore { create(data: NewExchangeKeyRow): Promise<{ id: number }> }
export type Deps = { binance?: BinanceClient; db?: KeyStore; ring?: Keyring; now?: () => number; clock?: ClockDeps };

export type StoredKeyPair = { api: StoredField; priv: StoredField };
/** Geçerli (iptal edilmemiş) SON anahtarın G03 zarfları — düz metin yoktur (S-1); çözme yalnız withDecrypted içinde (./sign.ts). İmzalı çağrı yapan her yol
 *  (G09 defter okuyucuları, G11 emir yolu) anahtarı BURADAN alır: `exchange_keys`'i okuyan tek yer de bu modüldür. Satır yoksa null → çağıran kapalı arızalanır. */
export const prismaKeySource = async (client?: PrismaClient): Promise<StoredKeyPair | null> => {
  const r = await (client ?? getDb()).exchangeKey.findFirst({ where: { revokedAt: null }, orderBy: { id: "desc" }, select: { apiKeyCiphertext: true, privateKeyCiphertext: true, encryptionKeyVersion: true } });
  return r && { api: { ciphertext: r.apiKeyCiphertext, encryptionKeyVersion: r.encryptionKeyVersion }, priv: { ciphertext: r.privateKeyCiphertext, encryptionKeyVersion: r.encryptionKeyVersion } };
};
/** Geçerli son anahtarın borsa kabulünde ölçülen futures yetkisi (`enable_futures`, Tur 44 · G21-i). Satır yoksa null → çağıran kapalı arızalanır (null "yetki var" DEĞİLDİR). */
export const prismaKeyFutures = async (client?: PrismaClient): Promise<boolean | null> =>
  (await (client ?? getDb()).exchangeKey.findFirst({ where: { revokedAt: null }, orderBy: { id: "desc" }, select: { enableFutures: true } }))?.enableFutures ?? null;

const reject = (reason: RejectReason, permission?: Permission): AcceptResult => (permission ? { ok: false, reason, permission } : { ok: false, reason });
const prismaStore = (): KeyStore => ({ create: async (data) => ({ id: (await getDb().exchangeKey.create({ data, select: { id: true } })).id }) });

/** Kabul akışı. Girdi doğrulanmazsa BAD_INPUT; reddedilen anahtar hiçbir yere yazılmaz; kabul edilen yalnız zarf olarak satıra girer. */
export async function acceptExchangeKey(input: unknown, deps: Deps = {}): Promise<AcceptResult> {
  const p = inputSchema.safeParse(input); if (!p.success) return reject("BAD_INPUT");
  // (1) biçim — ağa çıkmadan, zarflamadan önce: tip adı ed25519 değilse burada biter (S-4)
  if (p.data.keyType !== "ed25519") return reject("KEY_TYPE_NOT_ED25519");
  let ring: Keyring; try { ring = deps.ring ?? keyringFromEnv(); } catch { return reject("RESTRICTIONS_UNAVAILABLE"); }
  const apiKey = Buffer.from(p.data.apiKey, "utf8"), pem = Buffer.from(p.data.privateKeyPem, "utf8");
  let sealed: { api: ReturnType<typeof encryptField>; priv: ReturnType<typeof encryptField> };
  try { sealed = { api: encryptField("exchange_keys:api_key", apiKey, ring), priv: encryptField("exchange_keys:private_key", pem, ring) }; }
  catch { return reject("BAD_INPUT"); }
  finally { apiKey.fill(0); pem.fill(0); }
  const shape = inspectPrivateKey(sealed.priv, ring); if (!shape.ok) return reject("PRIVATE_KEY_NOT_ED25519");
  // (2) yetki denetimi — boğazdan (S-7), imzalı; anahtar/imza withDecrypted içinde (./sign.ts). Damga SUNUCU SAATİNE hizalanır (Tur 13): hizalanamazsa çağrı ÇIKMAZ (kapalı arıza).
  const now = (deps.now ?? Date.now)(), binance = deps.binance ?? getBinance();
  const ts = await signedTimestamp({ ...(deps.clock ?? {}), exchange: { binance, ...(deps.clock?.exchange ?? {}) } });
  if (!ts.ok) return { ok: false, reason: "CLOCK_UNSYNCED", detail: ts.detail };
  let r: Awaited<ReturnType<BinanceClient["request"]>>;
  try { r = await withSignedCall(sealed.api, sealed.priv, { timestamp: ts.timestamp, recvWindow: String(RECV_WINDOW_MS) }, (headers, query) => binance.request({ path: RESTRICTIONS_CALL.path, query, headers, cls: RESTRICTIONS_CALL.cls, weight: RESTRICTIONS_CALL.weight }), ring); }
  catch { return reject("RESTRICTIONS_UNREADABLE"); } // G03 sızıntı koruyucusu dâhil: yanıt anahtar parçası taşısaydı burada düşerdi
  if (!r.ok) return { ok: false, reason: "RESTRICTIONS_UNAVAILABLE", detail: r.detail, status: r.status, sent: r.sent };
  const rx = restrictionsSchema.safeParse(r.data); if (!rx.success) return reject("RESTRICTIONS_UNREADABLE");
  // (3) P-1 kapısı — karar YANITTAN; hangi yetki olduğu döner, anahtar dönmez
  if (rx.data.enableWithdrawals) return reject("P1_WITHDRAWALS", "enableWithdrawals");
  if (rx.data.permitsUniversalTransfer) return reject("P1_UNIVERSAL_TRANSFER", "permitsUniversalTransfer");
  if (!rx.data.enableReading) return reject("READ_DISABLED", "enableReading");
  // (4)(5) yazma — yalnız zarf; alanlar ham yanıttan; last_order_at boş
  const row = await (deps.db ?? prismaStore()).create({
    label: p.data.label, keyType: "ed25519", apiKeyCiphertext: new Uint8Array(sealed.api.ciphertext), privateKeyCiphertext: new Uint8Array(sealed.priv.ciphertext), encryptionKeyVersion: sealed.api.encryptionKeyVersion,
    publicKeyFingerprint: shape.fingerprint, restrictionsRaw: rx.data as Prisma.InputJsonObject, ipRestrict: rx.data.ipRestrict, enableReading: rx.data.enableReading,
    enableSpotAndMarginTrading: rx.data.enableSpotAndMarginTrading, enableFutures: rx.data.enableFutures, enableWithdrawals: rx.data.enableWithdrawals,
    permitsUniversalTransfer: rx.data.permitsUniversalTransfer, verifiedAt: new Date(now), lastOrderAt: null,
  });
  return { ok: true, id: row.id, fingerprint: shape.fingerprint, restrictions: rx.data, usage: r.usage };
}

/** S-6 SAYACI (Tur 14): GERÇEK emir gönderildiğinde son emir zamanı işaretlenir — Binance IP kısıtsız anahtarı 30 gün emirsizlikte SİLER (ölçüldü 2026-09-08).
 *  `exchange_keys`'e yazan tek yer bu modüldür (P-1 kapısı); emir yolu satıra doğrudan yazmaz, bu fonksiyonu çağırır. `order/test` emir OLUŞTURMAZ → sayacı BAŞLATMAZ.
 *  Yazılamazsa `false` döner ve emir yolu bunu sonucunda taşır: sayaç kaçırılırsa emir atılmaz, ama sessiz de kalmaz (K-8). */
export async function markOrderSent(at: Date, client?: PrismaClient): Promise<boolean> {
  try {
    const db = client ?? getDb(), row = await db.exchangeKey.findFirst({ where: { revokedAt: null }, orderBy: { id: "desc" }, select: { id: true } });
    if (!row) return false;
    await db.exchangeKey.update({ where: { id: row.id }, data: { lastOrderAt: at } });
    return true;
  } catch { return false; }
}

/** S-6 durumu: son etkinlikten (last_order_at, yoksa verified_at) bu yana geçen gün; KEY_IDLE_DELETE_DAYS − KEY_IDLE_WARN_DAYS'ta "warn", tavanda "expired". Emir üretmez. */
export function keyIdleStatus(row: { lastOrderAt: Date | null; verifiedAt: Date }, now = Date.now()): { idleDays: number; state: "ok" | "warn" | "expired"; deleteAt: Date } {
  const since = (row.lastOrderAt ?? row.verifiedAt).getTime(), idleDays = Math.floor((now - since) / 86_400_000), deleteAt = new Date(since + KEY_IDLE_DELETE_DAYS * 86_400_000);
  return { idleDays, deleteAt, state: idleDays >= KEY_IDLE_DELETE_DAYS ? "expired" : idleDays >= KEY_IDLE_DELETE_DAYS - KEY_IDLE_WARN_DAYS ? "warn" : "ok" };
}

/** KAYITLI ANAHTARIN DURUMU (G31 · Tur 75 · S-2, S-6, U-3). Panelin "Binance API anahtarı" bölümü YALNIZ bunu okur (GET /api/exchange-key, cls session). Seçilen alanlar izin bayrakları, ad ve
 *  zamanlardır: zarf, parmak izi, ham Binance yanıtı ve şifreleme sürümü SEÇİLMEZ ve çözülmez (kapı: gate:exchange-key `status-leaks-key`). Motorun kullandığı satır prismaKeySource ile AYNI kuraldır
 *  (iptal edilmemiş EN YENİ satır). Kabul akışı eski satırı iptal ETMEZ (yalnız create) ⇒ ondan önceki geçerli satırlar sayılır ve "kullanılmıyor" diye yazılır. Cümleler burada kurulur; ekran kendi hesabını yazmaz. */
export type KeyStatus = { ok: true; present: false; lines: string[] } | { ok: true; present: true; lines: string[]; label: string; spot: boolean; futures: boolean; reading: boolean; ipRestrict: boolean;
  verifiedAt: string; lastOrderAt: string | null; idle: { idleDays: number; state: "ok" | "warn" | "expired"; deleteAt: string }; olderRows: number } | { ok: false; lines: string[] };
const utc = (d: Date) => `${d.toISOString().replace("T", " ").slice(0, 19)} UTC`;
const acik = (b: boolean) => (b ? "AÇIK" : "KAPALI");
export async function readKeyStatus(client?: PrismaClient, now = Date.now()): Promise<KeyStatus> {
  let row: { label: string; ipRestrict: boolean; enableReading: boolean; enableSpotAndMarginTrading: boolean; enableFutures: boolean; enableWithdrawals: boolean; permitsUniversalTransfer: boolean; verifiedAt: Date; lastOrderAt: Date | null } | null, live: number;
  try {
    const db = client ?? getDb();
    row = await db.exchangeKey.findFirst({ where: { revokedAt: null }, orderBy: { id: "desc" }, select: { label: true, ipRestrict: true, enableReading: true, enableSpotAndMarginTrading: true, enableFutures: true, enableWithdrawals: true, permitsUniversalTransfer: true, verifiedAt: true, lastOrderAt: true } });
    live = await db.exchangeKey.count({ where: { revokedAt: null } });
  } catch { return { ok: false, lines: ["Kayıtlı Binance anahtarının durumu bu açılışta OKUNAMADI — anahtar var mı yok mu BİLİNMİYOR. Okunamayan durum \"anahtar yok\" sayılmadı; motorun kendisi anahtarı ayrıca okur ve okuyamazsa borsaya imzalı çağrı yapmaz."] }; }
  if (!row) return { ok: true, present: false, lines: ["Kayıtlı Binance anahtarı YOK — motor borsaya imzalı çağrı yapamaz ve emir gönderemez. Aşağıdaki formdan bir anahtar ekleyebilirsin."] };
  const idle = keyIdleStatus(row, now), since = row.lastOrderAt ?? row.verifiedAt, olderRows = live - 1;
  const lines = [
    `Kayıtlı Binance anahtarı VAR: "${row.label}". Son değişiklik: ${utc(row.verifiedAt)} — anahtar o an Binance'ten izinleri okunarak doğrulandı ve şifrelenerek kaydedildi. Anahtarın kendisi ve özel anahtar bu ekranda hiçbir zaman gösterilmez.`,
    `İzinler (kayıt anında Binance'in bildirdiği): okuma ${acik(row.enableReading)} · spot işlem ${acik(row.enableSpotAndMarginTrading)} · futures ${acik(row.enableFutures)} · çekim ${acik(row.enableWithdrawals)} · evrensel transfer ${acik(row.permitsUniversalTransfer)} · IP kısıtı ${row.ipRestrict ? "VAR" : "YOK"}.${row.enableSpotAndMarginTrading ? "" : " Spot işlem izni KAPALI olduğu için motor bu anahtarla spot emir GÖNDEREMEZ."}`,
    row.ipRestrict
      ? `Son emir: ${row.lastOrderAt ? utc(row.lastOrderAt) : "bu anahtarla henüz gerçek emir gönderilmedi"}. Binance'in 30 gün emirsiz kalan anahtarı silme kuralı IP kısıtı OLMAYAN anahtarlar için ölçüldü; IP kısıtlı anahtar için bu kural ölçülmedi.`
      : `Son emir: ${row.lastOrderAt ? utc(row.lastOrderAt) : "bu anahtarla henüz gerçek emir gönderilmedi"}. IP kısıtı olmayan anahtarı Binance 30 gün emirsiz kalınca SİLİYOR (ölçüldü). Sayaç ${utc(since)} tarihinden işliyor: ${idle.idleDays} gün geçti, anahtar en erken ${utc(idle.deleteAt)} tarihinde silinebilir.${idle.state === "expired" ? " SÜRE DOLDU: anahtar Binance'te silinmiş olabilir; yeni bir anahtar eklemen gerekebilir." : idle.state === "warn" ? " SİLİNMEYE YAKLAŞIYOR: süre dolmadan yeni bir anahtar eklemen ya da motorun bir emir göndermesi gerekir." : ""} Yazılım anahtarı ayakta tutmak için anlamsız emir göndermez.`,
  ];
  if (olderRows > 0) lines.push(`Veritabanında bundan önce kaydedilmiş ${olderRows} eski anahtar kaydı daha duruyor; motor YALNIZ en yenisini kullanır. Bu ekran eski anahtarları Binance'te kapatmaz — kullanmadığın anahtarı Binance'te silmeyi unutma.`);
  return { ok: true, present: true, lines, label: row.label, spot: row.enableSpotAndMarginTrading, futures: row.enableFutures, reading: row.enableReading, ipRestrict: row.ipRestrict,
    verifiedAt: row.verifiedAt.toISOString(), lastOrderAt: row.lastOrderAt?.toISOString() ?? null, idle: { idleDays: idle.idleDays, state: idle.state, deleteAt: idle.deleteAt.toISOString() }, olderRows };
}
