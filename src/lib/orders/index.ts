// EMİR GÖNDERME YOLU (G11 · S-4, S-5, S-7, S-9, K-2, K-6, K-8, M-1, M-2, P-1, Ö-1, Ö-3). Binance'e emir gönderebilen TEK yüzey (kapı: scripts/gate-order.mjs).
// Bu modül emri KURMAKTAN sorumludur; GÖNDERMEYİ G10 sarmalayıcısı yapar: `executeSignal` sırası DEĞİŞMEZ — kimlik → çalışma izni (K-7) → kilit (K-6) → kayıt denetimi →
// PARA bütçesi (M-1) → sahiplik → BOĞAZ (S-7) → gönderim → kayıt → mutabakat → bırak. Bu modül o sırayı ne atlar ne yeniden kurar; yalnız `ExecutionPlan` üretir.
// GİRİŞ YOLU (K-2) — 2026-09-23'TEN BERİ AYAR, KOD SABİTİ DEĞİL (Tur 64, iş sahibi kararı 20 Eyl 2026): karar `entry_settings` satırındadır, okuma yolu `screenEntry` TEKTİR.
//   Kaynakta giriş kararını SABİT yazan kod kapıda KIRMIZI'dır. Şalteri AÇMAK hassas eylemdir (TOTP + E-1 defteri) ve İŞ SAHİBİNİN EYLEMİDİR; ajan açmaz.
//   Şalter KAPALIYKEN ya da ayar OKUNAMAZKEN ENTRY isteği olay yazıp reddedilir (K-8) — iki hâlin sebep kodu AYRIDIR. Çıkış, koruma ve durdurma bu ayara HİÇ bağlı değildir.
//   Tur 14'ten devralınan gerekçe (koruma kanaryaları gerçek emirle sınanmadı, A-6 kararı yok) SİLİNMEDİ: bugün şalteri KAPALI TUTAN gerekçe odur, ama artık kodun değil
//   iş sahibinin elindedir — ekranda okunur ve panelden değiştirilir.
// KORUMA TÜRLERİ (G12, ÖLÇÜLDÜ 2026-09-09 `GET /api/v3/exchangeInfo` BTCUSDT+USUALUSDT): SPOT `orderTypes` = LIMIT, LIMIT_MAKER, MARKET, STOP_LOSS, STOP_LOSS_LIMIT,
//   TAKE_PROFIT, TAKE_PROFIT_LIMIT. `STOP_MARKET`/`TAKE_PROFIT_MARKET` SPOT'ta YOKTUR (futures adları, A-5) — sözlükte kalır ama gönderilebilir DEĞİLDİR.
// FİLTRE KURALLARI ÇALIŞMA ANINDA (./filters.ts): LOT_SIZE · MIN_NOTIONAL/NOTIONAL · PRICE_FILTER · stepSize · tickSize exchangeInfo'dan okunur, koda gömülmez; yuvarlama AŞAĞI;
//   kurala uymayan emir GÖNDERİLMEDEN reddedilir. İMZA (S-4, G06): API anahtarı başlığı ve Ed25519 imzası yalnız `withSignedCall` içinde üretilir; bu modül düz anahtar görmez.
//   Kimlik (`newClientOrderId`) İMZALANAN sorgunun içindedir: sarmalayıcı aynı belirlenimci değeri yeniden yazar (aynı anahtar, aynı sıra) — imza bozulmaz.
// BÜYÜKLÜK (`notional`, G09 ön rezervasyonu): ölçülen fiyattan hesaplanır. `order/test` emri oluşturmaz, komisyon doğmaz → büyüklük 0 bildirilir (bütçe sızıntısı olmaz; sicil).
import type { Keyring } from "@/lib/crypto";
import type { Observation } from "@/lib/binance";
import { signedTimestamp } from "@/lib/binance/time";
import { RECV_WINDOW_MS, markOrderSent, prismaKeySource, type StoredKeyPair } from "@/lib/exchange-key";
import { withSignedCall } from "@/lib/exchange-key/sign";
import { stopEngine, type EmitResult } from "@/lib/events";
import { requestWithEvents } from "@/lib/events/exchange";
import { executeSignal, type Deps as ExecDeps, type Dispatch, type ExecuteOutcome, type OrderRow } from "@/lib/execution-lock/execute";
import { CLOSED_SHORT_MODE, FUTURES_REFUSALS, readRiskRuntime, type SettingsStore } from "@/lib/risk-settings";
import { readOrderFills, readSymbolLeverage } from "./futures-signed";
import { entrySwitch, type EntrySwitchStore } from "@/lib/entry-settings";
import { deriveClientOrderId, type SignalKey } from "@/lib/execution-lock";
import { applyRules, readAvgPrice, readFuturesSymbolRules, readMarkPrice, readSymbolRules, type Adjusted, type SymbolRules } from "./filters";
import { readFreeAsset, readRate } from "@/lib/fee-ledger/exchange";
import { Prisma } from "@/generated/prisma/client";

