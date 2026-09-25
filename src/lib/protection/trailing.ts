// TEPE TAKİBİ + KÂR GERİ VERME ÇIKIŞI + YENİDEN GİRİŞ TAVANI (G14 · K-10, K-1, K-2, K-8, M-1, M-4, M-7, A-1, Ö-1, Ö-3). Kapı: scripts/gate-trailing.mjs.
// K-10 — OLAY TETİKLİ: bu modülün tek girişi bir FİYAT OLAYIDIR (`onPriceEvent`); zamanlayıcı YOKTUR (kapı: setTimeout/setInterval/cron KIRMIZI). Fiyat değişmezse hiçbir şey olmaz.
//   TEPE (positions.peak_price) yalnız YÜKSELDİĞİNDE yazılır, asla düşmez. KÂR GERİ VERME seviyesi tepeden türer: seviye = tepe − (tepe − giriş) × giveBackRatio.
//   Bu, borsanın yerleşik trailing'i (TRAILING_DELTA — FİYAT referanslı) ile İFADE EDİLEMEZ: bizimki KÂR referanslıdır (K-10; kapı `trailingDelta` simgesini KIRMIZI sayar).
// K-1 — KORUMA BORSADA DURUR: seviye yükselince borsadaki STOP_LOSS TAŞINIR. STOP_LOSS değiştirilemez → ÖNCE İPTAL, SONRA yeni emir (ters sıra ters yönde iki açık emir bırakır; kapı zorlar).
//   Güncelleme bir emir çiftidir; yalnız seviye ANLAMLI EŞİK kadar ilerlediğinde yapılır — eşik ölçülen gidiş-dönüş maliyetinden türer (costBp × stepMultiple), koda bp yazılmaz.
//   İptal edilemezse yeni koruma GÖNDERİLMEZ (eski yerinde, pozisyon korumalı); iptal edildi ama yeni koruma yerleşmezse pozisyon KORUMASIZDIR → derhal kapatılır (K-2, closeUnprotected).
// ÇIKIŞ — fiyat seviyeye DEĞDİĞİNDE (≤, tam eşik) pozisyon kapatılır: önce koruma emrinin durumu okunur (borsa stop'u zaten tetiklemişse satır CLOSED, emir yok — gerçek okunur),
//   sonra İPTAL, sonra MARKET SELL (sınıf EXIT → PARA bütçesine takılmaz M-1, asgari kenar/soğuma kapılarına uğramaz). Satış gönderilemezse K-2 kapatma yolu; o da düşerse motor durur.
// M-7 — YENİDEN GİRİŞ (yalnız GİRİŞ yolu): soğuma dolmuş VE dönem başına tur sayısı tavanın altında VE koşul yeniden doğrulanmış (G13 taraması çıkıştan sonra yeniden koşar,
//   bu kapı onun ÖNÜNDEDİR). Tur sayısı `positions`'tan ÖLÇÜLÜR (sembolün kapanmış satırları; dönem = UTC takvim ayı, G09'un PERIOD_BASIS'i); ayrı sayaç tutulmaz.
//   M-1 ile ilişkisi: ikisi de yalnız GİRİŞİ keser; bütçe portföy genelinde ve gönderim anında (executeSignal), tur tavanı çift başına ve emir kurulmadan önce — hangisi ÖNCE dolduysa o durdurur.
// EMİR KURMAZ VE GÖNDERMEZ: her emir G11 yüzeyinden (placeOrder / cancelOrder / readOrder) ve G10 sarmalayıcısından geçer; `positions`'a yalnız G12 deposu (PositionStore) yazar.
// TUR 23 (K-10 gecikmez, A-9): tepe `store.peak` ile yazılır — tikte bu depo `withPositionCopy`'dir: tepe KOPYAYA gider, Neon'a OLAY TETİKLİ (koruma taşıma `reprotect`, kapanış `close`, tazeleme) —
//   her tikte Neon'a tepe yazan yol KIRMIZI (kapı). Çıkış kararı (`judgeExit`) aynı; tepe tikler arasında kopyadan okunur (ucuz mod) ya da bellekte taşınır (hızlı mod) — eşik aynı noktada tetiklenir (kanarya).
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/db/client";
import { stopEngine, type Deps as EventDeps, type EmitResult } from "@/lib/events";
import { periodOf } from "@/lib/fee-ledger";
import { cancelOrder, placeOrder, readOrder, type OrderOutcome, type OrderResponse } from "@/lib/orders";
import { PROTECTION_TYPE, PROTECTION_WINDOW_MS, closeUnprotected, exchangeOrderIdOf, prismaPositionStore, type Closure, type Deps, type OpenPosition, type PositionStore } from "./index";

