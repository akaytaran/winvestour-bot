// KOMİSYON DEFTERİ + PARA BÜTÇESİ (G09 · M-1, M-3, M-4, P-2, K-1, K-2, K-8, S-2, S-9, Ö-1, Ö-2). Deftere (fee_ledger / fee_entries) yazan TEK yüzey (kapı: scripts/gate-fee-budget.mjs).
// PARA bütçesi ≠ AĞIRLIK bütçesi: G05 boğazı Binance'in IP başına çağrı AĞIRLIĞINI sayar (S-7, dakikalık pencere, birim weight, pay CLASS_SHARE); bu defter dönem başına ÖDENEN
// KOMİSYONU sayar (M-1, aylık pencere, birim quote_asset, kural FEE_GATE_BY_CLASS). İkisi de sınıf bazlıdır ama ayrı sicildir; biri diğerini okumaz.
// İLKELER: (1) Gerçek maliyet yalnız BORSADAN gelir (dolum yanıtındaki commission/commissionAsset); tahmin yalnız ÖN REZERVASYON içindir, gerçek gelince DEĞİŞTİRİLİR (DB CHECK: SETTLED ⇒ actual).
// (2) Bütçe iki kez harcanamaz: rezervasyon tek koşullu UPDATE ile atomik (fees_paid + funding_paid + reserved + tahmin ≤ budget; satır kilidi eşzamanlı halkaları sıraya koyar; ref tekil).
// (3) EXIT/PROTECTION bütçeye BAKMAZ (M-1, K-1, K-2) — ayrım TEK yerde: FEE_GATE_BY_CLASS. Defter/sermaye/kur düşükse de çıkış geçer (rezervasyonsuz; olay yazılır, K-8).
// (4) Farklı varlıkta ödenen komisyon (ör. BNB) quote'a ÖLÇÜLEN kurla çevrilir (./exchange.ts ticker/price); kur alınamazsa kayıt UNCONVERTED kalır → giriş kapalı, çıkış geçer.
// (5) funding ayrı kalemdir (M-3; futures ileride). ALINAN funding (Tur 39, Karar 2) AYRI alandadır (`funding_received`): yalnız KÂR; bütçe/sağlık/kenar onu OKUMAZ, maliyeti DÜŞÜRMEZ. (6) Bu modül fırlatmaz; depo hatası yapılandırılmış sonuçtur; console YOKTUR (S-2). Emir yolu YOKTUR (sarmalayıcı çağırır).
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/db/client";
import type { CallClass } from "@/lib/binance/budget";
import { stopEngine, type Deps as EventDeps, type EmitResult } from "@/lib/events";
import { readCapital, readRate } from "./exchange";

/** İŞ SAHİBİ KARARI (Tur 10 promptu madde 9, ANAYASA M-1/A-1) — UYDURMA DEĞİL: dönem başına harcanabilecek toplam işlem maliyeti = sermayenin %2'si. */
export const FEE_BUDGET_PCT = 2;
/** SERMAYE TABANI (Tur 11 kararı, sicil): dönem AÇILIŞINDA borsadan ölçülen hesap değeri — tüm bakiyeler (free+locked) ticker/price ile quote'a değerlenir. Anlık/ortalama DEĞİL:
 *  M-1 "önceden belirlenir" der; bütçe dönem içinde SABİT kalır — yükselen piyasa bütçeyi şişiremez, düşen piyasa girişi zaten kısar, çıkışı hiç etkilemez (kanarya: dalgalanma). */
export const CAPITAL_BASIS = "PERIOD_START_EQUITY" as const;
/** DÖNEM TABANI (Tur 11 kararı, sicil): UTC takvim ayı [ayın 1'i 00:00Z, sonraki ayın 1'i). Kayan 30 gün DEĞİL: dönem yalnız saatten türetilir (iki halka koordinasyonsuz aynı dönemi bulur),
 *  fee_ledger(period_start, period_end) tekil kısıtı doğal anahtar olur, M-7 "dönem başına tur" ve P-2 raporu aylık okunur. İlk (kısmi) ay orantılanmaz — AÇIK, sicil, geri alınabilir. */
export const PERIOD_BASIS = "UTC_CALENDAR_MONTH" as const;
/** Defterin tek para birimi (sicil, geri alınabilir; A-2 coin evreni açık, spot çiftlerin quote'u). */
export const QUOTE_ASSET = "USDT";
/** Aynı varlık → çevrim yok. Bu bir kur SABİTİ değildir (kapı: başka her sayısal kur KIRMIZI). */
export const IDENTITY_RATE = "1";
/** SINIF → PARA BÜTÇESİNE BAKAR MI (M-1, K-1, K-2). TEK YER. EXIT/PROTECTION: ASLA. G05 CLASS_SHARE ile KARIŞTIRILMAZ (o ağırlık payı, bu bakar/bakmaz). */
export const FEE_GATE_BY_CLASS: Record<CallClass, boolean> = { ENTRY: true, DISCOVERY: true, EXIT: false, PROTECTION: false };
/** Binance emir durumları (belge; ölçülmedi, S-9): dolum YOK ve bir daha olmayacak → rezervasyon serbest. Diğer dolumsuz durumlar (NEW, PARTIALLY_FILLED) beklemede kalır (G16 WS). */
export const NO_FILL_TERMINAL = ["CANCELED", "REJECTED", "EXPIRED", "EXPIRED_IN_MATCH"] as const;

