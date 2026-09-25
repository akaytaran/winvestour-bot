// RİSK AYARLARI — KALDIRAÇ TAVANI · FUTURES ŞALTERİ · M-2 FUTURES TERİMİ · SHORT KİPİ (Tur 36 · G21 kalemleri b, d, g · A-1, A-5, K-11, K-2, M-2, S-8, E-1, Ö-2, U-3).
// Kapı: scripts/gate-risk-settings.mjs · kanarya: scripts/canary-risk-settings.mts. Kalıp Tur 25 `brain_settings` + Tur 28–30 `notify_settings` ile AYNIDIR; yeni kalıp icat edilmedi.
// İŞ SAHİBİ KARARLARI (2026-09-17): `winvestor-a5-futures-hesabi` ("önce kod, ama sabit değil — AYAR olarak"), `winvestor-acik-satis-short` ("üç kip de yazılır, varsayılan NONE"),
//   `winvestor-m2-futures-esigi` = [A] ("şimdi sayı seçilmez"). Talimat: "benden beklenen bu kararlar yazılımda parametrik ve ayarlanabilir olursa beklemene gerek kalmaz."
// BU MODÜL AYARIN TEK OKUMA YOLUDUR (kapı: ikinci okuyucu KIRMIZI). KAPALI ARIZA (Ö-2): ayar okunamaz ya da satır yoksa VARSAYILAN ÜRETİLMEZ — futures yolu reddedilir ve olay yazılır.
// BU MODÜLDE SAYI YOKTUR: kaldıraç tavanı, futures eşiği ve SHORT yönü bu dosyada hiçbir sabitle temsil edilmez; hepsi Neon `risk_settings` satırından gelir (kapı: sabit KIRMIZI).
// K-11 GEVŞEMEDİ: ayarın hiçbir değeri K-1/K-2 (koruma), K-6 (icra kilidi) ve K-7 (durdurma) kurallarını askıya alamaz — bu modül yalnız "futures yolu açık mı" ve "tavan nedir" der.
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/db/client";
import { stopEngine, type Deps as EventDeps, type EmitResult } from "@/lib/events";

/** AÇIK LİSTE — SHORT KİPLERİ yaprak modülde durur (`./modes`, hiçbir şey içe aktarmaz): Beyin şeması kipi BİLMEK zorundadır ama Beyin'in ÇALIŞMA ZAMANI GRAFİĞİ
 *  veritabanına/Upstash'e UZANAMAZ (B-3, Tur 31 dersi). Liste TİPtir; SEÇİLEN kip yalnız ayardan okunur (kapı: ikinci okuma yolu KIRMIZI).
 *  `NONE` = bugünkü davranış (Beyin şeması yalnız LONG üretir) · `CARRY_HEDGE` = funding carry'nin korumalı biçimi (yönü açar ama korumasız açığa satış değildir) · `FREE` = serbest yön.
 *  Bu turda hiçbir kip SHORT yönünde emir üretmez: emir yolu futures'ı reddeder (G21 kalemi f yazılmadı) ve LONG olmayan kural icraya geçmez (`planFromRule`). */
export { SHORT_MODES, CLOSED_SHORT_MODE, SHORT_MODE_NOTES, SHORT_MODE_EXECUTION, SHORT_MODE_TODAY } from "./modes";
export type { ShortMode } from "./modes";
import { SHORT_MODES, CLOSED_SHORT_MODE, type ShortMode } from "./modes";

export type RiskSettingsRow = { leverageCap: number | null; futuresEnabled: boolean; shortMode: ShortMode; m2FuturesMultiple: string | null };
export type SettingChange = { field: keyof RiskSettingsRow; from: string | null; to: string | null };
/** Çalışma değeri: ayar + türetilmiş futures hükmü. Çağıran ayarı KENDİ OKUMAZ; bu nesneyi alır (okuma yolu tektir). */
export type RiskRuntime = RiskSettingsRow & { futures: FuturesVerdict; source: string; sentence: string };

// ---- DEPO ----
export interface SettingsStore { read(): Promise<RiskSettingsRow | null>; write(next: RiskSettingsRow, by: string, changes: SettingChange[]): Promise<void>; changes(n: number): Promise<{ at: Date; by: string; changes: SettingChange[] }[]> }
const rowOf = (r: { leverageCap: number | null; futuresEnabled: boolean; shortMode: string; m2FuturesMultiple: unknown }): RiskSettingsRow =>
  ({ leverageCap: r.leverageCap, futuresEnabled: r.futuresEnabled, shortMode: r.shortMode as ShortMode, m2FuturesMultiple: r.m2FuturesMultiple === null || r.m2FuturesMultiple === undefined ? null : String(r.m2FuturesMultiple) });
