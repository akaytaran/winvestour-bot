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
// Tur 79 (G34): kipin cümleleri DİLE GÖRE — kip yaprağı (modes.ts) B-3 gereği hiçbir şey içe aktarmaz ve TR cümlesinin kaynağı orada kalır; sözlüğün TR kopyası ona DERİN EŞİT
//   olmak zorundadır (gate:i18n (16b)). Uç (`/api/risk/settings`) cümleyi isteğin dilinde buradan alır.
export const shortModeNotes = (lang: string = RECORD_LANG): Record<"NONE" | "CARRY_HEDGE" | "FREE", string> => srvFor(lang).risk.modes.notes;
export const shortModeToday = (lang: string = RECORD_LANG): Record<"NONE" | "CARRY_HEDGE" | "FREE", string> => srvFor(lang).risk.modes.today;
import { SHORT_MODES, CLOSED_SHORT_MODE, type ShortMode } from "./modes";
import { fill } from "@/lib/i18n";
import { srvFor, RECORD_LANG } from "@/lib/i18n/srv";
// TUR 79 (G34 · S5): cümleler SUNUCU SÖZLÜĞÜNDEN (src/lib/i18n/srv · risk). Dil verilmezse İÇ KAYIT DİLİ (tr); uç isteğin dilini geçer. Ret/kip kodları dilden bağımsızdır.

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
  // Tur 78: aynı E-1 defterine risk PAYI satırları da yazılır (aşağıda) — bu ayarın okuması onları DIŞARIDA bırakır ⇒ `/api/risk/settings` yanıtı Tur 77'dekiyle aynı içerikte kalır.
  changes: async (n) => (await db().riskSettingChange.findMany({ where: { NOT: SHARE_LEDGER_FILTER }, orderBy: { at: "desc" }, take: n })).map((c) => ({ at: c.at, by: c.by, changes: c.changes as unknown as SettingChange[] })),
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
export function validatePatch(cur: RiskSettingsRow, patch: SettingsPatch, lang: string = RECORD_LANG): PatchOutcome {
  const errors: string[] = [], next: RiskSettingsRow = { ...cur }, E = srvFor(lang).risk.errors;
  for (const k of Object.keys(patch) as (keyof RiskSettingsRow)[]) if (!(k in cur)) errors.push(fill(E.unknownField, { field: String(k) }));
  if (patch.leverageCap !== undefined) { const v = patch.leverageCap;
    if (v !== null && !(typeof v === "number" && Number.isInteger(v) && v >= 1)) errors.push(fill(E.leverageCap, { value: String(v) })); else next.leverageCap = v; }
  if (patch.futuresEnabled !== undefined) { const v = patch.futuresEnabled;
    if (typeof v !== "boolean") errors.push(fill(E.futures, { value: String(v) })); else next.futuresEnabled = v; }
  if (patch.shortMode !== undefined) { const v = patch.shortMode;
    if (typeof v !== "string" || !(SHORT_MODES as readonly string[]).includes(v)) errors.push(fill(E.shortMode, { value: String(v), allowed: SHORT_MODES.join(", ") })); else next.shortMode = v as ShortMode; }
  if (patch.m2FuturesMultiple !== undefined) { const v = patch.m2FuturesMultiple;
    if (v !== null && !(typeof v === "string" && DEC_RE.test(v) && Number(v) > 0)) errors.push(fill(E.m2, { value: String(v) })); else next.m2FuturesMultiple = v; }
  if (next.futuresEnabled && next.leverageCap === null) errors.push(E.futuresNoCap);
  if (errors.length) return { ok: false, errors };
  const changes: SettingChange[] = (Object.keys(cur) as (keyof RiskSettingsRow)[]).filter((k) => String(cur[k]) !== String(next[k])).map((k) => ({ field: k, from: cur[k] === null ? null : String(cur[k]), to: next[k] === null ? null : String(next[k]) }));
  return { ok: true, next, changes };
}