const D = Prisma.Decimal; type Dec = InstanceType<typeof D>;
export type FeePaid = { asset: string; amount: string };
export type PaidTrace = { asset: string; amount: string; rate: string | null; source: string };
export type FillReport = { status: string; fees: FeePaid[] };
export type EntryState = "RESERVED" | "SETTLED" | "RELEASED" | "UNCONVERTED";
export type EntryCls = CallClass | "FUNDING" | "UNRESERVED";
export type LedgerRow = { id: number; periodStart: Date; periodEnd: Date; budget: string; feesPaid: string; fundingPaid: string; fundingReceived: string; reserved: string; capital: string | null; takerRate: string | null; quoteAsset: string };
export type EntryRow = { id: number; ledgerId: number; ref: string; kind: "FEE" | "FUNDING"; cls: EntryCls; state: EntryState; estimated: string; actual: string | null; paid: unknown };
export type NewLedger = Omit<LedgerRow, "id" | "feesPaid" | "fundingPaid" | "fundingReceived" | "reserved"> & { openedFrom: string };
export type ReserveStatus = "RESERVED" | "EXISTS" | "EXHAUSTED";
/** `freeQuote`: quote varlığının SERBEST (free) bakiyesi — G12 boyutlandırması bunu kullanır (kilitli bakiye emir açamaz). Aynı `/api/v3/account` okumasından gelir,
 *  ek çağrı yoktur; okunamayan/eski çağıranlar için opsiyoneldir ve yokluğunda boyutlandırma kapalı arızalanır (sayı varsayılmaz, Ö-3). */
export type CapitalReading = { ok: true; capital: string; quoteAsset: string; takerRate: string | null; freeQuote?: string | null; source: string } | { ok: false; detail: string };
export type RateReading = { ok: true; rate: string; source: string } | { ok: false; detail: string };
export type CapitalSource = (quote: string) => Promise<CapitalReading>;
export type RateSource = (asset: string, quote: string) => Promise<RateReading>;
/** Depo: üretimde Prisma (ham SQL, işlem içinde); kapı/kanarya bellek ya da shadow depo enjekte eder (S-9). Yöntemler fırlatabilir → çağıran yapılandırılmış sonuca çevirir. */
export interface LedgerStore {
  findPeriod(start: Date, end: Date): Promise<LedgerRow | null>; openPeriod(row: NewLedger): Promise<LedgerRow>; findEntry(ref: string): Promise<EntryRow | null>;
  reserve(ledgerId: number, e: { ref: string; cls: EntryCls; estimated: string }, gated: boolean): Promise<ReserveStatus>;
  settle(ref: string, actual: string, paid: PaidTrace[], at: Date, fallbackLedgerId: number | null): Promise<{ ledgerId: number; estimated: string; first: boolean } | null>;
  free(ref: string): Promise<{ estimated: string } | null>; markUnconverted(ref: string, paid: PaidTrace[]): Promise<boolean>; countUnconverted(ledgerId: number): Promise<number>;
  addFunding(ledgerId: number, ref: string, amount: string, at: Date): Promise<"ADDED" | "DUPLICATE">;
  /** Tur 39 (G22-h, Karar 2): ALINAN funding — aynı tekil `ref` kümesi (ödenen ile ORTAK), yalnız `funding_received` artar; ödenen toplam ve bütçe DEĞİŞMEZ. */
  addFundingReceived(ledgerId: number, ref: string, amount: string, at: Date): Promise<"ADDED" | "DUPLICATE">;
  /** G17 (Tur 24, M-5): sağlık duraklaması durumu (`fee_ledger.health_paused_at`) — okuyan/yazan tek yüzey bu depodur; eşik burada yoktur (src/lib/health türetir). */
  healthPause(ledgerId: number): Promise<Date | null>; setHealthPause(ledgerId: number, at: Date | null): Promise<boolean>;
}
export type Deps = { store?: LedgerStore; capital?: CapitalSource; rate?: RateSource; events?: EventDeps; now?: () => number };

