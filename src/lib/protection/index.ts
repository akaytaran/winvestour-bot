// KORUMA EMRİ YÖNETİCİSİ (G12 · K-1, K-2, K-3, K-8, K-9, M-1, M-4, S-7, S-9, Ö-1, Ö-3). Pozisyon açan TEK yüzey (kapı: scripts/gate-protection.mjs).
// K-1 — KORUMA BORSADA DURUR: stop bizim altyapımızda bir zamanlayıcı/bellek kaydı değil, Binance'te YERLEŞİK bir emirdir; altyapı tamamen ölse de tetiklenir.
// K-2 — KORUMASIZ POZİSYON YOKTUR: pozisyon açma ATOMİK DEĞİLDİR (borsa "giriş + stop"u tek işlem olarak almaz) ama TAMAMLANMASI ŞARTLIDIR:
//   (1) giriş emri gönderilir, dolum alınır → (2) HEMEN ARDINDAN koruma emri gönderilir ve BORSA EMİR KİMLİĞİ alınır → (3) kimlik `positions.protection_order_id`'ye yazılır
//   ve satır ancak o zaman `OPEN` olur (G02 CHECK `positions_open_requires_protection` son savunmadır: kimliksiz OPEN satır veritabanına giremez).
//   Koruma yerleşmezse YA DA koruma penceresi aşılırsa pozisyon DERHAL KAPATILIR; kapatma da başarısız olursa olay yazılır, MOTOR DURUR ve bildirim gerekir.
//   Sessizce açık pozisyon bırakan yol YOKTUR; her dal ya OPEN+kimlik, ya kapatma, ya da durdurma ile biter.
// KORUMA PENCERESİ (madde 3): dolum ile korumanın borsaya yerleşmesi arasındaki süre = pozisyonun korumasız kaldığı pencere. ÖLÇÜLÜR ve PROTECTION_WINDOW_MS tavanını
//   aşarsa pozisyon kapatılır (tavan aşağıda, AÇIK/UYDURULDU).
// TÜR VE TARAF (madde 4): UZUN pozisyon → koruma STOP_LOSS SATIŞ, tetik girişin ALTINDA. Tetik fiyatı DIŞARIDAN gelir; stop mesafesi A-1'de AÇIK, bu modül sayı ÜRETMEZ.
//   Tetik fiyatı G11 filtrelerinden geçer (PRICE_FILTER / tickSize / PERCENT_PRICE_BY_SIDE — applyRules, aşağı yuvarlama).
// BU MODÜL EMİR KURMAZ VE GÖNDERMEZ: her emir G11 emir yüzeyinden (placeOrder) ve dolayısıyla G10 icra sarmalayıcısından geçer (kimlik → izin → kilit → bütçe → boğaz → kayıt).
// G14 (Tur 16, K-10/M-7): tepe takibi, kâr geri verme çıkışı ve koruma taşıma `./trailing.ts`'tedir; YENİDEN GİRİŞ kapısı (soğuma + dönem başına tur tavanı) bu yolun İLK adımıdır —
//   G13 taramasından ve giriş emrinden ÖNCE (kapı: scripts/gate-trailing.mjs `reentry-order`). Tepe (`peak_price`) ve yeniden koruma kimliği yazımı yine yalnız bu deponun (PositionStore) işidir.
// TUR 23 (A-9, K-2, K-10, Ö-2): tik yolunda `positions` tablosu OKUNMAZ — açık pozisyonların özeti Upstash'te süreli bir KOPYADA (`./copy.ts`: `readPositions`, `withPositionCopy`). Neon kalıcı gerçektir ve
//   her değişimde ÖNCE yazılır (kapanış DERHAL: `close` tek yazımda tepeyi de taşır); kopya sonra güncellenir. `auditProtection` açık listeyi tikten (kopya) alır; borsadaki koruma emrini doğrulamayı sürdürür (K-1).
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/db/client";
import type { PositionCopyStore } from "./copy";
import type { Keyring } from "@/lib/crypto";
import { requestStop, type Deps as ControlDeps } from "@/lib/engine-control";
import { stopEngine, type Deps as EventDeps, type EmitResult } from "@/lib/events";
import { FUTURES_PROTECTION_TYPE, ORDER_PATHS, cancelOrder, placeOrder, readOrder, type OrderDeps, type OrderIntent, type OrderOutcome, type OrderResponse } from "@/lib/orders";
import { screenEntry, type ScreenDeps, type ScreenOutcome } from "@/lib/edge";
import { readOrderFills } from "@/lib/orders/futures-signed";
import { reconcileTriggered, reservationOpen } from "@/lib/execution-lock/execute";
import { futuresEntryEdge, type FuturesScreenOutcome } from "@/lib/edge/futures";
import { screenReentry, type ReentryDeps, type ReentryOutcome } from "./trailing";
import { screenHealth, type HealthDeps, type HealthOutcome } from "@/lib/health";

/** AÇIK — A-1'de yok, UYDURULDU (sicil, geri alınabilir): dolum ile korumanın yerleşmesi arasındaki süre tavanı. 10 s seçildi çünkü (a) ölçülen tek imzalı emir gidiş-dönüşü
 *  canlıda 48 ms, yerelde 285–488 ms'dir (Tur 13) — 10 s bunun 20–200 katıdır, yani normal gecikme bu tavana ÇARPMAZ; (b) EXECUTION_LEASE_MS 30 s'dir ve pencere aşıldığında
 *  pozisyonu KAPATMA işlemi de aynı icra adımına sığmak zorundadır: tavanın kiranın üçte birinde durması kapatmaya iki katı kadar pay bırakır. Ölçüm madde 9 adım 9'dadır. */
