// FUTURES GİRİŞİNİN KENAR KAPISI (Tur 84 · G22 kutuları (a), (b), (d) · M-2, M-3, K-9, M-4, M-1, Ö-1, Ö-2, Ö-3). SPOT'un `screenEntry`'sinin (./index.ts) futures karşılığıdır; SPOT dosyalarına
//   (./cost.ts, ./index.ts, ./universe.ts) DOKUNMAZ — onların baytları aynı kalır (canary:funding adım 8). Bağlandığı tek yer: `src/lib/protection` openProtectedPosition'ın futures dalı.
// SIRA (hepsi kapalı arızalanır, hiçbiri fırlatmaz, her ret bir olaydır — K-8/M-4):
//   (1) futures kapısı (`screenFutures`: tavan · şalter · ayar okunur mu) → (2) M-2 futures çarpanı (`risk_settings.m2_futures_multiple`; NULL ⇒ giriş YOK, sayı icat edilmez) →
//   (3) futures kuralları → (4) futures M-2 maliyeti = futures komisyon kademesi (hesabın kendi kademesi, imzalı) × 2 + futures yayılma × 1 + futures defter derinliği (planlanan büyüklükle) →
//   (5) M-3 funding terimi (`./funding-reader` oran + dönem ÖLÇÜLÜR, `./funding` terim; tutma süresi AÇIK parametre — verilmezse ya da oran/dönem okunamazsa giriş YOK, "0" varsayılmaz) →
//   (6) G22-b ÇARPIMLI EŞİK: eşik = (M-2 maliyeti + funding) × M-2 futures çarpanı; beklenen hareket eşiğin altındaysa AÇILMAZ →
//   (7) G22-d K-9: futures bacağının BRÜT nominali (miktar × fiyat — teminat DEĞİL, kaldıraçla bölünmez) açık SPOT + futures maruziyetinin üstüne eklenir (`./carry` judgeFuturesLegExposure).
// SPOT'TAN FARKI YALNIZ ÜÇTÜR: uçlar /fapi/, maliyete funding girer, çarpan ANAYASA'nın SPOT sabiti değil KULLANICI AYARIDIR (Tur 83 kararı D1).
// TUR 85 (Üretim S14-4 = A): A-2 EVREN ÖLÇÜTÜ futures girişinde de uygulanır — AYNI yargı (`./universe` judgeSymbol), AYNI oranlar (UNIVERSE_CRITERIA, tek yer), AYNI çapa (standart gidiş-dönüş
//   komisyon; futures'ta hesabın futures kademesi — commissionRate ucu indirim taşımaz). Girdiler futures piyasasından: futures kuralları (durum, asgari tutar, fiyat adımı), futures defterinin
//   yayılması ve derinliği (M-2 ölçümüyle aynı okuma), futures 24 saatlik quote hacmi. Sıra (3b): maliyet ölçüldükten SONRA, funding ve eşikten ÖNCE; geçilmezse giriş YOK, sicil UNIVERSE_REJECTED
//   (ölçülemezse COST_UNMEASURABLE). Yeni sayı YOK. SPOT dosyaları (./cost.ts, ./index.ts, ./universe.ts) DEĞİŞMEDİ — yalnız içe aktarılır.
// YÖN: yalnız uzun (BUY). Açığa satış (short/carry icrası) burada YOKTUR; emir yolu SATIŞ girişini zaten reddeder (Tur 83 futuresEntryGate).
import { Prisma } from "@/generated/prisma/client";
import type { Keyring } from "@/lib/crypto";
import { stopEngine, type Deps as EventDeps, type EmitResult } from "@/lib/events";
import { requestWithEvents, type ExchangeDeps } from "@/lib/events/exchange";
import { readFuturesSymbolRules } from "@/lib/orders/filters";
import { readFuturesCommission, type KeySource } from "@/lib/orders/futures-signed";
import { screenFutures, type SettingsStore } from "@/lib/risk-settings";
import { BP, COMMISSION_LEGS, DEPTH_LEVELS, SPREAD_LEGS, walkBook } from "./cost";
import { judgeFuturesLegExposure } from "./carry";
import { judgeSymbol } from "./universe";
import { fundingTermBp, withFunding } from "./funding";
import { readFunding } from "./funding-reader";
import { prismaCeilingSource, prismaExposureReader, type CeilingSource, type ExposureReader } from "./index";