const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002" || (e as { code?: string })?.code === "23505";
const errName = (e: unknown) => (e as { name?: string })?.name ?? "error", NUM = /^\d+(\.\d+)?$/, str = (v: unknown) => (v === null || v === undefined ? null : String(v));
type LRow = { id: number; periodStart: Date; periodEnd: Date; budget: unknown; feesPaid: unknown; fundingPaid: unknown; fundingReceived: unknown; reserved: unknown; capital: unknown; takerRate: unknown; quoteAsset: string };
const rowOf = (r: LRow): LedgerRow => ({ id: r.id, periodStart: r.periodStart, periodEnd: r.periodEnd, budget: String(r.budget), feesPaid: String(r.feesPaid), fundingPaid: String(r.fundingPaid), fundingReceived: String(r.fundingReceived), reserved: String(r.reserved), capital: str(r.capital), takerRate: str(r.takerRate), quoteAsset: r.quoteAsset });
type Cur = { state: EntryState; estimated: string; ledger_id: number };
export const prismaLedgerStore = (client?: PrismaClient): LedgerStore => { const db = () => client ?? getDb(); return {
  findPeriod: async (s, e) => { const r = await db().feeLedger.findUnique({ where: { periodStart_periodEnd: { periodStart: s, periodEnd: e } } }); return r && rowOf(r); },
  openPeriod: async (n) => { try { return rowOf(await db().feeLedger.create({ data: { periodStart: n.periodStart, periodEnd: n.periodEnd, budget: n.budget, capital: n.capital, takerRate: n.takerRate, quoteAsset: n.quoteAsset, openedFrom: n.openedFrom } })); } catch (e) { if (!isUnique(e)) throw e; return rowOf(await db().feeLedger.findUniqueOrThrow({ where: { periodStart_periodEnd: { periodStart: n.periodStart, periodEnd: n.periodEnd } } })); } },
  findEntry: async (ref) => { const r = await db().feeEntry.findUnique({ where: { ref } }); return r && { id: r.id, ledgerId: r.ledgerId, ref: r.ref, kind: r.kind as EntryRow["kind"], cls: r.cls as EntryCls, state: r.state as EntryState, estimated: String(r.estimated), actual: str(r.actual), paid: r.paid }; },
  reserve: (ledgerId, e, gated) => db().$transaction(async (tx) => {
    const cur = await tx.feeEntry.findUnique({ where: { ref: e.ref }, select: { state: true } }); if (cur && cur.state !== "RELEASED") return "EXISTS" as const;
    // ATOMİK BÜTÇE KAPISI: tek koşullu UPDATE (satır kilidi eşzamanlı rezervasyonları sıraya koyar). gated değilse KOŞULSUZ — EXIT/PROTECTION bütçeye bakmaz (M-1).
    const n = gated ? await tx.$executeRaw`UPDATE fee_ledger SET reserved = reserved + ${e.estimated}::numeric WHERE id = ${ledgerId} AND fees_paid + funding_paid + reserved + ${e.estimated}::numeric <= budget AND NOT EXISTS (SELECT 1 FROM fee_entries WHERE ledger_id = ${ledgerId} AND state = 'UNCONVERTED')`
      : await tx.$executeRaw`UPDATE fee_ledger SET reserved = reserved + ${e.estimated}::numeric WHERE id = ${ledgerId}`;
    if (n !== 1) return "EXHAUSTED" as const;
    if (cur) await tx.feeEntry.update({ where: { ref: e.ref }, data: { ledgerId, cls: e.cls, state: "RESERVED", estimated: e.estimated, actual: null, paid: Prisma.DbNull, settledAt: null } });
    else await tx.feeEntry.create({ data: { ledgerId, ref: e.ref, kind: "FEE", cls: e.cls, state: "RESERVED", estimated: e.estimated } });
    return "RESERVED" as const;
  }).catch((e: unknown) => { if (isUnique(e)) return "EXISTS" as const; throw e; }),
  settle: (ref, actual, paid, at, fallback) => db().$transaction(async (tx) => {
    const cur = (await tx.$queryRaw<Cur[]>`SELECT state, estimated::text AS estimated, ledger_id FROM fee_entries WHERE ref = ${ref} FOR UPDATE`)[0];
    if (!cur && fallback === null) return null;
    const lid = cur?.ledger_id ?? (fallback as number), open = cur?.state === "RESERVED" || cur?.state === "UNCONVERTED", est = open ? cur!.estimated : "0", p = JSON.stringify(paid);
    if (!cur) await tx.$executeRaw`INSERT INTO fee_entries (ledger_id, ref, kind, cls, state, estimated, actual, paid, settled_at) VALUES (${lid}, ${ref}, 'FEE', 'UNRESERVED', 'SETTLED', 0, ${actual}::numeric, ${p}::jsonb, ${at})`;
    else await tx.$executeRaw`UPDATE fee_entries SET state = 'SETTLED', estimated = CASE WHEN state = 'RELEASED' THEN 0 ELSE estimated END, actual = COALESCE(actual, 0) + ${actual}::numeric, paid = COALESCE(paid, '[]'::jsonb) || ${p}::jsonb, settled_at = ${at} WHERE ref = ${ref}`;
    await tx.$executeRaw`UPDATE fee_ledger SET reserved = reserved - ${est}::numeric, fees_paid = fees_paid + ${actual}::numeric WHERE id = ${lid}`;
    return { ledgerId: lid, estimated: est, first: open || !cur };
  }),
  free: (ref) => db().$transaction(async (tx) => {
    const r = await tx.$queryRaw<{ ledger_id: number; estimated: string }[]>`UPDATE fee_entries SET state = 'RELEASED' WHERE ref = ${ref} AND state = 'RESERVED' RETURNING ledger_id, estimated::text AS estimated`;
    if (r.length !== 1) return null; await tx.$executeRaw`UPDATE fee_ledger SET reserved = reserved - ${r[0].estimated}::numeric WHERE id = ${r[0].ledger_id}`; return { estimated: r[0].estimated };
  }),
  markUnconverted: async (ref, paid) => (await db().feeEntry.updateMany({ where: { ref, state: "RESERVED" }, data: { state: "UNCONVERTED", paid: paid as unknown as Prisma.InputJsonValue } })).count === 1,
  countUnconverted: (ledgerId) => db().feeEntry.count({ where: { ledgerId, state: "UNCONVERTED" } }),
  // Tur 38 madde 4c: AYNI funding anahtarı İKİ KEZ yazılamaz — tekil `ref` (fee_entries_ref_key) üstünde `ON CONFLICT DO NOTHING`; satır eklenmediyse toplam DA artmaz (aynı işlem).
  addFunding: (ledgerId, ref, amount, at) => db().$transaction(async (tx) => {
    const n = await tx.$executeRaw`INSERT INTO fee_entries (ledger_id, ref, kind, cls, state, estimated, actual, settled_at) VALUES (${ledgerId}, ${ref}, 'FUNDING', 'FUNDING', 'SETTLED', 0, ${amount}::numeric, ${at}) ON CONFLICT (ref) DO NOTHING`;
    if (n !== 1) return "DUPLICATE" as const;
    await tx.$executeRaw`UPDATE fee_ledger SET funding_paid = funding_paid + ${amount}::numeric WHERE id = ${ledgerId}`; return "ADDED" as const; }),
  // Tur 39 (G22-h, Karar 2): ALINAN funding aynı tekil `ref` üstünde (ödenenle ORTAK anahtar kümesi) `direction = 'RECEIVED'` ile; YALNIZ `funding_received` artar.
  addFundingReceived: (ledgerId, ref, amount, at) => db().$transaction(async (tx) => {
    const n = await tx.$executeRaw`INSERT INTO fee_entries (ledger_id, ref, kind, cls, state, estimated, actual, settled_at, direction) VALUES (${ledgerId}, ${ref}, 'FUNDING', 'FUNDING', 'SETTLED', 0, ${amount}::numeric, ${at}, 'RECEIVED') ON CONFLICT (ref) DO NOTHING`;
    if (n !== 1) return "DUPLICATE" as const;
    await tx.$executeRaw`UPDATE fee_ledger SET funding_received = funding_received + ${amount}::numeric WHERE id = ${ledgerId}`; return "ADDED" as const; }),
  healthPause: async (id) => (await db().feeLedger.findUnique({ where: { id }, select: { healthPausedAt: true } }))?.healthPausedAt ?? null,
  setHealthPause: async (id, at) => (await db().feeLedger.updateMany({ where: { id }, data: { healthPausedAt: at } })).count === 1,
}; };
/** Kapı/kanarya deposu (S-9): aynı anlambilim bellekte; `fail` fırlatır. */
export function memoryLedgerStore(): LedgerStore & { ledgers: LedgerRow[]; entries: Map<string, EntryRow>; fail: boolean } {
  const s = { ledgers: [] as LedgerRow[], entries: new Map<string, EntryRow>(), pauses: new Map<number, Date>(), fail: false }; let seq = 0;
  const g = () => { if (s.fail) throw new Error("ledger-store-down"); }, L = (i: number) => s.ledgers.find((l) => l.id === i)!, add = (a: string, b: string) => new D(a).add(b).toFixed(10), sub = (a: string, b: string) => new D(a).sub(b).toFixed(10);
  const find = (a: Date, b: Date) => s.ledgers.find((l) => l.periodStart.getTime() === a.getTime() && l.periodEnd.getTime() === b.getTime()) ?? null;
  return Object.assign(s, {
    findPeriod: async (a: Date, b: Date) => { g(); return find(a, b); },
    openPeriod: async (n: NewLedger) => { g(); const cur = find(n.periodStart, n.periodEnd); if (cur) return cur; const r: LedgerRow = { id: ++seq, feesPaid: "0", fundingPaid: "0", fundingReceived: "0", reserved: "0", ...n }; s.ledgers.push(r); return r; },
    findEntry: async (ref: string) => { g(); return s.entries.get(ref) ?? null; },
    reserve: async (lid: number, e: { ref: string; cls: EntryCls; estimated: string }, gated: boolean) => { g(); const cur = s.entries.get(e.ref); if (cur && cur.state !== "RELEASED") return "EXISTS"; const l = L(lid);
      if (gated && (new D(l.feesPaid).add(l.fundingPaid).add(l.reserved).add(e.estimated).gt(l.budget) || [...s.entries.values()].some((x) => x.ledgerId === lid && x.state === "UNCONVERTED"))) return "EXHAUSTED";
      l.reserved = add(l.reserved, e.estimated); s.entries.set(e.ref, { id: cur?.id ?? ++seq, ledgerId: lid, ref: e.ref, kind: "FEE", cls: e.cls, state: "RESERVED", estimated: e.estimated, actual: null, paid: null }); return "RESERVED"; },
    settle: async (ref: string, actual: string, paid: PaidTrace[], _at: Date, fallback: number | null) => { g(); const cur = s.entries.get(ref); if (!cur && fallback === null) return null; const lid = cur?.ledgerId ?? (fallback as number), open = cur?.state === "RESERVED" || cur?.state === "UNCONVERTED", est = open ? cur!.estimated : "0", l = L(lid);
      if (!cur) s.entries.set(ref, { id: ++seq, ledgerId: lid, ref, kind: "FEE", cls: "UNRESERVED", state: "SETTLED", estimated: "0", actual, paid }); else Object.assign(cur, { state: "SETTLED", estimated: cur.state === "RELEASED" ? "0" : cur.estimated, actual: add(cur.actual ?? "0", actual), paid: [...((cur.paid as PaidTrace[] | null) ?? []), ...paid] });
      l.reserved = sub(l.reserved, est); l.feesPaid = add(l.feesPaid, actual); return { ledgerId: lid, estimated: est, first: open || !cur }; },
    free: async (ref: string) => { g(); const cur = s.entries.get(ref); if (!cur || cur.state !== "RESERVED") return null; cur.state = "RELEASED"; const l = L(cur.ledgerId); l.reserved = sub(l.reserved, cur.estimated); return { estimated: cur.estimated }; },
    markUnconverted: async (ref: string, paid: PaidTrace[]) => { g(); const cur = s.entries.get(ref); if (!cur || cur.state !== "RESERVED") return false; Object.assign(cur, { state: "UNCONVERTED", paid }); return true; },
    countUnconverted: async (lid: number) => { g(); return [...s.entries.values()].filter((x) => x.ledgerId === lid && x.state === "UNCONVERTED").length; },
    addFunding: async (lid: number, ref: string, amount: string) => { g(); if (s.entries.has(ref)) return "DUPLICATE" as const; s.entries.set(ref, { id: ++seq, ledgerId: lid, ref, kind: "FUNDING", cls: "FUNDING", state: "SETTLED", estimated: "0", actual: amount, paid: null }); const l = L(lid); l.fundingPaid = add(l.fundingPaid, amount); return "ADDED" as const; },
    addFundingReceived: async (lid: number, ref: string, amount: string) => { g(); if (s.entries.has(ref)) return "DUPLICATE" as const; s.entries.set(ref, { id: ++seq, ledgerId: lid, ref, kind: "FUNDING", cls: "FUNDING", state: "SETTLED", estimated: "0", actual: amount, paid: null }); const l = L(lid); l.fundingReceived = add(l.fundingReceived, amount); return "ADDED" as const; },
    healthPause: async (lid: number) => { g(); return s.pauses.get(lid) ?? null; }, setHealthPause: async (lid: number, at: Date | null) => { g(); if (at === null) s.pauses.delete(lid); else s.pauses.set(lid, at); return true; },
  });
}