export const PROTECTION_WINDOW_MS = 10_000;
/** ÖLÇÜLDÜ (2026-09-09, GET /api/v3/exchangeInfo, BTCUSDT ve USUALUSDT — ikisinde de aynı): SPOT orderTypes = LIMIT, LIMIT_MAKER, MARKET, STOP_LOSS, STOP_LOSS_LIMIT,
 *  TAKE_PROFIT, TAKE_PROFIT_LIMIT. ANAYASA K-1'in yazdığı STOP_MARKET / TAKE_PROFIT_MARKET FUTURES adlarıdır ve SPOT'ta YOKTUR; kural değişmedi (koruma borsada yerleşik
 *  emirdir), yalnız spot karşılığı kullanılır. STOP_LOSS tetiklenince PİYASA emri olur — koruma için doğru olan budur (limit stop dolmayabilir). */
export const PROTECTION_TYPE = "STOP_LOSS", TARGET_TYPE = "TAKE_PROFIT";
/** OCO KARARI (madde 4). ÖLÇÜLDÜ (2026-09-09): iki sembolde de ocoAllowed:true. KARAR: G12 TEK BACAK gönderir — hedef (kâr alma) oranı A-1'de AÇIK ve G14'ün konusudur,
 *  sayı icat edilmez; tek bacakta "biri dolunca diğerini iptal et" sorunu ZATEN YOKTUR. İkinci bacak gerektiğinde BORSANIN OCO EMİR LİSTESİ kullanılacaktır: iki BAĞIMSIZ emir
 *  gönderip iptali kendi altyapımızda kovalamak K-1'i ihlal eder (koruma mantığı borsadan bizim tarafa geçer) ve altyapı ölünce ters yönde açık emir bırakır.
 *  Kapı bunu zorlar: aynı pozisyon için iki koruma emri gönderip OCO ucunu kullanmayan yol KIRMIZI'dır. (OCO'nun dolum-iptal davranışı ÖLÇÜLMEDİ — gerçek emir yok, S-9.) */
export const OCO_PATH = ORDER_PATHS.oco;

const D = Prisma.Decimal, NUM = /^\d+(\.\d+)?$/;
export type PositionSeed = { exchangeKeyId: number; symbol: string; market: "SPOT" | "FUTURES"; side: "LONG" | "SHORT"; entryPrice: string; quantity: string; openedAt: Date };
/** `entryPrice`: KAPATMA emrinin büyüklük (MIN_NOTIONAL) referansı. Ölçülmüş dolum fiyatıdır, satırda zaten durur — kapatma yolu bunun için ek bir fiyat çağrısı YAPMAZ
 *  (DISCOVERY sınıfı bütçeye takılırdı ve M-1 "çıkış bütçeye takılmaz" kuralını dolaylı olarak deler). */
export type OpenPosition = { id: number; symbol: string; market: "SPOT" | "FUTURES"; quantity: string; entryPrice: string; protectionOrderId: string | null; peakPrice: string | null };
/** Depo: üretimde Prisma; kapı/kanarya sahte ya da shadow depo enjekte eder (S-9). protect() OPENING → OPEN geçişini KİMLİKLE birlikte yapar (kimliksiz OPEN yazılamaz, DB CHECK).
 *  G14: peak() tepeyi YALNIZ açık satıra yazar (çağıran yalnız yükselişte çağırır, K-10); reprotect() taşınan korumanın yeni kimliğini OPEN satıra yazar; history() sembolün
 *  KAPANMIŞ satırlarından son çıkış anını ve dönem içindeki tur sayısını ÖLÇER (M-7 — ayrı sayaç yok). */
const CLOSED_STATUSES = ["CLOSED", "FAILED_UNPROTECTED_CLOSED"] as const;
export interface PositionStore {
  open(seed: PositionSeed): Promise<{ id: number }>;
  protect(id: number, protectionOrderId: string): Promise<boolean>;
  close(id: number, status: "CLOSED" | "FAILED_UNPROTECTED_CLOSED", at: Date, peakPrice?: string | null): Promise<boolean>; // Tur 23: kapanış tek yazımda son tepeyi de taşır (K-10 olay tetikli Neon yazımı)
  listOpen(): Promise<OpenPosition[]>;
  peak(id: number, price: string): Promise<boolean>;
  reprotect(id: number, protectionOrderId: string, peakPrice?: string | null): Promise<boolean>; // Tur 23: taşımada tepe de Neon'a (olay tetikli)
  history(symbol: string, periodStart: Date, periodEnd: Date): Promise<{ lastClosedAt: Date | null; closedInPeriod: number }>;
}
export const prismaPositionStore = (client?: PrismaClient): PositionStore => { const db = () => client ?? getDb(); return {
  open: async (s) => ({ id: (await db().position.create({ data: { ...s, status: "OPENING", protectionOrderId: null }, select: { id: true } })).id }),
  protect: async (id, protectionOrderId) => (await db().position.updateMany({ where: { id, status: "OPENING" }, data: { protectionOrderId, status: "OPEN" } })).count === 1,
  close: async (id, status, closedAt, peakPrice) => (await db().position.updateMany({ where: { id, status: { in: ["OPENING", "OPEN", "CLOSING"] } }, data: { status, closedAt, ...(peakPrice ? { peakPrice } : {}) } })).count === 1,
  listOpen: async () => (await db().position.findMany({ where: { status: "OPEN" }, select: { id: true, symbol: true, market: true, quantity: true, entryPrice: true, protectionOrderId: true, peakPrice: true } })).map((p) => ({ ...p, quantity: String(p.quantity), entryPrice: String(p.entryPrice), peakPrice: p.peakPrice === null ? null : String(p.peakPrice) })),
  peak: async (id, price) => (await db().position.updateMany({ where: { id, status: "OPEN" }, data: { peakPrice: price } })).count === 1,
  reprotect: async (id, protectionOrderId, peakPrice) => (await db().position.updateMany({ where: { id, status: "OPEN" }, data: { protectionOrderId, ...(peakPrice ? { peakPrice } : {}) } })).count === 1,
  history: async (symbol, periodStart, periodEnd) => ({
    lastClosedAt: (await db().position.findFirst({ where: { symbol, status: { in: [...CLOSED_STATUSES] }, closedAt: { not: null } }, orderBy: { closedAt: "desc" }, select: { closedAt: true } }))?.closedAt ?? null,
    closedInPeriod: await db().position.count({ where: { symbol, status: { in: [...CLOSED_STATUSES] }, closedAt: { gte: periodStart, lt: periodEnd } } }) }),
}; };

