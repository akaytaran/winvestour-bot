// İMZALI FUTURES SÜRÜCÜSÜ (Tur 83 · G21 kalemi f İKİNCİ DİLİM · K-11, S-4, S-5, S-7, S-8, S-9, M-1, M-3, Ö-1, Ö-2). Arayüz `./futures-driver.ts`'tedir (tek sorumluluk: "bu kaldıracı borsaya yaz");
//   bu dosya o arayüzün İMZALI gerçeklemesidir ve futures hesabının iki okumasını (kaldıraç kademesi, komisyon kademesi) taşır. Ödenen/alınan funding'in deftere yazımı `@/lib/fee-ledger/exchange`'tedir.
// ÜRETİM VARSAYILANI DEĞİŞMEDİ: kaldıraç ucu (`src/lib/risk-settings/leverage.ts`) hâlâ KAPALI sürücüyü kullanır. Bu sürücü YALNIZ açıkça verildiğinde çalışır (kanarya, testnet ölçümü);
//   üretim yoluna bağlanması G21 kutusu 6'nın TESTNET ölçümünden sonradır (iş sahibi kararı D2: bitiş ölçütü testnet; Tur 83'te testnet anahtarı YOK).
// ANA MAKİNE seçimi bu dosyada YOKTUR: imzalı çağrı boğazdan (`requestWithEvents` → `createBinanceClient`) çıkar; `/fapi/` yolunun gideceği ana makineyi istemcinin `futuresTarget`ı seçer
//   (`src/lib/binance/index.ts` `hostFor` — tek yer; dağıtımda testnet SEÇİLEMEZ, kapı: gate:binance-budget T83).
// BU DOSYADA SAYI YOKTUR: kaldıraç sınırı borsanın kademe tablosundan, komisyon hesabın kademesinden, tavan ayardan okunur. Yazılım hiçbir kaldıraç sayısı SEÇMEZ; borsa sınırını aşan istek
//   tavana İNDİRİLMEZ, REDDEDİLİR (karar `winvestor-kaldirac-tavan-asimi` = A; Üretim S12-5: "küçük olan geçerlidir ve ekranda yazılır").
import { Prisma } from "@/generated/prisma/client";
import type { Keyring, StoredField } from "@/lib/crypto";
import { signedTimestamp } from "@/lib/binance/time";
import { prismaKeySource, RECV_WINDOW_MS } from "@/lib/exchange-key";
import { withSignedCall } from "@/lib/exchange-key/sign";
import { requestWithEvents, type ExchangeDeps, type GuardedResult } from "@/lib/events/exchange";
import { LEVERAGE_OUTCOME_UNKNOWN, type DriverResult, type FuturesDriver, type LeverageWrite } from "./futures-driver";

/** Ağırlıklar Binance USDS-M belgesinden (boğaz her yanıtta `x-mbx-used-weight-1m` ile HİZALAR — sapma ölçümle düzelir, S-7). Hepsi imzalıdır (USER_DATA / TRADE). */
export const LEVERAGE_BRACKET_CALL = { path: "/fapi/v1/leverageBracket", cls: "DISCOVERY", weight: 1 } as const;
export const COMMISSION_RATE_CALL = { path: "/fapi/v1/commissionRate", cls: "DISCOVERY", weight: 20 } as const;
export const SYMBOL_CONFIG_CALL = { path: "/fapi/v1/symbolConfig", cls: "DISCOVERY", weight: 5 } as const;
/** Kaldıracı değiştiren tek çağrı. Sınıf PROTECTION DEĞİL, ENTRY DEĞİL: emir oluşturmaz, maruziyet yaratmaz — boğazda DISCOVERY payıyla çıkar; ORDERS sayacına girmez. */
export const SET_LEVERAGE_CALL = { path: "/fapi/v1/leverage", method: "POST", cls: "DISCOVERY", weight: 1 } as const;

export type KeySource = () => Promise<{ api: StoredField; priv: StoredField } | null>;
export type FuturesReadDeps = { exchange?: ExchangeDeps; key?: KeySource; ring?: Keyring; now?: () => number };
const D = Prisma.Decimal, NUM = /^\d+(\.\d+)?$/, BP_PER_UNIT = 10_000; // birim dönüşümü (oran → baz puan), eşik değil
const errName = (e: unknown) => (e as { name?: string })?.name ?? "error";