let prodStore: LedgerStore | null = null;
const resolve = (d: Deps) => ({ store: d.store ?? (prodStore ??= prismaLedgerStore()), capital: d.capital ?? ((q: string) => readCapital(q)), rate: d.rate ?? ((a: string, q: string) => readRate(a, q)), now: d.now ?? Date.now });
/** Dönem (PERIOD_BASIS): UTC takvim ayı. Saatten türetilir; depo/durum gerekmez. */
export function periodOf(nowMs: number): { start: Date; end: Date } { const d = new Date(nowMs), y = d.getUTCFullYear(), m = d.getUTCMonth(); return { start: new Date(Date.UTC(y, m, 1)), end: new Date(Date.UTC(y, m + 1, 1)) }; }
/** Dönem bütçesi = sermaye × FEE_BUDGET_PCT / 100 — tek yer. */
export const budgetOf = (capital: string): string => new D(capital).mul(FEE_BUDGET_PCT).div(100).toFixed(10);
/** Ön rezervasyon tahmini = notional × taker oranı (hesaptan okunan). Yalnız rezervasyon içindir; deftere kesin yazılmaz. */
export const estimateOf = (notional: string, takerRate: string): string => new D(notional).mul(takerRate).toFixed(10);

export type LedgerLookup = { ok: true; ledger: LedgerRow; opened: boolean } | { ok: false; reason: "LEDGER_UNAVAILABLE" | "CAPITAL_UNMEASURABLE"; detail: string };
/** Bu dönemin defteri; yoksa AÇILIR: sermaye borsadan ölçülür (CAPITAL_BASIS), bütçe hesaplanır, satır yazılır (tekil kısıt eşzamanlı açılışı tekler). Ölçülemezse ok:false (kapalı arıza). */
export async function currentLedger(deps: Deps = {}): Promise<LedgerLookup> {
  const { store, capital, now } = resolve(deps), p = periodOf(now());
  try {
    const cur = await store.findPeriod(p.start, p.end); if (cur) return { ok: true, ledger: cur, opened: false };
    const c = await capital(QUOTE_ASSET); if (!c.ok) return { ok: false, reason: "CAPITAL_UNMEASURABLE", detail: c.detail };
    const ledger = await store.openPeriod({ periodStart: p.start, periodEnd: p.end, budget: budgetOf(c.capital), capital: c.capital, takerRate: c.takerRate, quoteAsset: c.quoteAsset, openedFrom: `${CAPITAL_BASIS} · ${PERIOD_BASIS} · %${FEE_BUDGET_PCT} · ${c.source}` });
    return { ok: true, ledger, opened: true };
  } catch (e) { return { ok: false, reason: "LEDGER_UNAVAILABLE", detail: errName(e) }; }
}

