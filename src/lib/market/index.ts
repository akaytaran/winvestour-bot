// PİYASA AKIŞI (G16 · S-7, K-3, K-8, Ö-1, Ö-5). PAYLAŞILAN TEK AKIŞ: izlenen sembollerin tamamı TEK çağrıda, BOĞAZDAN (DISCOVERY), ağırlık başlıkla mutabakatlı okunur;
// son anlık görüntü halka kaydında (`chain:link:<seq>`, zincirin kalp atışıyla AYNI komutta) durur — ayrı `market:snapshot` yazımı Tur 20'de KALDIRILDI (ÖLÇÜLDÜ: tik başına 1 komut,
// hiçbir yol okumuyordu). K-3 — AKIŞ KESİLİRSE OLAY YAZILIR (MARKET_FEED_DOWN) ve MOTOR YENİ POZİSYON AÇMAZ: zincir (src/lib/chain) yalnız
// taze bir okumanın ardından giriş planlar; çıkış ve koruma bu akışa bağlı DEĞİLDİR (koruma borsada durur, K-1; denetleyici imzalı sorguyla okur, G12).
// SEMBOL LİSTESİ ELLE YAZILMAZ (A-2): izlenen semboller açık pozisyonlardan gelir; hiç pozisyon yokken akışın CANLILIĞI boğazın tavan sembolüyle (EXCHANGE_INFO.query) ölçülür —
// bu bir işlem çifti seçimi değildir. Sayılar: tik süresi Tur 20 madde 3 ÖLÇÜMÜNDEN, bayatlık tavanı UYDURULDU (sicil).
import { Prisma } from "@/generated/prisma/client";
import { EXCHANGE_INFO } from "@/lib/binance";
import type { Usage } from "@/lib/binance/budget";
import { stopEngine, type Deps as EventDeps, type EmitResult } from "@/lib/events";
import { requestWithEvents, type ExchangeDeps } from "@/lib/events/exchange";

/** Ağırlık 4: `symbols=[…]` biçimi (Tur 0 madde 6a ve Tur 4 kanarya adım 9'da 10 sembol tek çağrı → başlık deltası 4 ÖLÇÜLDÜ); boğaz her yanıtta başlıkla hizalar (S-7). */
export const MARKET_CALL = { path: "/api/v3/ticker/bookTicker", cls: "DISCOVERY", weight: 4 } as const;
/** Tek sembol biçimi (`symbol=`): ağırlık 2 — ÖLÇÜLDÜ (Tur 19 madde 6: başlık deltası tik başına 2). Doğru ağırlık bildirmek mutabakat yazımını da azaltır (yerel = başlık ⇒ SET yok). */
export const MARKET_CALL_SINGLE = { ...MARKET_CALL, weight: 2 } as const;
/** Mum serisi (Beyin girdisi, G15 MARKET_SNAPSHOT.candles): tek sembol, ağırlık 2 (Binance belgesi; başlıkla hizalanır). */
export const KLINES_CALL = { path: "/api/v3/klines", cls: "DISCOVERY", weight: 2 } as const;
/** TİK SÜRESİ — ÖLÇÜLDÜ (Tur 20 madde 3, `scripts/measure-tick-interval.mts`, 4 sembol × 6 saat 1 s'lik seri, 1 199 giriş, G14 `judgeExit` ile): kâr geri verme çıkışının 1 s referansa göre kayması
 *  Δ=3 s p10 −1,2 bp / kaçırılan %0,17 · **Δ=10 s p10 −3,5 bp / kaçırılan %0,42** · Δ=30 s p10 −5,9 bp / %1,08 · Δ=60 s p10 −8,0 bp / %2,4 (medyan her Δ'da ≈ 0). Seçim kuralı (UYDURULDU, AÇIK,
 *  sicil): kaçırılan çıkış ≤ %1 VE p10 kayma ≤ ölçülen gidiş-dönüş komisyonun (15 bp) üçte biri ⇒ en uzun aralık 10 s. Eski 3 s brieften geliyordu (ölçüm değildi); koruma borsada durduğu
 *  için (K-1) tik hızı korumayı etkilemez, hız arbitrajı yasaktır (K-12). Ağırlık: tek sembol 2 × 6/dk = 12 weight/dk (tavan exchangeInfo'dan, koda yazılmaz).
 *  TUR 21: bu sabit ÖLÇÜLEN ÖNERİDİR (hızlı mod için), fiilî tik aralığı AYARDIR (ENGINE_TICK_MS, ortam sözleşmesi) — zincir bu sabiti KULLANMAZ (kapı: koda gömülü tik KIRMIZI). Tur 21 madde 1 ölçümü (aynı betik,
 *  60/120 s): Δ=60 s p10 −6,4 bp / kaçırılan %2,26 · Δ=120 s p10 −8,7 bp / %4,27 · Δ=180 s −10,0 bp / %7,21 · Δ=300 s −11,0 bp / %9,97 — ucuz modun bedeli budur, koruma borsada durur (K-1). */
export const MARKET_TICK_MS = 10_000;
/** AÇIK — A-1'de yok, UYDURULDU (sicil, geri alınabilir): akışın "ayakta" sayılma tavanı = 3 tik. Bir tik kaçırmak (ağ dalgalanması, Tur 8/9 ölçümleri) kesinti değildir;
 *  üç ardışık tik boyunca okuma yoksa akış KESİK sayılır ve giriş planlanmaz (K-3). Çıkış/koruma bundan etkilenmez. */