/** GİRİŞ ADIMI ENJEKTE EDİLEBİLİR (S-9) — ama YALNIZ O. Gerekçe: `ENTRY_ENABLED = false` olduğu sürece (K-2) gerçek giriş emri GÖNDERİLEMEZ; koruma yolunun kendisi de
 *  ölçülemez hâle gelirdi. Kanarya bu adıma sahte bir DOLUM verir ve koruma/çıkış adımları GERÇEK emir yüzeyinden (placeOrder → executeSignal → boğaz) geçmeye devam eder.
 *  Varsayılan `entry` = ENTRY sınıfı `placeOrder`'dır ve ürün kodunda başka bir değer VERİLMEZ (kapı: gate:protection `entry-step-not-default` / `entry-injected-in-src`). */
export type EntryStep = (i: OrderIntent, d: OrderDeps) => Promise<OrderOutcome>;
export const defaultEntry: EntryStep = (i, d) => placeOrder({ ...i, cls: "ENTRY" }, d);
/** Kapı/kanarya deposu (S-9): aynı anlambilim bellekte. `protect` yalnız OPENING satırı OPEN yapar; `fail` ile depo düşürülebilir (kapalı arıza ölçümü). */
type MemRow = PositionSeed & { id: number; status: string; protectionOrderId: string | null; peakPrice: string | null; closedAt: Date | null };
export function memoryPositionStore(): PositionStore & { rows: MemRow[]; fail: boolean } {
  const s = { rows: [] as MemRow[], fail: false };
  const g = () => { if (s.fail) throw new Error("position-store-down"); };
  const closed = (x: MemRow) => (CLOSED_STATUSES as readonly string[]).includes(x.status) && x.closedAt !== null;
  return Object.assign(s, {
    open: async (seed: PositionSeed) => { g(); const r: MemRow = { ...seed, id: s.rows.length + 1, status: "OPENING", protectionOrderId: null, peakPrice: null, closedAt: null }; s.rows.push(r); return { id: r.id }; },
    protect: async (id: number, protectionOrderId: string) => { g(); const r = s.rows.find((x) => x.id === id && x.status === "OPENING"); if (!r) return false; r.protectionOrderId = protectionOrderId; r.status = "OPEN"; return true; },
    close: async (id: number, status: "CLOSED" | "FAILED_UNPROTECTED_CLOSED", at: Date, peakPrice?: string | null) => { g(); const r = s.rows.find((x) => x.id === id && ["OPENING", "OPEN", "CLOSING"].includes(x.status)); if (!r) return false; r.status = status; r.closedAt = at; if (peakPrice) r.peakPrice = peakPrice; return true; },
    listOpen: async () => { g(); return s.rows.filter((x) => x.status === "OPEN").map((x) => ({ id: x.id, symbol: x.symbol, market: x.market, quantity: x.quantity, entryPrice: x.entryPrice, protectionOrderId: x.protectionOrderId, peakPrice: x.peakPrice })); },
    peak: async (id: number, price: string) => { g(); const r = s.rows.find((x) => x.id === id && x.status === "OPEN"); if (!r) return false; r.peakPrice = price; return true; },
    reprotect: async (id: number, protectionOrderId: string, peakPrice?: string | null) => { g(); const r = s.rows.find((x) => x.id === id && x.status === "OPEN"); if (!r) return false; r.protectionOrderId = protectionOrderId; if (peakPrice) r.peakPrice = peakPrice; return true; },
    history: async (symbol: string, periodStart: Date, periodEnd: Date) => { g(); const rows = s.rows.filter((x) => x.symbol === symbol && closed(x)); const last = rows.reduce<Date | null>((a, x) => (a === null || (x.closedAt as Date) > a ? x.closedAt : a), null);
      return { lastClosedAt: last, closedInPeriod: rows.filter((x) => (x.closedAt as Date) >= periodStart && (x.closedAt as Date) < periodEnd).length }; },
  });
}

