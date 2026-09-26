// KALDIRAÇ İSTEĞİ (Tur 44 · G21 kalemi (i) · K-11, S-8, U-4, Ö-2 · karar `winvestor-kaldirac-tavan-asimi` = A). Uç: src/app/api/risk/leverage/route.ts (GET önizleme session · POST sensitive LEVERAGE_CHANGE).
// SIRA (her adım kapalı arızadır, ilk ret döner): istek geçerli mi → ayar okunur (TEK okuma yolu, readRiskRuntime) → tavan NULL ise RET → tavanı AŞAN istek RET (tavana İNDİRİLMEZ) →
//   futures şalteri → borsa anahtarının futures yetkisi → U-4 yükü (funding ÖLÇÜLÜR: ./../edge/funding-reader, İLK çağıranı budur; komisyon hesabın futures kademesinden) → uygula.
// UYGULAMA YOLU KAPALIDIR (Tur 49, G21-f birinci dilim): her şey geçen istek KABUL edilir, deftere ÖNCE yazılır ve kapalı sürücüye (src/lib/orders/futures-driver) verilir; sürücü `futures-driver-unavailable` ile REDDEDER;
//   ret bir değişiklik değildir ⇒ E-1 defterine (risk_setting_changes: eski → yeni) YAZILMAZ ve `risk_profile.leverage` DEĞİŞMEZ. Yarım yazma yolu bırakılmadı.
// BU MODÜLDE SAYI YOKTUR: tavan ayardan, oran/dönem borsadan, komisyon kademesi hesaptan gelir; ölçülemeyen sayı gösterilmez ("0" yazılmaz). Yazılım hiçbir kaldıraç sayısı SEÇMEZ.
import { Prisma } from "@/generated/prisma/client";
import { prismaKeyFutures } from "@/lib/exchange-key";
import type { ExchangeDeps } from "@/lib/events/exchange";
import { LEVERAGE_ACCEPTED_PENDING, LEVERAGE_REQUESTER, recordLeverageRequest, settleLeverageRequest } from "@/lib/events";
import { closedFuturesDriver, FUTURES_DRIVER_UNAVAILABLE, LEVERAGE_OUTCOME_UNKNOWN, type DriverResult, type DriverUnknown, type FuturesDriver } from "@/lib/orders/futures-driver";
import { checkK6Window, K6_CANARY_MAX_AGE_MS, K6_CANARY_SCRIPT, K6_WINDOW_REFUSAL, type K6Deps } from "@/lib/orders/k6-canary-window";
import { readFunding } from "@/lib/edge/funding-reader";
import { futuresRefusalText, readRiskRuntime, type FuturesRefusal, type SettingsDeps } from "./index";
import { reqLang } from "@/lib/i18n/request";
import { fill } from "@/lib/i18n";
import { srvFor, RECORD_LANG } from "@/lib/i18n/srv";
// TUR 79 (G34 · S5): cümleler SUNUCU SÖZLÜĞÜNDEN (src/lib/i18n/srv · leverage). Dil verilmezse İÇ KAYIT DİLİ (tr); uç isteğin dilini geçer. Ret/kip kodları dilden bağımsızdır.

const D = Prisma.Decimal, MS_PER_HOUR = 3_600_000; // birim dönüşümü, eşik değil
export const LEVERAGE_REFUSALS = { invalid: "leverage-refused:invalid-request", aboveCap: "leverage-refused:above-cap", keyNoFutures: "leverage-refused:key-futures-disabled",
  loadUnmeasured: "leverage-refused:load-unmeasured", unrecorded: "leverage-refused:unrecorded", driverUnavailable: FUTURES_DRIVER_UNAVAILABLE, k6Window: K6_WINDOW_REFUSAL } as const;
/** TUR 49 (G21-f) beklemede kodu — Tur 50'de sayım için src/lib/events'e taşındı (değer aynı); buradan da dışa aktarılır. */
export { LEVERAGE_ACCEPTED_PENDING, LEVERAGE_REQUESTER };
export type LeverageRefusal = (typeof LEVERAGE_REFUSALS)[keyof typeof LEVERAGE_REFUSALS] | FuturesRefusal;
export type CommissionReading = { ok: true; takerBp: string; source: string } | { ok: false; detail: string };
export type LeverageLoad = {
  funding: { ok: true; rateBp: string; perPeriodBp: string; periodHours: number; source: string; sentence: string } | { ok: false; refusal: string; detail: string; sentence: string };
  commission: { ok: true; takerBp: string; bothLegsBp: string; source: string; sentence: string } | { ok: false; detail: string; sentence: string };
};
export type LeverageOutcome = { ok: false; applied: false; refusal: LeverageRefusal; text: string; detail: string; requested: { symbol: string; leverage: number } | null; cap: number | null; load: LeverageLoad | null; exchangeCalls: number };
/** Bütün denetimlerden geçen istek (tavanın içinde · futures açık · anahtar yetkili · yük ölçüldü). KABUL uygulama DEĞİLDİR: uygulamayı sürücü yapar ve bugün sürücü KAPALIDIR. */
export type LeverageAccepted = { ok: true; applied: false; accepted: true; text: string; detail: string; requested: { symbol: string; leverage: number }; cap: number; load: LeverageLoad; exchangeCalls: number };
export type LeverageDeps = SettingsDeps & { exchange?: ExchangeDeps; keyFutures?: () => Promise<boolean | null>; commission?: (symbol: string) => Promise<CommissionReading>; driver?: FuturesDriver; k6?: K6Deps };