export const MARKET_STALE_MS = 3 * MARKET_TICK_MS;
/** Tikler arası bekleme. Zincir bu fonksiyonu kullanır; koruma güncellemesi zamanlayıcıyla tetiklenmez (K-10) — zamanlayıcı yalnız akış OKUMASINI aralıklar. */
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const D = Prisma.Decimal, NUM = /^\d+(\.\d+)?$/;
export type Quote = { symbol: string; bid: string; ask: string; mid: string; spreadBp: string };
export type MarketSnapshot = { at: string; quotes: Quote[]; source: string };
export type MarketRefusal = "FEED_UNAVAILABLE" | "FEED_UNREADABLE";
export type MarketReading = { ok: true; snapshot: MarketSnapshot; usage: Usage[]; event: null } | { ok: false; refusal: MarketRefusal; detail: string; event: EmitResult | null };
export type MarketDeps = { exchange?: ExchangeDeps; events?: EventDeps; now?: () => number };
type BookRow = { symbol?: string; bidPrice?: string; askPrice?: string };

/** TEK ÇAĞRI, TÜM SEMBOLLER. Okunamazsa MARKET_FEED_DOWN olayı (K-3/K-8); çağıran giriş planlamaz. Fırlatmaz. Depoya YAZMAZ (anlık görüntüyü çağıran kendi kaydına koyar). */
export async function readMarket(symbols: string[], deps: MarketDeps = {}): Promise<MarketReading> {
  const now = deps.now ?? Date.now, syms = symbols.length ? [...new Set(symbols)] : [EXCHANGE_INFO.query.symbol];
  const no = async (refusal: MarketRefusal, detail: string): Promise<MarketReading> => ({ ok: false, refusal, detail, event: await stopEngine("MARKET_FEED_DOWN", `${refusal} · ${syms.length} sembol · ${detail}`, {}, deps.events) });
  const r = await requestWithEvents<BookRow[] | BookRow>(syms.length === 1 ? { ...MARKET_CALL_SINGLE, query: { symbol: syms[0] } } : { ...MARKET_CALL, query: { symbols: JSON.stringify(syms) } }, deps.exchange);
  if (!r.result.ok) return no("FEED_UNAVAILABLE", `${MARKET_CALL.path}:${r.result.reason ?? ""}:${r.result.detail}${r.result.sent ? "" : " (çıkmadı)"}`);
  const rows = Array.isArray(r.result.data) ? r.result.data : [r.result.data], quotes: Quote[] = [];
  for (const row of rows) {
    const bid = typeof row.bidPrice === "string" && NUM.test(row.bidPrice) ? new D(row.bidPrice) : null, ask = typeof row.askPrice === "string" && NUM.test(row.askPrice) ? new D(row.askPrice) : null;
    if (typeof row.symbol !== "string" || bid === null || ask === null || !bid.gt(0) || ask.lt(bid)) return no("FEED_UNREADABLE", `${String(row.symbol)} bid=${row.bidPrice ?? "?"} ask=${row.askPrice ?? "?"}`);
    const mid = bid.add(ask).div(2); quotes.push({ symbol: row.symbol, bid: bid.toFixed(8), ask: ask.toFixed(8), mid: mid.toFixed(8), spreadBp: ask.sub(bid).div(mid).mul(10_000).toFixed(6) });
  }
  const missing = syms.filter((x) => !quotes.some((q) => q.symbol === x));
  if (missing.length) return no("FEED_UNREADABLE", `yanıtta eksik sembol: ${missing.join(",")}`);
  const snapshot: MarketSnapshot = { at: new Date(now()).toISOString(), quotes, source: `${MARKET_CALL.path} symbols=${syms.length} @${new Date(now()).toISOString()}` };
  return { ok: true, snapshot, usage: r.result.usage, event: null };
}
/** Akış ayakta mı? Son okuma MARKET_STALE_MS'ten eskiyse KESİK sayılır (K-3: giriş planlanmaz). */
export const feedFresh = (s: MarketSnapshot | null, nowMs: number): boolean => s !== null && nowMs - Date.parse(s.at) <= MARKET_STALE_MS;

export type Candle = [number, string, string, string, string, string];
/** Mum serisi (Beyin girdisi biçimi: [açılış ms, açılış, en yüksek, en düşük, kapanış, taban hacmi]); okunamazsa ok:false (Beyin çağrılmaz — girdi eksik). */
export async function readCandles(symbol: string, interval: string, limit: number, deps: MarketDeps = {}): Promise<{ ok: true; candles: Candle[]; source: string } | { ok: false; detail: string }> {
  const r = await requestWithEvents<unknown[][]>({ ...KLINES_CALL, query: { symbol, interval, limit: String(limit) } }, deps.exchange);
  if (!r.result.ok) return { ok: false, detail: `${KLINES_CALL.path}:${symbol}:${r.result.reason ?? ""}:${r.result.detail}` };
  const rows = Array.isArray(r.result.data) ? r.result.data : [], candles: Candle[] = [];
  for (const c of rows) { const [t, o, h, l, cl, v] = c; if (typeof t !== "number" || [o, h, l, cl, v].some((x) => typeof x !== "string" || !NUM.test(x))) return { ok: false, detail: `${symbol}: mum biçimi bozuk` }; candles.push([t, new D(o as string).toFixed(8), new D(h as string).toFixed(8), new D(l as string).toFixed(8), new D(cl as string).toFixed(8), new D(v as string).toFixed(8)]); }
  return { ok: true, candles, source: `${KLINES_CALL.path} ${symbol} ${interval}×${limit} @${new Date((deps.now ?? Date.now)()).toISOString()}` };
}
