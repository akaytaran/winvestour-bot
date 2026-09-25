// ASGARİ KENAR KAPISI + PORTFÖY TAVANI (G13 · M-2, M-4, K-9, M-1, A-1, A-2, A-6, Ö-1, Ö-3). Pozisyon açan yolun ÖNÜNDEKİ kapı (kapı: scripts/gate-edge.mjs).
// SIRA (hepsi kapalı arızalanır, hiçbiri fırlatmaz): evren ölçütleri (A-2) → maliyet (M-2, ./cost.ts) → asgari kenar (M-2) → maruziyet tavanı (K-9).
// M-2 — ASGARİ KENAR: beklenen hareket, o SEMBOL ve o BÜYÜKLÜK için hesaplanan gidiş-dönüş maliyetin en az `EDGE_MULTIPLE` katı değilse POZİSYON AÇILMAZ.
//   Çarpan ANAYASA'dan gelir, uydurulmaz (aşağıda). Eşik SABİT BİR SAYI DEĞİLDİR: çift başına, o anki ölçülen maliyetten hesaplanır (Tur 14'ün dersi).
//   "Beklenen hareket" bu modülde ÜRETİLMEZ — dışarıdan verilen bir girdidir; üreteni Beyin'dir (G15). Burada yalnız DOĞRULANIR ve karşılaştırılır.
// K-9 — TAVAN: toplam eş zamanlı maruziyet (birinci sınır) ve tek pozisyon payı (ikinci ve daha dar sınır). İkisi de `risk_profile`'dan okunur;
//   `max_total_exposure_pct` NULL ise POZİSYON AÇILMAZ — sayı İCAT EDİLMEZ (A-1/A-6 açık; boyutlandırmanın `max_single_position_pct` NULL kuralıyla aynı ilke).
// M-4 — İŞLEM YAPMAMAK GEÇERLİ ÇIKTIDIR: her ret sebebiyle, sayılarıyla ve KAYNAĞIYLA `POSITION_SKIPPED` olayına yazılır; sessiz atlama yoktur (K-8).
// M-1 — ÇIKIŞ VE KORUMA BU KAPIYA TAKILMAZ: bu modülü yalnız GİRİŞ yolu çağırır. `EDGE_GATE_BY_CLASS` tek yerdir ve EXIT/PROTECTION'ı false tutar (kapı zorlar).
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/db/client";
import type { Keyring } from "@/lib/crypto";
import { stopEngine, type Deps as EventDeps, type EmitResult } from "@/lib/events";
import type { ExchangeDeps } from "@/lib/events/exchange";
import type { KeySource } from "@/lib/fee-ledger/exchange";
import { readSymbolRules } from "@/lib/orders/filters";
import { readRoundTripCost, type CostReading, type CostRefusal, type Side } from "./cost";
import { judgeSymbol, readDayVolume, type UniverseRefusal } from "./universe";

/** ANAYASA M-2'DEN, UYDURULMADI: "beklenen hareket, gidiş-dönüş maliyetinin en az ÜÇ katı olmadan pozisyon açılmaz." Çarpan v0.9'daki ilk metinden bu yana ÜÇTÜR
 *  (PLAN'ın G13 satırındaki "maliyetin İKİ katı hareket taşıyan sinyal → açılmaz" bir EŞİK değil, aynı maddenin KANARYASIDIR: 2× < 3× olduğu için açılmaması beklenir).
 *  Değişecekse önce ANAYASA M-2 değişir (Ö-3: kapıyı geçmek için eşik değiştirilmez). Tek yer. */
export const EDGE_MULTIPLE = 3;
/** M-1 ile aynı ilke, ayrı sicil: hangi sınıf asgari kenar/tavan kapısına BAKAR. Çıkış ve koruma HİÇBİR koşulda bakmaz — TEK YER (kapı zorlar). */
export const EDGE_GATE_BY_CLASS = { ENTRY: true, DISCOVERY: false, EXIT: false, PROTECTION: false } as const;

const D = Prisma.Decimal, NUM = /^\d+(\.\d+)?$/;
const dec = (s: unknown): Prisma.Decimal | null => (typeof s === "string" && NUM.test(s) ? new D(s) : null);