/** Tur 84 (G22-a): adım FUTURES taramasını da taşır — plan tutma süresini (`holdMinutes`), bağımlılık futures ayar deposunu (`riskSettings`) geçirir; SPOT taraması ikisini okumaz. */
export type EdgeStep = (p: Parameters<typeof screenEntry>[0] & { holdMinutes?: number | null }, d: ScreenDeps & { riskSettings?: OrderDeps["riskSettings"] }) => Promise<ScreenOutcome | FuturesScreenOutcome>;
/** G13 kapısının varsayılanı. Enjeksiyon YALNIZ kapı/kanarya içindir (S-9); ürün kodunda enjekte eden yol KIRMIZI'dır. */
export const defaultScreen: EdgeStep = (p, d) => screenEntry(p, d);
/** Tur 84 (G22-a/b/d · Tur 83 §12 açığı): FUTURES açılışının varsayılan kenar kapısı — futures M-2 maliyeti + tutma süresince funding, eşik × M-2 futures çarpanı, K-9 brüt (src/lib/edge/futures.ts).
 *  Enjeksiyon yalnız kapı/kanarya içindir (S-9). */
export const defaultFuturesScreen: EdgeStep = (p, d) => futuresEntryEdge(p, d);
export type ReentryStep = (p: { symbol: string }, d: ReentryDeps) => Promise<ReentryOutcome>;
/** G14 (M-7) kapısının varsayılanı. Enjeksiyon YALNIZ kapı/kanarya içindir (S-9); ürün kodunda enjekte eden yol KIRMIZI'dır (gate:trailing `reentry-injected-in-src`). */
export const defaultReentry: ReentryStep = (p, d) => screenReentry(p, d);
export type HealthStep = (d: HealthDeps) => Promise<HealthOutcome>;
/** G17 (M-5) kapısının varsayılanı. Enjeksiyon YALNIZ kapı/kanarya içindir (S-9); ürün kodunda enjekte eden yol KIRMIZI'dır (gate:health `health-injected-in-src`). */
export const defaultHealth: HealthStep = (d) => screenHealth(d);
export type Deps = OrderDeps & { positions?: PositionStore; copy?: PositionCopyStore; control?: ControlDeps; events?: EventDeps; ring?: Keyring; now?: () => number; by?: string; entry?: EntryStep; screen?: EdgeStep; reentry?: ReentryStep; health?: HealthStep; gross?: HealthDeps["gross"]; ratioLimit?: HealthDeps["limit"]; limits?: ReentryDeps["limits"]; ceilings?: ScreenDeps["ceilings"]; exposure?: ScreenDeps["exposure"] };
/** `expectedMoveBp` ve `capital` bu modülde ÜRETİLMEZ: ilki Beyin'in (G15) çıktısı, ikincisi boyutlandırmanın ölçtüğü serbest sermayedir — ikisi de DIŞARIDAN gelir (Ö-1). */
/** Tur 83 (G21 · K-1/K-2): `market` FUTURES ise giriş futures emir yolundan, koruma borsada `STOP_MARKET` (reduceOnly), kapatma reduceOnly piyasa çıkışıyla yapılır; verilmezse SPOT (bugünkü yol AYNI).
 *  Yön yine yalnız uzun: açığa satış girişi emir yolunda reddedilir (short kapalı / icra yazılmadı, G22). */
export type OpenPlan = { source: string; seq: number; symbol: string; exchangeKeyId: number; quantity: string; entryType: "LIMIT" | "MARKET"; entryPrice?: string | null; refPrice?: string | null; stopPrice: string; test?: boolean; expectedMoveBp: string | null; capital: string; market?: "SPOT" | "FUTURES";
  /** Tur 84 (G22-a): beklenen tutma süresi (dakika) — YALNIZ futures kenarı okur (funding terimi); varsayılanı YOKTUR, verilmezse futures girişi yapılmaz (HOLD_UNSPECIFIED). */ holdMinutes?: number | null };
export type OpenRefusal = "REENTRY_REFUSED" | "HEALTH_REFUSED" | "EDGE_REFUSED" | "ENTRY_REFUSED" | "ENTRY_NOT_FILLED" | "POSITION_STORE_UNAVAILABLE" | "PROTECTION_FAILED" | "WINDOW_EXCEEDED" | "PROTECTION_UNRECORDED";
export type Closure = { attempted: boolean; canceled: boolean | null; closed: boolean; status: "CLOSED" | "FAILED_UNPROTECTED_CLOSED" | "NOT_CLOSED"; engineStopped: boolean; detail: string };
export type OpenOutcome =
  | { ok: true; positionId: number; protectionOrderId: string; windowMs: number; entry: OrderOutcome; protection: OrderOutcome }
  | { ok: false; refusal: OpenRefusal; detail: string; positionId: number | null; windowMs: number | null; closure: Closure | null; event: EmitResult | null; entry?: OrderOutcome; protection?: OrderOutcome; screen?: ScreenOutcome | FuturesScreenOutcome; reentry?: ReentryOutcome; health?: HealthOutcome };