export type FeeRefusal = "FEE_BUDGET_EXHAUSTED" | "FEE_RATE_UNAVAILABLE" | "FEE_LEDGER_UNAVAILABLE";
export type ReserveInput = { ref: string; cls: CallClass; notional: string };
export type ReserveOutcome =
  | { ok: true; gated: boolean; reserved: boolean; status: ReserveStatus | "UNGATED_NO_LEDGER"; estimated: string | null; ledgerId: number | null; event: EmitResult | null; detail?: string }
  | { ok: false; gated: true; reason: FeeRefusal; detail: string; event: EmitResult };
/** BÜTÇE KAPISI + ÖN REZERVASYON. Sınıf → FEE_GATE_BY_CLASS: bakan sınıf bütçe/kur/defter yoksa REDDEDİLİR (olay); bakmayan sınıf HER KOŞULDA geçer (defter varsa rezerve eder, yoksa olay yazar, geçer). */
export async function reserveFee(i: ReserveInput, deps: Deps = {}): Promise<ReserveOutcome> {
  const gated = FEE_GATE_BY_CLASS[i.cls], { store } = resolve(deps);
  const refuse = async (reason: FeeRefusal, detail: string): Promise<ReserveOutcome> => ({ ok: false, gated: true, reason, detail, event: await stopEngine(reason, `${i.cls} · ${i.ref} · ${detail}`, {}, deps.events) });
  const pass = async (status: ReserveStatus | "UNGATED_NO_LEDGER", estimated: string | null, ledgerId: number | null, detail?: string): Promise<ReserveOutcome> =>
    ({ ok: true, gated, reserved: status === "RESERVED" || status === "EXISTS", status, estimated, ledgerId, detail, event: detail ? await stopEngine("FEE_LEDGER_UNAVAILABLE", `${i.cls} · ${i.ref} · ${detail} · çıkış/koruma bütçeye bakmaz, GEÇTİ; rezervasyon yok (M-1)`, {}, deps.events) : null });
  const L = await currentLedger(deps);
  if (!L.ok) return gated ? refuse("FEE_LEDGER_UNAVAILABLE", `${L.reason}:${L.detail}`) : pass("UNGATED_NO_LEDGER", null, null, `${L.reason}:${L.detail}`);
  const est = L.ledger.takerRate !== null && NUM.test(i.notional) ? estimateOf(i.notional, L.ledger.takerRate) : null;
  if (est === null && gated) return refuse("FEE_LEDGER_UNAVAILABLE", L.ledger.takerRate === null ? "taker-rate-unknown" : "bad-notional"); // tahmin yapılamıyor → giriş kapalı
  let st: ReserveStatus; try { st = await store.reserve(L.ledger.id, { ref: i.ref, cls: i.cls, estimated: est ?? "0" }, gated); } catch (e) { return gated ? refuse("FEE_LEDGER_UNAVAILABLE", errName(e)) : pass("UNGATED_NO_LEDGER", est, L.ledger.id, errName(e)); }
  if (st !== "EXHAUSTED") return pass(st, est, L.ledger.id);
  let unconverted = -1; try { unconverted = await store.countUnconverted(L.ledger.id); } catch { unconverted = -1; /* sayılamadı: kapalı yönde (giriş yok) */ }
  if (unconverted !== 0) return refuse("FEE_RATE_UNAVAILABLE", `çevrilmemiş komisyon kaydı ${unconverted < 0 ? "sayılamadı" : unconverted}; kur ölçülene kadar giriş yok`);
  return refuse("FEE_BUDGET_EXHAUSTED", `bütçe ${L.ledger.budget} ${L.ledger.quoteAsset} · ödenen ${L.ledger.feesPaid} + funding ${L.ledger.fundingPaid} + rezerve ${L.ledger.reserved} + tahmin ${est} > bütçe`);
}

