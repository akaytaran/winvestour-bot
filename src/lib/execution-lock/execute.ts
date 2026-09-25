// İCRA SARMALAYICISI (G10 · K-6, K-7, K-8, S-7, S-9). Emir gönderecek HER yol buradan geçer (kapı: scripts/gate-execution-lock.mjs — atlayan yol KIRMIZI).
// Sıra (kapı kaynaktan ölçer): kimlik (saf, I/O yok) → çalışma izni (G08, K-7: run:false ise icra yok) → KİLİT (alınamazsa icra yok: HELD normal sonuç, LOCK_UNAVAILABLE olay) →
// kayıt deposunda aynı kimlik var mı (ALREADY_EXECUTED, gönderim yok) → sahiplik denetimi (fencing: bayat sahip göndermez) → BOĞAZ + olay (G05/G07, requestWithEvents;
// newClientOrderId = kimlik) → KAYIT (orders; tekil kısıt üçüncü kademe) → kirayı bırak (jetonla). Gönderim sonrası kayıt düşerse yanıt ATILMAZ: sonuç `recorded` alanında,
// olay RECORD_FAILED_AFTER_SEND yanıt gövdesiyle (Tur 8 madde 4). Bu modül fırlatmaz; jeton hiçbir yanıta/olaya girmez (S-2).
// UPSTASH DÜŞÜKSE İCRA YOK (madde 4 kararı): G05 boğazı zaten çağrı çıkarmaz, G08 okuyucusu zaten run:false der; kimlik katmanı bu durumda "tek başına yeter" olsa da iki kapı
// açık kalmaz (Ö-3: kapıyı geçmek için kural gevşetilmez). Kimlik katmanının bağımsızlığı Upstash kesintisi için değil, kilit süresi/zincir devri penceresi (A-4) için gerekir.
// Bu turda gerçek emir yolu YOKTUR (G11): sarmalayıcı verilen boğaz çağrısını taşır; emir ucu/gövde eşlemesi G11'de yazılır ve yine buradan geçer.
// G09 (Tur 11, M-1): PARA BÜTÇESİ kapısı kilit ve kimlikten SONRA, gönderimden ÖNCE (reserveFee: sınıf plandan; EXIT/PROTECTION bakmaz — ayrım FEE_GATE_BY_CLASS'ta, burada değil).
// Rezervasyon her çıkmayan yolda SERBEST bırakılır (releaseFee); gönderim sonrası dolum yanıtındaki GERÇEK komisyonla MUTABAKAT (settleOrRelease). Defter gönderimden sonra düşerse yanıt ATILMAZ.
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/db/client";
import type { BinanceCall, BinanceResult } from "@/lib/binance";
import { readRunPermit, type Deps as ControlDeps, type Permit } from "@/lib/engine-control";
import { stopEngine, type Deps as EventDeps, type EmitResult } from "@/lib/events";
import { requestWithEvents, type ExchangeDeps, type GuardedResult } from "@/lib/events/exchange";
import { releaseFee, reserveFee, settleOrRelease, type Deps as LedgerDeps, type FeeRefusal, type FillReport, type ReleaseOutcome, type ReserveOutcome, type SettleOrReleaseOutcome } from "@/lib/fee-ledger";
import { EXECUTION_LEASE_MS, acquire, deriveClientOrderId, holds, release, type Holder, type LockStore, type SignalKey } from "./index";