const num = (v: unknown): string | null => (typeof v === "string" && NUM.test(v) && new D(v).gt(0) ? v : null);
/** Dolum: gerçekleşen miktar ve AĞIRLIKLI ORTALAMA dolum fiyatı, borsanın yanıtından (tahmin yok). Dolum yoksa null → pozisyon satırı YAZILMAZ. */
export function fillOf(d: OrderResponse): { qty: string; price: string } | null {
  const fills = (d.fills ?? []).filter((f) => num(f.qty) && num(f.price));
  let q = new D(0), c = new D(0);
  for (const f of fills) { q = q.add(f.qty as string); c = c.add(new D(f.qty as string).mul(f.price as string)); }
  if (q.gt(0)) return { qty: q.toFixed(8), price: c.div(q).toFixed(8) };
  const ex = num(d.executedQty); return ex ? { qty: ex, price: num(d.avgPrice) ?? "" } : null; // Tur 83: futures yanıtı ağırlıklı ortalamayı `avgPrice`ta taşır
}
export const exchangeOrderIdOf = (d: OrderResponse): string | null => (d.orderId !== undefined && d.orderId !== null ? String(d.orderId) : d.clientOrderId ? String(d.clientOrderId) : null);
const sentData = (r: OrderOutcome): OrderResponse | null => (r.ok && r.result.executed ? r.result.result.data : null);
const why = (r: OrderOutcome): string => (r.ok ? (r.result.executed ? "?" : String(r.result.reason)) : `${r.refusal}:${r.detail}`);

/** KORUMASIZ POZİSYONU KAPAT (K-2). Sıra ÖNEMLİ: önce borsadaki koruma emri İPTAL edilir (varsa), sonra piyasa çıkışı gönderilir — tersi, ters yönde AÇIK emir bırakır.
 *  İptal edilemezse çıkış GÖNDERİLMEZ (elde duran koruma emri hâlâ satmaya hazırdır) ve motor durur: yanlış yönde iki emir açmaktansa durmak doğrudur (Ö-3). */
export async function closeUnprotected(p: { positionId: number | null; symbol: string; market?: "SPOT" | "FUTURES"; quantity: string; refPrice: string | null; source: string; seq: number; test?: boolean; cancelId: string | null; reasonCode: "PROTECTION_WINDOW_EXCEEDED" | "PROTECTION_FAILED" | "PROTECTION_LOST" | "PROTECTION_UPDATE_FAILED"; detail: string }, deps: Deps): Promise<Closure> {
  const now = deps.now ?? Date.now, store = deps.positions ?? prismaPositionStore();
  const halt = async (reason: string, canceled: boolean | null): Promise<Closure> => {
    await stopEngine("CLOSE_FAILED", `${p.symbol} · pozisyon=${p.positionId ?? "yok"} · ${p.detail} · ${reason}`, { positionId: p.positionId }, deps.events);
    const s = await requestStop({ mode: "HOLD" }, deps.by ?? "koruma-yoneticisi", { ...(deps.control ?? {}), events: deps.events });
    return { attempted: true, canceled, closed: false, status: "NOT_CLOSED", engineStopped: s.ok, detail: `${reason}; motor durduruldu (HOLD), bildirim gerekir (K-8)` };
  };
  let canceled: boolean | null = null;
  if (p.cancelId !== null) {
    const c = await cancelOrder({ symbol: p.symbol, orderId: p.cancelId, market: p.market }, deps);
    // -2011 "Unknown order sent": emir zaten borsada yok — iptal edilecek bir şey kalmamış demektir, ters yönde açık emir riski de yok
    canceled = c.ok || (!c.ok && c.refusal === "EXCHANGE_DENIED" && /:-2011/.test(c.detail));
    if (!canceled) return halt(`koruma emri (${p.cancelId}) İPTAL EDİLEMEDİ: ${c.ok ? "?" : c.detail}; çıkış gönderilmedi (ters yönde açık emir bırakılmaz)`, false);
  }
  const exit = await placeOrder({ source: p.source, symbol: p.symbol, market: p.market ?? "SPOT", side: "SELL", cls: "EXIT", type: "MARKET", quantity: p.quantity, refPrice: p.refPrice, seq: p.seq, test: p.test }, deps);
  if (sentData(exit) === null) return halt(`piyasa çıkışı gönderilemedi: ${why(exit)}`, canceled);
  const status = "FAILED_UNPROTECTED_CLOSED" as const;
  const marked = p.positionId === null ? false : await store.close(p.positionId, status, new Date(now())).catch(() => false);
  await stopEngine(p.reasonCode, `${p.symbol} · pozisyon=${p.positionId ?? "yok"} · ${p.detail} · koruma iptali=${canceled === null ? "gerekmedi" : canceled} · piyasa çıkışı gönderildi · satır=${marked ? status : "İŞARETLENEMEDİ"}`, { positionId: p.positionId }, deps.events);
  return { attempted: true, canceled, closed: true, status, engineStopped: false, detail: `korumasız pozisyon kapatıldı (${p.reasonCode}); satır ${marked ? status : "işaretlenemedi"}` };
}