const D = Prisma.Decimal, NUM = /^\d+(\.\d+)?$/;
const dec = (s: unknown): Prisma.Decimal | null => (typeof s === "string" && NUM.test(s) ? new D(s) : null);

/** Ağırlıklar Binance USDS-M belgesinden (boğaz her yanıtta başlıkla HİZALAR, S-7): bookTicker tek sembol 2 · depth limit 100 için 5. İkisi de imzasız genel uçtur. */
export const FUTURES_BOOK_TICKER_CALL = { path: "/fapi/v1/ticker/bookTicker", cls: "DISCOVERY", weight: 2 } as const;
export const FUTURES_DEPTH_CALL = { path: "/fapi/v1/depth", cls: "DISCOVERY", weight: 5 } as const;
/** Tur 85 (S14-4): futures 24 saatlik özet, tek sembol — ağırlık 1 (Binance USDS-M belgesi; boğaz başlıkla hizalar). İmzasız genel uç; A-2 hacim tabanının futures girdisi. */
export const FUTURES_DAY_TICKER_CALL = { path: "/fapi/v1/ticker/24hr", cls: "DISCOVERY", weight: 1 } as const;

// ---- futures M-2 maliyeti ----
export type FuturesCostRefusal = "COMMISSION_UNMEASURABLE" | "SPREAD_UNMEASURABLE" | "DEPTH_UNMEASURABLE" | "DEPTH_TOO_THIN";
export type FuturesCost = { ok: true; commissionBp: string; spreadBp: string; depthBp: string; totalBp: string; sources: string[] } | { ok: false; refusal: FuturesCostRefusal; detail: string };
type CostDeps = { exchange?: ExchangeDeps; key?: KeySource; ring?: Keyring; now?: () => number };
/** M-2'nin üç terimi FUTURES piyasasından: komisyon hesabın futures kademesinden (SPOT kademesi taşınmaz), yayılma ve derinlik futures defterinden. Biri ölçülemezse sonuç YOK (M-1). */
export async function readFuturesCost(i: { symbol: string; notional: string }, deps: CostDeps = {}): Promise<FuturesCost> {
  const now = deps.now ?? Date.now, at = () => new Date(now()).toISOString();
  const c = await readFuturesCommission(i.symbol, deps);
  if (!c.ok) return { ok: false, refusal: "COMMISSION_UNMEASURABLE", detail: `futures komisyon kademesi okunamadı: ${c.detail}` };
  const t = await requestWithEvents<{ symbol?: string; bidPrice?: string; askPrice?: string }>({ ...FUTURES_BOOK_TICKER_CALL, query: { symbol: i.symbol } }, deps.exchange);
  if (!t.result.ok) return { ok: false, refusal: "SPREAD_UNMEASURABLE", detail: `futures bookTicker:${t.result.reason ?? ""}:${t.result.detail}` };
  const bid = dec(t.result.data?.bidPrice), ask = dec(t.result.data?.askPrice);
  if (bid === null || ask === null || !bid.gt(0) || !ask.gt(0) || ask.lt(bid)) return { ok: false, refusal: "SPREAD_UNMEASURABLE", detail: `futures bookTicker:${i.symbol}:bid=${t.result.data?.bidPrice ?? "?"} ask=${t.result.data?.askPrice ?? "?"}` };
  const mid = bid.add(ask).div(2), spreadBp = ask.sub(bid).div(mid).mul(BP).mul(SPREAD_LEGS);
  const target = dec(i.notional);
  if (target === null || !target.gt(0)) return { ok: false, refusal: "DEPTH_UNMEASURABLE", detail: `futures depth:${i.symbol}:büyüklük=${i.notional}` };
  const b = await requestWithEvents<{ asks?: [string, string][] }>({ ...FUTURES_DEPTH_CALL, query: { symbol: i.symbol, limit: DEPTH_LEVELS } }, deps.exchange);
  if (!b.result.ok) return { ok: false, refusal: "DEPTH_UNMEASURABLE", detail: `futures depth:${b.result.reason ?? ""}:${b.result.detail}` };
  const asks = b.result.data?.asks;
  if (!Array.isArray(asks) || asks.length === 0) return { ok: false, refusal: "DEPTH_UNMEASURABLE", detail: `futures depth:${i.symbol}:asks boş` };
  const w = walkBook(asks, target);
  if (w === null) return { ok: false, refusal: "DEPTH_TOO_THIN", detail: `futures depth:${i.symbol}: defterin ilk ${asks.length} kademesi ${target.toFixed(8)} büyüklüğü taşımıyor` };
  const commissionBp = new D(c.takerBp).mul(COMMISSION_LEGS), total = commissionBp.add(spreadBp).add(w.impactBp);
  return { ok: true, commissionBp: commissionBp.toFixed(6), spreadBp: spreadBp.toFixed(6), depthBp: w.impactBp.toFixed(6), totalBp: total.toFixed(6),
    sources: [c.source, `futures bookTicker ${i.symbol} @${at()}`, `futures depth ${i.symbol} limit=${DEPTH_LEVELS} BUY @${at()}`] };
}