/** Üretimde futures komisyon kademesini okuyan yol YOK: kademe imzalı `/fapi/v1/commissionRate` ile okunur ve o çağrı G21-f ile doğar. Spot kademesi futures'a TAŞINMAZ, örnek oran yazılmaz. */
export const unmeasuredFuturesCommission = async (): Promise<CommissionReading> => ({ ok: false, detail: srvFor(RECORD_LANG).leverage.commissionUnmeasured });

/** Ret kodunun insan cümlesi (sözlük `leverage.text`); kod → anahtar eşlemesi burada, cümle sözlükte. Yeni ret kodu eklenirse derleyici eşlemeyi zorlar. */
const TEXT_KEY = { "leverage-refused:invalid-request": "invalid", "leverage-refused:above-cap": "aboveCap", "leverage-refused:key-futures-disabled": "keyNoFutures", "leverage-refused:load-unmeasured": "loadUnmeasured",
  "leverage-refused:unrecorded": "unrecorded", "leverage-refused:k6-canary-outside-window": "k6Window", "futures-driver-unavailable": "driverUnavailable" } as const satisfies Record<Exclude<LeverageRefusal, FuturesRefusal>, string>;
const textOf = (refusal: Exclude<LeverageRefusal, FuturesRefusal>, lang: string): string => fill(srvFor(lang).leverage.text[TEXT_KEY[refusal]], { hours: K6_CANARY_MAX_AGE_MS / MS_PER_HOUR });
const SYMBOL_RE = /^[A-Z0-9]{2,20}$/;

/** İsteği değerlendir. Fırlatmaz; borsaya yalnız GENEL (imzasız) funding uçları çağrılır ve yalnız futures yolu + anahtar yetkisi açıkken. Hiçbir dal kaydı değiştirmez; kabul uygulamak değildir. */
export async function evaluateLeverage(input: unknown, deps: LeverageDeps = {}): Promise<LeverageOutcome | LeverageAccepted> {
  const lang = deps.lang ?? RECORD_LANG, L = srvFor(lang).leverage;
  const i = (input ?? {}) as { symbol?: unknown; leverage?: unknown };
  const lev = typeof i.leverage === "string" && /^\d{1,4}$/.test(i.leverage) ? Number(i.leverage) : i.leverage;
  const requested = typeof i.symbol === "string" && SYMBOL_RE.test(i.symbol) && typeof lev === "number" && Number.isInteger(lev) && lev >= 1 ? { symbol: i.symbol, leverage: lev } : null;
  const no = (refusal: LeverageRefusal, detail: string, extra: Partial<LeverageOutcome> = {}): LeverageOutcome =>
    ({ ok: false, applied: false, refusal, text: refusal.startsWith("futures-unavailable:") ? futuresRefusalText(lang)[refusal as FuturesRefusal] : textOf(refusal as Exclude<LeverageRefusal, FuturesRefusal>, lang), detail, requested, cap: null, load: null, exchangeCalls: 0, ...extra });
  if (!requested) return no(LEVERAGE_REFUSALS.invalid, fill(L.detail.invalid, { symbol: JSON.stringify(i.symbol), leverage: JSON.stringify(i.leverage) }));
  const r = await readRiskRuntime({ ...deps, lang });
  if (!r.ok) return no("futures-unavailable:settings-unreadable", `${r.refusal}: ${r.detail}`);
  const cap = r.row.leverageCap;
  if (cap === null) return no("futures-unavailable:leverage-cap-null", L.detail.capNull);
  if (requested.leverage > cap) return no(LEVERAGE_REFUSALS.aboveCap, fill(L.detail.aboveCap, { req: requested.leverage, cap }), { cap });
  const v = r.runtime.futures;
  if (!v.allowed) return no(v.refusal, v.detail, { cap });
  let key: boolean | null; try { key = await (deps.keyFutures ?? prismaKeyFutures)(); } catch { key = null; }
  if (key !== true) return no(LEVERAGE_REFUSALS.keyNoFutures, fill(L.detail.keyNoFutures, { value: String(key) }), { cap });
  const load = await loadOf(requested, v, deps, lang);
  if (!load.load.funding.ok || !load.load.commission.ok) return no(LEVERAGE_REFUSALS.loadUnmeasured, [load.load.funding, load.load.commission].filter((x) => !x.ok).map((x) => x.detail).join(" · "), { cap, ...load });
  // TUR 50 (K-A, G21 şart 11): K-6 kanaryası "hemen önce" koşulmamışsa kabul YOK — sürücüye giden tek yol bu dönüşten geçer (kapalı-varsayılan; ayrıntı hangi şartın tutmadığını söyler)
  const k6 = await checkK6Window(deps.k6);
  if (!k6.ok) return no(LEVERAGE_REFUSALS.k6Window, `${K6_CANARY_SCRIPT}: ${k6.detail}`, { cap, ...load });
  return { ok: true, applied: false, accepted: true, text: L.preview, detail: L.detail.accepted, requested, cap, ...load };
}