// ---- M-2: asgari kenar ----
export type EdgeVerdict = { ok: true; thresholdBp: string; marginBp: string; workings: string } | { ok: false; refusal: "EDGE_BELOW_THRESHOLD" | "EXPECTED_MOVE_UNKNOWN"; detail: string };
/** SAF. Eşik = ölçülen maliyet × ANAYASA çarpanı. Beklenen hareket sayısal ve pozitif değilse karar VERİLMEZ (kapalı arıza) — varsayılan hareket YOKTUR. */
export function judgeEdge(i: { expectedMoveBp: string | null; costBp: string }): EdgeVerdict {
  const move = dec(i.expectedMoveBp), cost = dec(i.costBp);
  if (cost === null) return { ok: false, refusal: "EXPECTED_MOVE_UNKNOWN", detail: `maliyet ölçülemedi (costBp=${i.costBp})` };
  if (move === null || !move.gt(0)) return { ok: false, refusal: "EXPECTED_MOVE_UNKNOWN", detail: `beklenen hareket yok/geçersiz (expectedMoveBp=${i.expectedMoveBp ?? "yok"}); üreten Beyin'dir (G15), burada icat edilmez` };
  const threshold = cost.mul(EDGE_MULTIPLE), workings = `eşik = maliyet ${cost.toFixed(4)} bp × ${EDGE_MULTIPLE} = ${threshold.toFixed(4)} bp ↔ beklenen hareket ${move.toFixed(4)} bp`;
  if (move.lt(threshold)) return { ok: false, refusal: "EDGE_BELOW_THRESHOLD", detail: `${workings} ⇒ AÇILMAZ (M-2)` };
  return { ok: true, thresholdBp: threshold.toFixed(6), marginBp: move.sub(threshold).toFixed(6), workings: `${workings} ⇒ geçer` };
}

// ---- K-9: portföy tavanı ----
export type ExposureVerdict = { ok: true; totalAfter: string; totalCeiling: string; singleCeiling: string; workings: string[] } | { ok: false; refusal: "EXPOSURE_CEILING" | "SINGLE_POSITION_CEILING" | "EXPOSURE_UNKNOWN"; detail: string; workings: string[] };
export type ExposureInput = { capital: string; openExposure: string; newNotional: string; totalPct: string | null; singlePct: string | null };
/** SAF. İki sınır: toplam maruziyet (birinci) ve tek pozisyon payı (ikinci, daha dar). Yüzdeler `risk_profile`'dan; biri NULL ise karar verilmez, sayı icat edilmez. */
export function judgeExposure(i: ExposureInput): ExposureVerdict {
  const workings: string[] = [], cap = dec(i.capital), open = dec(i.openExposure), add = dec(i.newNotional), tp = dec(i.totalPct), sp = dec(i.singlePct);
  const no = (refusal: "EXPOSURE_CEILING" | "SINGLE_POSITION_CEILING" | "EXPOSURE_UNKNOWN", detail: string): ExposureVerdict => ({ ok: false, refusal, detail, workings });
  if (cap === null || !cap.gt(0) || open === null || add === null || !add.gt(0)) return no("EXPOSURE_UNKNOWN", `ölçülemeyen girdi: sermaye=${i.capital} açık maruziyet=${i.openExposure} yeni=${i.newNotional}`);
  if (tp === null || !tp.gt(0)) return no("EXPOSURE_UNKNOWN", `portföy toplam maruziyet tavanı YOK (risk_profile.max_total_exposure_pct=${i.totalPct ?? "NULL"}) — K-9/A-1/A-6 AÇIK, sayı icat edilmez`);
  if (sp === null || !sp.gt(0)) return no("EXPOSURE_UNKNOWN", `tek pozisyon payı YOK (risk_profile.max_single_position_pct=${i.singlePct ?? "NULL"}) — K-9/A-1/A-6 AÇIK, sayı icat edilmez`);
  const totalCeiling = cap.mul(tp).div(100), singleCeiling = cap.mul(sp).div(100), after = open.add(add);
  workings.push(`toplam tavan = sermaye ${cap.toFixed(8)} × %${tp.toFixed(3)} = ${totalCeiling.toFixed(8)}`, `açık ${open.toFixed(8)} + yeni ${add.toFixed(8)} = ${after.toFixed(8)}`, `tek pozisyon tavanı = sermaye ${cap.toFixed(8)} × %${sp.toFixed(3)} = ${singleCeiling.toFixed(8)}`);
  if (add.gt(singleCeiling)) return no("SINGLE_POSITION_CEILING", `yeni pozisyon ${add.toFixed(8)} > tek pozisyon tavanı ${singleCeiling.toFixed(8)} (K-9 ikinci ve daha dar sınır)`);
  if (after.gt(totalCeiling)) return no("EXPOSURE_CEILING", `toplam maruziyet ${after.toFixed(8)} > tavan ${totalCeiling.toFixed(8)} (K-9)`);
  return { ok: true, totalAfter: after.toFixed(8), totalCeiling: totalCeiling.toFixed(8), singleCeiling: singleCeiling.toFixed(8), workings };
}

