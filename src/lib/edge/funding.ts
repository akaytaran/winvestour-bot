// M-3 FUNDING TERİMİ (Tur 38 madde 4b · G22 açılışı · M-3, M-2, Ö-1, Ö-2, Ö-3). "Maliyet fonksiyonu süreyi içerir: girişte beklenen tutma süresinin funding maliyeti hesaba katılır."
// TERİM = ödeme sayısı × dönem başına funding oranı (bp), YÖNE göre işaretli (oran pozitifse LONG öder, SHORT alır). Ödeme sayısı = ⌈tutma süresi ÷ funding dönemi⌉:
//   funding ayrık anlarda ödenir; bir dönem süren pozisyon bir ödeme anını en fazla bir kez, kısa bir tutma bile bir kez KESEBİLİR — tavan (⌈⌉) en kötü durumdur.
// HİÇBİR SAYI GÖMÜLÜ DEĞİLDİR (kapı: scripts/gate-funding.mjs): oran ve dönem ÖLÇÜLÜR (Binance `/fapi/v1/premiumIndex` · `/fapi/v1/fundingRate`; dönem ham ödeme anlarından
//   TÜRETİLİR — ANAYASA "8 saat" der ama çift başına farklı olabilir, varsayılmaz). TUTMA SÜRESİ AÇIK PARAMETREDİR: varsayılanı YOKTUR; verilmezse terim hesaplanmaz, sebep ADIYLA döner.
//   Tutma süresinin bugünkü tek kaynağı Beyin kuralıdır (`holdMinutes`, src/lib/brain/schema.ts — "beklenen tutma süresi (dakika)"); bu modül onu OKUMAZ, çağıran verir.
// KAPALI ARIZA: futures yolu kapalıyken terim HESAPLANMAZ (`FUTURES_PATH_CLOSED`) — bugün `risk_settings` tavanı NULL olduğu için her futures çağrısı burada durur.
// SPOT YOLU DEĞİŞMEZ: spot'ta funding YOKTUR, terim 0'dır; SPOT maliyeti (`./cost.ts` readRoundTripCost) bu dosyayı içe AKTARMAZ ve çıktısı bayt bayt aynı kalır (kanarya ölçer).
// Ö-3: alınacak funding (işaretli terim < 0) MALİYETİ DÜŞÜRMEZ — terim sıfırın altına inmez. Alınan funding'in KENAR sayılıp sayılmayacağı (CARRY_HEDGE) G22'de açık bir sorudur.
import { Prisma } from "@/generated/prisma/client";
import type { FuturesVerdict } from "@/lib/risk-settings";
import { BP } from "./cost";

const D = Prisma.Decimal, SIGNED = /^-?\d+(\.\d+)?$/;
/** Birim dönüşümü (dakika → ms), eşik DEĞİL. */
const MS_PER_MIN = 60_000;
export const FUNDING_REFUSALS = { closed: "FUTURES_PATH_CLOSED", hold: "HOLD_UNSPECIFIED", rate: "FUNDING_RATE_UNMEASURED", period: "FUNDING_PERIOD_UNMEASURED" } as const;
export type FundingRefusal = (typeof FUNDING_REFUSALS)[keyof typeof FUNDING_REFUSALS];
export type FundingInput =
  | { venue: "SPOT" }
  | { venue: "FUTURES"; futures: FuturesVerdict; side: "LONG" | "SHORT"; holdMinutes: number | null | undefined; rateBp: string | null | undefined; periodMs: number | null | undefined; source: string };
export type FundingTerm =
  | { ok: true; venue: "SPOT" | "FUTURES"; fundingBp: string; signedBp: string; payments: number; workings: string }
  | { ok: false; refusal: FundingRefusal; detail: string };

/** Ham `lastFundingRate` (ondalık, ör. "0.0001") → dönem başına baz puan. Sayı değilse ölçüm YOKTUR (null). */
export function fundingRateBp(raw: unknown): string | null { return typeof raw === "string" && SIGNED.test(raw) ? new D(raw).mul(BP).toFixed(6) : null; }