/** AÇIK — A-1, UYDURULDU (sicil, geri alınabilir). SAYI DEĞİL ORAN: eşikler ölçülen değerlerle çarpılarak türer, koda bp yazılmaz.
 *  · giveBackRatio 0.5 — tepeden kazanılmış kârın YARISI geri verilince çıkılır. Gerekçe M-2: eşiği tam tutturan (3 × maliyet) bir hareketin tepesinden bu kuralla çıkışta elde kalan
 *    kâr 1,5 × maliyet > maliyet; oran 2/3 olsaydı kalan tam maliyet kadar (başabaş) olurdu. Daha küçük oran gürültüde çıkar ve her çıkış bir tur maliyetidir (M-7).
 *  · stepMultiple 1 — koruma seviyesi, ölçülen gidiş-dönüş maliyetin (bp) en az BİR katı kadar yükselmedikçe stop TAŞINMAZ (K-10 "anlamlı eşik"). Her taşıma bir emir çiftidir:
 *    ORDERS sayacından 2 birim yer ve aradaki pencere kadar pozisyon korumasız kalır; kilitlenen kâr bir maliyet birimi artmadan bu bedel ödenmez. */
export const TRAILING = { giveBackRatio: "0.5", stepMultiple: "1" } as const;
/** AÇIK — A-1 (M-7), UYDURULDU (sicil, geri alınabilir). risk_profile.cooldown_seconds / max_round_trips_per_period DOLUYSA iş sahibi kararıdır ve bunları EZER.
 *  · cooldownMs 3 600 000 (1 saat) — çıkıştan sonra aynı sembole yeniden giriş için asgari bekleme: boğazın tavan önbelleği (CEILING_TTL_SEC = 3600 s) dolup kural/piyasa
 *    okumaları TAZELENDİKTEN sonra karar verilsin. Aynı sinyalin ikinci icrası zaten K-6 kimliğiyle engellidir; soğuma "aynı bantta bir daha" davranışını kırar (M-7).
 *  · roundTripCeiling 4 — sembol başına, dönem (UTC ay) başına tur tavanı. Gerekçe M-1: bütçe sermayenin %2'si; bir tur ≈ 20 bp × pozisyon payı (%50) = 10 bp ⇒ 4 tur = 40 bp,
 *    yani tek bir çiftin döngüsü aylık bütçenin en çok BEŞTE BİRİNİ yiyebilir; kalanı diğer çiftlere ve çıkışlara kalır. */
export const REENTRY = { cooldownMs: 3_600_000, roundTripCeiling: 4 } as const;

const D = Prisma.Decimal, NUM = /^\d+(\.\d+)?$/;
const dec = (s: unknown): Prisma.Decimal | null => (typeof s === "string" && NUM.test(s) ? new D(s) : null);
/** `costBp`: o pozisyon için GİRİŞTE ÖLÇÜLEN gidiş-dönüş maliyet (G13 taramasının çıktısı) — burada ÜRETİLMEZ, dışarıdan gelir (Ö-1). Yoksa stop taşınmaz. */
export type TrailingState = { positionId: number; symbol: string; quantity: string; entryPrice: string; peakPrice: string; protectionOrderId: string; stopPrice: string; costBp: string | null };