export type SettleOutcome =
  | { ok: true; state: "SETTLED"; ledgerId: number; estimated: string; actual: string; diff: string; paid: PaidTrace[]; first: boolean }
  | { ok: false; reason: FeeRefusal | "NOT_RESERVED"; detail: string; paid: PaidTrace[]; event: EmitResult | null };
/** MUTABAKAT: gerçek komisyon (borsadan) tahminin YERİNE yazılır; fark döner. Varlık ≠ quote → kur ÖLÇÜLÜR (RateSource); ölçülemezse kayıt UNCONVERTED, giriş kapalı (olay), çıkış etkilenmez. */
export async function settleFee(i: { ref: string; fees: FeePaid[]; at?: Date }, deps: Deps = {}): Promise<SettleOutcome> {
  const { store, rate, now } = resolve(deps), at = i.at ?? new Date(now()), sums = new Map<string, Dec>();
  for (const f of i.fees) if (NUM.test(f.amount)) sums.set(f.asset, (sums.get(f.asset) ?? new D(0)).add(f.amount));
  const paid: PaidTrace[] = []; let actual = new D(0), missing: string | null = null;
  for (const [asset, amount] of sums) {
    const r: RateReading = asset === QUOTE_ASSET ? { ok: true, rate: IDENTITY_RATE, source: "identity" } : await rate(asset, QUOTE_ASSET).catch((e: unknown) => ({ ok: false as const, detail: errName(e) }));
    paid.push({ asset, amount: amount.toFixed(10), rate: r.ok ? r.rate : null, source: r.ok ? r.source : `ÖLÇÜLEMEDİ:${r.detail}` });
    if (r.ok) actual = actual.add(amount.mul(r.rate)); else missing ??= `${asset}:${r.detail}`;
  }
  try {
    if (missing !== null) { await store.markUnconverted(i.ref, paid); return { ok: false, reason: "FEE_RATE_UNAVAILABLE", detail: missing, paid, event: await stopEngine("FEE_RATE_UNAVAILABLE", `${i.ref} · ${missing} · kayıt UNCONVERTED; giriş kapalı, çıkış geçer`, {}, deps.events) }; }
    const L = await currentLedger(deps), r = await store.settle(i.ref, actual.toFixed(10), paid, at, L.ok ? L.ledger.id : null);
    if (!r) return { ok: false, reason: "NOT_RESERVED", detail: "rezervasyon yok ve dönem defteri açılamadı", paid, event: null };
    return { ok: true, state: "SETTLED", ledgerId: r.ledgerId, estimated: r.estimated, actual: actual.toFixed(10), diff: actual.sub(r.estimated).toFixed(10), paid, first: r.first };
  } catch (e) { return { ok: false, reason: "FEE_LEDGER_UNAVAILABLE", detail: errName(e), paid, event: null }; }
}
export type ReleaseOutcome = { ok: true; state: "RELEASED" | "NOT_RESERVED"; estimated: string | null } | { ok: false; reason: "FEE_LEDGER_UNAVAILABLE"; detail: string };
/** Emir çıkmadı/iptal/ret → rezervasyon serbest (sızıntı yok). */
export async function releaseFee(i: { ref: string }, deps: Deps = {}): Promise<ReleaseOutcome> {
  try { const r = await resolve(deps).store.free(i.ref); return r ? { ok: true, state: "RELEASED", estimated: r.estimated } : { ok: true, state: "NOT_RESERVED", estimated: null }; } catch (e) { return { ok: false, reason: "FEE_LEDGER_UNAVAILABLE", detail: errName(e) }; }
}
export type SettleOrReleaseOutcome = SettleOutcome | ReleaseOutcome | { ok: true; state: "PENDING" };
/** Gönderim sonrası: dolum yanıtında komisyon varsa MUTABAKAT; dolumsuz ve kesin bitmişse (NO_FILL_TERMINAL) SERBEST; açık emirse BEKLEMEDE (dolum WS'ten gelince settleFee, G16). */
export async function settleOrRelease(i: { ref: string; fill: FillReport }, deps: Deps = {}): Promise<SettleOrReleaseOutcome> {
  if (i.fill.fees.length > 0) return settleFee({ ref: i.ref, fees: i.fill.fees }, deps);
  if ((NO_FILL_TERMINAL as readonly string[]).includes(i.fill.status)) return releaseFee({ ref: i.ref }, deps);
  return { ok: true, state: "PENDING" };
}
/** FUNDING ANAHTARI (Tur 38 madde 4c · M-3, M-1): bir funding ödemesi = SEMBOL + borsanın ödeme anı (ms). `fee_entries.ref`'te TEKİLDİR — aynı ödeme iki kez yazılamaz. */
export const FUNDING_REF_RE = /^funding:[A-Z0-9]{5,20}:\d{13}$/;
export const fundingRef = (symbol: string, fundingTimeMs: number) => `funding:${symbol}:${fundingTimeMs}`;
export type FundingOutcome = { ok: true; ledgerId: number } | { ok: false; reason: "FEE_LEDGER_UNAVAILABLE" | "FUNDING_DUPLICATE" | "FUNDING_REF_INVALID" | "FUNDING_AMOUNT_INVALID"; detail: string };
/** Funding (M-3): ayrı kalem, doğrudan gerçek tutarla; bütçe kapısı toplamda sayar. Anahtar biçimi ve tutar DOĞRULANIR; ikinci yazım ADIYLA reddedilir, toplam artmaz.
 *  Tutar yalnız ÖDENEN funding'dir (≥ 0; şema CHECK `fee_ledger_nonnegative`): ALINAN funding `recordFundingReceived` ile AYRI yazılır (Tur 39, Karar 2) — negatif tutar burada yutulmaz, reddedilir. */
