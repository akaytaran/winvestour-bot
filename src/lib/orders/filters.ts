// SEMBOL EMİR KURALLARI (G11 · S-5, S-7, M-2 ilkesi "maliyet/kural hesabın kaynağından okunur", Ö-1, Ö-3). Binance'in filtreleri KODA GÖMÜLMEZ: her seferinde
// `GET /api/v3/exchangeInfo?symbol=<sembol>` ile ÇALIŞMA ANINDA okunur (DISCOVERY sınıfı, G05 boğazı + G07 olay sarmalayıcısı; imza gerekmez, genel uç). Okunamazsa emir
// GÖNDERİLMEZ (kapalı arıza) — sessiz varsayılan adım/tavan YOKTUR (kapı: scripts/gate-order.mjs, koda gömülü stepSize/tickSize/minNotional KIRMIZI).
// YUVARLAMA HER ZAMAN AŞAĞI (fazla göndermektense az gönder): miktar stepSize'a, fiyat tickSize'a `floor` ile indirgenir; yukarı yuvarlayan yol kapıda KIRMIZI.
// Kurala uymayan emir GÖNDERİLMEDEN reddedilir: minQty/maxQty (LOT_SIZE), minPrice/maxPrice (PRICE_FILTER), minNotional (NOTIONAL / MIN_NOTIONAL) ve sembol durumu.
import { Prisma } from "@/generated/prisma/client";
import { requestWithEvents, type ExchangeDeps } from "@/lib/events/exchange";

/** Ağırlık 20: `exchangeInfo` tek sembol — Tur 0 başlık deltasıyla ölçüldü (Tur 0 raporu madde 6a; G05 EXCHANGE_INFO ile aynı uç ve ağırlık). */
export const SYMBOL_RULES_CALL = { path: "/api/v3/exchangeInfo", cls: "DISCOVERY", weight: 20 } as const;
const D = Prisma.Decimal, NUM = /^\d+(\.\d+)?$/;
export type Band = { min: string; max: string; step: string };
/** PERCENT_PRICE_BY_SIDE (Tur 12 §5 ölçümüyle bulundu, Tur 13'te uygulandı): fiyat, son `avgPriceMins` dakikanın ORTALAMA fiyatının katları olarak bir banda hapsedilir.
 *  Yön ayrımı vardır: BUY için bid çarpanları, SELL için ask çarpanları. Değerler koda GÖMÜLMEZ — exchangeInfo'dan çalışma anında okunur. */
export type PercentBand = { bidUp: string; bidDown: string; askUp: string; askDown: string; avgPriceMins: number | null };
export type SymbolRules = { symbol: string; status: string; baseAsset: string; quoteAsset: string; lot: Band; marketLot: Band | null; price: Band; percent: PercentBand | null; minNotional: string; applyMinToMarket: boolean; notionalFilter: string; raw: unknown; source: string };
export type RulesReading = { ok: true; rules: SymbolRules } | { ok: false; detail: string };
export type RuleRefusal = "SYMBOL_UNKNOWN" | "SYMBOL_NOT_TRADING" | "LOT_SIZE" | "PRICE_FILTER" | "PERCENT_PRICE_BY_SIDE" | "AVG_PRICE_UNAVAILABLE" | "MIN_NOTIONAL" | "NOTIONAL_UNMEASURABLE" | "BAD_NUMBER";
export type Adjusted = { ok: true; quantity: string; price: string | null; stopPrice: string | null; notional: string; applied: string[] } | { ok: false; refusal: RuleRefusal; detail: string };
type RawFilter = { filterType?: string; minQty?: string; maxQty?: string; stepSize?: string; minPrice?: string; maxPrice?: string; tickSize?: string; minNotional?: string; applyMinToMarket?: boolean; bidMultiplierUp?: string; bidMultiplierDown?: string; askMultiplierUp?: string; askMultiplierDown?: string; avgPriceMins?: number };
type RawSymbol = { symbol?: string; status?: string; baseAsset?: string; quoteAsset?: string; filters?: RawFilter[] };