/** İmzalı futures okuması — G06 imzası (S-4) + Tur 13 saat hizalaması + G05 boğazı + G07 olayı. Anahtar ve imza yalnız `withSignedCall` içinde; bu modül düz anahtar görmez. */
async function signedRead<T>(label: string, call: { path: string; cls: "DISCOVERY"; weight: number; method?: "GET" | "POST" }, query: Record<string, string>, deps: FuturesReadDeps): Promise<{ ok: true; data: T; source: string } | { ok: false; detail: string; sent: boolean; status?: number }> {
  const now = deps.now ?? Date.now, k = await (deps.key ?? prismaKeySource)();
  if (!k) return { ok: false, detail: `${label}:no-exchange-key`, sent: false };
  const ts = await signedTimestamp({ exchange: deps.exchange, events: deps.exchange?.events, now });
  if (!ts.ok) return { ok: false, detail: `${label}:clock:${ts.refusal}:${ts.detail}`, sent: false };
  let r: GuardedResult<T>;
  try { r = await withSignedCall(k.api, k.priv, { ...query, recvWindow: String(RECV_WINDOW_MS), timestamp: ts.timestamp }, (headers, q) => requestWithEvents<T>({ ...call, headers, query: q }, deps.exchange), deps.ring); }
  catch (e) { return { ok: false, detail: `${label}:${errName(e)}`, sent: false }; }
  if (!r.result.ok) return { ok: false, detail: `${label}:${r.result.reason ?? ""}:${r.result.detail}`, sent: r.result.sent, status: r.result.status };
  return { ok: true, data: r.result.data, source: `${call.path} @${new Date(now()).toISOString()}` };
}

/** Sembolün borsa kaldıraç SINIRI (kademe tablosunun en yüksek `initialLeverage`'ı). Okunamazsa ok:false — sınır "yok" sayılmaz (Ö-2). */
export type BracketReading = { ok: true; maxLeverage: number; source: string } | { ok: false; detail: string };
export async function readLeverageBracket(symbol: string, deps: FuturesReadDeps = {}): Promise<BracketReading> {
  const r = await signedRead<{ symbol?: string; brackets?: { initialLeverage?: unknown }[] }[] | { symbol?: string; brackets?: { initialLeverage?: unknown }[] }>("leverageBracket", LEVERAGE_BRACKET_CALL, { symbol }, deps);
  if (!r.ok) return { ok: false, detail: r.detail };
  const row = (Array.isArray(r.data) ? r.data : [r.data]).find((x) => x?.symbol === symbol);
  const levs = (row?.brackets ?? []).map((b) => b.initialLeverage).filter((x): x is number => typeof x === "number" && Number.isInteger(x) && x >= 1);
  if (levs.length === 0) return { ok: false, detail: `leverageBracket:${symbol}:no-bracket` };
  return { ok: true, maxLeverage: Math.max(...levs), source: r.source };
}

/** Sembolün HESAPTAKİ güncel kaldıracı (K-11: giriş, tavanı aşan kaldıraçla AÇILMAZ). Okunamazsa ok:false — giriş yapılmaz. */
export async function readSymbolLeverage(symbol: string, deps: FuturesReadDeps = {}): Promise<{ ok: true; leverage: number; source: string } | { ok: false; detail: string }> {
  const r = await signedRead<{ symbol?: string; leverage?: unknown }[]>("symbolConfig", SYMBOL_CONFIG_CALL, { symbol }, deps);
  if (!r.ok) return { ok: false, detail: r.detail };
  const lev = (Array.isArray(r.data) ? r.data : []).find((x) => x?.symbol === symbol)?.leverage;
  if (typeof lev !== "number" || !Number.isInteger(lev) || lev < 1) return { ok: false, detail: `symbolConfig:${symbol}:no-leverage` };
  return { ok: true, leverage: lev, source: r.source };
}

/** Futures KOMİSYON kademesi (M-2 ilkesi: maliyet hesabın kendi kademesinden okunur; SPOT kademesi futures'a TAŞINMAZ). Taker oranı baz puana çevrilir; okunamazsa ok:false (sayı yazılmaz). */
export async function readFuturesCommission(symbol: string, deps: FuturesReadDeps = {}): Promise<{ ok: true; takerBp: string; source: string } | { ok: false; detail: string }> {
  const r = await signedRead<{ symbol?: string; takerCommissionRate?: unknown }>("commissionRate", COMMISSION_RATE_CALL, { symbol }, deps);
  if (!r.ok) return { ok: false, detail: r.detail };
  const t = r.data?.takerCommissionRate;
  if (r.data?.symbol !== symbol || typeof t !== "string" || !NUM.test(t)) return { ok: false, detail: `commissionRate:${symbol}:bad-rate` };
  return { ok: true, takerBp: new D(t).mul(BP_PER_UNIT).toFixed(6), source: `${r.source} taker=${t}` };
}

/** BORSA SINIRINDA RET (Üretim S12-5): istenen kaldıraç kullanıcı tavanının içinde ama borsanın sembol sınırının ÜSTÜNDE ⇒ geçerli olan küçük sınırdır, istek REDDEDİLİR (indirilmez). */
export const DRIVER_ABOVE_BRACKET = "leverage-refused:above-exchange-bracket" as const;
/** Borsa okuması ya da yazımı GÖNDERİLMEDEN düştü (anahtar yok, saat hizalanmadı, kademe okunamadı, boğaz reddi): kaldıraç borsada DEĞİŞMEDİ. */
export const DRIVER_NOT_SENT = "leverage-refused:exchange-unavailable" as const;

