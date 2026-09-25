// İCRA KİLİDİ + İCRA KİMLİĞİ (G10 · K-6, S-7, S-2, Ö-2). "Aynı sinyal iki kez icra edilemez" — İKİ KATMAN, kilit tek savunma DEĞİLDİR (Tur 10 madde 2):
//   KATMAN 1 — KİMLİK (asıl garanti): her icra kararı sinyalden BELİRLENİMCİ türetilen bir client_order_id taşır (deriveClientOrderId). Aynı sinyal → aynı kimlik;
//     farklı sinyaller → farklı kimlik (SHA-256, 128 bit; kanonik biçim alan adlı ve ayraçlı, değerlerde kontrol karakteri yasak). Rastgelelik ve zaman YOKTUR (kapı ölçer).
//     Bu katman zincir ömründen (A-4), kilit süresinden ve Upstash'ten BAĞIMSIZDIR: Binance açık emirler arasında aynı kimliği reddeder (belge; ölçülmedi, S-9), `orders.client_order_id`
//     tekil kısıtı üçüncü kademe (üretimde ölçüldü, Tur 10 madde 1). Tahmin edilebilirlik kimlik için gereksinim DEĞİLDİR: kimlik yetki vermez, yetki API anahtarındadır (hesap dışından
//     aynı kimlikle emir verilemez). Tahmin edilemez olması GEREKEN yer: kilidin sahiplik jetonu (aşağıda, 128 bit rastgele).
//   KATMAN 2 — KİLİT (hız/israf koruması): Upstash'te atomik kiralama (SET PX NX), kimlik başına anahtar. Sahiplik jetonu (fencing token) taşır: uzatma/bırakma/sahiplik denetimi
//     jetonla karşılaştır-ve-yaz (EVAL); süresi dolmuş ya da el değiştirmiş kiranın sahibi geç gelen işlemi yapamaz. Kilit alınamazsa icra YAPILMAZ (kapalı arıza); bu bir hata değil,
//     yapılandırılmış "başkası çalışıyor" (HELD) ya da "kilit deposu erişilemez" (LOCK_UNAVAILABLE) sonucudur. Bu modül hiçbir zaman fırlatmaz; hata metni yalnız sınıf adıdır (S-2).
// Kira süresi EXECUTION_LEASE_MS: icra adımının kendi süresini (boğaz gönderimi + kayıt) örter; zincir devri penceresine (A-4) BAĞLI DEĞİLDİR — pencere kiradan uzun olsa bile
// ikinci halka kimlik katmanında durur (kanarya adım 2/4 ölçer). Jeton ve kira dışarıya çıkmaz: yanıtlarda/olaylarda yalnız sahip etiketi ve süre bulunur.
import { createHash, randomBytes } from "node:crypto";
import { pickEnv } from "@/lib/env";
import { redisPipeline } from "@/lib/upstash";

// ---- KATMAN 1: kimlik ----
export type SignalKey = { source: string; symbol: string; market: "SPOT" | "FUTURES"; side: "BUY" | "SELL"; intent: "ENTRY" | "EXIT" | "PROTECTION"; seq: number };
/** Kimlik sürüm ön eki + 32 hex = 35 karakter. Binance newClientOrderId: ^[\.A-Z\:/a-z0-9_-]{1,36}$ (belge; emir gönderilmediği için ölçülmedi, S-9). */
export const CLIENT_ORDER_ID_PREFIX = "w1-";
export const CLIENT_ORDER_ID_RE = /^[.A-Z:/a-z0-9_-]{1,36}$/;
const FIELDS = ["source", "symbol", "market", "side", "intent", "seq"] as const;
/** Kanonik biçim: sabit sırada `alan=değer` satırları. Değerler boş olamaz, kontrol karakteri (satır sonu dâhil) taşıyamaz; seq tam sayı ≥ 0. Aynı anahtar → aynı metin; farklı anahtar → farklı metin (ayraç değerde geçemez). */
export function canonicalSignal(k: SignalKey): string {
  for (const f of FIELDS) { const v = (k as Record<string, unknown>)[f]; if (f === "seq") { if (!Number.isInteger(v) || (v as number) < 0) throw new Error("signal[bad-seq]"); } else if (typeof v !== "string" || v.length === 0 || /[\u0000-\u001f\u007f]/.test(v)) throw new Error(`signal[bad-${f}]`); }
  if (k.market !== "SPOT" && k.market !== "FUTURES") throw new Error("signal[bad-market]"); if (k.side !== "BUY" && k.side !== "SELL") throw new Error("signal[bad-side]"); if (k.intent !== "ENTRY" && k.intent !== "EXIT" && k.intent !== "PROTECTION") throw new Error("signal[bad-intent]");
  return FIELDS.map((f) => `${f}=${String(k[f])}`).join("\n");
}
/** BELİRLENİMCİ: sha256(kanonik)[0..32) hex. Rastgelelik/zaman yok. Aynı sinyal her halkada, her zaman aynı kimliği verir. */
export function deriveClientOrderId(k: SignalKey): string { return CLIENT_ORDER_ID_PREFIX + createHash("sha256").update(canonicalSignal(k), "utf8").digest("hex").slice(0, 32); }

