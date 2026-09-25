// FUNDING ORANI + DÖNEMİ OKUYUCUSU (Tur 42 madde 3 · G22 kalemi d'nin GENEL UÇ yarısı · M-3, S-7, Ö-2). M-3 terimine (`./funding.ts` fundingTermBp) girecek iki ÖLÇÜMÜ borsadan okur:
//   · oran  — `GET /fapi/v1/premiumIndex?symbol=` → `lastFundingRate` (ham ondalık) → `fundingRateBp` (dönem başına bp; terim modülünün KENDİ dönüştürücüsü)
//   · dönem — `GET /fapi/v1/fundingRate?symbol=&limit=` → ödeme anları → `fundingPeriodFrom` (terim modülünün KENDİ türetici kuralı; ANAYASA'nın "8 saat"i VARSAYILMAZ)
// İKİ UÇ DA İMZASIZ ve ANAHTARSIZDIR (genel piyasa verisi). Çağrılar ürünün boğazından geçer (`requestWithEvents` → src/lib/binance: tavan, askı, sayaç, futures kapsamı — Tur 35);
//   bu dosyada ağ istemcisi YOKTUR. Sınıf DISCOVERY: giriş kararına girdi toplar, koruma/çıkış değildir (boğaz payı).
// KAPALI ARIZA: (1) futures yolu kapalıysa (`FuturesVerdict.allowed = false` — bugün tavan NULL) HİÇBİR ÇAĞRI ÇIKMAZ, ret `FUTURES_PATH_CLOSED` (G22 kabul kriteri (e): "futures kapalıyken funding
//   okunmaz"); (2) oran okunamazsa `FUNDING_RATE_UNMEASURED`, dönem türetilemezse `FUNDING_PERIOD_UNMEASURED` — sabit oran/dönem YOKTUR, sebep ADIYLA döner. Ret sözlüğü terim modülününkidir.
// ⚠ ÇAĞIRANI YOKTUR (2026-09-18, Tur 42 madde 3c — GİZLENMEZ): bu okuyucu bugün HİÇBİR ürün yolundan çağrılmaz. Ürün yoluna bağlanması G22 kalemi c'ye (futures emir yolu = G21-f) bağlıdır,
//   o da A-5'e (iş sahibinin futures hesabı + `enableFutures`) bağlıdır. "Ölü mekanizma yeşil sayılamaz": bu dosyanın varlığı G22'nin kapandığı anlamına GELMEZ; G22 AÇIKTIR.
//   Bugün yalnız kanarya (`scripts/canary-funding-reader.mts`) canlı genel uca karşı çağırır. Bağlanacağı yer: futures giriş kararı, `screenFutures` → bu okuyucu → `fundingTermBp`.
// → 2026-09-18 (Tur 44, G21 kalemi i): İLK ÇAĞIRAN yazıldı — `src/lib/risk-settings/leverage.ts` (kaldıraç seçim yüzeyinin U-4 funding yükü). Futures yolu kapalıyken o da çağrı ÇIKARMAZ
//   (bugün üretimde tavan NULL ⇒ çağrı 0). Giriş kararına (`fundingTermBp`) bağlanma yukarıdaki gibi G22-c'ye bağlı kalır; G22 AÇIKTIR.
import type { FuturesVerdict } from "@/lib/risk-settings";
import { requestWithEvents, type ExchangeDeps } from "@/lib/events/exchange";
import { FUNDING_REFUSALS, fundingPeriodFrom, fundingRateBp, type FundingRefusal } from "./funding";

/** Ağırlıklar Binance belgesinden (premiumIndex tek sembol 1; fundingRate belge: 500/5dk/IP ortak sınır, ağırlık başlığı boğazda HİZALANIR — S-7). */
export const PREMIUM_INDEX_CALL = { path: "/fapi/v1/premiumIndex", cls: "DISCOVERY", weight: 1 } as const;
export const FUNDING_HISTORY_CALL = { path: "/fapi/v1/fundingRate", cls: "DISCOVERY", weight: 1 } as const;
/** Geçmiş derinliği = istenen ödeme anı sayısı. ÖLÇÜM PARAMETRESİDİR, eşik DEĞİL: dönem türetmek için en az iki an gerekir; Tur 35 ölçüm aleti (`scripts/measure-futures.mts`) aynı derinliği
 *  kullandı ve dönem 5/5 çiftte türedi. Derinlik hükmü değiştirmez: anların aralıkları eşit değilse dönem YOK sayılır (fundingPeriodFrom). */
