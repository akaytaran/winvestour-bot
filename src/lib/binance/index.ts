// BİNANCE BOĞAZI (G05, S-7). Uygulamada Binance ana bilgisayarına HTTP çıkışı yapan TEK modül (kapı: scripts/gate-binance-budget.mjs).
// Her çağrı: sınıf + ağırlık bildirir → tavan (exchangeInfo.rateLimits, çalışma anında) → askı (429/418) denetimi + sayaç rezervasyonu TEK atomik adımda (Tur 20; yolun kapsamı: /api ya da /sapi) → gönderim →
// başlık mutabakatı (kapsamın kendi başlığı). Tavan okunamazsa, depo düşükse, askı varsa çağrı ÇIKMAZ (fail closed). Reddediş sebepleri EngineEventKind adlarıdır (./budget.ts).
// GÖNDERİM SONRASI KURALI (Tur 8 madde 4, Tur 6 §12-4 bulgusu): çağrı Binance'e ÇIKTIKTAN ve yanıt GELDİKTEN sonra depo (mutabakat/askı) hatası yanıtı ATMAZ — sonuç
// `postSend.storeFailed` ile işaretlenir, çağıran gerçek yanıtı görür; olayı G07 sarmalayıcısı yazar (src/lib/events/exchange.ts). Bu kural G11'i bağlar.
// FUTURES (Tur 35, G21 kalemi e): `/fapi/` ve `/dapi/` yolları AYRI ana makinelere gider (hostOf) ama TEK sayaç kapsamındadır (`futures`, scopeOf) — ÖLÇÜLDÜ.
// Futures tavanı futures exchangeInfo'dan ÇALIŞMA ANINDA okunur (sabit YOK, A-1'e sayı yazılmadı) ve yalnız futures kapsamlı bir çağrı geldiğinde (TEMBEL).
// Tavan okunamazsa futures penceresi KURULMAZ ve `reserve` futures çağrısını reddeder (`ceiling-unavailable:futures`) — `/sapi`nin bugünkü davranışının aynısı.
// BUGÜN BOĞAZDAN GEÇEN FUTURES ÇAĞRISI YOKTUR (emir yolu SPOT dışını reddeder, G21/A-5 iş sahibinde); bu tur yalnız SAYACI futures'ı görebilir hâle getirir.
// Bölge sabitleme (S-5) bu modülün üstüne gelir. İmzalı çağrı (G06, Tur 7): çağıran `headers` (X-MBX-APIKEY) ve imzalı `query` verir; boğaz yalnız taşır, anahtar/imza
// üretmez ve gözlemciye (observe) istek başlığı vermez (S-2).
// YÖNTEM (Tur 12, G11): `method` çağrıda BİLDİRİLİR, varsayılan GET. Emir uçları POST'tur; Binance imzalı POST'ta parametreleri de sorgu dizesinde kabul eder, bu yüzden
// imza girdisi (sorgu dizesi) yöntemden bağımsızdır ve G06 imzalama yolu değişmez. Boğaz gövde üretmez, taşımaz.
import { z } from "zod";
import { type BudgetStore, type CallClass, type Ceiling, type Decision, type DenyReason, type Scope, type Usage, placeHold, reconcile, reserve, scopeOf, upstashStore, withSapiFallback } from "./budget";

export const BINANCE_HOST = "https://api.binance.com";
/** FUTURES ANA MAKİNELERİ (Tur 35 madde 2, G21 kalemi e). İKİ ANA MAKİNE, TEK SAYAÇ: `/fapi/` (USD-M) ve `/dapi/` (COIN-M) ayrı ana makinelerdir ama aynı ağırlık
 *  sayacını paylaşırlar — ÖLÇÜLDÜ (Tur 35 futures ön ölçüm kaydı). Bu yüzden ana makine YOLDAN, sayaç kapsamı `scopeOf`tan gelir; ikisi aynı şey DEĞİLDİR. */