/** İMZALI SÜRÜCÜ. Sıra: kademe sınırı okunur (okunamazsa yazım YOK) → istek sınırın üstündeyse RET (yazım YOK) → `POST /fapi/v1/leverage` → borsanın döndüğü kaldıraç istenene EŞİTSE "oldu";
 *  gönderilip sonucu doğrulanamayan her hâl BİLMİYORUM (kaldıraç borsada değişmiş OLABİLİR — sessizce "olmadı" sayılmaz, Tur 50 S49-2). Fırlatmaz. */
export function signedFuturesDriver(deps: FuturesReadDeps = {}): FuturesDriver {
  return { setLeverage: async (w: LeverageWrite): Promise<DriverResult> => {
    const b = await readLeverageBracket(w.symbol, deps);
    if (!b.ok) return { ok: false, refusal: DRIVER_NOT_SENT, detail: `kayıt #${w.recordId} (${w.symbol} ${w.leverage}×): borsanın kaldıraç sınırı okunamadı (${b.detail}); kaldıraç yazılmadı`, exchangeCalls: 0, exchangeResponse: null };
    if (w.leverage > b.maxLeverage) return { ok: false, refusal: DRIVER_ABOVE_BRACKET, detail: `kayıt #${w.recordId}: istenen ${w.leverage}× borsanın ${w.symbol} sınırı ${b.maxLeverage}×'in üstünde — geçerli sınır küçük olandır; istek indirilmedi, reddedildi (${b.source})`, exchangeCalls: 1, exchangeResponse: null, exchangeMax: b.maxLeverage };
    const r = await signedRead<{ leverage?: unknown; symbol?: unknown; maxNotionalValue?: unknown }>("leverage", SET_LEVERAGE_CALL, { symbol: w.symbol, leverage: String(w.leverage) }, deps);
    if (!r.ok && !r.sent) return { ok: false, refusal: DRIVER_NOT_SENT, detail: `kayıt #${w.recordId}: kaldıraç yazımı gönderilmedi (${r.detail})`, exchangeCalls: 1, exchangeResponse: null };
    if (!r.ok) return { ok: false, unknown: true, refusal: LEVERAGE_OUTCOME_UNKNOWN, detail: `kayıt #${w.recordId}: kaldıraç yazımı gönderildi ama borsa onaylamadı (${r.detail}); borsadaki kaldıraç doğrulanmalı`, exchangeCalls: 2, exchangeResponse: { status: r.status ?? null } };
    if (r.data?.symbol !== w.symbol || r.data?.leverage !== w.leverage) return { ok: false, unknown: true, refusal: LEVERAGE_OUTCOME_UNKNOWN, detail: `kayıt #${w.recordId}: borsa yanıtı istenen kaldıracı doğrulamıyor (sembol=${String(r.data?.symbol)} kaldıraç=${String(r.data?.leverage)})`, exchangeCalls: 2, exchangeResponse: r.data };
    return { ok: true, applied: true, leverage: w.leverage, exchangeMax: b.maxLeverage, detail: `kayıt #${w.recordId}: ${w.symbol} kaldıracı borsada ${w.leverage}× (borsa sınırı ${b.maxLeverage}×; ${r.source})`, exchangeCalls: 2, exchangeResponse: r.data };
  } };
}

/** FUTURES DOLUMUNUN KOMİSYONU (M-1): futures emir yanıtı (RESULT) dolum ayrıntısı TAŞIMAZ ⇒ emrin işlemleri imzalı okunur ve SPOT'un `fills` biçimine çevrilir (aynı mutabakat yolu).
 *  Okunamazsa ok:false — çağıran olayı yazar (FEE_LEDGER_UNAVAILABLE); komisyon "0" sayılmaz (Ö-2). */
export const USER_TRADES_CALL = { path: "/fapi/v1/userTrades", cls: "DISCOVERY", weight: 5 } as const;
export type FuturesFill = { price: string; qty: string; commission: string; commissionAsset: string };
export async function readOrderFills(symbol: string, orderId: number | string, deps: FuturesReadDeps = {}): Promise<{ ok: true; fills: FuturesFill[]; source: string } | { ok: false; detail: string }> {
  const r = await signedRead<{ orderId?: unknown; price?: unknown; qty?: unknown; commission?: unknown; commissionAsset?: unknown }[]>("userTrades", USER_TRADES_CALL, { symbol, orderId: String(orderId) }, deps);
  if (!r.ok) return { ok: false, detail: r.detail };
  const rows = (Array.isArray(r.data) ? r.data : []).filter((t) => String(t.orderId) === String(orderId));
  const fills = rows.filter((t) => [t.price, t.qty, t.commission].every((x) => typeof x === "string" && NUM.test(x)) && typeof t.commissionAsset === "string")
    .map((t) => ({ price: t.price as string, qty: t.qty as string, commission: t.commission as string, commissionAsset: t.commissionAsset as string }));
  if (fills.length === 0) return { ok: false, detail: `userTrades:${symbol}:${orderId}:no-trade` };
  return { ok: true, fills, source: r.source };
}