// ---- SAF yargılar (ağ yok, depo yok) ----
/** Tepe yalnız YÜKSELİR; düşüş tepeyi değiştirmez. Okunamayan fiyat tepeyi değiştirmez. */
export function nextPeak(peak: string, price: string): { peak: string; raised: boolean } {
  const p = dec(peak), x = dec(price);
  if (x === null || !x.gt(0)) return { peak, raised: false };
  return p === null || x.gt(p) ? { peak: x.toFixed(8), raised: true } : { peak: p.toFixed(8), raised: false };
}
/** Kâr geri verme seviyesi. Tepe girişin üstünde değilse KÂR YOKTUR → seviye yok (koruma girişin altındaki ilk stop'ta kalır). */
export function giveBackLevel(entry: string, peak: string): string | null {
  const e = dec(entry), p = dec(peak);
  return e === null || p === null || !p.gt(e) ? null : p.sub(p.sub(e).mul(TRAILING.giveBackRatio)).toFixed(8);
}
export type ExitVerdict = { exit: boolean; level: string | null; detail: string };
/** Çıkış TAM EŞİKTE tetiklenir: fiyat ≤ seviye. Bir tık üstünde tetiklenmez. */
export function judgeExit(i: { entry: string; peak: string; price: string }): ExitVerdict {
  const level = giveBackLevel(i.entry, i.peak), x = dec(i.price);
  if (level === null || x === null) return { exit: false, level, detail: level === null ? "kâr yok (tepe ≤ giriş); geri verilecek kâr yok" : `fiyat okunamadı (${i.price})` };
  const hit = x.lte(level);
  return { exit: hit, level, detail: `seviye = tepe ${i.peak} − (tepe − giriş ${i.entry}) × ${TRAILING.giveBackRatio} = ${level} ↔ fiyat ${x.toFixed(8)} ⇒ ${hit ? "ÇIKIŞ" : "tutuluyor"}` };
}
export type MoveVerdict = { move: boolean; newStop: string | null; stepBp: string | null; minStepBp: string | null; detail: string };
/** Stop yalnız seviye ölçülen maliyet × stepMultiple kadar (bp) YÜKSELMİŞSE taşınır; maliyet ölçülmemişse taşınmaz (kapalı yönde: eldeki koruma yerinde, K-1 sağlanır). */
export function judgeStopMove(i: { entry: string; peak: string; currentStop: string; costBp: string | null }): MoveVerdict {
  const level = giveBackLevel(i.entry, i.peak), cur = dec(i.currentStop), cost = dec(i.costBp);
  if (level === null || cur === null || !cur.gt(0)) return { move: false, newStop: null, stepBp: null, minStepBp: null, detail: "kâr yok ya da mevcut stop okunamadı; koruma yerinde" };
  if (cost === null) return { move: false, newStop: level, stepBp: null, minStepBp: null, detail: "gidiş-dönüş maliyeti ölçülmemiş (costBp yok): anlamlı eşik türetilemez, koruma yerinde (Ö-3)" };
  const step = new D(level).sub(cur).div(cur).mul(10_000), min = cost.mul(TRAILING.stepMultiple), move = new D(level).gt(cur) && step.gte(min);
  return { move, newStop: level, stepBp: step.toFixed(6), minStepBp: min.toFixed(6), detail: `adım = (${level} − stop ${cur.toFixed(8)}) ÷ stop = ${step.toFixed(4)} bp ↔ eşik = maliyet ${cost.toFixed(4)} bp × ${TRAILING.stepMultiple} = ${min.toFixed(4)} bp ⇒ ${move ? "TAŞI" : "yerinde"}` };
}
export type ReentryRefusal = "REENTRY_COOLDOWN" | "ROUND_TRIP_CEILING" | "REENTRY_UNMEASURABLE";
export type ReentryVerdict = { ok: true; workings: string[] } | { ok: false; refusal: ReentryRefusal; detail: string; workings: string[] };
export type ReentryInput = { now: number; lastClosedAt: number | null; closedInPeriod: number; cooldownMs: number; ceiling: number; source: string };
/** Soğuma + dönem başına tur tavanı. Sayılar dışarıdan (risk_profile ya da REENTRY varsayılanı) ve KAYNAĞIYLA gelir (Ö-1). Sayılamayan → karar yok (Ö-2). */
export function judgeReentry(i: ReentryInput): ReentryVerdict {
  const workings = [`soğuma = ${i.cooldownMs} ms · tur tavanı = ${i.ceiling}/dönem (${i.source})`, `dönem içinde kapanan tur = ${i.closedInPeriod} · son çıkış = ${i.lastClosedAt === null ? "yok" : new Date(i.lastClosedAt).toISOString()}`];
  if (!Number.isFinite(i.cooldownMs) || !Number.isInteger(i.ceiling) || i.ceiling < 1 || !Number.isInteger(i.closedInPeriod) || i.closedInPeriod < 0) return { ok: false, refusal: "REENTRY_UNMEASURABLE", detail: `sınırlar/sayım okunamadı (soğuma=${i.cooldownMs} tavan=${i.ceiling} tur=${i.closedInPeriod})`, workings };
  if (i.closedInPeriod >= i.ceiling) return { ok: false, refusal: "ROUND_TRIP_CEILING", detail: `dönem başına tur tavanı dolu: ${i.closedInPeriod} ≥ ${i.ceiling} (M-7)`, workings };
  if (i.lastClosedAt !== null && i.now - i.lastClosedAt < i.cooldownMs) return { ok: false, refusal: "REENTRY_COOLDOWN", detail: `soğuma dolmadı: çıkıştan bu yana ${i.now - i.lastClosedAt} ms < ${i.cooldownMs} ms (M-7)`, workings };
  return { ok: true, workings };
}