// K-2 — GİRİŞ KARARI ARTIK KODDA DEĞİL AYARDA (Tur 64, iş sahibi kararı 20 Eyl 2026; ANAYASA K-2'ye tarihli not).
// Eskiden burada `export const ENTRY_ENABLED = false;` sabiti dururdu. Sabit KALDIRILDI: kararın tek yeri
// `src/lib/entry-settings` (Neon `entry_settings`, tek satır) ve tek okuma yolu `screenEntry`'dir.
// Kaynakta "giriş açık/kapalı" kararını SABİT olarak yazan her dosya kapıda KIRMIZI'dır (`gate:order` · `gate:protection`).
// Ayar okunamazsa giriş AÇILMAZ (kapalı arıza, Ö-2) — ve bu, ayarın "kapalı" olmasıyla AYNI ŞEY DEĞİLDİR:
// sebep kodu ayrıdır (`ENTRY_SETTINGS_UNREADABLE` ↔ `ENTRY_SWITCH_OFF`) ve ekranda ayrı cümle yazar.
/** K-1 sözlüğü: emir türleri. `orders.type` ile birebir. Koruma türleri burada TANIMLI ama G11'de gönderilmez (icra G12). */
export const ORDER_TYPES = ["LIMIT", "MARKET", "STOP_LOSS", "TAKE_PROFIT", "STOP_LOSS_LIMIT", "TAKE_PROFIT_LIMIT", "STOP_MARKET", "TAKE_PROFIT_MARKET"] as const;
/** SPOT'ta gönderilebilen türler (ölçüldü). Futures adları (`STOP_MARKET`, `TAKE_PROFIT_MARKET`) burada YOKTUR: borsa onları spot'ta reddeder (A-5'e kadar sözlükte durur). */
export const SENDABLE_TYPES = ["LIMIT", "MARKET", "STOP_LOSS", "TAKE_PROFIT"] as const;
/** Tetik fiyatı (`stopPrice`) ZORUNLU olan türler — tetiksiz koruma emri borsada durmaz, gönderilmeden reddedilir (K-1/K-2). */
export const STOP_TRIGGER_TYPES = ["STOP_LOSS", "TAKE_PROFIT", "STOP_LOSS_LIMIT", "TAKE_PROFIT_LIMIT"] as const;
/** Emir uçları. `order/test` emri OLUŞTURMAZ, yalnız doğrular (imza, filtreler, yetki) — G11'in ölçüm ucu. İkisi de POST. */
/** `oco`: iki bacaklı korumanin (stop + hedef) TEK ATOMIK ucu. G12 tek bacak gonderir (hedef orani A-1 ACIK); ikinci bacak gerektiginde YALNIZ bu uc kullanilir --
 *  iki bagimsiz emir + kendi iptal mantigimiz K-1 ihlalidir. Olculdu 2026-09-09: iki sembolde de `ocoAllowed: true`. Bu turda GONDERILMEZ (kapi olcer). */
export const ORDER_PATHS = { live: "/api/v3/order", test: "/api/v3/order/test", oco: "/api/v3/orderList/oco" } as const;
/** TUR 83 (G21 kalemi f İKİNCİ DİLİM · K-1/K-2/K-6/K-7/K-11 · iş sahibi kararı D2): FUTURES (USDS-M) EMİR YOLU. AYNI sarmalayıcıdan geçer (kimlik → izin → kilit → bütçe → boğaz → kayıt);
 *  farklı olan yalnız uç, tür kümesi, kurallar ve sorgu biçimidir. Gönderilebilir türler Binance USDS-M belgesinden; koruma `STOP_MARKET` (K-1'in futures adı), korumalar ve çıkışlar `reduceOnly`.
 *  Futures yanıtı dolum ayrıntısı taşımaz (RESULT) ⇒ komisyon emrin işlemlerinden okunur (`./futures-signed` readOrderFills) ve aynı M-1 mutabakatına girer. Ana makineyi boğaz seçer (üretim/testnet, S-9).
 *  ÖN KAPI YALNIZ GİRİŞTE: ayar (tavan · şalter · short · M-2 çarpanı) ve hesaptaki sembol kaldıracı (K-11) yalnız ENTRY'de okunur — çıkış ve koruma hiçbir ayara bağlanamaz (M-1/K-1/K-2). */
export const FUTURES_ORDER_PATHS = { live: "/fapi/v1/order", test: "/fapi/v1/order/test" } as const;
export const FUTURES_SENDABLE_TYPES = ["LIMIT", "MARKET", "STOP_MARKET", "TAKE_PROFIT_MARKET"] as const;
export const FUTURES_STOP_TRIGGER_TYPES = ["STOP_MARKET", "TAKE_PROFIT_MARKET"] as const;
export const FUTURES_PROTECTION_TYPE = "STOP_MARKET" as const;
export const FUTURES_RESPONSE_TYPE = "RESULT";
/** TUR 86 (G21 kutu 6 · K-1 · Üretim S15-1 = A): Binance USDS-M KOŞULLU emirleri (STOP_MARKET/TAKE_PROFIT_MARKET) `/fapi/v1/order`'dan ALMAZ — testnet HTTP 400 `-4120 STOP_ORDER_SWITCH_ALGO`
 *  (Tur 85 ölçümü). Futures KORUMASI Algo Order API'ye gider: `POST /fapi/v1/algoOrder` (algoType CONDITIONAL, triggerPrice, reduceOnly, kimlik `clientAlgoId` = aynı belirlenimci kimlik), sorgu `GET`
 *  ve iptal `DELETE` aynı uçta `algoId` ile. Belge: Binance USDS-M "New Algo Order (TRADE)" · "Query Algo Order" · "Cancel Algo Order" (USDS-M Futures belgesi, Trade bölümü).
 *  KİMLİK AÇIKTIR: borsadaki algo emri `ALGO:<algoId>` olarak taşınır (orders.exchange_order_id, positions.protection_order_id) — sorgu/iptal yolu ucu bu önekten seçer; önek yoksa futures'ta
 *  `/fapi/v1/order`, SPOT'ta `/api/v3/order` (SPOT kimliği önek TAŞIMAZ). Algo ucunun doğrulama (test) karşılığı YOKTUR ⇒ test kipinde koşullu emir GÖNDERİLMEZ (kapalı arıza). */
export const FUTURES_ALGO_PATH = "/fapi/v1/algoOrder", FUTURES_ALGO_TYPE = "CONDITIONAL", ALGO_ID_PREFIX = "ALGO:";
/** Algo emrinin durumu (`algoStatus`, belge): NEW borsada bekliyor · TRIGGERING tetik sağlandı, eşleştirme motoruna iletiliyor (henüz gerçek emir yok) · TRIGGERED/FINISHED motora geçti (gerçek emir
 *  `actualOrderId`) · CANCELED/EXPIRED/REJECTED. Emir diline çeviri (K-1 denetimi emir dilinde konuşur): NEW → "NEW" (duruyor), TRIGGERING → "PENDING_NEW" (yerleşmek üzere; kayıp sayılmaz);
 *  motora geçmişse GERÇEK emrin kendi durumu okunur (FILLED ⇒ stop tetiklendi ve doldu); diğer her durum olduğu gibi döner ve denetimde KAYIP sayılır (kapalı yönde). */