/** U-4: seçilen kaldıraçta TEMİNATA göre yük. Funding dönem başına = kaldıraç × ölçülen oran (işaretli: pozitifse uzun yön öder); komisyon gidiş-dönüş = kaldıraç × 2 × taker kademesi. */
async function loadOf(q: { symbol: string; leverage: number }, v: Extract<Awaited<ReturnType<typeof readRiskRuntime>>, { ok: true }>["runtime"]["futures"], deps: LeverageDeps, lang: string): Promise<{ load: LeverageLoad; exchangeCalls: number }> {
  const f = await readFunding(q.symbol, v, deps.exchange), L = new D(q.leverage), T = srvFor(lang).leverage.load;
  const funding: LeverageLoad["funding"] = f.ok
    ? { ok: true, rateBp: f.rateBp, perPeriodBp: L.mul(f.rateBp).toFixed(6), periodHours: f.periodMs / MS_PER_HOUR, source: f.source,
        sentence: fill(T.funding, { hours: f.periodMs / MS_PER_HOUR, bp: L.mul(f.rateBp).toFixed(6), lev: q.leverage, rate: f.rateBp }) }
    : { ok: false, refusal: f.refusal, detail: f.detail, sentence: fill(T.fundingUnmeasured, { refusal: f.refusal }) };
  let c: CommissionReading; try { c = await (deps.commission ?? unmeasuredFuturesCommission)(q.symbol); } catch (e) { c = { ok: false, detail: fill(T.commissionReadFailed, { name: (e as Error)?.name ?? "error" }) }; }
  const commission: LeverageLoad["commission"] = c.ok
    ? { ok: true, takerBp: c.takerBp, bothLegsBp: L.mul(c.takerBp).mul(2).toFixed(6), source: c.source, sentence: fill(T.commission, { bp: L.mul(c.takerBp).mul(2).toFixed(6), lev: q.leverage, taker: c.takerBp }) }
    : { ok: false, detail: c.detail, sentence: T.commissionUnmeasured };
  return { load: { funding, commission }, exchangeCalls: f.ok ? 2 : f.sent };
}

/** Uç gövdesi (GET önizleme ve POST istek AYNI değerlendirmeden geçer; erişim sınıfı route.ts'te bildirilir). Durum: 400 geçersiz · 503 ayar okunamadı ya da KAYIT yazılamadı · 409 diğer her ret.
 *  TUR 48 (K-A): POST — sahibin İSTEĞİ — sonucu ne olursa olsun olay defterine yazılır (tür LEVERAGE_REQUEST, sebep = sonuç kodu, ayrıntı = kim · sembol · istenen · tavan). GET önizlemedir, istek
 *  değildir, kayıt yazmaz. Kayıt yazılamazsa istek `leverage-refused:unrecorded` ile REDDEDİLİR (kapalı-varsayılan). Kayıt, sonuca göre DALLANMADAN önce yazılır: G21-f kabul dalı doğduğunda
 *  aynı çağrıdan geçer ve borsaya yazan çağrı kaydın ARDINDAN gelmek zorundadır. Bildirim ÜRETİLMEZ (G19: bildirimsiz). */