/** POZİSYON AÇ — koruma emri borsa kimliği dönmeden TAMAMLANMAZ (K-2). Hiçbir dal fırlatmaz; her dal ya OPEN+kimlik, ya kapatma, ya da durdurma ile biter. */
export async function openProtectedPosition(p: OpenPlan, deps: Deps = {}): Promise<OpenOutcome> {
  const now = deps.now ?? Date.now, store = deps.positions ?? prismaPositionStore();
  const no = async (refusal: OpenRefusal, detail: string, o: Record<string, unknown> = {}): Promise<OpenOutcome> =>
    ({ ok: false, refusal, detail, positionId: null, windowMs: null, closure: null, event: null, ...o }) as OpenOutcome;
  // YENİDEN GİRİŞ (G14, M-7) — İLK KAPI, ağa çıkmadan: soğuma + dönem başına tur tavanı pozisyon geçmişinden ölçülür; ret bir atlamadır (POSITION_SKIPPED), sayılamama durmadır (Ö-2).
  const reentry = await (deps.reentry ?? defaultReentry)({ symbol: p.symbol }, { positions: deps.positions, limits: deps.limits, events: deps.events, now });
  if (!reentry.ok) return no("REENTRY_REFUSED", `yeniden giriş kapısı geçilmedi: ${reentry.refusal} · ${reentry.detail}`, { reentry });
  // SAĞLIK (G17, M-5) — yeniden giriş kapısından SONRA, taramadan ve giriş emrinden ÖNCE: komisyon/brüt kâr oranı türetilmiş eşiği aşmışsa strateji duraklatılmıştır, yeni pozisyon açılmaz; sağlık bilinmiyorsa da açılmaz (Ö-2).
  // Çıkış ve koruma bu kapıya UĞRAMAZ (M-1, K-1): `closeUnprotected` ve `auditProtection` bu adımı çağırmaz (kapı zorlar). Eşik sayısı burada yoktur (src/lib/health türetir).
  const health = await (deps.health ?? defaultHealth)({ ledger: deps.ledger?.store, gross: deps.gross, limit: deps.ratioLimit, events: deps.events, now });
  if (!health.ok) return no("HEALTH_REFUSED", `sağlık kapısı geçilmedi: ${health.refusal} · ${health.verdict.sentence}`, { health });
  // ASGARİ KENAR + PORTFÖY TAVANI (G13, M-2/K-9) — GİRİŞ EMRİNDEN ÖNCE. Kapıyı geçmeyen sinyal emir KURMAZ; sebebi olayla yazılır (M-4).
  // Çıkış ve koruma bu kapıya UĞRAMAZ: `closeUnprotected` ve `auditProtection` bu adımı çağırmaz (M-1; kapı zorlar).
  const priceRef = num(p.entryPrice) ?? num(p.refPrice);
  const notional = priceRef === null ? "0" : new D(p.quantity).mul(priceRef).toFixed(8);
  // TUR 84 (G22-a · Tur 83 §12): FUTURES açılışı SPOT kenar kapısından (SPOT komisyon kademesi, SPOT defteri) DEĞİL, futures kenarından geçer — maliyete tutma süresince funding girer,
  //   eşik M-2 futures çarpanıyla (kullanıcı ayarı) kurulur, K-9 brüt. SPOT açılışı AYNI adımı aynı girdilerle çağırır (davranış değişmedi).
  const market = p.market ?? "SPOT";
  const screenStep = market === "FUTURES" ? (deps.screen ?? defaultFuturesScreen) : (deps.screen ?? defaultScreen);
  const screen = await screenStep({ symbol: p.symbol, side: "BUY", notional, expectedMoveBp: p.expectedMoveBp, capital: p.capital, holdMinutes: p.holdMinutes },
    { exchange: deps.exchange, events: deps.events, ring: deps.ring, key: deps.key, ceilings: deps.ceilings, exposure: deps.exposure, riskSettings: deps.riskSettings, now });
  if (!screen.ok) return no("EDGE_REFUSED", `asgari kenar/tavan kapısı geçilmedi: ${screen.refusal} · ${screen.detail}`, { screen });
  const entry = await (deps.entry ?? defaultEntry)({ source: p.source, symbol: p.symbol, market, side: "BUY", cls: "ENTRY", type: p.entryType, quantity: p.quantity, price: p.entryPrice, refPrice: p.refPrice, seq: p.seq, test: p.test }, deps);
  const eData = sentData(entry);
  if (eData === null) return no("ENTRY_REFUSED", `giriş emri gönderilmedi/icra edilmedi: ${why(entry)}`, { entry });
  const fill = fillOf(eData), filledAt = now();
  if (fill === null) return no("ENTRY_NOT_FILLED", `giriş emri dolmadı (durum=${eData.status ?? "?"}); pozisyon satırı yazılmadı`, { entry });
  const entryPrice = num(fill.price) ?? num(p.entryPrice) ?? num(p.refPrice);
  if (entryPrice === null) return no("ENTRY_NOT_FILLED", "dolum fiyatı ölçülemedi (fills yok, plan fiyatı yok); pozisyon satırı yazılmadı", { entry });
  let positionId: number;
  try { positionId = (await store.open({ exchangeKeyId: p.exchangeKeyId, symbol: p.symbol, market, side: "LONG", entryPrice, quantity: fill.qty, openedAt: new Date(filledAt) })).id; }
  catch (e) {
    const detail = `pozisyon satırı yazılamadı (${(e as { name?: string })?.name ?? "error"}); giriş DOLDU, kapatılıyor`;
    const closure = await closeUnprotected({ positionId: null, symbol: p.symbol, market, quantity: fill.qty, refPrice: entryPrice, source: p.source, seq: p.seq + 1, test: p.test, cancelId: null, reasonCode: "PROTECTION_FAILED", detail }, deps);
    return no("POSITION_STORE_UNAVAILABLE", detail, { entry, closure });
  }
  // KORUMA: HEMEN ARDINDAN, aynı yoldan (kimlik → izin → kilit → bütçe → boğaz → kayıt); sınıf PROTECTION → PARA bütçesine takılmaz (M-1)
  const prot = await placeOrder({ source: p.source, symbol: p.symbol, market, side: "SELL", cls: "PROTECTION", type: market === "FUTURES" ? FUTURES_PROTECTION_TYPE : PROTECTION_TYPE, quantity: fill.qty, stopPrice: p.stopPrice, refPrice: entryPrice, seq: p.seq, test: p.test, positionId }, deps);
  const windowMs = now() - filledAt, pData = sentData(prot), protectionOrderId = pData === null ? null : exchangeOrderIdOf(pData);
  if (protectionOrderId === null) {
    const detail = `koruma emri YERLEŞMEDİ (borsa emir kimliği yok): ${why(prot)}; pencere=${windowMs} ms`;
    const closure = await closeUnprotected({ positionId, symbol: p.symbol, market, quantity: fill.qty, refPrice: entryPrice, source: p.source, seq: p.seq + 1, test: p.test, cancelId: null, reasonCode: "PROTECTION_FAILED", detail }, deps);
    return no("PROTECTION_FAILED", detail, { entry, protection: prot, positionId, windowMs, closure });
  }
  if (windowMs > PROTECTION_WINDOW_MS) {
    const detail = `koruma penceresi ${windowMs} ms > PROTECTION_WINDOW_MS ${PROTECTION_WINDOW_MS} ms; pozisyon korumasız kaldı`;
    const closure = await closeUnprotected({ positionId, symbol: p.symbol, market, quantity: fill.qty, refPrice: entryPrice, source: p.source, seq: p.seq + 1, test: p.test, cancelId: protectionOrderId, reasonCode: "PROTECTION_WINDOW_EXCEEDED", detail }, deps);
    return no("WINDOW_EXCEEDED", detail, { entry, protection: prot, positionId, windowMs, closure });
  }
  const attached = await store.protect(positionId, protectionOrderId).catch(() => false);
  if (!attached) {
    const detail = `koruma kimliği (${protectionOrderId}) satıra yazılamadı; satır OPEN yapılamadı, pozisyon kapatılıyor (K-2)`;
    const closure = await closeUnprotected({ positionId, symbol: p.symbol, market, quantity: fill.qty, refPrice: entryPrice, source: p.source, seq: p.seq + 1, test: p.test, cancelId: protectionOrderId, reasonCode: "PROTECTION_FAILED", detail }, deps);
    return no("PROTECTION_UNRECORDED", detail, { entry, protection: prot, positionId, windowMs, closure });
  }
  return { ok: true, positionId, protectionOrderId, windowMs, entry, protection: prot };
}