/** Ondalık basamak sayısı — adımın KENDİ biçiminden alınır (ör. "0.00001000" → 8). Sabit hassasiyet yoktur. */
const dp = (s: string): number => { const i = s.indexOf("."); return i < 0 ? 0 : s.length - i - 1; };
/** AŞAĞI yuvarla: floor(değer / adım) × adım, adımın biçiminde. Adım 0/eksikse değer değişmez. Yukarı yuvarlama YOK (Ö-3: kapıyı geçmek için kural gevşetilmez). */
export function floorTo(value: string, step: string): string {
  if (!NUM.test(value)) return value;
  if (!NUM.test(step) || !new D(step).gt(0)) return value;
  return new D(value).div(step).floor().mul(step).toFixed(dp(step));
}
const bandOf = (f: RawFilter | undefined, keys: [keyof RawFilter, keyof RawFilter, keyof RawFilter]): Band | null => {
  if (!f) return null; const v = keys.map((k) => f[k]);
  return v.every((x) => typeof x === "string" && NUM.test(x)) ? { min: v[0] as string, max: v[1] as string, step: v[2] as string } : null;
};

/** Kuralları borsadan oku. Yanıt ham hâliyle `raw`'da döner (Ö-1: sayının kaynağı ve zamanı yanında). Eksik/bozuk filtre → ok:false (emir gönderilmez). */
export async function readSymbolRules(symbol: string, deps: { exchange?: ExchangeDeps; now?: () => number } = {}): Promise<RulesReading> {
  const now = deps.now ?? Date.now;
  const r = await requestWithEvents<{ symbols?: RawSymbol[] }>({ ...SYMBOL_RULES_CALL, query: { symbol } }, deps.exchange);
  if (!r.result.ok) return { ok: false, detail: `exchangeInfo:${r.result.reason ?? ""}:${r.result.detail}` };
  const s = (r.result.data?.symbols ?? []).find((x) => x.symbol === symbol);
  if (!s) return { ok: false, detail: `exchangeInfo:${symbol}:symbol-not-listed` };
  const f = (t: string) => (s.filters ?? []).find((x) => x.filterType === t);
  const lot = bandOf(f("LOT_SIZE"), ["minQty", "maxQty", "stepSize"]), price = bandOf(f("PRICE_FILTER"), ["minPrice", "maxPrice", "tickSize"]);
  const nf = f("NOTIONAL") ?? f("MIN_NOTIONAL"); // Binance yeni şemada NOTIONAL, eskide MIN_NOTIONAL — ikisi de okunur, hangisi bulunduysa kaynakta yazılır
  const minNotional = nf?.minNotional;
  if (!lot || !price || typeof minNotional !== "string" || !NUM.test(minNotional)) return { ok: false, detail: `exchangeInfo:${symbol}:missing-filter(lot=${!!lot} price=${!!price} notional=${typeof minNotional})` };
  const pp = f("PERCENT_PRICE_BY_SIDE"), pv = [pp?.bidMultiplierUp, pp?.bidMultiplierDown, pp?.askMultiplierUp, pp?.askMultiplierDown];
  // Filtre YOKSA null (her sembolde bulunmaz, sınır uygulanmaz); filtre VARSA çarpanları bozuksa okuma DÜŞER — yarım okunan bandın uygulanmaması sessiz gevşetmedir (Ö-3).
  if (pp && !pv.every((x) => typeof x === "string" && NUM.test(x))) return { ok: false, detail: `exchangeInfo:${symbol}:bad-percent-price-by-side` };
  const percent: PercentBand | null = pp ? { bidUp: pv[0] as string, bidDown: pv[1] as string, askUp: pv[2] as string, askDown: pv[3] as string, avgPriceMins: typeof pp.avgPriceMins === "number" ? pp.avgPriceMins : null } : null;
  return { ok: true, rules: { symbol, status: String(s.status ?? "?"), baseAsset: String(s.baseAsset ?? "?"), quoteAsset: String(s.quoteAsset ?? "?"), lot, marketLot: bandOf(f("MARKET_LOT_SIZE"), ["minQty", "maxQty", "stepSize"]), price, percent, minNotional, applyMinToMarket: nf?.applyMinToMarket !== false, notionalFilter: String(nf?.filterType ?? "?"), raw: s.filters ?? null, source: `exchangeInfo ${symbol} @${new Date(now()).toISOString()}` } };
}