// ---- OKUMA (TEK YOL) + KAPALI ARIZA ----
export type SettingsDeps = { store?: SettingsStore; events?: EventDeps; now?: () => number; /** Tur 79: dönen insan metninin dili (verilmezse iç kayıt dili) */ lang?: string };
export type RuntimeOutcome = { ok: true; runtime: RiskRuntime; row: RiskSettingsRow } | { ok: false; refusal: "RISK_SETTINGS_UNREADABLE"; detail: string; event: EmitResult | null };
const errName = (e: unknown) => (e as { name?: string })?.name ?? "error";
/** TEK OKUMA YOLU. Fırlatmaz. Okunamaz / satır yok / kayıtlı ayar geçersiz ⇒ KAPALI ARIZA: futures yolu açılmaz, olay yazılır, VARSAYILANA DÜŞÜLMEZ (Ö-2). */
export async function readRiskRuntime(deps: SettingsDeps = {}): Promise<RuntimeOutcome> {
  const store = deps.store ?? prismaRiskSettingsStore(), lang = deps.lang ?? RECORD_LANG, R = srvFor(lang).risk.runtime, REC = srvFor(RECORD_LANG).risk.runtime;
  // Olay (sicil) metni İÇ KAYIT DİLİNDE; dönen `detail` isteğin dilinde.
  const no = async (detail: string, recDetail: string = detail): Promise<RuntimeOutcome> => ({ ok: false, refusal: "RISK_SETTINGS_UNREADABLE", detail,
    event: await stopEngine("RISK_SETTINGS_UNREADABLE", fill(REC.unreadable, { detail: recDetail }), {}, deps.events) });
  let row: RiskSettingsRow | null; try { row = await store.read(); } catch (e) { return no(fill(R.storeError, { name: errName(e) }), fill(REC.storeError, { name: errName(e) })); }
  if (row === null) return no(R.noRow, REC.noRow);
  const v = validatePatch(row, row, lang); if (!v.ok) { const vr = validatePatch(row, row); return no(fill(R.invalid, { errors: v.errors.join(" · ") }), fill(REC.invalid, { errors: vr.ok ? "" : vr.errors.join(" · ") })); }
  const futures = judgeFutures(row, lang);
  return { ok: true, row, runtime: { ...row, futures, source: "risk_settings#1", sentence: sentenceOf(row, futures, lang) } };
}

// ---- FUTURES HÜKMÜ (KAPALI ARIZA) ----
/** Ret sebepleri Tur 35'in `ceiling-unavailable:<kapsam>` kalıbıyla adlandırıldı: ad hem kütükte hem yanıtta AYNI dizedir, "kapalı" diye genellenmez. */
export const FUTURES_REFUSALS = { capNull: "futures-unavailable:leverage-cap-null", disabled: "futures-unavailable:futures-disabled", unreadable: "futures-unavailable:settings-unreadable" } as const;
export type FuturesRefusal = (typeof FUTURES_REFUSALS)[keyof typeof FUTURES_REFUSALS];
export type FuturesVerdict = { allowed: true; leverageCap: number; m2FuturesMultiple: string | null } | { allowed: false; refusal: FuturesRefusal; detail: string };
/** RET SEBEBİNİN İNSAN CÜMLESİ (Tur 37 · U-3). `detail` denetçi içindir (sütun adı, kural numarası taşır); EKRANA bu sözlükten gelen cümle çıkar — ham kod ekrana ÇIKMAZ (kapı: gate:ui).
 *  `satisfies Record<FuturesRefusal, string>`: yeni bir ret sebebi eklenirse derleyici cümlesini ZORLAR; ekranda sebepsiz "KAPALI" yazan bir hâl doğamaz. */
export const futuresRefusalText = (lang: string = RECORD_LANG): Record<FuturesRefusal, string> => { const T = srvFor(lang).risk.futuresText;
  return { [FUTURES_REFUSALS.capNull]: T.capNull, [FUTURES_REFUSALS.disabled]: T.disabled, [FUTURES_REFUSALS.unreadable]: T.unreadable } satisfies Record<FuturesRefusal, string>; };