// ---- KATMAN 2: kilit ----
/** AÇIK — A-1'de yok, UYDURULDU (sicil, geri alınabilir). Kira = tek icra adımının süre tavanı: boğaz gönderimi (ölçülen exchangeInfo ≤ 2,5 s, /api ≤ 1 s) + Neon kayıt + Upstash gidiş-dönüş.
 *  A-4'e (zincir devri penceresi) BAĞLI DEĞİL: pencere bundan uzun olsa da çift icra kimlik katmanında durur; kira yalnız aynı anda iki halkanın boşa boğaz/ağırlık harcamasını önler. */
export const EXECUTION_LEASE_MS = 30_000;
export const LOCK_PREFIX = "execution-lock:";
export const lockKeyOf = (clientOrderId: string) => LOCK_PREFIX + clientOrderId;
export type LockDoc = { token: string; owner: string; until: string };
export type Lease = { key: string; token: string; owner: string; until: string; leaseMs: number };
export type Holder = { owner: string; until: string };
export type AcquireResult = { ok: true; lease: Lease } | { ok: false; reason: "HELD"; holder: Holder | null } | { ok: false; reason: "LOCK_UNAVAILABLE"; error: string };
export type LeaseOp = { ok: true } | { ok: false; reason: "STALE" | "LOCK_UNAVAILABLE"; error?: string };
export type HoldCheck = { held: true } | { held: false; reason: "STALE" | "LOCK_UNAVAILABLE"; error?: string };
/** Depo: üretimde Upstash; kapı/kanarya bellek deposu enjekte eder (S-9). Her yöntem fırlatabilir → çağıran kapalı arızalanır (yapılandırılmış sonuçla). */
export interface LockStore { setNx(key: string, value: string, pxMs: number): Promise<boolean>; get(key: string): Promise<string | null>; casExtend(key: string, expected: string, pxMs: number): Promise<boolean>; casDelete(key: string, expected: string): Promise<boolean> }
const EXTEND_LUA = "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('PEXPIRE', KEYS[1], ARGV[2]) return 1 end return 0";
const DELETE_LUA = "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]) return 1 end return 0";
export function upstashLockStore(cfg?: { url: string; token: string }): LockStore {
  const c = () => { if (cfg) return cfg; const e = pickEnv("UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"); return { url: e.UPSTASH_REDIS_REST_URL, token: e.UPSTASH_REDIS_REST_TOKEN }; };
  return {
    setNx: async (k, v, px) => (await redisPipeline([["SET", k, v, "PX", px, "NX"]], c()))[0] === "OK",
    get: async (k) => (await redisPipeline([["GET", k]], c()))[0] as string | null,
    casExtend: async (k, exp, px) => (await redisPipeline([["EVAL", EXTEND_LUA, 1, k, exp, px]], c()))[0] === 1,
    casDelete: async (k, exp) => (await redisPipeline([["EVAL", DELETE_LUA, 1, k, exp]], c()))[0] === 1,
  };
}
/** Kapı/kanarya deposu (S-9): süre `now` ile ölçülür, `fail` fırlatır. Atomiklik tek süreçte eşzamanlı çağrılar için de geçerli (senkron kontrol-ve-yaz). */
export function memoryLockStore(now: () => number = Date.now): LockStore & { data: Map<string, { v: string; exp: number }>; fail: boolean; calls: number } {
  const s = { data: new Map<string, { v: string; exp: number }>(), fail: false, calls: 0 };
  const live = (k: string) => { const e = s.data.get(k); if (e && e.exp <= now()) s.data.delete(k); return s.data.get(k) ?? null; }, guard = () => { s.calls++; if (s.fail) throw new Error("lock-store-down"); };
  return Object.assign(s, { setNx: async (k: string, v: string, px: number) => { guard(); if (live(k)) return false; s.data.set(k, { v, exp: now() + px }); return true; }, get: async (k: string) => { guard(); return live(k)?.v ?? null; },
    casExtend: async (k: string, exp: string, px: number) => { guard(); const e = live(k); if (!e || e.v !== exp) return false; e.exp = now() + px; return true; }, casDelete: async (k: string, exp: string) => { guard(); const e = live(k); if (!e || e.v !== exp) return false; s.data.delete(k); return true; } });
}
let prodStore: LockStore | null = null;
const defaultStore = (): LockStore => (prodStore ??= upstashLockStore());
const errName = (e: unknown) => (e as { name?: string })?.name ?? "error";
const parseDoc = (s: string | null): LockDoc | null => { if (s === null) return null; try { const d = JSON.parse(s) as LockDoc; return typeof d.token === "string" && typeof d.owner === "string" ? d : null; } catch { return null; } };
const docOf = (l: Lease): string => JSON.stringify({ token: l.token, owner: l.owner, until: l.until } satisfies LockDoc);