/** PERCENT_PRICE_BY_SIDE'ın referansı: son `avgPriceMins` dakikanın ortalama fiyatı. Ağırlık 2 (Binance belgesi). Sembol kuralları gibi ÇALIŞMA ANINDA okunur, koda gömülmez. */
export const AVG_PRICE_CALL = { path: "/api/v3/avgPrice", cls: "DISCOVERY", weight: 2 } as const;
/** Ortalama fiyatı borsadan oku. Okunamazsa ok:false → fiyat bandı denetlenemez → emir GÖNDERİLMEZ (kapalı arıza). */
export async function readAvgPrice(symbol: string, deps: { exchange?: ExchangeDeps; now?: () => number } = {}): Promise<{ ok: true; price: string; mins: number | null; source: string } | { ok: false; detail: string }> {
  const r = await requestWithEvents<{ mins?: number; price?: string }>({ ...AVG_PRICE_CALL, query: { symbol } }, deps.exchange);
  if (!r.result.ok) return { ok: false, detail: `avgPrice:${r.result.reason ?? ""}:${r.result.detail}` };
  const px = r.result.data?.price;
  if (typeof px !== "string" || !NUM.test(px)) return { ok: false, detail: `avgPrice:${symbol}:bad-price` };
  return { ok: true, price: px, mins: typeof r.result.data?.mins === "number" ? r.result.data.mins : null, source: `avgPrice ${symbol} @${new Date((deps.now ?? Date.now)()).toISOString()}` };
}

// ---- FUTURES (USDS-M) KURALLARI (Tur 83 · G21 kalemi f ikinci dilim) — aynı ilke: çalışma anında okunur, koda gömülmez, eksikse emir GÖNDERİLMEZ ----
// Futures exchangeInfo'nun filtre adları SPOT'tan farklıdır (Binance USDS-M belgesi): LOT_SIZE · MARKET_LOT_SIZE · PRICE_FILTER aynı alanlarla; asgari büyüklük `MIN_NOTIONAL.notional`;
//   fiyat bandı `PERCENT_PRICE` (multiplierUp/multiplierDown, referans İŞARET FİYATI — yön ayrımı yok ⇒ iki yöne aynı çarpan). Uç sembol süzgeci almaz (bütün liste; ağırlık 1 — Tur 35 ölçümü).
export const FUTURES_RULES_CALL = { path: "/fapi/v1/exchangeInfo", cls: "DISCOVERY", weight: 1 } as const;
export const MARK_PRICE_CALL = { path: "/fapi/v1/premiumIndex", cls: "DISCOVERY", weight: 1 } as const;
type RawFuturesFilter = RawFilter & { notional?: string; multiplierUp?: string; multiplierDown?: string };
export async function readFuturesSymbolRules(symbol: string, deps: { exchange?: ExchangeDeps; now?: () => number } = {}): Promise<RulesReading> {
  const now = deps.now ?? Date.now;
  const r = await requestWithEvents<{ symbols?: (RawSymbol & { filters?: RawFuturesFilter[] })[] }>({ ...FUTURES_RULES_CALL }, deps.exchange);
  if (!r.result.ok) return { ok: false, detail: `futuresExchangeInfo:${r.result.reason ?? ""}:${r.result.detail}` };
  const s = (r.result.data?.symbols ?? []).find((x) => x.symbol === symbol);
  if (!s) return { ok: false, detail: `futuresExchangeInfo:${symbol}:symbol-not-listed` };
  const f = (t: string): RawFuturesFilter | undefined => (s.filters ?? []).find((x) => x.filterType === t);
  const lot = bandOf(f("LOT_SIZE"), ["minQty", "maxQty", "stepSize"]), price = bandOf(f("PRICE_FILTER"), ["minPrice", "maxPrice", "tickSize"]), minNotional = f("MIN_NOTIONAL")?.notional;
  if (!lot || !price || typeof minNotional !== "string" || !NUM.test(minNotional)) return { ok: false, detail: `futuresExchangeInfo:${symbol}:missing-filter(lot=${!!lot} price=${!!price} notional=${typeof minNotional})` };
  const pp = f("PERCENT_PRICE"), up = pp?.multiplierUp, down = pp?.multiplierDown;
  if (pp && !(typeof up === "string" && NUM.test(up) && typeof down === "string" && NUM.test(down))) return { ok: false, detail: `futuresExchangeInfo:${symbol}:bad-percent-price` };
  const percent: PercentBand | null = pp ? { bidUp: up as string, bidDown: down as string, askUp: up as string, askDown: down as string, avgPriceMins: null } : null;
  return { ok: true, rules: { symbol, status: String(s.status ?? "?"), baseAsset: String(s.baseAsset ?? "?"), quoteAsset: String(s.quoteAsset ?? "?"), lot, marketLot: bandOf(f("MARKET_LOT_SIZE"), ["minQty", "maxQty", "stepSize"]), price, percent, minNotional, applyMinToMarket: true, notionalFilter: "MIN_NOTIONAL", raw: s, source: `futuresExchangeInfo ${symbol} @${new Date(now()).toISOString()}` } };
}
/** Futures fiyat bandının referansı: İŞARET FİYATI (premiumIndex.markPrice). Okunamazsa ok:false → band denetlenemez → emir GÖNDERİLMEZ. */
export async function readMarkPrice(symbol: string, deps: { exchange?: ExchangeDeps; now?: () => number } = {}): Promise<{ ok: true; price: string; mins: number | null; source: string } | { ok: false; detail: string }> {
  const r = await requestWithEvents<{ symbol?: string; markPrice?: string }>({ ...MARK_PRICE_CALL, query: { symbol } }, deps.exchange);
  if (!r.result.ok) return { ok: false, detail: `premiumIndex:${r.result.reason ?? ""}:${r.result.detail}` };
  const px = r.result.data?.markPrice;
  if (typeof px !== "string" || !NUM.test(px)) return { ok: false, detail: `premiumIndex:${symbol}:bad-mark-price` };
  return { ok: true, price: px, mins: null, source: `premiumIndex ${symbol} @${new Date((deps.now ?? Date.now)()).toISOString()}` };
}