export const FUTURES_REFUSAL_TEXT: Record<FuturesRefusal, string> = futuresRefusalText();
/** SAF. Tavan NULL ⇒ kapalı · şalter kapalı ⇒ kapalı. İkisi de tamamsa ayar futures'a İZİN VERİR — ama bu turda emir yolu yine de reddeder (G21 kalemi f yazılmadı, K2). */
export function judgeFutures(row: RiskSettingsRow, lang: string = RECORD_LANG): FuturesVerdict {
  const T = srvFor(lang).risk.futuresDetail;
  if (row.leverageCap === null) return { allowed: false, refusal: FUTURES_REFUSALS.capNull, detail: T.capNull };
  if (!row.futuresEnabled) return { allowed: false, refusal: FUTURES_REFUSALS.disabled, detail: T.disabled };
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
export function sentenceOf(row: RiskSettingsRow, v: FuturesVerdict, lang: string = RECORD_LANG): string {
  const T = srvFor(lang).risk.summary;
  const cap = row.leverageCap === null ? T.capUnset : fill(T.cap, { cap: row.leverageCap });
  const m2 = row.m2FuturesMultiple === null ? T.m2Unset : fill(T.m2, { m2: row.m2FuturesMultiple });
  const kip = row.shortMode === "NONE" ? T.modeNone : fill(T.mode, { mode: row.shortMode });
  return fill(T.line, { cap, futures: row.futuresEnabled ? T.on : T.off, mode: kip, m2, path: v.allowed ? T.pathOpen : fill(T.pathClosed, { refusal: v.refusal }) });
}

// ---- YAZMA (S-8 hassas eylem + E-1 defteri) ----
export type WriteOutcome = { ok: true; next: RiskSettingsRow; changes: SettingChange[] } | { ok: false; status: 400 | 409 | 503; reason: "INVALID" | "NO_ROW" | "STORE_UNAVAILABLE"; errors: string[] };
/** YAZMA: doğrula → ayarı ve defteri AYNI işlemde yaz. Uç `withAccess({ cls: "sensitive", action: "RISK_SETTINGS_CHANGE" })` ile korunur (kapı ölçer); bu fonksiyon oturumu/TOTP'yi kendi denetlemez. */
export async function writeRiskSettings(patch: SettingsPatch, by: string, deps: SettingsDeps = {}): Promise<WriteOutcome> {
  const store = deps.store ?? prismaRiskSettingsStore(), lang = deps.lang ?? RECORD_LANG, W = srvFor(lang).risk.write;
  let cur: RiskSettingsRow | null; try { cur = await store.read(); } catch (e) { return { ok: false, status: 503, reason: "STORE_UNAVAILABLE", errors: [fill(W.readFailed, { name: errName(e) })] }; }
  if (cur === null) return { ok: false, status: 409, reason: "NO_ROW", errors: [W.noRow] };
  const v = validatePatch(cur, patch, lang); if (!v.ok) return { ok: false, status: 400, reason: "INVALID", errors: v.errors };
  try { await store.write(v.next, by, v.changes); } catch (e) { return { ok: false, status: 503, reason: "STORE_UNAVAILABLE", errors: [fill(W.writeFailed, { name: errName(e) })] }; }
  return { ok: true, next: v.next, changes: v.changes };
}

// ---- RİSK PAYLARI: TEK POZİSYON PAYI + TOPLAM MARUZİYET (Tur 78 · G33 · K-9, A-1/A-6, S-8, Ö-3, U-3) ----
// Yer: `risk_profile` id=1 (`max_single_position_pct`, `max_total_exposure_pct`). Okuyucular (edge/sizing/panel) DEĞİŞMEDİ; bu bölüm yalnız YAZMA yolunu ve onun E-1 defterini ekler.
// Defter: `risk_setting_changes` (E-1 risk defteri; tek okuma/yazma yolu kuralı gereği bu dosyada). Alan adları `maxSinglePositionPct` / `maxTotalExposurePct`; `/api/risk/settings` bu satırları görmez.
// BU BÖLÜMDE SAYI YOKTUR ve HİÇBİR DEĞER ÖNERİLMEZ (A-1/A-6: sayı iş sahibinindir): varsayılan, tohum, örnek yok. Satır yoksa YALNIZ gönderilen değerle oluşur; gönderilmeyen alan NULL kalır.
// SINIRLAR YALNIZ YAZILI KAYNAKTAN — (1) > 0: okuyucular (`edge.judgeExposure`, `sizing.planPositionSize`) pozitif olmayan payı "yok" sayar ⇒ yazılsa kapalı arıza olurdu;
//   (2) sütun DECIMAL(6,3): en çok 3 tam + 3 ondalık hane — fazlası REDDEDİLİR, yuvarlanmaz/kırpılmaz (Ö-3); (3) K-9 "tek pozisyon payı ikinci ve DAHA DAR sınır": iki değer de
//   biliniyorsa tek pay ≤ toplam. Belgede olmayan bir üst sınır (ör. yüzde yüz) İCAT EDİLMEDİ. NULL'a geri çekme bu turda YOK (null → 400).
export const SHARE_FIELDS = ["singlePositionPct", "totalExposurePct"] as const;
export type ShareField = (typeof SHARE_FIELDS)[number];
export type RiskShares = { singlePositionPct: string | null; totalExposurePct: string | null };
export type ShareChange = { field: "maxSinglePositionPct" | "maxTotalExposurePct"; from: string | null; to: string };
const LEDGER_FIELD = { singlePositionPct: "maxSinglePositionPct", totalExposurePct: "maxTotalExposurePct" } as const;
/** Defterde pay satırlarını ayıran süzgeç (jsonb @>): alan adlarından biri geçen satır pay satırıdır. */
const SHARE_LEDGER_FILTER = { OR: [{ changes: { array_contains: [{ field: "maxSinglePositionPct" }] } }, { changes: { array_contains: [{ field: "maxTotalExposurePct" }] } }] };
const SHARE_RE = /^\d{1,3}(\.\d{1,3})?$/;
const sameDec = (a: string | null, b: string | null) => (a === null || b === null ? a === b : new Prisma.Decimal(a).eq(new Prisma.Decimal(b)));
export type SharesOutcome = { ok: true; next: RiskShares; changes: ShareChange[] } | { ok: false; errors: string[] };
/** SAF. Gövde bütünüyle geçer ya da bütünüyle REDDEDİLİR. Hata metinleri İngilizce ve sayı ÖNERMEZ (yalnız kuralı söyler). */
// Tur 79: pay iletileri sözlükten (srv · shares). Tur 78'de İngilizce yazılmışlardı ⇒ dil verilmezse varsayılan EN (iç çıktı DEĞİŞMEDİ); uç isteğin dilini geçer.
export function validateShares(cur: RiskShares, body: unknown, lang: string = "en"): SharesOutcome {
  const E = srvFor(lang).shares.errors;
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, errors: [E.notObject] };
  const keys = Object.keys(body), errors: string[] = [], next: RiskShares = { ...cur };
  for (const k of keys) if (!(SHARE_FIELDS as readonly string[]).includes(k)) errors.push(fill(E.unknownField, { field: k, allowed: SHARE_FIELDS.join(", ") }));
  if (keys.filter((k) => (SHARE_FIELDS as readonly string[]).includes(k)).length === 0) errors.push(E.noValue);
  for (const f of SHARE_FIELDS) { if (!(f in body)) continue; const v = (body as Record<string, unknown>)[f];
    if (typeof v !== "number" || !Number.isFinite(v)) { errors.push(fill(E.notNumber, { field: f, type: v === null ? "null" : typeof v })); continue; }
    const s = String(v);
    if (!SHARE_RE.test(s)) { errors.push(fill(E.digits, { field: f, value: s })); continue; }
    if (!(v > 0)) { errors.push(fill(E.notPositive, { field: f })); continue; }
    next[f] = s; }
  if (errors.length === 0 && next.singlePositionPct !== null && next.totalExposurePct !== null && new Prisma.Decimal(next.singlePositionPct).gt(new Prisma.Decimal(next.totalExposurePct)))
    errors.push(fill(E.singleAboveTotal, { single: next.singlePositionPct, total: next.totalExposurePct }));
  if (errors.length) return { ok: false, errors };
  const changes: ShareChange[] = SHARE_FIELDS.filter((f) => !sameDec(cur[f], next[f])).map((f) => ({ field: LEDGER_FIELD[f], from: cur[f], to: next[f] as string }));
  return { ok: true, next, changes };
}
export interface SharesStore { read(): Promise<RiskShares | null>; write(next: RiskShares, by: string, changes: ShareChange[], createRow: boolean): Promise<void>; changes(n: number): Promise<{ at: Date; by: string; changes: ShareChange[] }[]> }
const decStr = (x: unknown) => (x === null || x === undefined ? null : String(x));
/** Neon deposu. PAY YAZIMI VE DEFTER AYNI İŞLEMDE (E-1): defter yazılamazsa pay da yazılmaz. `createRow` = satır yoktu ⇒ YALNIZ gönderilen değerlerle oluşturulur (varsayılan yok). */
export const prismaRiskSharesStore = (client?: PrismaClient): SharesStore => { const db = () => client ?? getDb(); return {
  read: async () => { const r = await db().riskProfile.findUnique({ where: { id: 1 }, select: { maxSinglePositionPct: true, maxTotalExposurePct: true } }); return r ? { singlePositionPct: decStr(r.maxSinglePositionPct), totalExposurePct: decStr(r.maxTotalExposurePct) } : null; },
  write: async (next, by, changes, createRow) => { const data = { maxSinglePositionPct: next.singlePositionPct, maxTotalExposurePct: next.totalExposurePct };
    await db().$transaction([
      createRow ? db().riskProfile.create({ data: { id: 1, ...data } }) : db().riskProfile.update({ where: { id: 1 }, data }),
      db().riskSettingChange.create({ data: { by, changes: changes as unknown as Prisma.InputJsonValue } }),
    ]); },
  changes: async (n) => (await db().riskSettingChange.findMany({ where: SHARE_LEDGER_FILTER, orderBy: { at: "desc" }, take: n })).map((c) => ({ at: c.at, by: c.by, changes: c.changes as unknown as ShareChange[] })),
}; };
export type SharesRead = { ok: true; shares: RiskShares; rowExists: boolean } | { ok: false; detail: string };
/** Okuma (GET). Fırlatmaz. Okunamazsa ok:false — "boş" SAYILMAZ (Ö-2). */
export async function readRiskShares(deps: { store?: SharesStore; lang?: string } = {}): Promise<SharesRead> {
  const store = deps.store ?? prismaRiskSharesStore();
  try { const r = await store.read(); return { ok: true, shares: r ?? { singlePositionPct: null, totalExposurePct: null }, rowExists: r !== null }; } catch (e) { return { ok: false, detail: fill(srvFor(deps.lang ?? "en").shares.readFailed, { name: errName(e) }) }; }
}
export type SharesWrite = { ok: true; next: RiskShares; changes: ShareChange[] } | { ok: false; status: 400 | 503; reason: "INVALID" | "STORE_UNAVAILABLE"; errors: string[] };
/** YAZMA: oku → doğrula → pay + defter AYNI işlemde. Uç `withAccess({ cls: "sensitive", action: "RISK_PROFILE_CHANGE" })` ile korunur (kapı ölçer); bu fonksiyon kodu kendi denetlemez.
 *  Değişiklik yoksa (aynı değerler) hiçbir şey yazılmaz — defter DEĞİŞİKLİK kaydıdır. */