export const ALGO_STATUS_AS_ORDER: Record<string, string> = { NEW: "NEW", TRIGGERING: "PENDING_NEW" };
export type AlgoResponse = { algoId?: number; clientAlgoId?: string; algoStatus?: string; triggerPrice?: string; actualOrderId?: string | number; updateTime?: number; createTime?: number };
export const algoAsOrder = (a: AlgoResponse, actualStatus: string | null = null): OrderResponse & { stopPrice?: string } => ({ ...a, orderId: a.algoId === undefined ? undefined : `${ALGO_ID_PREFIX}${a.algoId}`,
  clientOrderId: a.clientAlgoId, status: actualStatus ?? ALGO_STATUS_AS_ORDER[String(a.algoStatus)] ?? String(a.algoStatus ?? "UNKNOWN"), stopPrice: a.triggerPrice, updateTime: a.updateTime ?? a.createTime });
/** Futures'ta tetikli tür (STOP_MARKET/TAKE_PROFIT_MARKET) ⇒ Algo Order API. SPOT'ta hiçbir tür algo DEĞİLDİR. */
const isAlgo = (i: OrderIntent): boolean => i.market === "FUTURES" && (FUTURES_STOP_TRIGGER_TYPES as readonly string[]).includes(i.type);
/** Futures GİRİŞİNİN adlı retleri (ayrıntının başında; kod adı kendini anlatır). */
export const FUTURES_ENTRY_REFUSALS = { shortNone: "futures-refused:short-mode-none", shortNotWritten: "futures-refused:short-execution-not-written", m2Null: "futures-refused:m2-futures-multiple-null",
  leverageAbove: "futures-refused:symbol-leverage-above-cap", leverageUnread: "futures-refused:symbol-leverage-unreadable" } as const;
/** Emir OLUŞTURMAYAN imzalı emir işlemleri (G12): sorgu ve iptal. Ağırlıklar Binance belgesinden; boğaz her yanıtta başlıkla hizalar (S-7). */
export const ORDER_QUERY_WEIGHT = 4, ORDER_CANCEL_WEIGHT = 1;
/** TÜRETİLMİŞ (uydurma değil): imza damgasının gönderim anına kadar yaşlanabileceği süre tavanı = `RECV_WINDOW_MS / 2`. Kalan yarı, borsaya varış gecikmesi ve
 *  sunucu-saat sapması için pay bırakır. Damga bu tavanı aşmışsa emir GÖNDERİLMEZ (kapalı arıza): kilit ve rezervasyon bırakılır, `STAMP_STALE` olayı yazılır.
 *  Ölçüm gerekçesi (Tur 14 madde 12): damga gönderimden 12 s önce basıldığında borsa `-1021 "Timestamp for this request is outside of the recvWindow"` döndürdü. */
export const STAMP_MAX_AGE_MS = RECV_WINDOW_MS / 2;
/** Ağırlık 1 / emir sayacı 1 (Binance belgesi; boğaz her yanıtta `x-mbx-used-weight-1m` ve `x-mbx-order-count-10s` başlığıyla HİZALAR — sapma ölçümle düzelir, S-7). */
export const ORDER_WEIGHT = 1, ORDER_COUNT = 1;
/** SİCİL (Tur 12, geri alınabilir; strateji kararı DEĞİL): LIMIT emirde süre kuralı verilmezse `GTC` — "iptal edilene kadar dur". IOC/FOK bir strateji seçimidir, icat edilmedi (G13/G15). */
export const TIME_IN_FORCE_DEFAULT = "GTC";
/** Yanıt biçimi: dolum ayrıntısı (`fills[].commission/commissionAsset`) M-1 mutabakatı için ZORUNLU (G09) — ACK yanıtı komisyonu taşımaz. */
export const RESPONSE_TYPE = "FULL";

export type OrderType = (typeof ORDER_TYPES)[number];
export type SendableType = (typeof SENDABLE_TYPES)[number];
export type OrderClass = "ENTRY" | "EXIT" | "PROTECTION";
export type OrderIntent = { source: string; symbol: string; market: "SPOT" | "FUTURES"; side: "BUY" | "SELL"; cls: OrderClass; type: OrderType; quantity: string; price?: string | null; stopPrice?: string | null; refPrice?: string | null; timeInForce?: string; seq: number; test?: boolean; positionId?: number | null };
export type OrderRefusal = "ENTRY_CLOSED" | "TYPE_NOT_SENDABLE" | "MARKET_NOT_SUPPORTED" | "RULES_UNAVAILABLE" | "RULE_VIOLATION" | "BAD_SIGNAL" | "NO_KEY" | "CLOCK_UNSYNCED" | "TRIGGER_MISSING" | "SHORT_CLOSED" | "EDGE_MULTIPLE_UNSET" | "LEVERAGE_ABOVE_CAP";
/** Borsanın İŞ HATASI kodları: bunlar boğazın durma sebepleri değildir (statü var, `reason` yok) — K-8 gereği yine de olay yazılır (`ORDER_REJECTED`). */
export const EXCHANGE_REJECT = /^http-4\d\d(:-?\d+)?$/;
export type OrderResponse = { orderId?: number | string; clientOrderId?: string; status?: string; transactTime?: number; updateTime?: number; avgPrice?: string; executedQty?: string; fills?: { price?: string; qty?: string; commission?: string; commissionAsset?: string }[] };
export type OrderRefused = { ok: false; refusal: OrderRefusal; detail: string; clientOrderId: string | null; event: EmitResult | null; rules?: SymbolRules; adjusted?: Adjusted };
export type OrderOutcome = OrderRefused
  | { ok: true; clientOrderId: string; test: boolean; rules: SymbolRules; adjusted: Extract<Adjusted, { ok: true }>; result: ExecuteOutcome<OrderResponse>; keyEvent: EmitResult | null; rejectEvent: EmitResult | null; keyMarked: boolean | null };
export type KeySource = () => Promise<StoredKeyPair | null>;
/** `observe`: TAŞIYICI anını (POST'un uçuş süresi) ölçen gözlemci. Depo/taşıyıcı ENJEKSİYONU DEĞİLDİR — hiçbir davranışı değiştirmez, yalnız okur (Ö-5: aleti de ölç).
 *  Tur 14'te ölçüldü: emrin reddi kodda değil AĞDA doğdu (POST taşıyıcıda 10 746,7 ms geçirdi); bu sayı görülmeden "mimari çalışıyor" denemez. */
