// BORSA ÇAĞRISI + OLAY (G07 → G11). Boğazın (G05) reddedişini ve gönderim sonrası depo hatasını (Tur 8 madde 4) OLAYA çevirir; sonucu çağırana olduğu gibi verir.
// Motor kodu (G11, G12, G16) Binance'e bu sarmalayıcıyla çıkar: boğaz `ok:false` + sebep döndürürse sebep sicilden (THROTTLE_DENY_TO_STOP) olaya yazılır;
// `ok:true` + `postSend.storeFailed` ise gerçek yanıt ATILMAZ — olay gövdesine konur (RECORD_FAILED_AFTER_SEND), çağıran `result.ok:true` ve veriyi görür.
// Olay yazma sonucu da döner (`event`); çağıran onu da görür (K-8: yazma hatası sessiz değil). Anahtar/başlık olaya girmez: yalnız statü/sebep/yanıt gövdesi (S-2; yayıcı yeniden tarar).
import { getBinance, type BinanceCall, type BinanceClient, type BinanceResult } from "@/lib/binance";
import { stopEngine, type Deps as EventDeps, type EmitResult } from "./index";
import { THROTTLE_DENY_TO_STOP } from "./stop-reasons";

export type ExchangeDeps = { binance?: BinanceClient; events?: EventDeps; positionId?: number | null; openPositions?: number | null };
export type GuardedResult<T> = { result: BinanceResult<T>; event: EmitResult | null };

/** Boğaz çağrısı; durma sebebi üretirse olay yazar. Olaysız reddediş yoktur: sebepli her `ok:false` sicil üzerinden olaya gider. */
export async function requestWithEvents<T = unknown>(call: BinanceCall, deps: ExchangeDeps = {}): Promise<GuardedResult<T>> {
  const result = await (deps.binance ?? getBinance()).request<T>(call);
  const ctx = { positionId: deps.positionId ?? null, openPositions: deps.openPositions }, where = `${call.cls} ${call.path}`;
  let event: EmitResult | null = null;
  if (!result.ok && result.reason) {
    const detail = `${where} → ${result.detail}${result.status !== undefined && !result.detail.includes(`http-${result.status}`) ? ` http-${result.status}` : ""}${result.sent ? "" : " (çıkmadı)"}`;
    event = await stopEngine(THROTTLE_DENY_TO_STOP[result.reason], detail, { ...ctx, exchangeResponse: { status: result.status ?? null, detail: result.detail, retryAfterMs: result.retryAfterMs ?? null, sent: result.sent, postSend: result.postSend ?? null } }, deps.events);
  } else if (result.postSend?.storeFailed) {
    // Yanıt elde, sayaç/askı yazılamadı: yanıt olayda korunur (Tur 8 madde 4). ok:true ise data, değilse statü+ayrıntı.
    event = await stopEngine("RECORD_FAILED_AFTER_SEND", `${where} → http-${result.status ?? "?"} · ${result.postSend.detail}`, { ...ctx, exchangeResponse: result.ok ? { status: result.status, data: result.data } : { status: result.status ?? null, detail: result.detail } }, deps.events);
  }
  return { result, event };
}