// ---- G22-b: çarpımlı eşik ----
export type FuturesEdgeVerdict = { ok: true; thresholdBp: string; marginBp: string; workings: string } | { ok: false; refusal: "EDGE_MULTIPLE_UNSET" | "EDGE_BELOW_THRESHOLD" | "EXPECTED_MOVE_UNKNOWN"; detail: string };
/** SAF. Eşik = futures giriş maliyeti (M-2 + funding) × M-2 FUTURES ÇARPANI (kullanıcı ayarı). Çarpan yoksa karar VERİLMEZ (sayı icat edilmez); beklenen hareket yoksa karar verilmez. */
export function judgeFuturesEdge(i: { expectedMoveBp: string | null; costBp: string; multiple: string | null }): FuturesEdgeVerdict {
  const m = dec(i.multiple), cost = dec(i.costBp), move = dec(i.expectedMoveBp);
  if (m === null || !m.gt(0)) return { ok: false, refusal: "EDGE_MULTIPLE_UNSET", detail: `M-2 futures çarpanı ayarlanmadı (m2_futures_multiple=${i.multiple ?? "NULL"}) — eşik kurulamaz, futures girişi yok (sayı icat edilmez)` };
  if (cost === null) return { ok: false, refusal: "EXPECTED_MOVE_UNKNOWN", detail: `futures maliyeti ölçülemedi (costBp=${i.costBp})` };
  if (move === null || !move.gt(0)) return { ok: false, refusal: "EXPECTED_MOVE_UNKNOWN", detail: `beklenen hareket yok/geçersiz (expectedMoveBp=${i.expectedMoveBp ?? "yok"}); üreten Beyin'dir, burada icat edilmez` };
  const threshold = cost.mul(m), workings = `futures eşiği = maliyet ${cost.toFixed(4)} bp × çarpan ${m.toString()} = ${threshold.toFixed(4)} bp ↔ beklenen hareket ${move.toFixed(4)} bp`;
  if (move.lt(threshold)) return { ok: false, refusal: "EDGE_BELOW_THRESHOLD", detail: `${workings} ⇒ AÇILMAZ (M-2, G22-b)` };
  return { ok: true, thresholdBp: threshold.toFixed(6), marginBp: move.sub(threshold).toFixed(6), workings: `${workings} ⇒ geçer` };
}

// ---- kapı ----
export type FuturesScreenRefusal = "FUTURES_PATH_CLOSED" | "EDGE_MULTIPLE_UNSET" | "RULES_UNAVAILABLE" | FuturesCostRefusal | "UNIVERSE_REJECTED" | "UNIVERSE_UNMEASURED" | "FUNDING_RATE_UNMEASURED" | "FUNDING_PERIOD_UNMEASURED" | "HOLD_UNSPECIFIED"
  | "EDGE_BELOW_THRESHOLD" | "EXPECTED_MOVE_UNKNOWN" | "EXPOSURE_CEILING" | "SINGLE_POSITION_CEILING" | "EXPOSURE_UNKNOWN";