// ---- çalışma anı okuyucuları ----
export type CeilingSource = () => Promise<{ totalPct: string | null; singlePct: string | null }>;
/** Tavan yüzdeleri risk profilinden (tek satır, id=1). İkisi de NULL olabilir — o zaman pozisyon açılmaz (sayı icat edilmez). */
export const prismaCeilingSource = (client?: PrismaClient): CeilingSource => async () => {
  const r = await (client ?? getDb()).riskProfile.findUnique({ where: { id: 1 }, select: { maxTotalExposurePct: true, maxSinglePositionPct: true } });
  const v = (x: unknown) => (x === null || x === undefined ? null : String(x));
  return { totalPct: v(r?.maxTotalExposurePct), singlePct: v(r?.maxSinglePositionPct) };
};
export type ExposureReader = () => Promise<string | null>;
/** AÇIK pozisyonların toplam maruziyeti = Σ (miktar × giriş fiyatı). Okunamazsa null → karar verilmez (kapalı arıza). */
export const prismaExposureReader = (client?: PrismaClient): ExposureReader => async () => {
  try {
    const rows = await (client ?? getDb()).position.findMany({ where: { status: "OPEN" }, select: { quantity: true, entryPrice: true } });
    return rows.reduce((a, r) => a.add(new D(String(r.quantity)).mul(String(r.entryPrice))), new D(0)).toFixed(8);
  } catch { return null; }
};

export type ScreenRefusal = "RULES_UNAVAILABLE" | UniverseRefusal | CostRefusal | "EDGE_BELOW_THRESHOLD" | "EXPECTED_MOVE_UNKNOWN" | "EXPOSURE_CEILING" | "SINGLE_POSITION_CEILING" | "EXPOSURE_UNKNOWN";
/** Ret sebebinin SİCİLDEKİ karşılığı (K-8, tek yer): ölçüm düşmesi bir DURMADIR (`STOPPED`), kural tutmaması bir ATLAMADIR (`POSITION_SKIPPED`, M-4 — kusur değil). */
export const SKIP_REASON_BY_REFUSAL: Record<ScreenRefusal, "COST_UNMEASURABLE" | "EDGE_BELOW_THRESHOLD" | "UNIVERSE_REJECTED" | "EXPOSURE_CEILING"> = {
  RULES_UNAVAILABLE: "COST_UNMEASURABLE", COMMISSION_UNMEASURABLE: "COST_UNMEASURABLE", SPREAD_UNMEASURABLE: "COST_UNMEASURABLE", DEPTH_UNMEASURABLE: "COST_UNMEASURABLE",
  DEPTH_TOO_THIN: "UNIVERSE_REJECTED", MANUALLY_EXCLUDED: "UNIVERSE_REJECTED", NOT_TRADING: "UNIVERSE_REJECTED", QUOTE_MISMATCH: "UNIVERSE_REJECTED",
  SPREAD_TOO_WIDE: "UNIVERSE_REJECTED", BELOW_MIN_NOTIONAL: "UNIVERSE_REJECTED", VOLUME_TOO_LOW: "UNIVERSE_REJECTED", UNMEASURED: "COST_UNMEASURABLE",
  EDGE_BELOW_THRESHOLD: "EDGE_BELOW_THRESHOLD", EXPECTED_MOVE_UNKNOWN: "EDGE_BELOW_THRESHOLD",
  EXPOSURE_CEILING: "EXPOSURE_CEILING", SINGLE_POSITION_CEILING: "EXPOSURE_CEILING", EXPOSURE_UNKNOWN: "EXPOSURE_CEILING",
};
export type ScreenDeps = { exchange?: ExchangeDeps; events?: EventDeps; ring?: Keyring; key?: KeySource; ceilings?: CeilingSource; exposure?: ExposureReader; now?: () => number };
export type ScreenPlan = { symbol: string; side: Side; notional: string; expectedMoveBp: string | null; capital: string };
export type ScreenOutcome =
  | { ok: true; cost: Extract<CostReading, { ok: true }>; thresholdBp: string; marginBp: string; workings: string[]; event: null }
  | { ok: false; refusal: ScreenRefusal; detail: string; cost: CostReading | null; workings: string[]; event: EmitResult | null };