export const FUTURES_HOST = "https://fapi.binance.com", COIN_FUTURES_HOST = "https://dapi.binance.com";
/** Yolun gideceği ana makine. Tek yer: `send` buradan okur; kapı boğaz dışında ana makine adı aramayı sürdürür. */
export const hostOf = (path: string) => (path.startsWith("/fapi/") ? FUTURES_HOST : path.startsWith("/dapi/") ? COIN_FUTURES_HOST : BINANCE_HOST);
/** Tavan önbellek süresi (sicil, geri alınabilir): exchangeInfo 20 weight; saatte bir okumak dakikalık tavanın binde 3'ü. Süre dolunca yeniden okunur; okunamazsa sessiz eski değer YOK. */
export const CEILING_TTL_SEC = 3600;
/** Tavanın okunduğu çağrı. Ağırlık 20: Tur 0 başlık deltası (Tur 0 raporu madde 6a). Tek sembol istenir; rateLimits bloğu sembolden bağımsızdır. */
export const EXCHANGE_INFO = { path: "/api/v3/exchangeInfo", query: { symbol: "BTCUSDT" }, weight: 20 } as const;
/** Futures tavanının okunduğu çağrı (Tur 35). Ağırlık 1 — ÖLÇÜLDÜ (ön ölçüm adım 1: başlık 0 → 1). Sembol süzgeci YOKTUR: yanıt 1 113 598 bayt / 897 sembol (ÖLÇÜLDÜ),
 *  bu yüzden yalnız futures kapsamlı bir çağrı geldiğinde okunur (TEMBEL) ve `CEILING_TTL_SEC` boyunca saklanır. Bugün futures çağrısı YOK ⇒ bu uç hiç çağrılmıyor. */
export const FUTURES_EXCHANGE_INFO = { path: "/fapi/v1/exchangeInfo", weight: 1 } as const;
/** Tavan kümeleri AYRI önbelleklenir: `base` (api + türetilmiş sapi) ve `futures`. Kapsam → küme; küme → anahtar + hangi exchangeInfo'dan okunduğu. */
type CeilingSet = "base" | "futures";
const setOf = (s: Scope): CeilingSet => (s === "futures" ? "futures" : "base");
const CEILING_KEY: Record<CeilingSet, string> = { base: "binance:ceilings:v2", futures: "binance:ceilings:futures:v1" }; // v2 (Tur 8): kapsamlı (api/sapi) tavan listesi; futures:v1 (Tur 35): ayrı küme, ayrı anahtar — eski anahtar şemaya uymaz, yeniden okunur
/** 429/418 yanıtında Retry-After yoksa ve tavan da bilinmiyorsa askı süresi (sicil): bir dakika. Tavan biliniyorsa en kısa pencere kullanılır. */
const DEFAULT_BACKOFF_MS = 60_000;

/** DELETE (Tur 14, G12): emir İPTALİ. Yeni emir oluşturmaz — ORDERS sayacına girmez, yalnız REQUEST_WEIGHT harcar; imza girdisi yine sorgu dizesidir (yöntemden bağımsız). */
export type HttpMethod = "GET" | "POST" | "DELETE";
/** `observe`: bu ÇAĞRIYA özel gözlemci. Boğazın kendi `deps.observe`'unu değiştirmez, ona EK olarak çağrılır ve yalnız TAŞIYICI anını görür (depo turları hariç) —
 *  saat hizalaması (./time.ts) gönderim/alım anını bu yüzden buradan alır: t1−t0 ölçüsü Upstash turlarıyla şişerse sapma ölçümü anlamsızlaşır (Ö-5). */
/** `guard` (Tur 14): TAŞIYICIYA VERİLMEDEN HEMEN ÖNCE, son kontrol edilebilir anda çalışır. `false` dönerse çağrı ÇIKMAZ (`sent:false`) ve sonuç `reason` TAŞIMAZ —
 *  yani boğazın kendi durma sebeplerinden biri değildir, olayı çağıran yazar (imzalı emirde `STAMP_STALE`, G11). Depo turları (askı, tavan, rezervasyon) guard'dan
 *  ÖNCE koştuğu için imza damgasının o turlarda yaşlanması burada yakalanır: ölçüldü (Tur 14 madde 12), damga 5 s'lik recvWindow'u aşınca borsa -1021 veriyordu. */