/** Neon deposu. YAZMA VE DEFTER AYNI İŞLEMDE (E-1): defter yazılamazsa ayar da yazılmaz (kapı zorlar). */
export const prismaRiskSettingsStore = (client?: PrismaClient): SettingsStore => { const db = () => client ?? getDb(); return {
  read: async () => { const r = await db().riskSettings.findUnique({ where: { id: 1 } }); return r ? rowOf(r) : null; },
  write: async (next, by, changes) => { await db().$transaction([
    db().riskSettings.update({ where: { id: 1 }, data: { leverageCap: next.leverageCap, futuresEnabled: next.futuresEnabled, shortMode: next.shortMode, m2FuturesMultiple: next.m2FuturesMultiple } }),
    db().riskSettingChange.create({ data: { by, changes: changes as unknown as Prisma.InputJsonValue } }),
  ]); },
  changes: async (n) => (await db().riskSettingChange.findMany({ orderBy: { at: "desc" }, take: n })).map((c) => ({ at: c.at, by: c.by, changes: c.changes as unknown as SettingChange[] })),
}; };
/** Kapı/kanarya deposu (S-9): `fail` okuma/yazmayı düşürür, `journalFail` yalnız defteri — ikisinde de ayar DEĞİŞMEZ (işlem taklidi). */
export function memoryRiskSettingsStore(row: RiskSettingsRow | null = null): SettingsStore & { row: RiskSettingsRow | null; log: { at: Date; by: string; changes: SettingChange[] }[]; fail: boolean; journalFail: boolean } {
  const s = { row, log: [] as { at: Date; by: string; changes: SettingChange[] }[], fail: false, journalFail: false };
  return Object.assign(s, {
    read: async () => { if (s.fail) throw new Error("risk-settings-store-down"); return s.row; },
    write: async (next: RiskSettingsRow, by: string, changes: SettingChange[]) => { if (s.fail) throw new Error("risk-settings-store-down"); if (s.journalFail) throw new Error("risk-settings-journal-down"); s.row = next; s.log.unshift({ at: new Date(), by, changes }); },
    changes: async (n: number) => s.log.slice(0, n),
  });
}

// ---- DOĞRULAMA ----
export type SettingsPatch = Partial<RiskSettingsRow>;
export type PatchOutcome = { ok: true; next: RiskSettingsRow; changes: SettingChange[] } | { ok: false; errors: string[] };
const DEC_RE = /^\d{1,8}(\.\d{1,4})?$/;
/** Yama bütünüyle geçer ya da bütünüyle REDDEDİLİR. Tavan: pozitif tamsayı ya da NULL (üst sınır KODDA YOKTUR — sayı seçmek iş sahibinin işidir, A-1/K-11).
 *  Şalter: tavan NULL iken AÇILAMAZ (kapalı arıza; veritabanında da CHECK var). Kip: açık listeden. M-2 terimi: pozitif ondalık ya da NULL. */
export function validatePatch(cur: RiskSettingsRow, patch: SettingsPatch): PatchOutcome {
  const errors: string[] = [], next: RiskSettingsRow = { ...cur };
  for (const k of Object.keys(patch) as (keyof RiskSettingsRow)[]) if (!(k in cur)) errors.push("bilinmeyen alan: " + String(k));
  if (patch.leverageCap !== undefined) { const v = patch.leverageCap;
    if (v !== null && !(typeof v === "number" && Number.isInteger(v) && v >= 1)) errors.push("kaldıraç tavanı pozitif tamsayı (≥ 1) ya da null olmalı: " + String(v)); else next.leverageCap = v; }
  if (patch.futuresEnabled !== undefined) { const v = patch.futuresEnabled;
    if (typeof v !== "boolean") errors.push("futures şalteri boolean olmalı: " + String(v)); else next.futuresEnabled = v; }
  if (patch.shortMode !== undefined) { const v = patch.shortMode;
    if (typeof v !== "string" || !(SHORT_MODES as readonly string[]).includes(v)) errors.push(`SHORT kipi açık listede değil: ${String(v)} — izinli: ${SHORT_MODES.join(", ")}`); else next.shortMode = v as ShortMode; }
  if (patch.m2FuturesMultiple !== undefined) { const v = patch.m2FuturesMultiple;
    if (v !== null && !(typeof v === "string" && DEC_RE.test(v) && Number(v) > 0)) errors.push("M-2 futures ÇARPANI pozitif ondalık dize ya da null olmalı (birim: çarpan, bp değil): " + String(v)); else next.m2FuturesMultiple = v; }
  if (next.futuresEnabled && next.leverageCap === null) errors.push("kaldıraç tavanı seçilmeden futures şalteri açılamaz (K-11, kapalı arıza): önce leverage_cap");
  if (errors.length) return { ok: false, errors };
  const changes: SettingChange[] = (Object.keys(cur) as (keyof RiskSettingsRow)[]).filter((k) => String(cur[k]) !== String(next[k])).map((k) => ({ field: k, from: cur[k] === null ? null : String(cur[k]), to: next[k] === null ? null : String(next[k]) }));
  return { ok: true, next, changes };
}

