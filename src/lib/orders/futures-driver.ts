// FUTURES SÜRÜCÜSÜ ARAYÜZÜ (Tur 49 · G21 kalemi f BİRİNCİ DİLİM · Üretim kararı `winvestor-g21f-kapsam` · K-11, S-8). Tek yüzey, tek sorumluluk: "bu kaldıracı borsaya yaz".
// Girdi, olay defterine ÖNCE yazılmış kaldıraç isteği kaydının kimliğini taşır (`LeverageRecordId`, markalı; yalnız `recordLeverageRequest` basar) ⇒ kaydı olmayan istek sürücüye
//   VERİLEMEZ — sıra tiple gömülüdür. Sonuç, çağıran tarafından AYNI kaydın sebebine yazılır (`settleLeverageRequest`).
// ÜRETİMİN VARSAYILAN GERÇEKLEMESİ KAPALIDIR: borsaya giden imzalı çağrı bu dosyada YOKTUR (A-5: üretimde `enable_futures = false`; bitiş ölçütü testnet, iş sahibi kararı D2 2 Eki 2026).
//   Her çağrı `futures-driver-unavailable` ile reddedilir; borsaya çağrı 0, borsa yanıtı yok. Bu modülde ağ istemcisi YOKTUR (kapı: gate:events DEĞİŞMEZ T49).
// TUR 83 (G21-f İKİNCİ DİLİM): İMZALI gerçekleme ayrı dosyadadır (`./futures-signed.ts`) ve YALNIZ açıkça verildiğinde çalışır; bu arayüz ona "oldu" hâlini ve iki adlı reddi kazandırdı.
import type { LeverageRecordId } from "@/lib/events";

export const FUTURES_DRIVER_UNAVAILABLE = "futures-driver-unavailable" as const;
export type LeverageWrite = { recordId: LeverageRecordId; symbol: string; leverage: number };
/** TUR 50 (S49-2): sürücünün ÜÇÜNCÜ cevabı — BİLMİYORUM. Çağrı gönderilmiş olabilir ama sonucu doğrulanamadı (zaman aşımı, bağlantı koptu, tanınmayan yanıt): kaldıraç borsada DEĞİŞMİŞ
 *  OLABİLİR. Satır bu kodla kapanır, sessizce "olmadı" sayılmaz. Bugünkü kapalı sürücü bunu DÖNMEZ; çağıran, sürücü fırlatırsa ya da tanınmayan biçim dönerse bu hâli kendisi kurar. */
export const LEVERAGE_OUTCOME_UNKNOWN = "leverage-outcome-unknown:driver-unconfirmed" as const;
/** TUR 83: imzalı sürücünün iki adlı reddi — ikisinde de kaldıraç borsada DEĞİŞMEDİ (yazım gönderilmedi). Değerler `./futures-signed.ts`'teki sabitlerle AYNIDIR (kapı ölçer). */
export const DRIVER_REFUSALS = ["leverage-refused:above-exchange-bracket", "leverage-refused:exchange-unavailable"] as const;
export type DriverRefused = { ok: false; refusal: typeof FUTURES_DRIVER_UNAVAILABLE | (typeof DRIVER_REFUSALS)[number]; detail: string; exchangeCalls: number; exchangeResponse: null; exchangeMax?: number };
export type DriverUnknown = { ok: false; unknown: true; refusal: typeof LEVERAGE_OUTCOME_UNKNOWN; detail: string; exchangeCalls: number; exchangeResponse: unknown };
/** TUR 83: "OLDU" hâli — borsanın yanıtı istenen kaldıracı DOĞRULADI. Yalnız imzalı sürücü döner; kapalı sürücü dönemez. */
export type DriverApplied = { ok: true; applied: true; leverage: number; exchangeMax: number; detail: string; exchangeCalls: number; exchangeResponse: unknown };
export type DriverResult = DriverRefused | DriverUnknown | DriverApplied;
export interface FuturesDriver { setLeverage(w: LeverageWrite): Promise<DriverResult> }

export const closedFuturesDriver: FuturesDriver = {
  setLeverage: async (w) => ({ ok: false, refusal: FUTURES_DRIVER_UNAVAILABLE, exchangeCalls: 0, exchangeResponse: null,
    detail: `kayıt #${w.recordId} (${w.symbol} ${w.leverage}×): üretimin varsayılan sürücüsü kapalı — imzalı sürücü testnet ölçümünden sonra bağlanır (G21 kutusu 6, D2); borsaya çağrı gönderilmedi` }),
};