export type BinanceCall = { path: string; method?: HttpMethod; query?: Record<string, string>; headers?: Record<string, string>; cls: CallClass; weight: number; orders?: number; observe?: (o: Observation) => void; guard?: () => { ok: true } | { ok: false; detail: string } };
export type TransportResponse = { status: number; headers: { get(name: string): string | null }; text: string };
export type Transport = (url: string, headers?: Record<string, string>, method?: HttpMethod) => Promise<TransportResponse>;
/** `method`: gözlemcinin "gerçek emir gönderildi mi" sorusunu URL'ye BAKARAK yanıtlaması yanlıştır — `GET /api/v3/order` (sorgu) ve `DELETE` (iptal) emir OLUŞTURMAZ.
 *  Emir yalnız `POST /api/v3/order` ile oluşur; yöntem bu yüzden gözleme girer (Tur 14 bulgusu: yöntemsiz dedektör provada sahte "gerçek emir" alarmı verdi). */
export type Observation = TransportResponse & { url: string; method: HttpMethod; ms: number };
export type Deps = { store: BudgetStore; transport?: Transport; now?: () => number; observe?: (o: Observation) => void };
/** Gönderim sonrası depo hatası: yanıt elde, sayaç hizalanamadı/askı yazılamadı. Yanıt atılmaz (Tur 8 madde 4). */
export type PostSendStoreFailure = { storeFailed: true; detail: "store-unavailable-after-send" };
export type BinanceResult<T = unknown> =
  | { ok: true; status: number; data: T; usage: Usage[]; sent: true; postSend?: PostSendStoreFailure }
  | { ok: false; reason?: DenyReason; detail: string; status?: number; retryAfterMs?: number; usage?: Usage[]; sent: boolean; postSend?: PostSendStoreFailure };
export type Denied = Extract<BinanceResult, { ok: false }>;

const rateLimitsSchema = z.object({ rateLimits: z.array(z.object({ rateLimitType: z.string(), interval: z.enum(["SECOND", "MINUTE", "HOUR", "DAY"]), intervalNum: z.number().int().positive(), limit: z.number().int().positive() })) });
const cachedSchema = z.object({ ceilings: z.array(z.object({ kind: z.enum(["REQUEST_WEIGHT", "ORDERS"]), scope: z.enum(["api", "sapi", "futures"]), interval: z.enum(["SECOND", "MINUTE", "HOUR", "DAY"]), intervalNum: z.number().int().positive(), limit: z.number().int().positive(), source: z.enum(["exchangeInfo", "futuresExchangeInfo", "SAPI_CEILING_FALLBACK"]) })), expiresAt: z.number() });
const WINDOW_MS = { SECOND: 1e3, MINUTE: 6e4, HOUR: 36e5, DAY: 864e5 } as const;
const fetchTransport: Transport = async (url, headers, method) => { const r = await fetch(url, { method: method ?? "GET", cache: "no-store", headers: { Accept: "application/json", ...headers } }); return { status: r.status, headers: r.headers, text: await r.text() }; };
const denied = (d: Decision & { allowed: false }, sent: boolean): Denied => ({ ok: false, reason: d.reason, detail: d.detail, retryAfterMs: d.retryAfterMs, sent });
const isDenied = (x: unknown): x is Decision & { allowed: false } => typeof x === "object" && x !== null && "allowed" in x;
const POST_SEND_FAILED: PostSendStoreFailure = { storeFailed: true, detail: "store-unavailable-after-send" };