export type OrderDeps = ExecDeps & { key?: KeySource; ring?: Keyring; markSent?: (at: Date) => Promise<boolean>; observe?: (o: Observation) => void; entrySettings?: EntrySwitchStore; /** Tur 83: futures girişinin ayar deposu (kapı/kanarya) */ riskSettings?: SettingsStore };

const NUM = /^\d+(\.\d+)?$/;
/** Borsanın "anahtar geçersiz" kodları (Binance belgesi): -2014 API-key format invalid · -2015 invalid API-key/IP/permissions. Sicil: KEY_INVALID (kaynak G11). */
const KEY_INVALID_CODES = ["-2014", "-2015"];

/** İmzalanacak sorgu: kimlik (`newClientOrderId`) İÇERİDE. Anahtar sırası imzayla birebir aynı kalır — sarmalayıcı aynı değeri yeniden yazsa da dize değişmez.
 *  `timestamp` YEREL SAATTEN GELMEZ: sunucu saatine hizalanmış damga dışarıdan verilir (src/lib/binance/time.ts, Tur 13) — kapı yerel saatten damga üretimini KIRMIZI sayar. */
function orderQuery(i: OrderIntent, a: Extract<Adjusted, { ok: true }>, clientOrderId: string, timestamp: string, fut = false): Record<string, string> {
  if (fut && isAlgo(i)) return { algoType: FUTURES_ALGO_TYPE, symbol: i.symbol, side: i.side, type: i.type, quantity: a.quantity, triggerPrice: a.stopPrice as string, reduceOnly: "true", clientAlgoId: clientOrderId, recvWindow: String(RECV_WINDOW_MS), timestamp }; // Tur 86: koşullu futures emri (tetik borsada, K-1)
  const q: Record<string, string> = { symbol: i.symbol, side: i.side, type: i.type, quantity: a.quantity };
  if (a.price !== null) { q.price = a.price; q.timeInForce = i.timeInForce ?? TIME_IN_FORCE_DEFAULT; }
  if (a.stopPrice !== null) q.stopPrice = a.stopPrice; // K-1: tetik borsada durur; değeri G12 planından gelir, bu modül tetik fiyatı ÜRETMEZ (A-1: stop mesafesi açık)
  if (fut && i.cls !== "ENTRY") q.reduceOnly = "true"; // Tur 83: futures çıkış/koruma pozisyonu YALNIZ küçültür — ters yönde yeni pozisyon açamaz (K-2)
  q.newClientOrderId = clientOrderId;
  q.newOrderRespType = fut ? FUTURES_RESPONSE_TYPE : RESPONSE_TYPE; q.recvWindow = String(RECV_WINDOW_MS); q.timestamp = timestamp;
  return q;
}

/** FUTURES GİRİŞİNİN ÖN KAPISI (Tur 83 · K-11, M-2, Üretim S12-5). Sıra: ayar okunur (TEK okuma yolu; okunamaz ⇒ kapalı arıza) → tavan/şalter hükmü → SATIŞ yönlü giriş = açığa satış: kip
 *  kapalıysa (`CLOSED_SHORT_MODE`) ret; kip açık ama icrası yazılmadı (G22) ⇒ yine ret → M-2 futures çarpanı NULL ⇒ ret (kenar ölçülemez) → hesaptaki sembol kaldıracı tavanı AŞIYORSA ya da
 *  okunamıyorsa ret (K-11: kaldıraç tavanı aşamaz). Hepsi borsaya EMİR gönderilmeden. Dönüş null ⇒ giriş kapısı geçildi. */
type EntryGateRefusal = { refusal: OrderRefusal; detail: string };
async function futuresEntryGate(i: OrderIntent, deps: OrderDeps): Promise<EntryGateRefusal | null> {
  const r = await readRiskRuntime({ store: deps.riskSettings, events: deps.events });
  if (!r.ok) return { refusal: "MARKET_NOT_SUPPORTED", detail: `market=FUTURES; ${FUTURES_REFUSALS.unreadable}: ${r.refusal}: ${r.detail}` };
  const f = r.runtime.futures;
  if (!f.allowed) return { refusal: "MARKET_NOT_SUPPORTED", detail: `market=FUTURES; ${f.refusal}: ${f.detail}` };
  if (i.side === "SELL") return { refusal: "SHORT_CLOSED", detail: r.runtime.shortMode === CLOSED_SHORT_MODE ? `${FUTURES_ENTRY_REFUSALS.shortNone}: açığa satış kapalı (ayar); satış yönlü futures girişi yapılmaz`
    : `${FUTURES_ENTRY_REFUSALS.shortNotWritten}: kip ${r.runtime.shortMode} seçili ama açığa satış icrası yazılmadı (G22); satış yönlü futures girişi yapılmaz` };
  if (f.m2FuturesMultiple === null) return { refusal: "EDGE_MULTIPLE_UNSET", detail: `${FUTURES_ENTRY_REFUSALS.m2Null}: M-2 futures çarpanı ayarlanmadı; futures kenarı ölçülemez, giriş yok` };
  const l = await readSymbolLeverage(i.symbol, { exchange: deps.exchange, key: deps.key, ring: deps.ring, now: deps.now });
  if (!l.ok) return { refusal: "LEVERAGE_ABOVE_CAP", detail: `${FUTURES_ENTRY_REFUSALS.leverageUnread}: ${l.detail}; hesaptaki kaldıraç doğrulanamadan giriş yapılmaz (K-11)` };
  if (l.leverage > f.leverageCap) return { refusal: "LEVERAGE_ABOVE_CAP", detail: `${FUTURES_ENTRY_REFUSALS.leverageAbove}: hesaptaki ${i.symbol} kaldıracı ${l.leverage}× > tavan ${f.leverageCap}× (K-11)` };
  return null;
}