// ---- çalışma anı: sınırlar ve yeniden giriş taraması ----
export type ReentryLimits = { cooldownMs: number; ceiling: number; source: string };
export type LimitSource = () => Promise<ReentryLimits>;
/** risk_profile DOLUYSA iş sahibi kararı kullanılır; NULL ise REENTRY varsayılanı (UYDURULDU, A-1). Hangisi kullanıldığı kaynağa yazılır (Ö-1). */
export const prismaLimitSource = (client?: PrismaClient): LimitSource => async () => {
  const r = await (client ?? getDb()).riskProfile.findUnique({ where: { id: 1 }, select: { cooldownSeconds: true, maxRoundTripsPerPeriod: true } });
  const cd = r?.cooldownSeconds ?? null, ce = r?.maxRoundTripsPerPeriod ?? null;
  return { cooldownMs: cd === null ? REENTRY.cooldownMs : cd * 1000, ceiling: ce === null ? REENTRY.roundTripCeiling : ce,
    source: `soğuma=${cd === null ? "REENTRY.cooldownMs (UYDURULDU)" : "risk_profile.cooldown_seconds (iş sahibi)"} · tavan=${ce === null ? "REENTRY.roundTripCeiling (UYDURULDU)" : "risk_profile.max_round_trips_per_period (iş sahibi)"}` };
};
export type ReentryDeps = { positions?: PositionStore; limits?: LimitSource; events?: EventDeps; now?: () => number };
export type ReentryOutcome = ReentryVerdict & { event: EmitResult | null };
/** GİRİŞ YOLUNUN İLK KAPISI (M-7). Geçmiş `positions`'tan ÖLÇÜLÜR; her ret sebebiyle olaya yazılır (M-4/K-8). Fırlatmaz. Çıkış ve koruma bunu ÇAĞIRMAZ (kapı zorlar). */
export async function screenReentry(p: { symbol: string }, deps: ReentryDeps = {}): Promise<ReentryOutcome> {
  const now = deps.now ?? Date.now, t = now(), period = periodOf(t), store = deps.positions ?? prismaPositionStore();
  let v: ReentryVerdict;
  try {
    const h = await store.history(p.symbol, period.start, period.end), L = await (deps.limits ?? prismaLimitSource())();
    v = judgeReentry({ now: t, lastClosedAt: h.lastClosedAt?.getTime() ?? null, closedInPeriod: h.closedInPeriod, cooldownMs: L.cooldownMs, ceiling: L.ceiling, source: L.source });
  } catch (e) { v = { ok: false, refusal: "REENTRY_UNMEASURABLE", detail: `pozisyon geçmişi/sınırlar okunamadı (${(e as { name?: string })?.name ?? "error"}); tur sayılamadan giriş yok (Ö-2)`, workings: [] }; }
  if (v.ok) return { ...v, event: null };
  return { ...v, event: await stopEngine(v.refusal, `${p.symbol} · ${v.detail} · ${v.workings.join(" · ")}`, {}, deps.events) };
}