// ---- OKUMA (TEK YOL) + KAPALI ARIZA ----
export type SettingsDeps = { store?: SettingsStore; events?: EventDeps; now?: () => number };
export type RuntimeOutcome = { ok: true; runtime: RiskRuntime; row: RiskSettingsRow } | { ok: false; refusal: "RISK_SETTINGS_UNREADABLE"; detail: string; event: EmitResult | null };
const errName = (e: unknown) => (e as { name?: string })?.name ?? "error";
/** TEK OKUMA YOLU. Fırlatmaz. Okunamaz / satır yok / kayıtlı ayar geçersiz ⇒ KAPALI ARIZA: futures yolu açılmaz, olay yazılır, VARSAYILANA DÜŞÜLMEZ (Ö-2). */
export async function readRiskRuntime(deps: SettingsDeps = {}): Promise<RuntimeOutcome> {
  const store = deps.store ?? prismaRiskSettingsStore();
  const no = async (detail: string): Promise<RuntimeOutcome> => ({ ok: false, refusal: "RISK_SETTINGS_UNREADABLE", detail,
    event: await stopEngine("RISK_SETTINGS_UNREADABLE", `risk ayarı okunamadı: ${detail} — futures yolu açılmadı, varsayılana DÜŞÜLMEDİ (Ö-2); spot çıkış ve borsadaki koruma sürer`, {}, deps.events) });
  let row: RiskSettingsRow | null; try { row = await store.read(); } catch (e) { return no("depo hatası (" + errName(e) + ")"); }
  if (row === null) return no("risk_settings satırı yok (id=1); göç uygulanmamış olabilir");
  const v = validatePatch(row, row); if (!v.ok) return no("kayıtlı ayar geçersiz: " + v.errors.join(" · "));
  const futures = judgeFutures(row);
  return { ok: true, row, runtime: { ...row, futures, source: "risk_settings#1", sentence: sentenceOf(row, futures) } };
}

// ---- FUTURES HÜKMÜ (KAPALI ARIZA) ----
/** Ret sebepleri Tur 35'in `ceiling-unavailable:<kapsam>` kalıbıyla adlandırıldı: ad hem kütükte hem yanıtta AYNI dizedir, "kapalı" diye genellenmez. */
export const FUTURES_REFUSALS = { capNull: "futures-unavailable:leverage-cap-null", disabled: "futures-unavailable:futures-disabled", unreadable: "futures-unavailable:settings-unreadable" } as const;
export type FuturesRefusal = (typeof FUTURES_REFUSALS)[keyof typeof FUTURES_REFUSALS];
export type FuturesVerdict = { allowed: true; leverageCap: number; m2FuturesMultiple: string | null } | { allowed: false; refusal: FuturesRefusal; detail: string };
/** RET SEBEBİNİN İNSAN CÜMLESİ (Tur 37 · U-3). `detail` denetçi içindir (sütun adı, kural numarası taşır); EKRANA bu sözlükten gelen cümle çıkar — ham kod ekrana ÇIKMAZ (kapı: gate:ui).
 *  `satisfies Record<FuturesRefusal, string>`: yeni bir ret sebebi eklenirse derleyici cümlesini ZORLAR; ekranda sebepsiz "KAPALI" yazan bir hâl doğamaz. */