/** Emri kur ve G10 sarmalayıcısıyla gönder. Hiçbir dal fırlatmaz; gönderilmeyen her emir sebepli sonuç + olaydır (K-8). */
export async function placeOrder(i: OrderIntent, deps: OrderDeps = {}): Promise<OrderOutcome> {
  const now = deps.now ?? Date.now, test = i.test === true;
  const no = async (refusal: OrderRefusal, code: "ENTRY_CLOSED" | "ORDER_RULES_UNAVAILABLE" | "ORDER_RULE_VIOLATION", detail: string, extra: Partial<OrderRefused> = {}): Promise<OrderRefused> =>
    ({ ok: false, refusal, detail, clientOrderId: null, event: await stopEngine(code, `${i.cls} ${i.symbol} ${i.type} · ${detail}`, { positionId: i.positionId ?? null }, deps.events), ...extra });
  // FUTURES ÖN KAPISI (Tur 36, G21 kalemleri b/g): karar artık kodda değil AYARDA (risk_settings). Ayar YALNIZ bu dalda okunur — SPOT emirlerine (giriş, çıkış, KORUMA)
  // tek bir ek okuma bile eklenmez (M-1/K-1/K-2: çıkış ve koruma hiçbir ayara bağlanamaz). Ayar izin verse bile emir ÇIKMAZ: futures EMİR YOLU yazılmadı (kalem f, A-5).
  // TUR 83: emir yolu futures'ı TAŞIR (Tur 36'nın "yazılmadı" hâli kalktı); ön kapı artık YALNIZ futures GİRİŞİNDE ayarı ve sembol kaldıracını okur (futuresEntryGate) — çıkış/koruma okumaz.
  const fut = i.market === "FUTURES";
  if (i.market !== "SPOT" && !fut) return no("MARKET_NOT_SUPPORTED", "ORDER_RULE_VIOLATION", `market=${String(i.market)} tanınmıyor`);
  if (fut && i.cls === "ENTRY") { const g = await futuresEntryGate(i, deps); if (g) return no(g.refusal, "ORDER_RULE_VIOLATION", g.detail); }
  if (!fut && !(SENDABLE_TYPES as readonly string[]).includes(i.type)) return no("TYPE_NOT_SENDABLE", "ORDER_RULE_VIOLATION", `tür=${i.type} bu turda gönderilmez (koruma emri yerleştirme G12, K-1/K-2)`);
  if (fut && !(FUTURES_SENDABLE_TYPES as readonly string[]).includes(i.type)) return no("TYPE_NOT_SENDABLE", "ORDER_RULE_VIOLATION", `tür=${i.type} futures'ta gönderilmez (USDS-M türleri: ${FUTURES_SENDABLE_TYPES.join(", ")})`);
  const algo = isAlgo(i); // TUR 86: futures koşullu emri Algo Order API'ye gider; doğrulama ucu yok ⇒ test kipinde gönderilmez
  if (algo && test) return no("TYPE_NOT_SENDABLE", "ORDER_RULE_VIOLATION", `tür=${i.type} futures'ta koşullu emirdir (${FUTURES_ALGO_PATH}); Binance'in bu uç için doğrulama (test) ucu yok — test kipinde gönderilmez`);
  // GİRİŞ ŞALTERİ (Tur 64): karar AYARDAN okunur, koddan değil. Okuma YALNIZ bu dalda yapılır — çıkışa, korumaya ve iptale tek bir ek okuma bile eklenmez (M-1/K-1/K-2).
  if (i.cls === "ENTRY") { const e = await entrySwitch({ store: deps.entrySettings });
    if (!e.allowed) return no("ENTRY_CLOSED", "ENTRY_CLOSED", `${e.refusal}: ${e.detail}`); }
  if (([...STOP_TRIGGER_TYPES, ...FUTURES_STOP_TRIGGER_TYPES] as readonly string[]).includes(i.type) && (typeof i.stopPrice !== "string" || i.stopPrice.length === 0)) return no("TRIGGER_MISSING", "ORDER_RULE_VIOLATION", `tür=${i.type} tetik fiyatı (stopPrice) olmadan gönderilemez: tetiksiz koruma borsada durmaz (K-1)`);
  const r = await (fut ? readFuturesSymbolRules : readSymbolRules)(i.symbol, { exchange: deps.exchange, now });
  if (!r.ok) return no("RULES_UNAVAILABLE", "ORDER_RULES_UNAVAILABLE", `${i.symbol} kuralları okunamadı: ${r.detail}; emir gönderilmedi`);
  // PERCENT_PRICE_BY_SIDE referansı (Tur 13): sembolde o filtre VARSA ve emir fiyatlıysa ortalama fiyat ÇALIŞMA ANINDA okunur; okunamazsa emir gönderilmez (kapalı arıza).
  let avgPrice: string | null = null;
  if (r.rules.percent && (i.type === "LIMIT" || typeof i.stopPrice === "string")) {
    const ap = await (fut ? readMarkPrice : readAvgPrice)(i.symbol, { exchange: deps.exchange, now });
    if (!ap.ok) return no("RULES_UNAVAILABLE", "ORDER_RULES_UNAVAILABLE", `${i.symbol} ortalama fiyatı okunamadı: ${ap.detail}; PERCENT_PRICE_BY_SIDE denetlenemez, emir gönderilmedi`, { rules: r.rules });
    avgPrice = ap.price;
  }
  const a = applyRules(r.rules, { type: i.type, side: i.side, quantity: i.quantity, price: i.price, stopPrice: i.stopPrice, refPrice: i.refPrice, avgPrice });
  if (!a.ok) return no("RULE_VIOLATION", "ORDER_RULE_VIOLATION", `${a.refusal}: ${a.detail}`, { rules: r.rules, adjusted: a });
  const signal: SignalKey = { source: i.source, symbol: i.symbol, market: i.market, side: i.side, intent: i.cls, seq: i.seq };
  let clientOrderId: string; try { clientOrderId = deriveClientOrderId(signal); } catch (e) { return no("BAD_SIGNAL", "ORDER_RULE_VIOLATION", `sinyal kanonik değil: ${(e as Error).message}`); }
  const k = await (deps.key ?? prismaKeySource)();
  if (!k) return { ok: false, refusal: "NO_KEY", detail: "geçerli borsa anahtarı yok; emir gönderilmedi", clientOrderId, rules: r.rules, adjusted: a, event: await stopEngine("KEY_INVALID", `${i.cls} ${i.symbol} · kayıtlı geçerli anahtar yok`, {}, deps.events) };
  const toRow = (d: OrderResponse): OrderRow => ({ exchangeOrderId: test ? `TEST:${clientOrderId}` : String(d.orderId ?? `?:${clientOrderId}`), symbol: i.symbol, market: i.market, type: i.type, side: i.side, quantity: a.quantity, price: a.price, status: test ? "TEST" : String(d.status ?? "UNKNOWN"), placedAt: new Date(d.transactTime ?? d.updateTime ?? now()), rawResponse: d, positionId: i.positionId ?? null });
  const toFill = (d: OrderResponse) => ({ status: test ? "TEST" : String(d.status ?? "UNKNOWN"), fees: (d.fills ?? []).filter((f) => typeof f.commissionAsset === "string" && typeof f.commission === "string" && NUM.test(f.commission)).map((f) => ({ asset: f.commissionAsset as string, amount: f.commission as string })) });
  // GÖNDERİM YÜZEYİ (Tur 14): imza ve damga BURADA, sarmalayıcının izin/kilit/kayıt/bütçe adımlarından SONRA, gönderimden hemen önce üretilir (bkz. execute.ts `Dispatch`).
  // Damga ile taşıyıcı arasında boğazın kendi depo turları kalır; onların da damgayı yaşlandırmasına karşı `guard` son anda yaşı ölçer ve aşılmışsa çağrıyı ÇIKARTMAZ.
  const dispatch: Dispatch<OrderResponse> = async (call) => {
    const ts = await signedTimestamp({ exchange: deps.exchange, events: deps.events, now });
    if (!ts.ok) return { ok: false, refusal: "CLOCK_UNSYNCED", detail: `${ts.refusal}: ${ts.detail}; emir gönderilmedi`, event: ts.event };
    const mintedAt = now();
    const guard = (): { ok: true } | { ok: false; detail: string } => { const age = now() - mintedAt; return age <= STAMP_MAX_AGE_MS ? { ok: true } : { ok: false, detail: `stamp-stale:${age}ms>${STAMP_MAX_AGE_MS}ms` }; };
    const sent = await withSignedCall(k.api, k.priv, orderQuery(i, a, clientOrderId, ts.timestamp, fut),
      async (headers, query) => ({ ok: true as const, ...(await requestWithEvents<OrderResponse>({ ...call, headers, query, guard, observe: deps.observe }, deps.exchange)) }), deps.ring);
    if (algo && sent.result.ok) sent.result.data = algoAsOrder(sent.result.data as AlgoResponse); // TUR 86: kimlik ALGO:<algoId>, durum emir dilinde, tetik stopPrice'ta (ham alanlar korunur)
    // TUR 83 (M-1): futures dolumunun komisyonu emrin işlemlerinden okunur ve SPOT'un `fills` biçimine konur ⇒ mutabakat aynı yoldan. Okunamazsa olay yazılır; komisyon "0" sayılmaz.
    if (fut && !test && sent.result.ok && sent.result.data.orderId !== undefined && Number(sent.result.data.executedQty ?? "0") > 0) {
      const fl = await readOrderFills(i.symbol, sent.result.data.orderId, { exchange: deps.exchange, key: deps.key, ring: deps.ring, now });
      if (fl.ok) sent.result.data.fills = fl.fills;
      else await stopEngine("FEE_LEDGER_UNAVAILABLE", `${i.cls} ${i.symbol} · kimlik ${clientOrderId} · futures dolumunun komisyonu okunamadı (${fl.detail}); defter eksik kalabilir`, { positionId: i.positionId ?? null }, deps.events);
    }
    if (!sent.result.ok && !sent.result.reason && /^stamp-stale:/.test(sent.result.detail))
      return { ok: false, refusal: "STAMP_STALE", detail: sent.result.detail, event: await stopEngine("STAMP_STALE", `${i.cls} ${i.symbol} · kimlik ${clientOrderId} · ${sent.result.detail}; kilit ve rezervasyon bırakıldı`, { positionId: i.positionId ?? null }, deps.events) };
    return sent;
  };
  const result = await executeSignal<OrderResponse>({ signal, call: { path: fut ? (algo ? FUTURES_ALGO_PATH : test ? FUTURES_ORDER_PATHS.test : FUTURES_ORDER_PATHS.live) : test ? ORDER_PATHS.test : ORDER_PATHS.live, method: "POST", cls: i.cls, weight: ORDER_WEIGHT, orders: ORDER_COUNT }, notional: test ? "0" : a.notional, toRow, toFill, dispatch, records: !test }, deps);
  const denied = !result.executed && result.reason === "EXCHANGE_DENIED" ? result.result : null;
  const keyInvalid = !!denied && !denied.ok && KEY_INVALID_CODES.some((c) => denied.detail.endsWith(`:${c}`));
  const keyEvent = keyInvalid && denied && !denied.ok
    ? await stopEngine("KEY_INVALID", `${i.cls} ${i.symbol} · borsa anahtarı reddetti: ${denied.detail}`, { positionId: i.positionId ?? null }, deps.events) : null;
  // K-8 BOŞLUĞU KAPATILDI (Tur 14): borsanın İŞ HATASIYLA reddettiği emir (statü var, boğaz sebebi yok — -1013 filtre, -1021 damga, -2010 bakiye…) eskiden HİÇBİR olay yazmıyordu;
  // yalnız -2014/-2015 (KEY_INVALID) istisnaydı. Artık her borsa reddi `ORDER_REJECTED` yazar: reddediş de bir durmadır ve sessiz olamaz.
  // YALNIZ boğazın kendi sebebi YOKKEN yazılır: 429/418/451 zaten `BUDGET_EXHAUSTED`/`IP_BANNED`/`REGION_BLOCKED` olayını üretti; üstüne ikinci bir olay yazmak
  // aynı olayı iki kez raporlamak olurdu (ölçüldü: sahte 451'de çift olay çıktı). Buradaki boşluk, sebebi OLMAYAN iş hatalarıdır (-1013 / -1021 / -2010 …).
  const rejectEvent = denied && !denied.ok && !keyInvalid && denied.reason === undefined && denied.status !== undefined && EXCHANGE_REJECT.test(denied.detail)
    ? await stopEngine("ORDER_REJECTED", `${i.cls} ${i.symbol} ${i.type} · kimlik ${clientOrderId} · ${denied.detail}`, { positionId: i.positionId ?? null, exchangeResponse: { status: denied.status, detail: denied.detail } }, deps.events) : null;
  // S-6 SAYACI: GERÇEK emir borsaya çıktıysa `exchange_keys.last_order_at` işaretlenir (yazan tek yer G06 modülü). `order/test` emir OLUŞTURMAZ → sayaç başlamaz.
  const keyMarked = !test && result.executed ? await (deps.markSent ?? markOrderSent)(new Date(now())) : null;
  return { ok: true, clientOrderId, test, rules: r.rules, adjusted: a, result, keyEvent, rejectEvent, keyMarked };
}