// ---- olay tetikli yol ----
export type TrailAction = "NONE" | "PEAK" | "STOP_MOVED" | "EXITED" | "ALREADY_EXITED" | "UPDATE_REFUSED" | "CLOSED_UNPROTECTED" | "ENGINE_STOPPED";
export type PriceEvent = { price: string; seq: number; source: string };
export type TrailOutcome = { state: TrailingState; action: TrailAction; peakRaised: boolean; peakStored: boolean | null; exit: ExitVerdict; move: MoveVerdict | null; windowMs: number | null; detail: string; cancel: boolean | null; sent: OrderOutcome | null; closure: Closure | null };
const sentData = (r: OrderOutcome): OrderResponse | null => (r.ok && r.result.executed ? r.result.result.data : null);
const why = (r: OrderOutcome): string => (r.ok ? (r.result.executed ? "?" : String(r.result.reason)) : `${r.refusal}:${r.detail}`);
const gone = (c: Awaited<ReturnType<typeof cancelOrder>>): boolean => !c.ok && c.refusal === "EXCHANGE_DENIED" && /:-2011/.test(c.detail); // -2011 "Unknown order sent": borsada yok

/** Başlangıç durumu: tepe satırdan (yoksa giriş fiyatı), MEVCUT STOP BORSADAN okunur (Ö-1: varsayılmaz). Okunamazsa durum yok → bu pozisyon için olay tetikli yol başlamaz, koruma yerinde kalır. */
export async function readTrailingState(pos: OpenPosition, costBp: string | null, deps: Deps = {}): Promise<{ ok: true; state: TrailingState } | { ok: false; detail: string }> {
  if (pos.protectionOrderId === null) return { ok: false, detail: "koruma kimliği yok" };
  const q = await readOrder({ symbol: pos.symbol, orderId: pos.protectionOrderId }, deps), stop = q.ok ? dec((q.data as { stopPrice?: string }).stopPrice) : null;
  if (stop === null) return { ok: false, detail: `mevcut stop borsadan okunamadı: ${q.ok ? "stopPrice yok" : q.detail}` };
  return { ok: true, state: { positionId: pos.id, symbol: pos.symbol, quantity: pos.quantity, entryPrice: pos.entryPrice, peakPrice: pos.peakPrice ?? pos.entryPrice, protectionOrderId: pos.protectionOrderId, stopPrice: stop.toFixed(8), costBp } };
}