export const HISTORY_DEPTH = "4";

type PremiumIndex = { symbol?: string; lastFundingRate?: unknown; nextFundingTime?: unknown; time?: unknown };
type FundingHistoryRow = { symbol?: string; fundingTime?: unknown; fundingRate?: unknown };
export type FundingReading =
  | { ok: true; symbol: string; rateBp: string; rawRate: string; periodMs: number; paymentTimes: number[]; nextFundingTime: number | null; source: string }
  | { ok: false; refusal: FundingRefusal; detail: string; sent: number };

/** Oranı ve dönemi oku. Futures yolu kapalıysa ÇAĞRI YOK. Dönen `rateBp` + `periodMs` doğrudan `fundingTermBp`'nin girdisidir; tutma süresini bu modül bilmez (çağıran verir). */
export async function readFunding(symbol: string, futures: FuturesVerdict, deps: ExchangeDeps = {}): Promise<FundingReading> {
  if (!futures.allowed) return { ok: false, refusal: FUNDING_REFUSALS.closed, detail: `futures yolu KAPALI (${futures.refusal}) — funding okunmadı, borsaya çağrı çıkmadı`, sent: 0 };
  const prem = await requestWithEvents<PremiumIndex>({ ...PREMIUM_INDEX_CALL, query: { symbol } }, deps);
  if (!prem.result.ok) return { ok: false, refusal: FUNDING_REFUSALS.rate, detail: `premiumIndex:${prem.result.reason ?? ""}:${prem.result.detail}`, sent: prem.result.sent ? 1 : 0 };
  const raw = prem.result.data?.lastFundingRate, rateBp = fundingRateBp(raw);
  if (rateBp === null || prem.result.data?.symbol !== symbol) return { ok: false, refusal: FUNDING_REFUSALS.rate, detail: `premiumIndex:${symbol}: lastFundingRate okunamadı (${JSON.stringify(raw)}, sembol ${JSON.stringify(prem.result.data?.symbol)})`, sent: 1 };
  const hist = await requestWithEvents<FundingHistoryRow[]>({ ...FUNDING_HISTORY_CALL, query: { symbol, limit: HISTORY_DEPTH } }, deps);
  if (!hist.result.ok) return { ok: false, refusal: FUNDING_REFUSALS.period, detail: `fundingRate:${hist.result.reason ?? ""}:${hist.result.detail}`, sent: hist.result.sent ? 2 : 1 };
  const rows = Array.isArray(hist.result.data) ? hist.result.data : [], times = rows.filter((x) => x.symbol === symbol).map((x) => x.fundingTime);
  if (times.length !== rows.length || times.some((t) => typeof t !== "number" || !Number.isFinite(t))) return { ok: false, refusal: FUNDING_REFUSALS.period, detail: `fundingRate:${symbol}: ödeme anları okunamadı (${rows.length} satır)`, sent: 2 };
  const period = fundingPeriodFrom(times as number[]);
  if (!period.ok) return { ok: false, refusal: FUNDING_REFUSALS.period, detail: `fundingRate:${symbol}: ${period.detail}`, sent: 2 };
  const next = prem.result.data?.nextFundingTime;
  return { ok: true, symbol, rateBp, rawRate: raw as string, periodMs: period.periodMs, paymentTimes: [...(times as number[])].sort((a, b) => a - b), nextFundingTime: typeof next === "number" && Number.isFinite(next) ? next : null,
    source: `${PREMIUM_INDEX_CALL.path} lastFundingRate=${raw as string} · ${FUNDING_HISTORY_CALL.path} ${times.length} ödeme anı → dönem ${period.periodMs} ms (farklar ${period.deltas.join(", ")} ms)` };
}
