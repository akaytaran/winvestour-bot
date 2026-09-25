// FUTURES SÜRÜCÜSÜ ARAYÜZÜ (Tur 49 · G21 kalemi f BİRİNCİ DİLİM · Üretim kararı `winvestor-g21f-kapsam` · K-11, S-8). Tek yüzey, tek sorumluluk: "bu kaldıracı borsaya yaz".
// Girdi, olay defterine ÖNCE yazılmış kaldıraç isteği kaydının kimliğini taşır (`LeverageRecordId`, markalı; yalnız `recordLeverageRequest` basar) ⇒ kaydı olmayan istek sürücüye
//   VERİLEMEZ — sıra tiple gömülüdür. Sonuç, çağıran tarafından AYNI kaydın sebebine yazılır (`settleLeverageRequest`).
// BUGÜNKÜ TEK GERÇEKLEME KAPALIDIR: borsaya giden imzalı çağrı bu dilimde YAZILMADI (A-5: üretimde `enable_futures = false`; gerçek borsada deneme kararı `winvestor-g21-gercek-emir`
//   iş sahibinde). Her çağrı `futures-driver-unavailable` ile reddedilir; borsaya çağrı 0, borsa yanıtı yok. Bu modülde ağ istemcisi YOKTUR (kapı: gate:events DEĞİŞMEZ T49).
import type { LeverageRecordId } from "@/lib/events";

export const FUTURES_DRIVER_UNAVAILABLE = "futures-driver-unavailable" as const;
export type LeverageWrite = { recordId: LeverageRecordId; symbol: string; leverage: number };
/** TUR 50 (S49-2): sürücünün ÜÇÜNCÜ cevabı — BİLMİYORUM. Çağrı gönderilmiş olabilir ama sonucu doğrulanamadı (zaman aşımı, bağlantı koptu, tanınmayan yanıt): kaldıraç borsada DEĞİŞMİŞ
 *  OLABİLİR. Satır bu kodla kapanır, sessizce "olmadı" sayılmaz. Bugünkü kapalı sürücü bunu DÖNMEZ; çağıran, sürücü fırlatırsa ya da tanınmayan biçim dönerse bu hâli kendisi kurar. */
export const LEVERAGE_OUTCOME_UNKNOWN = "leverage-outcome-unknown:driver-unconfirmed" as const;
export type DriverRefused = { ok: false; refusal: typeof FUTURES_DRIVER_UNAVAILABLE; detail: string; exchangeCalls: 0; exchangeResponse: null };
export type DriverUnknown = { ok: false; unknown: true; refusal: typeof LEVERAGE_OUTCOME_UNKNOWN; detail: string; exchangeCalls: number; exchangeResponse: unknown };
/** "Oldu" hâli imzalı sürücüyle (G21-f ikinci dilim) doğar; bugün tipte YOKTUR ⇒ hiçbir yol "uygulandı" diyemez. */
export type DriverResult = DriverRefused | DriverUnknown;
export interface FuturesDriver { setLeverage(w: LeverageWrite): Promise<DriverResult> }

export const closedFuturesDriver: FuturesDriver = {
  setLeverage: async (w) => ({ ok: false, refusal: FUTURES_DRIVER_UNAVAILABLE, exchangeCalls: 0, exchangeResponse: null,
    detail: `kayıt #${w.recordId} (${w.symbol} ${w.leverage}×): kaldıracı borsaya yazan imzalı çağrı yazılmadı — sürücü kapalı (G21 kalemi f birinci dilim, A-5); borsaya çağrı gönderilmedi` }),
};