// ---- ELLE ÇIKIŞ (Tur 14 madde 12) ----
// Bir varlığın SERBEST bakiyesinin tamamını quote'a satar. ÇIKIŞTIR: sınıf EXIT → PARA bütçesine takılmaz (M-1), koruma emri gerektirmez (yeni pozisyon açmaz),
// `positions`'a satır yazmaz. KISAYOL YOKTUR: emir `placeOrder` üzerinden gider, yani kimlik → izin → kilit → bütçe → boğaz → imza+damga → filtreler → gönderim → kayıt.
// Fiyat, miktar ve borsa kuralları ÇAĞRI ANINDA okunur — hiçbiri koda yazılmaz (Ö-1). Miktarı `applyRules` adıma AŞAĞI yuvarlar; bu fonksiyon yuvarlama YAPMAZ.
// TEK KULLANIMLIK: kimlik `source`+`seq`'ten belirlenimci türer (G10), bu yüzden aynı çağrı ikinci kez emir GÖNDERMEZ — kayıt denetimi `ALREADY_EXECUTED` der (K-6).
export type ManualExit = { ok: true; base: string; quote: string; free: string; price: string; expected: string; order: OrderOutcome }
  | { ok: false; refusal: "RULES_UNAVAILABLE" | "PRICE_UNAVAILABLE" | "BALANCE_UNAVAILABLE"; detail: string };