/** FİYAT OLAYI (K-10): tepe → çıkış kararı → (çıkış yoksa) koruma taşıma kararı. Zamanlayıcı yok; aynı fiyat ikinci kez gelirse hiçbir emir çıkmaz. Hiçbir dal fırlatmaz. */
export async function onPriceEvent(s: TrailingState, ev: PriceEvent, deps: Deps = {}): Promise<TrailOutcome> {
  const store = deps.positions ?? prismaPositionStore(), { peak, raised } = nextPeak(s.peakPrice, ev.price);
  const peakStored = raised ? await store.peak(s.positionId, peak).catch(() => false) : null; // yalnız YÜKSELDİĞİNDE yazılır
  const state = { ...s, peakPrice: peak }, exit = judgeExit({ entry: s.entryPrice, peak, price: ev.price });
  const b: TrailOutcome = { state, action: raised ? "PEAK" : "NONE", peakRaised: raised, peakStored, exit, move: null, windowMs: null, detail: exit.detail, cancel: null, sent: null, closure: null };
  if (exit.exit) return exitAtGiveBack(b, ev, deps);
  const move = judgeStopMove({ entry: s.entryPrice, peak, currentStop: s.stopPrice, costBp: s.costBp }); b.move = move; b.detail = move.detail;
  return move.move && move.newStop !== null ? moveProtection(b, move.newStop, ev, deps) : b;
}
/** KÂR GERİ VERME ÇIKIŞI. Sıra: koruma emrinin durumu (dolmuşsa emir YOK) → İPTAL → MARKET SELL (EXIT). İptal edilemezse çıkış gönderilmez (koruma yerinde, pozisyon korumalı). */
async function exitAtGiveBack(b: TrailOutcome, ev: PriceEvent, deps: Deps): Promise<TrailOutcome> {
  const now = deps.now ?? Date.now, store = deps.positions ?? prismaPositionStore(), s = b.state;
  const q = await readOrder({ symbol: s.symbol, orderId: s.protectionOrderId }, deps);
  if (q.ok && String(q.data.status) === "FILLED") { const marked = await store.close(s.positionId, "CLOSED", new Date(now()), s.peakPrice).catch(() => false); return { ...b, action: "ALREADY_EXITED", detail: `koruma emri borsada DOLMUŞ (stop tetiklenmiş); çıkış emri gönderilmedi, satır ${marked ? "CLOSED" : "işaretlenemedi"}` }; }
  const c = await cancelOrder({ symbol: s.symbol, orderId: s.protectionOrderId }, deps);
  if (!c.ok && !gone(c)) return { ...b, action: "UPDATE_REFUSED", cancel: false, detail: `çıkış için koruma iptali başarısız (${c.detail}); çıkış GÖNDERİLMEDİ, koruma yerinde` };
  const sell = await placeOrder({ source: ev.source, symbol: s.symbol, market: "SPOT", side: "SELL", cls: "EXIT", type: "MARKET", quantity: s.quantity, refPrice: ev.price, seq: ev.seq, positionId: s.positionId }, deps);
  if (sentData(sell) === null) { // koruma iptal edildi, satış çıkmadı: pozisyon KORUMASIZ → K-2 kapatma yolu (iptal gerekmez); o da düşerse motor durur
    const closure = await closeUnprotected({ positionId: s.positionId, symbol: s.symbol, quantity: s.quantity, refPrice: ev.price, source: ev.source, seq: ev.seq + 1, cancelId: null, reasonCode: "PROTECTION_UPDATE_FAILED", detail: `kâr geri verme çıkışı gönderilemedi (${why(sell)}); koruma iptal edilmişti` }, deps);
    return { ...b, action: closure.closed ? "CLOSED_UNPROTECTED" : "ENGINE_STOPPED", cancel: true, sent: sell, closure, detail: closure.detail };
  }
  const marked = await store.close(s.positionId, "CLOSED", new Date(now()), s.peakPrice).catch(() => false); // kapanış Neon'a DERHAL; son tepe aynı yazımda (K-10 olay tetikli)
  return { ...b, action: "EXITED", cancel: true, sent: sell, detail: `${b.exit.detail}; koruma iptal edildi, piyasa çıkışı gönderildi, satır ${marked ? "CLOSED" : "işaretlenemedi"}` };
}
/** KORUMAYI TAŞI (K-10/K-1): ÖNCE İPTAL, SONRA yeni STOP_LOSS. Pencere ölçülür (PROTECTION_WINDOW_MS); yeni koruma yerleşmez / pencere aşılır / kimlik yazılamazsa pozisyon kapatılır (K-2). */
async function moveProtection(b: TrailOutcome, newStop: string, ev: PriceEvent, deps: Deps): Promise<TrailOutcome> {
  const now = deps.now ?? Date.now, store = deps.positions ?? prismaPositionStore(), s = b.state;
  const c = await cancelOrder({ symbol: s.symbol, orderId: s.protectionOrderId }, deps), t0 = now();
  if (!c.ok && !gone(c)) return { ...b, action: "UPDATE_REFUSED", cancel: false, detail: `koruma iptal edilemedi (${c.detail}); yeni koruma GÖNDERİLMEDİ, eski koruma yerinde (iki koruma emri açık bırakılmaz)` };
  const closeAs = async (cancelId: string | null, reasonCode: "PROTECTION_UPDATE_FAILED" | "PROTECTION_WINDOW_EXCEEDED" | "PROTECTION_LOST", detail: string, sent: OrderOutcome | null): Promise<TrailOutcome> => {
    const closure = await closeUnprotected({ positionId: s.positionId, symbol: s.symbol, quantity: s.quantity, refPrice: ev.price, source: ev.source, seq: ev.seq + 1, cancelId, reasonCode, detail }, deps);
    return { ...b, action: closure.closed ? "CLOSED_UNPROTECTED" : "ENGINE_STOPPED", cancel: true, sent, closure, windowMs: now() - t0, detail: closure.detail };
  };
  // -2011: koruma borsada YOK — ya dolmuş ya iptal edilmiş; hesabın durumu bilinmiyor → yeniden yerleştirilmez, kapatılır (K-3 kararı)
  if (!c.ok) return closeAs(null, "PROTECTION_LOST", "koruma taşınırken emir borsada bulunamadı (-2011); yeniden yerleştirilmez", null);
  const prot = await placeOrder({ source: ev.source, symbol: s.symbol, market: "SPOT", side: "SELL", cls: "PROTECTION", type: PROTECTION_TYPE, quantity: s.quantity, stopPrice: newStop, refPrice: ev.price, seq: ev.seq, positionId: s.positionId }, deps);
  const windowMs = now() - t0, data = sentData(prot), id = data === null ? null : exchangeOrderIdOf(data);
  if (id === null) return closeAs(null, "PROTECTION_UPDATE_FAILED", `taşınan koruma YERLEŞMEDİ (${why(prot)}); eski koruma iptal edilmişti, pozisyon korumasız`, prot);
  if (windowMs > PROTECTION_WINDOW_MS) return closeAs(id, "PROTECTION_WINDOW_EXCEEDED", `koruma taşıma penceresi ${windowMs} ms > ${PROTECTION_WINDOW_MS} ms`, prot);
  const attached = await store.reprotect(s.positionId, id, s.peakPrice).catch(() => false); // taşıma: yeni kimlik + tepe Neon'a aynı yazımda (olay tetikli)
  if (!attached) return closeAs(id, "PROTECTION_UPDATE_FAILED", `yeni koruma kimliği (${id}) satıra yazılamadı`, prot);
  const stopPrice = prot.ok ? (prot.adjusted.stopPrice ?? newStop) : newStop; // borsanın kabul ettiği (tick'e aşağı yuvarlanmış) tetik
  return { ...b, action: "STOP_MOVED", state: { ...s, peakPrice: b.state.peakPrice, protectionOrderId: id, stopPrice }, cancel: true, sent: prot, windowMs, detail: `${b.move?.detail ?? ""}; ${s.protectionOrderId} iptal → ${id} @${stopPrice}, pencere ${windowMs} ms` };
}