/** Funding DÖNEMİ ham ödeme anlarından TÜRETİLİR: ardışık farklar dakikaya yuvarlanır (ölçüldü: damgalarda birkaç ms sapma var) ve HEPSİ aynıysa dönem odur.
 *  İki ödemeden azı ya da farklı aralıklar ⇒ dönem YOKTUR (varsayılmaz). Tur 35'in `measure-futures` kuralıyla AYNI (alet artık bu fonksiyonu çağırır). */
export function fundingPeriodFrom(times: number[]): { ok: true; periodMs: number; deltas: number[] } | { ok: false; deltas: number[]; detail: string } {
  const t = [...times].sort((a, b) => a - b), deltas = t.slice(1).map((x, i) => x - t[i]), round = (ms: number) => Math.round(ms / MS_PER_MIN) * MS_PER_MIN;
  if (deltas.length === 0) return { ok: false, deltas, detail: `dönem türetilemedi: ${t.length} ödeme anı (en az iki gerekir)` };
  const p = round(deltas[0]);
  if (!(p > 0) || deltas.some((d) => round(d) !== p)) return { ok: false, deltas, detail: `dönem türetilemedi: ödeme aralıkları eşit değil (${deltas.join(", ")} ms)` };
  return { ok: true, periodMs: p, deltas };
}

/** SAF. M-3'ün terimi. SPOT ⇒ 0. FUTURES ⇒ yol kapalıysa, tutma süresi yoksa, oran ya da dönem ölçülmemişse HESAPLANMAZ ve sebep ADIYLA döner (varsayılan yok). */
export function fundingTermBp(i: FundingInput): FundingTerm {
  if (i.venue === "SPOT") return { ok: true, venue: "SPOT", fundingBp: new D(0).toFixed(6), signedBp: new D(0).toFixed(6), payments: 0, workings: "SPOT: funding yoktur (M-3 yalnız futures pozisyonuna uygulanır) ⇒ terim 0" };
  if (!i.futures.allowed) return { ok: false, refusal: FUNDING_REFUSALS.closed, detail: `futures yolu KAPALI (${i.futures.refusal}) — funding terimi hesaplanmadı` };
  const hold = i.holdMinutes;
  if (typeof hold !== "number" || !Number.isInteger(hold) || hold <= 0) return { ok: false, refusal: FUNDING_REFUSALS.hold, detail: `beklenen tutma süresi verilmedi/geçersiz (holdMinutes=${String(hold)}) — varsayılan tutma süresi YOKTUR, terim hesaplanmadı` };
  const rate = typeof i.rateBp === "string" && SIGNED.test(i.rateBp) ? new D(i.rateBp) : null;
  if (rate === null) return { ok: false, refusal: FUNDING_REFUSALS.rate, detail: `funding oranı ölçülmedi (rateBp=${String(i.rateBp)}) — sabit oran kullanılmaz` };
  const period = i.periodMs;
  if (typeof period !== "number" || !Number.isInteger(period) || period <= 0) return { ok: false, refusal: FUNDING_REFUSALS.period, detail: `funding dönemi ölçülmedi (periodMs=${String(period)}) — dönem ham ödeme anlarından türetilir, varsayılmaz` };
  const payments = Math.ceil((hold * MS_PER_MIN) / period), sign = i.side === "LONG" ? 1 : -1;
  const signed = rate.mul(payments).mul(sign), cost = D.max(signed, 0);
  return { ok: true, venue: "FUTURES", fundingBp: cost.toFixed(6), signedBp: signed.toFixed(6), payments,
    workings: `funding = ⌈${hold} dk ÷ ${period / MS_PER_MIN} dk⌉ = ${payments} ödeme × ${rate.toFixed(6)} bp × ${i.side} (${sign}) = ${signed.toFixed(6)} bp ⇒ maliyet ${cost.toFixed(6)} bp${signed.lt(0) ? " (alınacak funding maliyeti düşürmez, Ö-3)" : ""} · kaynak ${i.source}` };
}

/** Futures maliyeti = M-2'nin üç terimi (komisyon + yayılma + derinlik) + M-3'ün funding terimi. Yalnız HESAPLANMIŞ terimle çağrılır (ret dalı toplanamaz — tip zorlar). */
export function withFunding(costBp: string, term: Extract<FundingTerm, { ok: true }>): string { return new D(costBp).add(term.fundingBp).toFixed(6); }