/** GİRİŞ TARAMASI — pozisyon açan yol bunu geçmeden emir kuramaz. Her ret bir `POSITION_SKIPPED` olayıdır (M-4/K-8); hiçbir dal fırlatmaz. */
export async function screenEntry(p: ScreenPlan, deps: ScreenDeps = {}): Promise<ScreenOutcome> {
  const now = deps.now ?? Date.now, workings: string[] = [];
  const no = async (refusal: ScreenRefusal, detail: string, cost: CostReading | null): Promise<ScreenOutcome> =>
    ({ ok: false, refusal, detail, cost, workings, event: await stopEngine(SKIP_REASON_BY_REFUSAL[refusal], `${p.symbol} · ${refusal} · ${detail} · ${workings.join(" · ")}`, {}, deps.events) });
  const rules = await readSymbolRules(p.symbol, { exchange: deps.exchange, now });
  if (!rules.ok) return no("RULES_UNAVAILABLE", `${p.symbol} kuralları okunamadı: ${rules.detail}`, null);
  const cost = await readRoundTripCost({ symbol: p.symbol, side: p.side, notional: p.notional }, { exchange: deps.exchange, key: deps.key, ring: deps.ring, now });
  if (!cost.ok) return no(cost.refusal, `maliyet ölçülemedi: ${cost.detail} — bileşen eksikken giriş yapılmaz (M-1)`, cost);
  workings.push(`maliyet = komisyon ${cost.commissionBp} + yayılma ${cost.spreadBp} + derinlik ${cost.depthBp} = ${cost.totalBp} bp (${cost.discount}) @${cost.at}`, ...cost.sources);
  const vol = await readDayVolume(p.symbol, { exchange: deps.exchange, now });
  const u = judgeSymbol({ symbol: p.symbol, status: rules.rules.status, quoteAsset: rules.rules.quoteAsset, minNotional: rules.rules.minNotional, tickSize: rules.rules.price.step,
    midPrice: null, spreadBp: cost.spreadBp, depthBp: cost.depthBp, quoteVolume: vol.ok ? vol.quoteVolume : null, positionSize: p.notional, commissionRoundTripBp: cost.standardCommissionBp }); // çapa = STANDART komisyon (Tur 17 madde 2: indirim evreni daraltamaz)
  workings.push(...u.workings, vol.ok ? vol.source : `ticker/24hr okunamadı: ${vol.detail}`);
  if (!u.ok) return no(u.refusal, `evren ölçütü: ${u.detail}`, cost);
  const e = judgeEdge({ expectedMoveBp: p.expectedMoveBp, costBp: cost.totalBp });
  if (!e.ok) return no(e.refusal, e.detail, cost);
  workings.push(e.workings);
  let ceilings: { totalPct: string | null; singlePct: string | null };
  try { ceilings = await (deps.ceilings ?? prismaCeilingSource())(); } catch (x) { ceilings = { totalPct: null, singlePct: null }; workings.push(`risk_profile okunamadı: ${(x as { name?: string })?.name ?? "error"}`); }
  const open = await (deps.exposure ?? prismaExposureReader())();
  if (open === null) return no("EXPOSURE_UNKNOWN", "açık pozisyonların toplam maruziyeti okunamadı; tavan denetlenemez (kapalı arıza)", cost);
  const x = judgeExposure({ capital: p.capital, openExposure: open, newNotional: p.notional, totalPct: ceilings.totalPct, singlePct: ceilings.singlePct });
  workings.push(...x.workings);
  if (!x.ok) return no(x.refusal, x.detail, cost);
  return { ok: true, cost, thresholdBp: e.thresholdBp, marginBp: e.marginBp, workings, event: null };
}