export async function recordFunding(i: { ref: string; amount: string; at?: Date }, deps: Deps = {}): Promise<FundingOutcome> {
  if (!FUNDING_REF_RE.test(i.ref)) return { ok: false, reason: "FUNDING_REF_INVALID", detail: `funding anahtarı biçimsiz (${i.ref}) — beklenen funding:<SEMBOL>:<ödeme anı ms>` };
  if (!NUM.test(i.amount)) return { ok: false, reason: "FUNDING_AMOUNT_INVALID", detail: `funding tutarı ödenen (≥ 0) ondalık değil (${i.amount}) — alınan funding recordFundingReceived ile yazılır` };
  const { store, now } = resolve(deps), L = await currentLedger(deps); if (!L.ok) return { ok: false, reason: "FEE_LEDGER_UNAVAILABLE", detail: `${L.reason}:${L.detail}` };
  try { const r = await store.addFunding(L.ledger.id, i.ref, i.amount, i.at ?? new Date(now()));
    return r === "ADDED" ? { ok: true, ledgerId: L.ledger.id } : { ok: false, reason: "FUNDING_DUPLICATE", detail: `${i.ref} bu defterde zaten yazılı — aynı funding iki kez sayılmaz (funding_paid değişmedi)` }; }
  catch (e) { return { ok: false, reason: "FEE_LEDGER_UNAVAILABLE", detail: errName(e) }; }
}
/** ALINAN FUNDING (Tur 39 · G22 kalemi h · Üretim Kararı 2 `winvestor-alinan-funding-muhasebesi`): pozisyon funding'i ödemek yerine ALDIĞINDA.
 *  YALNIZ KÂR olarak sayılır: ayrı alana (`funding_received`) MUTLAK değerle yazılır; bütçe kapısı, sağlık oranı ve kenar/maliyet yolu onu OKUMAZ (kapı: gate:funding (6)) —
 *  alınan funding bütçede yer açmaz, maliyeti düşürmez. Anahtar ödenen funding'le AYNI biçim ve AYNI tekil küme: bir funding ya ödenir ya alınır, TEK kez yazılır; ikinci yazım ADIYLA reddedilir.
 *  Tutar işaretsiz ondalıktır (alınan miktarın kendisi); işaretli tutar kabul edilmez — yön fonksiyonun adındadır, işarette değil. CARRY_HEDGE'de kenara katma AYRI karardır (bu turda yok). */
