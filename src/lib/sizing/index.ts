// POZİSYON BOYUTLANDIRMA (G12 · madde 1 · K-9, M-4, S-7, A-1, A-6, Ö-1, Ö-3). SERMAYE MİKTARI KODA GİRMEZ ve sermaye düzeyine göre DAL YOKTUR.
// Hem etkin pozisyon sayısı hem tek pozisyon büyüklüğü ÇALIŞMA ANINDA türetilir: serbest sermaye HESAPTAN (imzalı /api/v3/account, quote varlığının FREE bakiyesi),
// asgari emir tutarı BORSADAN (exchangeInfo minNotional, G11 filtreleri), tek pozisyon payı RİSK PROFİLİNDEN (risk_profile.max_single_position_pct).
//   etkin azami pozisyon sayısı = min( yapılandırılmış tavan , ⌊ serbest sermaye ÷ asgari emir tutarı ⌋ )      ← tavan bir ÜST SINIR, hedef değil
//   tek pozisyon büyüklüğü      = serbest sermaye × tek pozisyon payı (K-9)                                     ← minNotional'ın altına düşerse POZİSYON AÇILMAZ
// PAY YUKARI ÇEKİLMEZ, ASGARİ TUTAR AŞAĞI ÇEKİLMEZ, KURAL GEVŞETİLMEZ (Ö-3): işlem yapmamak geçerli bir çıktıdır (M-4) ve sebebiyle olay yazılır (POSITION_SKIPPED, K-8).
// Aynı formül her sermaye düzeyinde aynı işler: 17 USDT'de az/hiç fırsat, 1000 USDT'de tavan kadar fırsat. Sermayeye özel dal yazmak kapıda KIRMIZI'dır.
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/db/client";
import type { Keyring } from "@/lib/crypto";
import { stopEngine, type Deps as EventDeps, type EmitResult } from "@/lib/events";
import type { ExchangeDeps } from "@/lib/events/exchange";
import { readCapital, type KeySource } from "@/lib/fee-ledger/exchange";
import { QUOTE_ASSET } from "@/lib/fee-ledger";
import { readSymbolRules } from "@/lib/orders/filters";

/** AÇIK — A-1'de sayı yok, A-6 (asgari işletme sermayesi) iş sahibi kararını bekliyor; UYDURULDU (sicil, geri alınabilir). Bu bir ÜST SINIRDIR, hedef DEĞİL:
 *  etkin sayı çalışma anında sermayeden türer ve bundan küçük olabilir (Tur 13 ölçümüyle bugün 0). 5 seçildi çünkü borsanın ÖLÇÜLEN emir sayısı tavanı
 *  `MAX_NUM_ALGO_ORDERS = 5`'tir (2026-09-09, BTCUSDT ve USUALUSDT): korumasız pozisyon yasak olduğuna göre (K-2) aynı sembolde 5'ten fazla eş zamanlı
 *  pozisyonun koruma emri borsada duramaz. Portföy maruziyet tavanının KENDİSİ (K-9) hâlâ AÇIK ve bu sabit onun yerine geçmez. */
export const POSITION_COUNT_CEILING = 5;

const D = Prisma.Decimal, NUM = /^\d+(\.\d+)?$/;
export type SizingRefusal = "BAD_NUMBER" | "SHARE_UNKNOWN" | "NO_CAPACITY" | "BELOW_MIN_NOTIONAL";
export type SizingInput = { freeCapital: string; minNotional: string; sharePct: string | null; ceiling?: number };
type Base = { maxPositions: number; positionSize: string | null; ceiling: number; workings: string[] };
export type SizingPlan = (Base & { ok: true; positionSize: string }) | (Base & { ok: false; refusal: SizingRefusal; detail: string });