export async function exitAllFree(base: string, quote: string, source: string, seq: number, deps: OrderDeps = {}): Promise<ManualExit> {
  const now = deps.now ?? Date.now, symbol = base + quote, rd = { exchange: deps.exchange, ring: deps.ring, now };
  const r = await readSymbolRules(symbol, { exchange: deps.exchange, now });
  if (!r.ok) return { ok: false, refusal: "RULES_UNAVAILABLE", detail: `${symbol}: ${r.detail}` };
  const px = await readRate(base, quote, rd);
  if (!px.ok) return { ok: false, refusal: "PRICE_UNAVAILABLE", detail: px.detail };
  const bal = await readFreeAsset(base, rd);
  if (!bal.ok) return { ok: false, refusal: "BALANCE_UNAVAILABLE", detail: bal.detail };
  const order = await placeOrder({ source, symbol, market: "SPOT", side: "SELL", cls: "EXIT", type: "MARKET", quantity: bal.free, refPrice: px.rate, seq }, deps);
  return { ok: true, base, quote, free: bal.free, price: px.rate, expected: new Prisma.Decimal(bal.free).mul(px.rate).toFixed(8), order };
}

// ---- KOMİSYON VARLIĞI ALIMI (Tur 18 madde 3, İŞ SAHİBİ KARARI: "BNB'yi yazılım alacak") ----
// Quote'tan indirim varlığına (BNB) geçiş. POZİSYON DEĞİLDİR: `positions` satırı yazmaz, koruma emri yoktur (K-2 pozisyonlar içindir), kenar/maruziyet kapılarına uğramaz.
// SINIF EXIT (sicil): bu bir giriş DEĞİLDİR ve giriş şalterine (ayar) HİÇ bakmaz; EXIT sınıfı komisyonu deftere YİNE DÜŞER (M-1 sayacı okunur, mutabakat yapılır) ama
//   bütçe REDDİ uygulamaz (M-1 reddi yeni pozisyonu keser). Ayrı bir sınıf (FEE_ASSET) 10 dosya + kapı literalleri + üretim göçü isterdi — bu turda yazılmadı (raporda DUR VE SOR).
// MİKTAR: borsanın MIN_NOTIONAL'ı, LOT_SIZE adımı ve fiyat ÇAĞRI ANINDA okunur (Ö-1); asgari = ⌊minNotional ÷ fiyat ÷ adım⌋ + 1 adım (eşiği GEÇEN ilk adım katı) + 1 adım (fiyat oynaması payı —
//   pay borsanın kendi hassasiyetidir, uydurma sayı değil). Yukarı yuvarlama YOKTUR (kapı): floor + adım. Sermayenin geri kalanına dokunulmaz. KISAYOL YOK: `placeOrder` → `executeSignal`.
// TEK KULLANIMLIK: kimlik `source`+`seq`'ten belirlenimci türer (G10); aynı çağrı ikinci kez emir GÖNDERMEZ (`ALREADY_EXECUTED`, K-6).
export type FeeAssetBuy = { ok: true; base: string; quote: string; quantity: string; price: string; minNotional: string; lotStep: string; expected: string; order: OrderOutcome }
  | { ok: false; refusal: "RULES_UNAVAILABLE" | "PRICE_UNAVAILABLE"; detail: string };
export async function buyFeeAsset(base: string, quote: string, source: string, seq: number, deps: OrderDeps = {}): Promise<FeeAssetBuy> {
  const now = deps.now ?? Date.now, symbol = base + quote;
  const r = await readSymbolRules(symbol, { exchange: deps.exchange, now });
  if (!r.ok) return { ok: false, refusal: "RULES_UNAVAILABLE", detail: `${symbol}: ${r.detail}` };
  const px = await readRate(base, quote, { exchange: deps.exchange, ring: deps.ring, now });
  if (!px.ok) return { ok: false, refusal: "PRICE_UNAVAILABLE", detail: px.detail };
  const D = Prisma.Decimal, step = new D(r.rules.lot.step), dp = (r.rules.lot.step.replace(/0+$/, "").split(".")[1] ?? "").length;
  const quantity = new D(r.rules.minNotional).div(px.rate).div(step).floor().add(2).mul(step).toFixed(dp);
  const order = await placeOrder({ source, symbol, market: "SPOT", side: "BUY", cls: "EXIT", type: "MARKET", quantity, refPrice: px.rate, seq }, deps);
  return { ok: true, base, quote, quantity, price: px.rate, minNotional: r.rules.minNotional, lotStep: r.rules.lot.step, expected: new D(quantity).mul(px.rate).toFixed(8), order };
}