/** Kuralları uygula: AŞAĞI yuvarla, sonra sınırları denetle. Uymayan emir GÖNDERİLMEDEN reddedilir. `refPrice` fiyatsız emrin (MARKET, STOP_LOSS, TAKE_PROFIT) büyüklüğünü ölçmek içindir (fiyat kaynağı G16; yoksa ret).
 *  Büyüklük (notional) da AŞAĞI yuvarlanır (`ROUND_DOWN`): toFixed varsayılanı yarıyı yukarı yuvarlar ve sınırdaki bir emri MIN_NOTIONAL denetiminden geçirebilirdi.
 *  `avgPrice` PERCENT_PRICE_BY_SIDE'ın referansıdır: sembolde o filtre VARSA ve emir fiyatlıysa zorunludur — yoksa emir reddedilir (sessiz gevşetme yok, Ö-3). */
export function applyRules(rules: SymbolRules, o: { type: string; side: "BUY" | "SELL"; quantity: string; price?: string | null; stopPrice?: string | null; refPrice?: string | null; avgPrice?: string | null }): Adjusted {
  if (rules.status !== "TRADING") return { ok: false, refusal: "SYMBOL_NOT_TRADING", detail: `${rules.symbol} durum=${rules.status}` };
  if (!NUM.test(o.quantity)) return { ok: false, refusal: "BAD_NUMBER", detail: `quantity=${o.quantity}` };
  // TUR 14 DÜZELTMESİ (ölçüldü): `LOT_SIZE` HER emir tipinde geçerlidir; `MARKET_LOT_SIZE` market emirde EK bir kısıttır — biri diğerinin YERİNE geçmez, İKİSİ BİRDEN uygulanır
  // (kesişim: en DAR adım, en YÜKSEK minQty, en DÜŞÜK maxQty). Eskiden market emirde yalnız MARKET_LOT_SIZE seçiliyordu; USUALUSDT'de onun stepSize'ı 0 olduğu için miktar
  // LOT_SIZE adımına (0.1) hiç yuvarlanmıyordu ve borsa emri -1013 ile reddederdi. `stepSize = 0` "kısıt yok" demektir, "adım yok" demek değildir.
  const applied: string[] = [], base = rules.lot, ml = o.type === "MARKET" ? rules.marketLot : null;
  const lot = { step: ml && new D(ml.step).gt(0) && new D(ml.step).gt(base.step) ? ml.step : base.step,
                min: ml && new D(ml.min).gt(base.min) ? ml.min : base.min,
                max: ml && new D(ml.max).lt(base.max) ? ml.max : base.max };
  const quantity = floorTo(o.quantity, lot.step); applied.push(`LOT_SIZE${ml ? "+MARKET_LOT_SIZE" : ""}.stepSize=${lot.step} minQty=${lot.min} maxQty=${lot.max} ${o.quantity}→${quantity} (aşağı)`);
  if (new D(quantity).lt(lot.min)) return { ok: false, refusal: "LOT_SIZE", detail: `miktar ${quantity} < minQty ${lot.min}` };
  if (new D(quantity).gt(lot.max)) return { ok: false, refusal: "LOT_SIZE", detail: `miktar ${quantity} > maxQty ${lot.max}` };
  // Fiyat alanları (LIMIT'te `price`, koruma emrinde `stopPrice`) AYNI kurallardan geçer: tickSize'a AŞAĞI yuvarla → PRICE_FILTER sınırları → PERCENT_PRICE_BY_SIDE bandı.
  // Binance her iki alana da bu filtreleri uygular; koruma emrinin tetik fiyatını denetlemeden göndermek sessiz gevşetmedir (Ö-3, G12 madde 4).
  let bad: Adjusted | null = null;
  const priced = (label: string, raw: string): string | null => {
    if (!NUM.test(raw)) { bad ??= { ok: false, refusal: "BAD_NUMBER", detail: `${label}=${raw}` }; return null; }
    const v = floorTo(raw, rules.price.step); applied.push(`PRICE_FILTER.tickSize=${rules.price.step} ${label} ${raw}→${v} (aşağı)`);
    if (new D(v).lt(rules.price.min)) { bad ??= { ok: false, refusal: "PRICE_FILTER", detail: `${label} ${v} < minPrice ${rules.price.min}` }; return v; }
    if (new D(v).gt(rules.price.max)) { bad ??= { ok: false, refusal: "PRICE_FILTER", detail: `${label} ${v} > maxPrice ${rules.price.max}` }; return v; }
    // PERCENT_PRICE_BY_SIDE — yönüne göre band (Binance: BUY ⇒ bid çarpanları, SELL ⇒ ask çarpanları; referans son avgPriceMins dakikanın ORTALAMASI)
    if (rules.percent) {
      if (typeof o.avgPrice !== "string" || !NUM.test(o.avgPrice)) { bad ??= { ok: false, refusal: "AVG_PRICE_UNAVAILABLE", detail: `PERCENT_PRICE_BY_SIDE var ama ortalama fiyat ölçülemedi (avgPrice=${o.avgPrice ?? "yok"}); emir gönderilmez` }; return v; }
      const up = o.side === "BUY" ? rules.percent.bidUp : rules.percent.askUp, down = o.side === "BUY" ? rules.percent.bidDown : rules.percent.askDown;
      const hi = new D(o.avgPrice).mul(up), lo = new D(o.avgPrice).mul(down);
      applied.push(`PERCENT_PRICE_BY_SIDE.${o.side}=[${down}×${o.avgPrice}, ${up}×${o.avgPrice}]=[${lo.toFixed(8)}, ${hi.toFixed(8)}] ${label}=${v}`);
      if (new D(v).gt(hi)) bad ??= { ok: false, refusal: "PERCENT_PRICE_BY_SIDE", detail: `${label} ${v} > ${up} × ortalama ${o.avgPrice} = ${hi.toFixed(8)} (${o.side}, ${rules.percent.avgPriceMins ?? "?"} dk ortalama)` };
      if (new D(v).lt(lo)) bad ??= { ok: false, refusal: "PERCENT_PRICE_BY_SIDE", detail: `${label} ${v} < ${down} × ortalama ${o.avgPrice} = ${lo.toFixed(8)} (${o.side}, ${rules.percent.avgPriceMins ?? "?"} dk ortalama)` };
    }
    return v;
  };
  let price: string | null = null, stopPrice: string | null = null;
  if (o.type === "LIMIT" || o.type === "STOP_LOSS_LIMIT" || o.type === "TAKE_PROFIT_LIMIT") price = priced("fiyat", typeof o.price === "string" ? o.price : String(o.price));
  if (typeof o.stopPrice === "string" || o.stopPrice === null) { if (typeof o.stopPrice === "string") stopPrice = priced("tetik fiyatı", o.stopPrice); }
  if (bad) return bad;
  const ref = price ?? (typeof o.refPrice === "string" && NUM.test(o.refPrice) ? o.refPrice : null);
  if (ref === null) return { ok: false, refusal: "NOTIONAL_UNMEASURABLE", detail: `MARKET emirde büyüklük ölçülemedi: refPrice yok (fiyat kaynağı G16, icat edilmedi)` };
  const notional = new D(quantity).mul(ref).toFixed(8, D.ROUND_DOWN); applied.push(`notional=${quantity}×${ref}=${notional}`);
  if ((o.type !== "MARKET" || rules.applyMinToMarket) && new D(notional).lt(rules.minNotional)) return { ok: false, refusal: "MIN_NOTIONAL", detail: `büyüklük ${notional} < minNotional ${rules.minNotional} (${rules.notionalFilter})` };
  return { ok: true, quantity, price, stopPrice, notional, applied };
}