/** İstemci kur. Üretim: getBinance(). Kapı/kanarya: sahte depo/taşıyıcı enjekte eder (S-9); ürün kodunda enjeksiyon YOK (kapı denetler). */
export function createBinanceClient(deps: Deps) {
  const store = deps.store, transport = deps.transport ?? fetchTransport, now = deps.now ?? Date.now;
  const mem: Partial<Record<CeilingSet, { ceilings: Ceiling[]; expiresAt: number }>> = {};

  const send = async (path: string, query?: Record<string, string>, headers?: Record<string, string>, method: HttpMethod = "GET", observe?: (o: Observation) => void): Promise<TransportResponse> => {
    const qs = query && Object.keys(query).length ? "?" + new URLSearchParams(query).toString() : "";
    const url = hostOf(path) + path + qs, t0 = performance.now(), r = await transport(url, headers, method);
    const o: Observation = { ...r, url, method, ms: +(performance.now() - t0).toFixed(1) };
    deps.observe?.(o); observe?.(o);
    return r;
  };
  /** Statüden karar (saf, depo yok): 429 → BUDGET_EXHAUSTED, 418 → IP_BANNED, 451 → REGION_BLOCKED. Askı süresi başlıkta yoksa en kısa pencere kadar. */
  const classify = (r: TransportResponse, ceilings: Ceiling[], usage: Usage[]): Denied | null => {
    const ra = Number(r.headers.get("retry-after")), fallback = ceilings.length ? Math.min(...ceilings.map((c) => c.intervalNum * WINDOW_MS[c.interval])) : DEFAULT_BACKOFF_MS;
    const retryAfterMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : fallback;
    if (r.status === 429) return { ok: false, reason: "BUDGET_EXHAUSTED", detail: "http-429", status: 429, retryAfterMs, usage, sent: true };
    if (r.status === 418) return { ok: false, reason: "IP_BANNED", detail: "http-418", status: 418, retryAfterMs, usage, sent: true };
    if (r.status === 451) return { ok: false, reason: "REGION_BLOCKED", detail: "http-451", status: 451, usage, sent: true };
    return null;
  };
  /** 429 → geri çekilme askısı (Retry-After), 418 → IP_BANNED askısı (depoya yazılır), 451 → askı yok. */
  const settle = async (r: TransportResponse, ceilings: Ceiling[], usage: Usage[]): Promise<Denied | null> => {
    const d = classify(r, ceilings, usage);
    if (d && (d.reason === "BUDGET_EXHAUSTED" || d.reason === "IP_BANNED") && d.retryAfterMs !== undefined) await placeHold(store, d.reason, d.retryAfterMs, now());
    return d;
  };
  /** Tavanı oku (KAPSAMIN KÜMESİ İÇİN): bellek → paylaşılan önbellek → exchangeInfo. `base` = /api tavanları + türetilmiş /sapi penceresi (SAPI_CEILING_FALLBACK);
   *  `futures` = futures exchangeInfo'nun kendi tavanları (sabit YOK, çalışma anında). Hiçbiri yoksa kapalı arıza; sessiz varsayılan tavan YOK — hiçbir kapsamda.
   *  TEMBEL: futures kümesi yalnız futures kapsamlı bir çağrı geldiğinde okunur; futures çağrısı yoksa futures exchangeInfo hiç çağrılmaz (bugünkü hâl). */
  const ceilings = async (scope: Scope): Promise<Ceiling[] | (Decision & { allowed: false }) | Denied> => {
    const t = now(), set = setOf(scope), tag = set === "futures" ? "futures:" : "", infoScope: Scope = set === "futures" ? "futures" : "api";
    const cachedSet = mem[set]; if (cachedSet && cachedSet.expiresAt > t) return cachedSet.ceilings;
    const [cached] = await store.mget([CEILING_KEY[set]]);
    if (cached) { const p = cachedSchema.safeParse(JSON.parse(cached)); if (p.success && p.data.expiresAt > t && p.data.ceilings.length) { mem[set] = p.data; return p.data.ceilings; } }
    const info = set === "futures" ? { path: FUTURES_EXCHANGE_INFO.path, query: undefined } : { path: EXCHANGE_INFO.path, query: { ...EXCHANGE_INFO.query } }; // TEK `send` (kapı: her send için bir reconcile)
    let r: TransportResponse; try { r = await send(info.path, info.query); } catch { return { allowed: false, reason: "STOPPED", detail: `ceiling-unavailable:${tag}transport` }; }
    let parsed: ReturnType<typeof rateLimitsSchema.safeParse> | null = null;
    try { parsed = rateLimitsSchema.safeParse(JSON.parse(r.text)); } catch { parsed = null; }
    const read: Ceiling[] = parsed?.success ? parsed.data.rateLimits.filter((x) => x.rateLimitType === "REQUEST_WEIGHT" || x.rateLimitType === "ORDERS").map((x) => ({ kind: x.rateLimitType as Ceiling["kind"], scope: infoScope, interval: x.interval, intervalNum: x.intervalNum, limit: x.limit, source: set === "futures" ? "futuresExchangeInfo" : "exchangeInfo" })) : [];
    const list = set === "futures" ? read : withSapiFallback(read);
    const bad = await settle(r, list, list.length ? await reconcile(store, list, r.headers, now(), infoScope) : []);
    if (bad) return bad;
    if (r.status !== 200 || !read.some((c) => c.kind === "REQUEST_WEIGHT")) return { allowed: false, reason: "STOPPED", detail: `ceiling-unavailable:${tag}http-${r.status}` };
    mem[set] = { ceilings: list, expiresAt: t + CEILING_TTL_SEC * 1000 };
    await store.set(CEILING_KEY[set], JSON.stringify(mem[set]), CEILING_TTL_SEC);
    return list;
  };

  return {
    /** Tavanı döndür (önbellekten ya da exchangeInfo'dan). Reddedilirse sebep. */
    ceilings: async (scope: Scope = "api"): Promise<{ ok: true; ceilings: Ceiling[] } | Denied> => {
      try { const c = await ceilings(scope); return Array.isArray(c) ? { ok: true, ceilings: c } : isDenied(c) ? denied(c, false) : c; }
      catch { return { ok: false, reason: "STOPPED", detail: "store-unavailable", sent: false }; }
    },
    /** Tek çağrı yolu. Sınıf ve ağırlık zorunlu (tip). Çıkmayan çağrı sent:false döner. Gönderim sonrası depo hatası yanıtı atmaz (postSend). */
    request: async <T = unknown>(call: BinanceCall): Promise<BinanceResult<T>> => {
      let sent = false;
      try {
        if (!/^\/[\w\-./]+$/.test(call.path)) return { ok: false, reason: "STOPPED", detail: "bad-path", sent };
        const scope = scopeOf(call.path);
        const c = await ceilings(scope); if (!Array.isArray(c)) return isDenied(c) ? denied(c, sent) : c;
        // ASKI + REZERVASYON tek atomik depo adımı (Tur 20): askı varsa sayaç artmaz; pay aşılırsa geri alınır. Sıra korunur: tavan → askı → rezervasyon → gönderim → mutabakat.
        const dec = await reserve(store, c, call, now()); if (!dec.allowed) return denied(dec, sent);
        // SON AN: depo turları bitti, taşıyıcıya vermeden önce çağıranın kendi ön koşulu (imza damgasının yaşı gibi) denetlenir. Düşerse çağrı ÇIKMAZ ve sebep taşımaz.
        const g = call.guard?.(); if (g && !g.ok) return { ok: false, detail: g.detail, sent: false };
        sent = true;
        let r: TransportResponse; try { r = await send(call.path, call.query, call.headers, call.method ?? "GET", call.observe); } catch { return { ok: false, reason: "STOPPED", detail: "transport-failed", sent }; }
        // Yanıt ELDE. Bundan sonra depo hatası yanıtı atmaz (Tur 8 madde 4): mutabakat/askı denenir, düşerse postSend işaretlenir, statü kararı saf classify ile verilir.
        let usage: Usage[] = [], postSend: PostSendStoreFailure | undefined, bad: Denied | null;
        try { usage = await reconcile(store, c, r.headers, now(), scope, dec.locals); bad = await settle(r, c, usage); }
        catch { postSend = POST_SEND_FAILED; bad = classify(r, c, usage); }
        if (bad) return postSend ? { ...bad, postSend } : bad;
        if (r.status !== 200) { let code: number | undefined; try { code = JSON.parse(r.text).code; } catch { code = undefined; /* gövde JSON değil */ } return { ok: false, detail: `http-${r.status}${code !== undefined ? ":" + code : ""}`, status: r.status, usage, sent, postSend }; }
        try { return { ok: true, status: 200, data: JSON.parse(r.text) as T, usage, sent: true, postSend }; } catch { return { ok: false, detail: "bad-json", status: 200, usage, sent, postSend }; }
      } catch { return { ok: false, reason: "STOPPED", detail: "store-unavailable", sent }; }
    },
  };
}
export type BinanceClient = ReturnType<typeof createBinanceClient>;

let singleton: BinanceClient | null = null;
/** Uygulama içi istemci: sayaç Upstash'te (ortam sözleşmesi), taşıyıcı fetch. */
export function getBinance(): BinanceClient { return (singleton ??= createBinanceClient({ store: upstashStore() })); }