export async function leverageResponse(req: Request, deps: LeverageDeps = {}): Promise<Response> {
  let input: unknown = null;
  if (req.method === "GET") { const u = new URL(req.url); input = { symbol: u.searchParams.get("symbol"), leverage: u.searchParams.get("leverage") }; }
  else { try { input = await req.json(); } catch { input = null; } }
  const lang = deps.lang ?? reqLang(req), R = srvFor(lang).leverage.record; // Tur 79: yanıtın insan metni isteğin dilinde; defter kaydı KODLARLA (dilden bağımsız)
  const o = await evaluateLeverage(input, { ...deps, lang });
  if (req.method === "GET") return Response.json(o, { status: o.ok ? 200 : statusOf(o.refusal) });
  // KAYIT ÖNCE (sonuca göre dallanmadan): ret kendi koduyla, kabul "beklemede" koduyla yazılır. Yazılamazsa istek REDDEDİLİR ve sürücü ÇAĞRILMAZ (kapalı-varsayılan).
  const rec = await recordLeverageRequest(o.ok ? LEVERAGE_ACCEPTED_PENDING : o.refusal, o.requested, o.cap, deps.events);
  const unrecorded = (why: string) => Response.json({ ...o, ok: false, applied: false, refusal: LEVERAGE_REFUSALS.unrecorded, text: textOf(LEVERAGE_REFUSALS.unrecorded, lang), detail: why, load: null, recorded: false }, { status: 503 });
  if (!rec.ok) return unrecorded(fill(R.notWritten, { code: rec.code, result: o.ok ? LEVERAGE_ACCEPTED_PENDING : o.refusal }));
  if (!o.ok) return Response.json({ ...o, recorded: true }, { status: statusOf(o.refusal) });
  // ÇAĞRI SONRA: sürücü yalnız DEFTERE YAZILMIŞ kaydın kimliğiyle çağrılabilir (markalı tip). Sonucu AYNI satıra yazılır; yazılamazsa sonuç bildirilmez.
  // TUR 50 (S49-2) UZLAŞTIRMA: satırın kapanışı sürücünün KENDİ dönüşünden türer — olmadı (kendi kodu) · BİLMİYORUM (fırlattı / açıkça bilmiyorum / tanınmayan biçim). "Oldu" bugün tipte yok.
  let d: DriverResult;
  try { d = classify(await (deps.driver ?? closedFuturesDriver).setLeverage({ recordId: rec.id, symbol: o.requested.symbol, leverage: o.requested.leverage }), lang); }
  catch (e) { d = unknownOf(fill(R.driverThrew, { name: (e as Error)?.name ?? "error" })); }
  const s = await settleLeverageRequest(rec.id, LEVERAGE_ACCEPTED_PENDING, d.refusal, deps.events);
  if (!s.ok) return unrecorded(fill(R.notSettled, { refusal: d.refusal, id: rec.id, code: s.code }));
  if ("unknown" in d) return Response.json({ ok: false, applied: null, outcome: "unknown", refusal: d.refusal, text: srvFor(lang).leverage.unknownText, detail: d.detail, requested: o.requested, cap: o.cap, load: o.load, exchangeCalls: o.exchangeCalls + d.exchangeCalls, recorded: true }, { status: 502 });
  return Response.json({ ok: false, applied: false, refusal: d.refusal, text: textOf(d.refusal, lang), detail: d.detail, requested: o.requested, cap: o.cap, load: o.load, exchangeCalls: o.exchangeCalls + d.exchangeCalls, recorded: true } satisfies LeverageOutcome & { recorded: true }, { status: 409 });
}
/** Sürücünün dönüşü yalnız TANINAN ret biçimindeyse "olmadı"dır; başka her biçim (ok:true dâhil — bugün "oldu" hâli yok) BİLMİYORUM sayılır: yazılım uygulanmış olabilecek kaldıracı "olmadı" diye kapatmaz. */
const classify = (d: unknown, lang: string = RECORD_LANG): DriverResult => { const x = d as { ok?: unknown; unknown?: unknown; refusal?: unknown; detail?: unknown; exchangeCalls?: unknown; exchangeResponse?: unknown } | null;
  if (x && x.ok === false && x.refusal === FUTURES_DRIVER_UNAVAILABLE && !("unknown" in x)) return d as DriverResult;
  if (x && x.ok === false && x.unknown === true && x.refusal === LEVERAGE_OUTCOME_UNKNOWN) return { ...x, detail: String(x.detail ?? ""), exchangeCalls: Number.isInteger(x.exchangeCalls) ? Number(x.exchangeCalls) : 0 } as DriverUnknown;
  return unknownOf(srvFor(lang).leverage.record.unrecognized); };
const unknownOf = (detail: string): DriverUnknown => ({ ok: false, unknown: true, refusal: LEVERAGE_OUTCOME_UNKNOWN, detail, exchangeCalls: 0, exchangeResponse: null });
const statusOf = (refusal: LeverageRefusal) => (refusal === LEVERAGE_REFUSALS.invalid ? 400 : refusal === "futures-unavailable:settings-unreadable" ? 503 : 409);