/** Ret → sicil (K-8, tek yer): ÖLÇÜM düşmesi (kural/maliyet/funding okunamadı) bir DURMADIR (`COST_UNMEASURABLE`, Ö-2); kural tutmaması bir ATLAMADIR (M-4). */
export const FUTURES_SKIP_REASON: Record<FuturesScreenRefusal, "COST_UNMEASURABLE" | "FUTURES_EDGE_BELOW_THRESHOLD" | "EXPOSURE_CEILING" | "UNIVERSE_REJECTED"> = {
  UNIVERSE_REJECTED: "UNIVERSE_REJECTED", UNIVERSE_UNMEASURED: "COST_UNMEASURABLE",
  FUTURES_PATH_CLOSED: "FUTURES_EDGE_BELOW_THRESHOLD", EDGE_MULTIPLE_UNSET: "FUTURES_EDGE_BELOW_THRESHOLD", HOLD_UNSPECIFIED: "FUTURES_EDGE_BELOW_THRESHOLD",
  EDGE_BELOW_THRESHOLD: "FUTURES_EDGE_BELOW_THRESHOLD", EXPECTED_MOVE_UNKNOWN: "FUTURES_EDGE_BELOW_THRESHOLD",
  RULES_UNAVAILABLE: "COST_UNMEASURABLE", COMMISSION_UNMEASURABLE: "COST_UNMEASURABLE", SPREAD_UNMEASURABLE: "COST_UNMEASURABLE", DEPTH_UNMEASURABLE: "COST_UNMEASURABLE", DEPTH_TOO_THIN: "COST_UNMEASURABLE",
  FUNDING_RATE_UNMEASURED: "COST_UNMEASURABLE", FUNDING_PERIOD_UNMEASURED: "COST_UNMEASURABLE",
  EXPOSURE_CEILING: "EXPOSURE_CEILING", SINGLE_POSITION_CEILING: "EXPOSURE_CEILING", EXPOSURE_UNKNOWN: "EXPOSURE_CEILING",
};
export type FuturesScreenDeps = { exchange?: ExchangeDeps; events?: EventDeps; ring?: Keyring; key?: KeySource; ceilings?: CeilingSource; exposure?: ExposureReader; riskSettings?: SettingsStore; now?: () => number };
export type FuturesScreenPlan = { symbol: string; notional: string; expectedMoveBp: string | null; capital: string; holdMinutes?: number | null };
export type FuturesScreenOutcome =
  | { ok: true; venue: "FUTURES"; costBp: string; fundingBp: string; totalBp: string; thresholdBp: string; marginBp: string; workings: string[]; event: null }
  | { ok: false; venue: "FUTURES"; refusal: FuturesScreenRefusal; detail: string; workings: string[]; event: EmitResult | null };