export const FUTURES_REFUSAL_TEXT = {
  "futures-unavailable:leverage-cap-null": "Kaldıraç tavanı seçilmediği için futures yolu KAPALI. Tavan seçilmeden kaldıraçlı işlem açılmaz ve yazılım kendi başına bir sayı seçmez — o sayı iş sahibinin kararıdır.",
  "futures-unavailable:futures-disabled": "Futures şalteri kapalı olduğu için futures yolu KAPALI. Şalteri açmak, futures hesabının açılmasını ve borsa anahtarının bu yetkiyle yeniden kabul edilmesini gerektirir.",
  "futures-unavailable:settings-unreadable": "Risk ayarı okunamadı, bu yüzden futures yolu KAPALI sayıldı. Okunamayan ayar “sorun yok” demek değildir; kapalı arıza uygulanır ve motor durdurulur.",
} as const satisfies Record<FuturesRefusal, string>;
/** SAF. Tavan NULL ⇒ kapalı · şalter kapalı ⇒ kapalı. İkisi de tamamsa ayar futures'a İZİN VERİR — ama bu turda emir yolu yine de reddeder (G21 kalemi f yazılmadı, K2). */
export function judgeFutures(row: RiskSettingsRow): FuturesVerdict {
  if (row.leverageCap === null) return { allowed: false, refusal: FUTURES_REFUSALS.capNull, detail: "kaldıraç tavanı SEÇİLMEDİ (risk_settings.leverage_cap NULL) — K-11: tavansız kaldıraç yoktur; sayı icat edilmez" };
  if (!row.futuresEnabled) return { allowed: false, refusal: FUTURES_REFUSALS.disabled, detail: "futures şalteri KAPALI (risk_settings.futures_enabled = false) — A-5: hesabın açılması ve şalter iş sahibindedir" };
  return { allowed: true, leverageCap: row.leverageCap, m2FuturesMultiple: row.m2FuturesMultiple };
}
/** Futures yolunun TEK KAPISI: ayarı okur, hükmü verir. Okunamazsa KAPALI ARIZA (ret + olay); hiçbir dal "izin var" demez. */
export async function screenFutures(deps: SettingsDeps = {}): Promise<FuturesVerdict> {
  const r = await readRiskRuntime(deps);
  if (!r.ok) return { allowed: false, refusal: FUTURES_REFUSALS.unreadable, detail: `${r.refusal}: ${r.detail}` };
  return r.runtime.futures;
}
/** SHORT kipi — TEK OKUMA YOLU. Okunamazsa bugünkü davranış (NONE): kip "serbest" varsayılmaz (Ö-2). */
export async function readShortMode(deps: SettingsDeps = {}): Promise<{ mode: ShortMode; from: "ayar" | "kapalı varsayılan"; detail: string }> {
  const r = await readRiskRuntime(deps);
  return r.ok ? { mode: r.runtime.shortMode, from: "ayar", detail: r.runtime.source } : { mode: CLOSED_SHORT_MODE, from: "kapalı varsayılan", detail: `${r.refusal}: ${r.detail}` };
}

/** U-3 — YALNIZ VERİDEN CÜMLE: ekranda ve kütükte aynı cümle; "0"/boş ne demek yazılı. */
export function sentenceOf(row: RiskSettingsRow, v: FuturesVerdict): string {
  const cap = row.leverageCap === null ? "kaldıraç tavanı SEÇİLMEDİ (boş ⇒ futures kapalı)" : `kaldıraç tavanı ${row.leverageCap}×`;
  const m2 = row.m2FuturesMultiple === null ? "M-2 futures çarpanı SEÇİLMEDİ (boş ⇒ futures kenarı ölçülemez)" : `M-2 futures çarpanı ${row.m2FuturesMultiple}× (maliyetin katı)`;
  const kip = row.shortMode === "NONE" ? "SHORT kipi NONE: yalnız uzun yön, bugünkü davranış" : `SHORT kipi ${row.shortMode}`;
  return `${cap} · futures şalteri ${row.futuresEnabled ? "AÇIK" : "KAPALI"} · ${kip} · ${m2} — futures yolu ${v.allowed ? "ayara göre AÇIK (emir yolu ayrıca yazılmadı: G21 kalemi f)" : `KAPALI: ${v.refusal}`}.`;
}

// ---- YAZMA (S-8 hassas eylem + E-1 defteri) ----
export type WriteOutcome = { ok: true; next: RiskSettingsRow; changes: SettingChange[] } | { ok: false; status: 400 | 409 | 503; reason: "INVALID" | "NO_ROW" | "STORE_UNAVAILABLE"; errors: string[] };
/** YAZMA: doğrula → ayarı ve defteri AYNI işlemde yaz. Uç `withAccess({ cls: "sensitive", action: "RISK_SETTINGS_CHANGE" })` ile korunur (kapı ölçer); bu fonksiyon oturumu/TOTP'yi kendi denetlemez. */
export async function writeRiskSettings(patch: SettingsPatch, by: string, deps: SettingsDeps = {}): Promise<WriteOutcome> {
  const store = deps.store ?? prismaRiskSettingsStore();
  let cur: RiskSettingsRow | null; try { cur = await store.read(); } catch (e) { return { ok: false, status: 503, reason: "STORE_UNAVAILABLE", errors: ["ayar okunamadı (" + errName(e) + ")"] }; }
  if (cur === null) return { ok: false, status: 409, reason: "NO_ROW", errors: ["risk_settings satırı yok (id=1); göç uygulanmamış olabilir"] };
  const v = validatePatch(cur, patch); if (!v.ok) return { ok: false, status: 400, reason: "INVALID", errors: v.errors };
  try { await store.write(v.next, by, v.changes); } catch (e) { return { ok: false, status: 503, reason: "STORE_UNAVAILABLE", errors: ["ayar ya da E-1 defteri yazılamadı (" + errName(e) + ") — ayar DEĞİŞMEDİ"] }; }
  return { ok: true, next: v.next, changes: v.changes };
}