// ---- KORUMA DENETLEYİCİSİ (madde 5 · K-1, K-3, M-1) ----
// Açık her pozisyon için borsadaki koruma emrinin HÂLÂ ORADA olduğu düzenli doğrulanır. Denetim sınıfı PROTECTION'dır → PARA bütçesine takılmaz (M-1).
// KARAR — emir kaybolmuşsa POZİSYON KAPATILIR, koruma YENİDEN YERLEŞTİRİLMEZ. Gerekçe: (a) K-2 "koruma yerleştirilemezse pozisyon kapatılır, 'sonra deneriz' yoktur" der;
//   yeniden yerleştirme tam olarak "sonra deneriz"dir. (b) Emir üç sebeple kaybolur — DOLDU (pozisyon zaten çıkmıştır), İPTAL EDİLDİ (bunu biz yapmadık: hesabın durumu
//   hakkındaki varsayımımız yanlış demektir) ya da borsa emri düşürdü. Son ikisinde hesabın gerçek durumu BİLİNMİYOR; bilinmeyenin üstüne yeni emir koymak maruziyeti
//   ARTIRABİLİR, kapatmak ise sıfıra indirir — belirsizlikte küçülen yön seçilir. (c) DOLMUŞ emir istisnadır: kapatma emri GÖNDERİLMEZ, satır CLOSED yapılır (gerçek okunur,
//   varsayılmaz). Sorgu DÜŞERSE koruma DOĞRULANAMAMIŞTIR → korumasız sayılır: motor durur (kapalı arıza, Ö-2 — "ölçemedim" sessizce yeşil olamaz).
export type ProtectionState = "PROTECTED" | "FILLED" | "LOST" | "UNVERIFIABLE" | "NO_ID";
export type AuditRow = { positionId: number; symbol: string; protectionOrderId: string | null; state: ProtectionState; status: string | null; action: "NONE" | "CLOSED" | "ENGINE_STOPPED"; closure: Closure | null; detail: string };
export type AuditReport = { checked: number; rows: AuditRow[]; ok: boolean; detail?: string };
/** Borsanın "emir hâlâ duruyor" saydığı durumlar. Diğer her durum (CANCELED/EXPIRED/REJECTED/…) ve emrin bulunamaması KAYIP sayılır (kapalı yönde). */
export const RESTING_STATUSES = ["NEW", "PARTIALLY_FILLED", "PENDING_NEW"] as const;