/** SAF. Girdilerin hepsi çalışma anında ölçülmüş değerlerdir; bu fonksiyonda sermaye sabiti ve sermaye düzeyine göre dal YOKTUR (kapı ölçer). */
export function planPositionSize(i: SizingInput): SizingPlan {
  const ceiling = i.ceiling ?? POSITION_COUNT_CEILING, workings: string[] = [];
  const base = (o: Partial<Base> = {}): Base => ({ maxPositions: 0, positionSize: null, ceiling, workings, ...o });
  if (!NUM.test(i.freeCapital) || !NUM.test(i.minNotional) || !new D(i.minNotional).gt(0)) return { ...base(), ok: false, refusal: "BAD_NUMBER", detail: `serbest sermaye=${i.freeCapital} asgari emir tutarı=${i.minNotional}` };
  const cap = new D(i.freeCapital), min = new D(i.minNotional), byCapital = cap.div(min).floor().toNumber(), maxPositions = Math.min(ceiling, byCapital);
  workings.push(`etkin azami pozisyon = min(tavan ${ceiling}, floor(${cap.toFixed(10)} ÷ ${min.toFixed(8)}) = ${byCapital}) = ${maxPositions}`);
  if (i.sharePct === null || !NUM.test(i.sharePct) || !new D(i.sharePct).gt(0)) return { ...base({ maxPositions }), ok: false, refusal: "SHARE_UNKNOWN", detail: `tek pozisyon payı yok (risk_profile.max_single_position_pct=${i.sharePct}) — K-9/A-1/A-6 AÇIK, sayı icat edilmez` };
  const positionSize = cap.mul(i.sharePct).div(100).toFixed(8, D.ROUND_DOWN);
  workings.push(`tek pozisyon büyüklüğü = ${cap.toFixed(10)} × %${i.sharePct} ÷ 100 = ${positionSize} (aşağı yuvarlandı)`);
  if (maxPositions < 1) return { ...base({ maxPositions, positionSize }), ok: false, refusal: "NO_CAPACITY", detail: `serbest sermaye ${cap.toFixed(10)} asgari emir tutarına (${min.toFixed(8)}) yetmiyor; pozisyon açılmaz (M-4)` };
  if (new D(positionSize).lt(min)) return { ...base({ maxPositions, positionSize }), ok: false, refusal: "BELOW_MIN_NOTIONAL", detail: `tek pozisyon büyüklüğü ${positionSize} < asgari emir tutarı ${min.toFixed(8)}; pay yukarı çekilmez, asgari tutar aşağı çekilmez — pozisyon açılmaz (M-4, Ö-3)` };
  return { ...base({ maxPositions, positionSize }), ok: true, positionSize };
}

export type ShareSource = () => Promise<string | null>;
export type Deps = { exchange?: ExchangeDeps; events?: EventDeps; ring?: Keyring; key?: KeySource; share?: ShareSource; now?: () => number };
/** Tek pozisyon payı risk profilinden okunur (tek satır, id=1). Değer NULL ise pozisyon açılmaz — varsayılan pay YOKTUR (A-1/A-6 açık). */
export const prismaShareSource = (client?: PrismaClient): ShareSource => async () => {
  const r = await (client ?? getDb()).riskProfile.findUnique({ where: { id: 1 }, select: { maxSinglePositionPct: true } });
  return r?.maxSinglePositionPct === null || r?.maxSinglePositionPct === undefined ? null : String(r.maxSinglePositionPct);
};

export type SizingReading = { ok: true; plan: SizingPlan; freeCapital: string; minNotional: string; sharePct: string | null; source: string; event: EmitResult | null }
  | { ok: false; refusal: "CAPITAL_UNMEASURABLE" | "RULES_UNAVAILABLE"; detail: string; event: EmitResult | null };
/** ÇALIŞMA ANI okuması: serbest sermaye + asgari emir tutarı + pay → plan. Hiçbiri okunamazsa pozisyon açılmaz (kapalı arıza); plan reddederse sebebi olayla yazılır (M-4). */
export async function readSizing(symbol: string, deps: Deps = {}): Promise<SizingReading> {
  const now = deps.now ?? Date.now;
  const cap = await readCapital(QUOTE_ASSET, { exchange: deps.exchange, ring: deps.ring, key: deps.key, now });
  if (!cap.ok || cap.freeQuote === null || cap.freeQuote === undefined) return { ok: false, refusal: "CAPITAL_UNMEASURABLE", detail: cap.ok ? "serbest quote bakiyesi okunamadı" : cap.detail, event: await stopEngine("FEE_LEDGER_UNAVAILABLE", `boyutlandırma · ${symbol} · sermaye ölçülemedi: ${cap.ok ? "freeQuote yok" : cap.detail}`, {}, deps.events) };
  const rules = await readSymbolRules(symbol, { exchange: deps.exchange, now });
  if (!rules.ok) return { ok: false, refusal: "RULES_UNAVAILABLE", detail: rules.detail, event: await stopEngine("ORDER_RULES_UNAVAILABLE", `boyutlandırma · ${symbol} · ${rules.detail}`, {}, deps.events) };
  let sharePct: string | null = null, shareError: string | null = null;
  try { sharePct = await (deps.share ?? prismaShareSource())(); } catch (e) { shareError = (e as { name?: string })?.name ?? "error"; } // yutulmaz: hata kaynağa ve olaya yazılır
  const plan = planPositionSize({ freeCapital: cap.freeQuote, minNotional: rules.rules.minNotional, sharePct });
  const source = `serbest ${QUOTE_ASSET}=${cap.freeQuote} (${cap.source}) · minNotional=${rules.rules.minNotional} (${rules.rules.source}) · pay=${sharePct ?? (shareError === null ? "YOK" : `OKUNAMADI:${shareError}`)} (risk_profile)`;
  const event = plan.ok ? null : await stopEngine("POSITION_SKIPPED", `${symbol} · ${plan.refusal} · ${plan.detail} · ${source}`, {}, deps.events);
  return { ok: true, plan, freeCapital: cap.freeQuote, minNotional: rules.rules.minNotional, sharePct, source, event };
}