// ---- EMİR OLUŞTURMAYAN imzalı emir işlemleri (G12): SORGU ve İPTAL ----
// Bunlar yeni maruziyet YARATMAZ (emir kurmaz, `orders` satırı yazmaz, ORDERS sayacına girmez), bu yüzden icra sarmalayıcısından (kimlik/kilit/PARA bütçesi) GEÇMEZLER:
//   M-1 "çıkış ve koruma hiçbir zaman bütçeye takılmaz" ve K-1/K-2 gereği koruma denetimi ile korumasız pozisyonun temizliği bir kilidi beklemek zorunda değildir.
// Yine de ZORUNLU olanlar: G05 boğazı (S-7 sayaç + askı), G07 olay sarmalayıcısı (K-8), G06 imzası (S-4) ve Tur 13 saat hizalaması. Kapı bu iki fonksiyonun dışında
// boğaz çağrısını KIRMIZI sayar; sınıfları PROTECTION/EXIT sabittir (ENTRY olamaz).
/** Tur 83: `market` FUTURES ise sorgu/iptal futures emir ucuna gider (aynı boğaz, aynı imza); verilmezse SPOT. */
export type OrderRef = { symbol: string; orderId?: number | string | null; clientOrderId?: string | null; market?: "SPOT" | "FUTURES" };
export type OrderOpRefusal = "BAD_REF" | "NO_KEY" | "CLOCK_UNSYNCED" | "EXCHANGE_DENIED";
export type OrderOpOutcome = { ok: true; data: OrderResponse; event: EmitResult | null } | { ok: false; refusal: OrderOpRefusal; detail: string; status?: number; event: EmitResult | null };

async function signedOrderOp(label: string, method: "GET" | "DELETE", cls: Extract<OrderClass, "EXIT" | "PROTECTION">, weight: number, ref: OrderRef, deps: OrderDeps): Promise<OrderOpOutcome> {
  const now = deps.now ?? Date.now;
  const id = ref.orderId === null || ref.orderId === undefined ? null : String(ref.orderId);
  if (!ref.symbol || (id === null && !ref.clientOrderId)) return { ok: false, refusal: "BAD_REF", detail: `${label}: sembol ve (orderId ya da clientOrderId) gerekir`, event: null };
  const k = await (deps.key ?? prismaKeySource)();
  if (!k) return { ok: false, refusal: "NO_KEY", detail: `${label}: geçerli borsa anahtarı yok`, event: await stopEngine("KEY_INVALID", `${cls} ${ref.symbol} · ${label} · kayıtlı geçerli anahtar yok`, {}, deps.events) };
  const ts = await signedTimestamp({ exchange: deps.exchange, events: deps.events, now });
  if (!ts.ok) return { ok: false, refusal: "CLOCK_UNSYNCED", detail: `${label}: ${ts.refusal}: ${ts.detail}`, event: ts.event };
  // TUR 86 (G21 kutu 6): futures koruması algo emridir — kimlik `ALGO:<algoId>` ⇒ sorgu/iptal algo ucuna `algoId` ile; algo emri motora geçmişse (actualOrderId) GERÇEK emrin durumu AYNI imzalı
  //   yoldan okunur (FILLED ⇒ stop tetiklendi). Önek yoksa yol eskisiyle AYNI (SPOT `/api/v3/order`, futures `/fapi/v1/order`).
  const algoId = ref.market === "FUTURES" && id !== null && id.startsWith(ALGO_ID_PREFIX) ? id.slice(ALGO_ID_PREFIX.length) : null;
  const send = (path: string, q: Record<string, string>, m: "GET" | "DELETE" = method) => withSignedCall(k.api, k.priv, { ...q, recvWindow: String(RECV_WINDOW_MS), timestamp: ts.timestamp }, (headers, query) => requestWithEvents<OrderResponse>({ path, method: m, cls, weight, headers, query }, deps.exchange), deps.ring);
  const q: Record<string, string> = algoId !== null ? { algoId } : { symbol: ref.symbol };
  if (algoId === null) { if (id !== null) q.orderId = id; else q.origClientOrderId = ref.clientOrderId as string; }
  const r = await send(algoId !== null ? FUTURES_ALGO_PATH : ref.market === "FUTURES" ? FUTURES_ORDER_PATHS.live : ORDER_PATHS.live, q);
  if (!r.result.ok) return { ok: false, refusal: "EXCHANGE_DENIED", detail: `${label}: ${r.result.reason ?? ""}:${r.result.detail}`, status: r.result.status, event: r.event };
  if (algoId === null) return { ok: true, data: r.result.data, event: r.event };
  const a = r.result.data as AlgoResponse, actual = method === "GET" && a.actualOrderId !== undefined && String(a.actualOrderId) !== "" ? String(a.actualOrderId) : null;
  if (actual === null) return { ok: true, data: algoAsOrder(a), event: r.event };
  const o = await send(FUTURES_ORDER_PATHS.live, { symbol: ref.symbol, orderId: actual }, "GET");
  if (!o.result.ok) return { ok: false, refusal: "EXCHANGE_DENIED", detail: `${label}: algo ${algoId} motora geçti (emir ${actual}) ama emir okunamadı: ${o.result.reason ?? ""}:${o.result.detail}`, status: o.result.status, event: o.event };
  return { ok: true, data: algoAsOrder(a, String(o.result.data.status ?? "UNKNOWN")), event: o.event };
}
/** Borsadaki emrin GÜNCEL durumu (K-1 denetimi). Sınıf PROTECTION: bütçeye takılmaz (M-1), boğazda en yüksek payı alır. */
export const readOrder = (ref: OrderRef, deps: OrderDeps = {}): Promise<OrderOpOutcome> => signedOrderOp("emir sorgusu", "GET", "PROTECTION", ORDER_QUERY_WEIGHT, ref, deps);
/** Borsadaki emri İPTAL et (K-2: pozisyon kapatılırken ters yönde açık emir bırakılmaz). Sınıf EXIT: bütçeye takılmaz (M-1). */
export const cancelOrder = (ref: OrderRef, deps: OrderDeps = {}): Promise<OrderOpOutcome> => signedOrderOp("emir iptali", "DELETE", "EXIT", ORDER_CANCEL_WEIGHT, ref, deps);