/** `given` (Tur 23): tik açık listeyi KOPYADAN verir — bu yol Neon'u OKUMAZ; verilmezse (kanarya/kapı) depodan okunur. Kopya yalnız hangi pozisyonun hangi emir kimliğine sahip olduğunu söyler; koruma borsada doğrulanır (K-1). */
export async function auditProtection(deps: Deps & { source?: string } = {}, given?: OpenPosition[]): Promise<AuditReport> {
  const store = deps.positions ?? prismaPositionStore(), source = deps.source ?? "koruma-denetleyicisi", now = deps.now ?? Date.now;
  let open: OpenPosition[];
  try { open = given ?? await store.listOpen(); } catch (e) { return { checked: 0, rows: [], ok: false, detail: `açık pozisyonlar okunamadı: ${(e as { name?: string })?.name ?? "error"}` }; }
  const rows: AuditRow[] = [];
  for (const [i, pos] of open.entries()) {
    const seq = 900_000 + i;
    if (pos.protectionOrderId === null) { // DB CHECK bunu zaten engeller; yine de kapalı yönde davran (Ö-2)
      const closure = await closeUnprotected({ positionId: pos.id, symbol: pos.symbol, market: pos.market, quantity: pos.quantity, refPrice: pos.entryPrice, source, seq, cancelId: null, reasonCode: "PROTECTION_LOST", detail: "OPEN satırda koruma kimliği yok" }, deps);
      rows.push({ positionId: pos.id, symbol: pos.symbol, protectionOrderId: null, state: "NO_ID", status: null, action: closure.closed ? "CLOSED" : "ENGINE_STOPPED", closure, detail: closure.detail }); continue;
    }
    const q = await readOrder({ symbol: pos.symbol, orderId: pos.protectionOrderId, market: pos.market }, deps);
    const status = q.ok ? String(q.data.status ?? "?") : null;
    const gone = !q.ok && q.refusal === "EXCHANGE_DENIED" && /:-2013/.test(q.detail); // -2013 "Order does not exist"
    if (q.ok && (RESTING_STATUSES as readonly string[]).includes(status as string)) { rows.push({ positionId: pos.id, symbol: pos.symbol, protectionOrderId: pos.protectionOrderId, state: "PROTECTED", status, action: "NONE", closure: null, detail: `koruma emri borsada duruyor (${status})` }); continue; }
    if (q.ok && status === "FILLED") { // stop TETİKLENDİ: pozisyon zaten çıktı — kapatma emri GÖNDERİLMEZ, satır gerçeğe göre kapatılır
      const marked = await store.close(pos.id, "CLOSED", new Date(now()), pos.peakPrice).catch(() => false);
      // TB-8 (Üretim S16-2 = A): FUTURES korumasının tetik dolumu kullanıcı akışından GELMEZ (SPOT dolumu akıştan mutabakat görür) ⇒ rezervasyon AÇIKKEN gerçek emrin işlemleri
      //   (userTrades) okunur ve sarmalayıcının mutabakat işleviyle gerçek komisyon yazılır; okunamazsa rezervasyon açık kalır (Ö-2). Bu dal emir GÖNDERMEZ.
      const fd = q.data as OrderResponse & { actualOrderId?: string | number }, kim = fd.clientOrderId ?? null, gercek = fd.actualOrderId ?? null;
      if (pos.market === "FUTURES" && kim && gercek !== null && gercek !== "" && await reservationOpen(kim, deps.ledger)) {
        const t = await readOrderFills(pos.symbol, gercek, deps); if (t.ok) await reconcileTriggered({ ref: kim, fees: t.fills.map((f) => ({ asset: f.commissionAsset, amount: f.commission })) }, deps.ledger); }
      rows.push({ positionId: pos.id, symbol: pos.symbol, protectionOrderId: pos.protectionOrderId, state: "FILLED", status, action: "CLOSED", closure: null, detail: `koruma emri DOLDU (stop tetiklendi); satır ${marked ? "CLOSED" : "işaretlenemedi"}` }); continue;
    }
    if (!q.ok && !gone) { // sorgu düştü: koruma DOĞRULANAMADI → korumasız sayılır, motor durur (kapalı arıza)
      await stopEngine("PROTECTION_UNVERIFIABLE", `${pos.symbol} · pozisyon=${pos.id} · koruma emri ${pos.protectionOrderId} sorgulanamadı: ${q.detail}`, { positionId: pos.id }, deps.events);
      const s = await requestStop({ mode: "HOLD" }, deps.by ?? source, { ...(deps.control ?? {}), events: deps.events });
      rows.push({ positionId: pos.id, symbol: pos.symbol, protectionOrderId: pos.protectionOrderId, state: "UNVERIFIABLE", status: null, action: "ENGINE_STOPPED", closure: null, detail: `sorgu düştü (${q.detail}); motor ${s.ok ? "durduruldu" : "DURDURULAMADI"}` }); continue;
    }
    const detail = `koruma emri KAYBOLDU (durum=${status ?? "bulunamadı(-2013)"}); pozisyon kapatılıyor, koruma yeniden yerleştirilmez`;
    const closure = await closeUnprotected({ positionId: pos.id, symbol: pos.symbol, market: pos.market, quantity: pos.quantity, refPrice: pos.entryPrice, source, seq, cancelId: gone ? null : pos.protectionOrderId, reasonCode: "PROTECTION_LOST", detail }, deps);
    rows.push({ positionId: pos.id, symbol: pos.symbol, protectionOrderId: pos.protectionOrderId, state: "LOST", status, action: closure.closed ? "CLOSED" : "ENGINE_STOPPED", closure, detail: closure.detail });
  }
  return { checked: open.length, rows, ok: rows.every((r) => r.state === "PROTECTED" || r.state === "FILLED") };
}