export type OrderRow = { exchangeOrderId: string; symbol: string; market: "SPOT" | "FUTURES"; type: "MARKET" | "LIMIT" | "STOP_LOSS" | "TAKE_PROFIT" | "STOP_LOSS_LIMIT" | "TAKE_PROFIT_LIMIT" | "STOP_MARKET" | "TAKE_PROFIT_MARKET"; side: "BUY" | "SELL"; quantity: string; price: string | null; status: string; placedAt: Date; rawResponse: unknown; positionId?: number | null };
/** Kayıt deposu: üretimde Prisma; kapı/kanarya sahte ya da shadow depo enjekte eder (S-9). */
export interface OrderStore { findByClientOrderId(id: string): Promise<{ id: number } | null>; create(row: OrderRow & { clientOrderId: string }): Promise<{ id: number }> }
/** notional: emrin quote cinsinden büyüklüğü (G09 ön rezervasyon tahmini için; G11 verir). toFill: dolum yanıtından durum + ödenen komisyonlar (commission/commissionAsset) — G09 mutabakatı. */
/** GÖNDERİM YÜZEYİ (Tur 14 düzeltmesi, ÖLÇÜME dayanır). `dispatch` verilirse boğaz çağrısı ONUN İÇİNDEN yapılır ve İMZA İLE ZAMAN DAMGASI ORADA, GÖNDERİMDEN HEMEN ÖNCE üretilir.
 *  NEDEN: damga eskiden emir kurulurken (izin/kilit/kayıt/bütçe adımlarından ÖNCE) basılıyor ve o adımlar boyunca YAŞLANIYORDU; adımlar `recvWindow`'u yerse borsa emri
 *  `-1021` ile reddediyordu — ölçüldü (Tur 14 madde 12: `placeOrder` 11 957 / 12 254 ms, recvWindow 5 000 ms; aynı yol BELLEK depolarıyla 200 aldı).
 *  SIRA DEĞİŞMEDİ: kimlik → izin → kilit → kayıt denetimi → bütçe → sahiplik → **imza+gönderim** → kayıt → mutabakat. Yalnız imzanın basıldığı an sona kaydı.
 *  Anahtar geri çağrının İÇİNDE kalır (G03 sızıntı koruyucusu imzalı başlığın dışarı çıkmasını engeller); sarmalayıcı kimliği (`newClientOrderId`) çağrıya yine kendisi yazar. */
export type DispatchOutcome<T> = ({ ok: true } & GuardedResult<T>) | { ok: false; refusal: "CLOCK_UNSYNCED" | "STAMP_STALE"; detail: string; event: EmitResult | null };
export type Dispatch<T> = (call: Omit<BinanceCall, "cls"> & { cls: "ENTRY" | "EXIT" | "PROTECTION" }) => Promise<DispatchOutcome<T>>;
/** `records` (Tur 14 düzeltmesi, ÖLÇÜLDÜ): bu çağrı borsada GERÇEK bir emir oluşturur mu? `order/test` OLUŞTURMAZ — sonucu `orders`'a YAZILMAZ.
 *  NEDEN: `orders` borsada VAR OLAN emirlerin defteridir. Olmayan bir emri yazmak (a) defteri yalancı yapar (`exchange_order_id` uydurma bir "TEST:…" olur),
 *  (b) belirlenimci `client_order_id`'yi İŞGAL eder ve K-6'nın ÜÇÜNCÜ kademesi (tekil kısıt + kayıt denetimi) GERÇEK emri engeller — ölçüldü: prova sonrası
 *  gerçek emir `ALREADY_EXECUTED` döndü ve hiç gönderilmedi. SEÇENEK B ("TEST satırı tekilliği işgal etmesin") ELENDİ: kısmi tekil kısıt ya da kimliksiz satır
 *  demekti, ikisi de K-6'nın üçüncü kademesini ZAYIFLATIR. Kaydı hiç yazmamak kuralı gevşetmez, YANLIŞ KAYDI kaldırır (Ö-3). Varsayılan: kaydedilir. */
export type ExecutionPlan<T> = { signal: SignalKey; call: Omit<BinanceCall, "cls"> & { cls: "ENTRY" | "EXIT" | "PROTECTION" }; notional: string; toRow: (data: T) => OrderRow; toFill: (data: T) => FillReport; dispatch?: Dispatch<T>; records?: boolean };
export type Deps = { lock?: LockStore; orders?: OrderStore; exchange?: ExchangeDeps; control?: ControlDeps; events?: EventDeps; ledger?: LedgerDeps; now?: () => number; owner?: string; leaseMs?: number };
/** `skipped`: çağrı emir OLUŞTURMADI (order/test), bu yüzden defter satırı YAZILMADI — bir hata değil, kaydedilecek bir emrin olmaması. */
export type Recorded = { ok: true; id: number } | { ok: true; id: null; skipped: "NOT_AN_ORDER" } | { ok: false; code: "DUPLICATE" | "STORE_UNAVAILABLE"; event: EmitResult };
export type Refusal = "NOT_PERMITTED" | "HELD" | "LOCK_UNAVAILABLE" | "RECORD_UNAVAILABLE" | "ALREADY_EXECUTED" | "STALE_OWNER" | "EXCHANGE_DENIED" | "CLOCK_UNSYNCED" | "STAMP_STALE" | FeeRefusal;
export type FeeTrail = { reservation: ReserveOutcome; released?: ReleaseOutcome | null; settlement?: SettleOrReleaseOutcome; ledgerEvent?: EmitResult | null };
export type ExecuteOutcome<T> =
  | { executed: true; clientOrderId: string; owner: string; result: Extract<BinanceResult<T>, { ok: true }>; exchangeEvent: EmitResult | null; recorded: Recorded; released: boolean; fee: FeeTrail }
  | { executed: false; clientOrderId: string; owner: string; reason: Refusal; sent: boolean; permit?: Permit; holder?: Holder | null; existingOrderId?: number; result?: BinanceResult<T>; event?: EmitResult | null; released?: boolean; fee?: FeeTrail };