export async function recordFundingReceived(i: { ref: string; amount: string; at?: Date }, deps: Deps = {}): Promise<FundingOutcome> {
  if (!FUNDING_REF_RE.test(i.ref)) return { ok: false, reason: "FUNDING_REF_INVALID", detail: `funding anahtarı biçimsiz (${i.ref}) — beklenen funding:<SEMBOL>:<ödeme anı ms>` };
  if (!NUM.test(i.amount)) return { ok: false, reason: "FUNDING_AMOUNT_INVALID", detail: `alınan funding tutarı işaretsiz ondalık değil (${i.amount}) — alınan miktarın kendisi yazılır, yön fonksiyonun adındadır` };
  const { store, now } = resolve(deps), L = await currentLedger(deps); if (!L.ok) return { ok: false, reason: "FEE_LEDGER_UNAVAILABLE", detail: `${L.reason}:${L.detail}` };
  try { const r = await store.addFundingReceived(L.ledger.id, i.ref, i.amount, i.at ?? new Date(now()));
    return r === "ADDED" ? { ok: true, ledgerId: L.ledger.id } : { ok: false, reason: "FUNDING_DUPLICATE", detail: `${i.ref} bu defterde zaten yazılı (ödenen ya da alınan) — aynı funding iki kez sayılmaz (funding_received değişmedi)` }; }
  catch (e) { return { ok: false, reason: "FEE_LEDGER_UNAVAILABLE", detail: errName(e) }; }
}