export async function writeRiskShares(body: unknown, by: string, deps: { store?: SharesStore; lang?: string } = {}): Promise<SharesWrite> {
  const lang = deps.lang ?? "en", SH = srvFor(lang).shares;
  const store = deps.store ?? prismaRiskSharesStore();
  let cur: RiskShares | null; try { cur = await store.read(); } catch (e) { return { ok: false, status: 503, reason: "STORE_UNAVAILABLE", errors: [fill(SH.writeReadFailed, { name: errName(e) })] }; }
  const v = validateShares(cur ?? { singlePositionPct: null, totalExposurePct: null }, body, lang); if (!v.ok) return { ok: false, status: 400, reason: "INVALID", errors: v.errors };
  if (v.changes.length === 0) return { ok: true, next: v.next, changes: [] };
  try { await store.write(v.next, by, v.changes, cur === null); } catch (e) { return { ok: false, status: 503, reason: "STORE_UNAVAILABLE", errors: [fill(SH.writeFailed, { name: errName(e) })] }; }
  return { ok: true, next: v.next, changes: v.changes };
}
/** Kapı/kanarya deposu (S-9): `fail` okuma/yazmayı, `journalFail` yalnız defteri düşürür — ikisinde de pay DEĞİŞMEZ (işlem taklidi). */
export function memoryRiskSharesStore(row: RiskShares | null = null): SharesStore & { row: RiskShares | null; log: { at: Date; by: string; changes: ShareChange[] }[]; fail: boolean; journalFail: boolean } {
  const s = { row, log: [] as { at: Date; by: string; changes: ShareChange[] }[], fail: false, journalFail: false };
  return Object.assign(s, {
    read: async () => { if (s.fail) throw new Error("risk-shares-store-down"); return s.row; },
    write: async (next: RiskShares, by: string, changes: ShareChange[]) => { if (s.fail) throw new Error("risk-shares-store-down"); if (s.journalFail) throw new Error("risk-shares-journal-down"); s.row = next; s.log.unshift({ at: new Date(), by, changes }); },
    changes: async (n: number) => s.log.slice(0, n),
  });
}