/** FUTURES GİRİŞ TARAMASI — futures pozisyonu açan yol bunu geçmeden emir kuramaz. Hiçbir dal fırlatmaz; her ret bir olaydır. */
export async function futuresEntryEdge(p: FuturesScreenPlan, deps: FuturesScreenDeps = {}): Promise<FuturesScreenOutcome> {
  const now = deps.now ?? Date.now, workings: string[] = [];
  const no = async (refusal: FuturesScreenRefusal, detail: string): Promise<FuturesScreenOutcome> =>
    ({ ok: false, venue: "FUTURES", refusal, detail, workings, event: await stopEngine(FUTURES_SKIP_REASON[refusal], `${p.symbol} · FUTURES · ${refusal} · ${detail} · ${workings.join(" · ")}`, {}, deps.events) });
  const f = await screenFutures({ store: deps.riskSettings, events: deps.events });
  if (!f.allowed) return no("FUTURES_PATH_CLOSED", `futures yolu KAPALI (${f.refusal}): ${f.detail}`);
  if (f.m2FuturesMultiple === null) return no("EDGE_MULTIPLE_UNSET", "M-2 futures çarpanı ayarlanmadı (m2_futures_multiple=NULL) — eşik kurulamaz, futures girişi yok (sayı icat edilmez)");
  const rules = await readFuturesSymbolRules(p.symbol, { exchange: deps.exchange, now });
  if (!rules.ok) return no("RULES_UNAVAILABLE", `${p.symbol} futures kuralları okunamadı: ${rules.detail}`);
  const cost = await readFuturesCost({ symbol: p.symbol, notional: p.notional }, { exchange: deps.exchange, key: deps.key, ring: deps.ring, now });
  if (!cost.ok) return no(cost.refusal, `futures maliyeti ölçülemedi: ${cost.detail} — bileşen eksikken giriş yapılmaz (M-1)`);
  workings.push(`futures M-2 maliyeti = komisyon ${cost.commissionBp} + yayılma ${cost.spreadBp} + derinlik ${cost.depthBp} = ${cost.totalBp} bp`, ...cost.sources);
  // (3b) A-2 EVREN (S14-4): SPOT'un tek yargısı, futures girdileriyle. Hacim okunamazsa yargı UNMEASURED verir (kapalı arıza).
  const vol = await requestWithEvents<{ quoteVolume?: string }>({ ...FUTURES_DAY_TICKER_CALL, query: { symbol: p.symbol } }, deps.exchange);
  const quoteVolume = vol.result.ok ? dec(vol.result.data?.quoteVolume)?.toFixed(8) ?? null : null;
  const u = judgeSymbol({ symbol: p.symbol, status: rules.rules.status, quoteAsset: rules.rules.quoteAsset, minNotional: rules.rules.minNotional, tickSize: rules.rules.price.step,
    midPrice: null, spreadBp: cost.spreadBp, depthBp: cost.depthBp, quoteVolume, positionSize: p.notional, commissionRoundTripBp: cost.commissionBp });
  workings.push(...u.workings, `futures 24s hacim ${quoteVolume ?? `okunamadı (${vol.result.ok ? "quoteVolume yok" : vol.result.detail})`} @${new Date(now()).toISOString()}`);
  if (!u.ok) return no(u.refusal === "UNMEASURED" ? "UNIVERSE_UNMEASURED" : "UNIVERSE_REJECTED", `${u.refusal}: ${u.detail} — A-2 evren ölçütü (SPOT ile aynı oranlar ve çapa) geçilmedi`);
  const fr = await readFunding(p.symbol, f, deps.exchange);
  if (!fr.ok) return no(fr.refusal, `funding ölçülemedi: ${fr.detail} — oran/dönem okunamazsa giriş yok ("0" varsayılmaz, M-3)`);
  const term = fundingTermBp({ venue: "FUTURES", futures: f, side: "LONG", holdMinutes: p.holdMinutes, rateBp: fr.rateBp, periodMs: fr.periodMs, source: fr.source });
  if (!term.ok) return no(term.refusal, term.detail);
  const total = withFunding(cost.totalBp, term);
  workings.push(term.workings, `futures giriş maliyeti = M-2 ${cost.totalBp} + funding ${term.fundingBp} = ${total} bp`);
  const e = judgeFuturesEdge({ expectedMoveBp: p.expectedMoveBp, costBp: total, multiple: f.m2FuturesMultiple });
  if (!e.ok) return no(e.refusal, e.detail);
  workings.push(e.workings);
  let ceilings: { totalPct: string | null; singlePct: string | null };
  try { ceilings = await (deps.ceilings ?? prismaCeilingSource())(); } catch (x) { ceilings = { totalPct: null, singlePct: null }; workings.push(`risk_profile okunamadı: ${(x as { name?: string })?.name ?? "error"}`); }
  const open = await (deps.exposure ?? prismaExposureReader())();
  if (open === null) return no("EXPOSURE_UNKNOWN", "açık pozisyonların (SPOT + futures) toplam maruziyeti okunamadı; tavan denetlenemez (kapalı arıza)");
  const x = judgeFuturesLegExposure({ capital: p.capital, openExposure: open, notional: p.notional, totalPct: ceilings.totalPct, singlePct: ceilings.singlePct });
  workings.push(...x.workings);
  if (!x.ok) return no(x.refusal, x.detail);
  return { ok: true, venue: "FUTURES", costBp: cost.totalBp, fundingBp: term.fundingBp, totalBp: total, thresholdBp: e.thresholdBp, marginBp: e.marginBp, workings, event: null };
}