/** Kirayı al: SET PX NX. Jeton 128 bit RASTGELE (tahmin edilemez olması gereken yer budur; kimlik değil). Alınamazsa yapılandırılmış sonuç; ASLA fırlatmaz. */
export async function acquire(clientOrderId: string, owner: string, store: LockStore = defaultStore(), leaseMs: number = EXECUTION_LEASE_MS, now: () => number = Date.now): Promise<AcquireResult> {
  const key = lockKeyOf(clientOrderId), lease: Lease = { key, token: randomBytes(16).toString("hex"), owner, until: new Date(now() + leaseMs).toISOString(), leaseMs };
  try {
    if (await store.setNx(key, docOf(lease), leaseMs)) return { ok: true, lease };
    const h = parseDoc(await store.get(key)); return { ok: false, reason: "HELD", holder: h ? { owner: h.owner, until: h.until } : null };
  } catch (e) { return { ok: false, reason: "LOCK_UNAVAILABLE", error: errName(e) }; }
}
/** Sahiplik hâlâ bende mi? (fencing) Süresi dolmuş/el değiştirmiş kira → held:false. */
export async function holds(lease: Lease, store: LockStore = defaultStore()): Promise<HoldCheck> {
  try { const d = parseDoc(await store.get(lease.key)); return d && d.token === lease.token ? { held: true } : { held: false, reason: "STALE" }; } catch (e) { return { held: false, reason: "LOCK_UNAVAILABLE", error: errName(e) }; }
}
/** Kirayı uzat — yalnız jeton eşleşiyorsa (EVAL). Bayat sahip uzatamaz. */
export async function extend(lease: Lease, store: LockStore = defaultStore(), leaseMs: number = lease.leaseMs): Promise<LeaseOp> {
  try { return (await store.casExtend(lease.key, docOf(lease), leaseMs)) ? { ok: true } : { ok: false, reason: "STALE" }; } catch (e) { return { ok: false, reason: "LOCK_UNAVAILABLE", error: errName(e) }; }
}
/** Kirayı bırak — yalnız jeton eşleşiyorsa (EVAL). Jetonsuz bırakma yolu YOKTUR (tip: Lease zorunlu; kapı DEL desenini ayrıca yasaklar). */
export async function release(lease: Lease, store: LockStore = defaultStore()): Promise<LeaseOp> {
  try { return (await store.casDelete(lease.key, docOf(lease))) ? { ok: true } : { ok: false, reason: "STALE" }; } catch (e) { return { ok: false, reason: "LOCK_UNAVAILABLE", error: errName(e) }; }
}