export const prismaOrderStore = (client?: PrismaClient): OrderStore => { const db = () => client ?? getDb(); return {
  findByClientOrderId: async (id) => db().order.findUnique({ where: { clientOrderId: id }, select: { id: true } }),
  create: async (r) => ({ id: (await db().order.create({ data: { exchangeOrderId: r.exchangeOrderId, clientOrderId: r.clientOrderId, symbol: r.symbol, market: r.market, type: r.type, side: r.side, quantity: r.quantity, price: r.price, status: r.status, placedAt: r.placedAt, rawResponse: r.rawResponse === null || r.rawResponse === undefined ? Prisma.DbNull : (r.rawResponse as Prisma.InputJsonValue), positionId: r.positionId ?? null }, select: { id: true } })).id }),
}; };
const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002" || (e as { code?: string })?.code === "23505";

/** Tek icra yolu. Kilit → kimlik → boğaz → gönderim → kayıt. Çıkmayan icra `executed:false, sent:false` + sebep döner; hiçbir dal fırlatmaz. */
export async function executeSignal<T = unknown>(plan: ExecutionPlan<T>, deps: Deps = {}): Promise<ExecuteOutcome<T>> {
  const clientOrderId = deriveClientOrderId(plan.signal), owner = deps.owner ?? "kas", lock = deps.lock, orders = deps.orders ?? prismaOrderStore(), now = deps.now ?? Date.now;
  const permit = await readRunPermit(deps.control); if (!permit.run) return { executed: false, clientOrderId, owner, reason: "NOT_PERMITTED", sent: false, permit };
  const got = await acquire(clientOrderId, owner, lock, deps.leaseMs ?? EXECUTION_LEASE_MS, now);
  if (!got.ok) {
    if (got.reason === "HELD") return { executed: false, clientOrderId, owner, reason: "HELD", sent: false, holder: got.holder };
    const event = await stopEngine("LOCK_UNAVAILABLE", `${plan.call.cls} ${plan.signal.symbol} · kimlik ${clientOrderId} · ${got.error}`, {}, deps.events);
    return { executed: false, clientOrderId, owner, reason: "LOCK_UNAVAILABLE", sent: false, event };
  }
  const lease = got.lease;
  let existing: { id: number } | null | "unavailable"; try { existing = await orders.findByClientOrderId(clientOrderId); } catch { existing = "unavailable"; }
  if (existing === "unavailable") { const event = await stopEngine("RECORD_UNAVAILABLE", `${plan.call.cls} ${plan.signal.symbol} · kimlik ${clientOrderId} · kayıt deposu okunamadı, gönderim yok`, {}, deps.events); const rel = await release(lease, lock); return { executed: false, clientOrderId, owner, reason: "RECORD_UNAVAILABLE", sent: false, event, released: rel.ok }; }
  if (existing) { const rel = await release(lease, lock); return { executed: false, clientOrderId, owner, reason: "ALREADY_EXECUTED", sent: false, existingOrderId: existing.id, released: rel.ok }; }
  // BÜTÇE (G09, M-1): kilit ve kimlikten sonra, gönderimden önce. Sınıf PLANDAN gelir; bakan sınıf reddedilir (olay), bakmayan (EXIT/PROTECTION) her koşulda geçer.
  const fee = await reserveFee({ ref: clientOrderId, cls: plan.call.cls, notional: plan.notional }, deps.ledger);
  if (!fee.ok) { const rel = await release(lease, lock); return { executed: false, clientOrderId, owner, reason: fee.reason, sent: false, event: fee.event, released: rel.ok, fee: { reservation: fee } }; }
  const h = await holds(lease, lock); // fencing: gönderimden hemen önce sahiplik; bayat sahip göndermez
  if (!h.held) { const fr = await releaseFee({ ref: clientOrderId }, deps.ledger); const rel = await release(lease, lock); return { executed: false, clientOrderId, owner, reason: "STALE_OWNER", sent: false, released: rel.ok, fee: { reservation: fee, released: fr } }; }
  // İMZA + GÖNDERİM: kimlik sarmalayıcıdan gelir; imza `dispatch` içinde, TAM BU ANDA basılır (yukarıdaki açıklama). Damga üretilemez ya da yaşlanmışsa emir ÇIKMAZ:
  // kilit ve rezervasyon bırakılır, olayı `dispatch` yazar (K-8) — sessiz geçilmez.
  const call = { ...plan.call, query: { ...(plan.call.query ?? {}), newClientOrderId: clientOrderId } };
  const disp: DispatchOutcome<T> = plan.dispatch ? await plan.dispatch(call) : { ok: true, ...(await requestWithEvents<T>(call, deps.exchange)) };
  if (!disp.ok) { const fr = await releaseFee({ ref: clientOrderId }, deps.ledger); const rel = await release(lease, lock); return { executed: false, clientOrderId, owner, reason: disp.refusal, sent: false, event: disp.event, released: rel.ok, fee: { reservation: fee, released: fr } }; }
  const { result, event: exchangeEvent } = disp;
  // çıkmadı ya da borsa kesin reddetti (statü var) → rezervasyon serbest; gönderildi ama yanıt yok (taşıyıcı düştü, statü yok) → emir borsada olabilir, rezervasyon TUTULUR (mutabakat G16)
  if (!result.ok) { const fr = !result.sent || result.status !== undefined ? await releaseFee({ ref: clientOrderId }, deps.ledger) : null; const rel = await release(lease, lock); return { executed: false, clientOrderId, owner, reason: "EXCHANGE_DENIED", sent: result.sent, result, event: exchangeEvent, released: rel.ok, fee: { reservation: fee, released: fr } }; }
  let recorded: Recorded;
  // EMİR OLUŞTURMAYAN ÇAĞRI DEFTERE YAZILMAZ (Tur 14): `order/test` borsada emir yaratmaz; satır yazmak kimliği işgal edip GERÇEK emri K-6'dan engellerdi.
  if (plan.records === false) recorded = { ok: true, id: null, skipped: "NOT_AN_ORDER" };
  else try { recorded = { ok: true, id: (await orders.create({ ...plan.toRow(result.data), clientOrderId })).id }; }
  catch (e) { const code = isUnique(e) ? "DUPLICATE" : "STORE_UNAVAILABLE"; const event = await stopEngine("RECORD_FAILED_AFTER_SEND", `${plan.call.cls} ${plan.signal.symbol} · kimlik ${clientOrderId} · kayıt ${code}; yanıt olayda korundu`, { exchangeResponse: { status: result.status, data: result.data } }, deps.events); recorded = { ok: false, code, event }; }
  // MUTABAKAT (G09): gerçek komisyon dolum yanıtından; dolumsuz iptal/ret → serbest; açık emir → beklemede (G16 WS). Defter düşerse yanıt ATILMAZ (Tur 8 madde 4): olay yanıtı taşır.
  const settlement = await settleOrRelease({ ref: clientOrderId, fill: plan.toFill(result.data) }, deps.ledger);
  const ledgerEvent = !settlement.ok && settlement.reason === "FEE_LEDGER_UNAVAILABLE" ? await stopEngine("RECORD_FAILED_AFTER_SEND", `${plan.call.cls} ${plan.signal.symbol} · kimlik ${clientOrderId} · defter mutabakatı düştü (${settlement.detail}); yanıt olayda korundu`, { exchangeResponse: { status: result.status, data: result.data } }, deps.events) : null;
  const rel = await release(lease, lock);
  return { executed: true, clientOrderId, owner, result, exchangeEvent, recorded, released: rel.ok, fee: { reservation: fee, settlement, ledgerEvent } };
}
