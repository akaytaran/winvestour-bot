// GİDİŞ-DÖNÜŞ MALİYET HESAPLAYICISI (G13 · M-2, M-1, S-7, S-9, Ö-1, Ö-3). M-2'nin "UYGULANMADI" beyanı bu dosyayla kalkar.
// MALİYET = KOMİSYON + YAYILMA + DERİNLİK ETKİSİ. Üçü de ÇALIŞMA ANINDA ölçülür; hiçbiri koda yazılmaz (kapı: scripts/gate-edge.mjs).
//   · komisyon    — hesabın KENDİ kademesinden: imzalı `GET /api/v3/account/commission?symbol=` (standardCommission.taker + discount bloğu). Gidiş-dönüş İKİ kez.
//   · yayılma     — `GET /api/v3/ticker/bookTicker`: (ask − bid) ÷ orta fiyat. Gidiş-dönüş BİR kez ödenir (piyasa alışı satışa, piyasa satışı alışa değer, M-2).
//   · derinlik    — `GET /api/v3/depth` defteri PLANLANAN BÜYÜKLÜKLE yürünür: ortalama dolumun en iyi kademeden sapması. ÖLÇÜLÜR, sıfır VARSAYILMAZ.
// BNB İNDİRİMİ ÖLÇÜLÜR (Tur 15 bulgusu, iş sahibi kararı): borsanın `discount.enabledForAccount` bayrağı AÇIK olsa bile yakılacak BNB yoksa indirim UYGULANMAZ —
//   ölçüldü (2026-09-10): bayrak açık, oran %75, BNB serbest bakiye 0, ve Tur 14'ün GERÇEK emri tam 10 bp komisyon ödedi. Bu yüzden indirim yalnız (a) bayrak açık VE
//   (b) serbest BNB'nin ÖLÇÜLEN quote karşılığı bu gidiş-dönüşün tahmini komisyonunu karşılıyorsa uygulanır. Ölçülemeyen her durumda STANDART oran kullanılır:
//   maliyeti DÜŞÜK göstermek M-2'yi gevşetir (Ö-3), YÜKSEK göstermek yalnız işlem yapmamaya yol açar (M-4 — geçerli çıktı).
// KAPALI ARIZA (M-1): üç bileşenden biri ölçülemezse maliyet DÖNMEZ → giriş yok. Çıkış ve koruma bu hesabı hiç çağırmaz (kapı zorlar).
import { Prisma } from "@/generated/prisma/client";
import type { Keyring } from "@/lib/crypto";
import { signedTimestamp } from "@/lib/binance/time";
import { prismaKeySource, RECV_WINDOW_MS } from "@/lib/exchange-key";
import { withSignedCall } from "@/lib/exchange-key/sign";
import { requestWithEvents, type ExchangeDeps } from "@/lib/events/exchange";
import { readFreeAsset, readRate, type KeySource } from "@/lib/fee-ledger/exchange";
import { QUOTE_ASSET } from "@/lib/fee-ledger";

/** Ağırlıklar Binance belgesinden; boğaz her yanıtta başlıkla HİZALAR (S-7). commission 20 · bookTicker tek sembol 2 · depth limit≤100 için 5. */
export const COMMISSION_CALL = { path: "/api/v3/account/commission", cls: "DISCOVERY", weight: 20 } as const;
export const BOOK_TICKER_CALL = { path: "/api/v3/ticker/bookTicker", cls: "DISCOVERY", weight: 2 } as const;
export const DEPTH_CALL = { path: "/api/v3/depth", cls: "DISCOVERY", weight: 5 } as const;
/** Defter derinliği kademe sayısı: 100 kademe `DEPTH_CALL.weight` ile aynı fiyat kademesindedir (Binance: 1–100 ⇒ ağırlık 5). Daha derini ağırlığı büyütür. */
export const DEPTH_LEVELS = "100";
/** Baz puan çarpanı — birim dönüşümü, eşik DEĞİL (M-2'nin eşiği ./index.ts'te ve ANAYASA'dan gelir). */
export const BP = 10_000;
/** Gidiş-dönüş: komisyon İKİ kez (giriş + çıkış), yayılma BİR kez (M-2 metni). Sayı değil, kuralın kendisi — tek yerde. */
export const COMMISSION_LEGS = 2, SPREAD_LEGS = 1;

const D = Prisma.Decimal, NUM = /^\d+(\.\d+)?$/;
const bp = (x: Prisma.Decimal) => x.mul(BP);
const dec = (s: unknown): Prisma.Decimal | null => (typeof s === "string" && NUM.test(s) ? new D(s) : null);
export type CostDeps = { exchange?: ExchangeDeps; key?: KeySource; ring?: Keyring; now?: () => number };
export type Side = "BUY" | "SELL";

type CommissionResponse = { standardCommission?: { taker?: string }; discount?: { enabledForAccount?: boolean; enabledForSymbol?: boolean; discountAsset?: string; discount?: string } };
export type CommissionReading =
  | { ok: true; standardTakerBp: string; effectiveTakerBp: string; roundTripBp: string; discountApplied: boolean; discountDetail: string; source: string }
  | { ok: false; refusal: "COMMISSION_UNMEASURABLE"; detail: string };

/** Komisyon oranı HESABIN KENDİ kademesinden. `notional` BNB indiriminin gerçekten karşılanıp karşılanmadığını ÖLÇMEK için gerekir (tahmini komisyon ↔ BNB bakiyesi). */
export async function readCommission(symbol: string, notional: string, deps: CostDeps = {}): Promise<CommissionReading> {
  const now = deps.now ?? Date.now, k = await (deps.key ?? prismaKeySource)();
  if (!k) return { ok: false, refusal: "COMMISSION_UNMEASURABLE", detail: "no-exchange-key" };
  const ts = await signedTimestamp({ exchange: deps.exchange, events: deps.exchange?.events, now });
  if (!ts.ok) return { ok: false, refusal: "COMMISSION_UNMEASURABLE", detail: `clock:${ts.refusal}:${ts.detail}` };
  let r: Awaited<ReturnType<typeof requestWithEvents<CommissionResponse>>>;
  try { r = await withSignedCall(k.api, k.priv, { symbol, timestamp: ts.timestamp, recvWindow: String(RECV_WINDOW_MS) }, (h, q) => requestWithEvents<CommissionResponse>({ ...COMMISSION_CALL, headers: h, query: q }, deps.exchange), deps.ring); }
  catch (e) { return { ok: false, refusal: "COMMISSION_UNMEASURABLE", detail: `commission:${(e as { name?: string })?.name ?? "error"}` }; }
  if (!r.result.ok) return { ok: false, refusal: "COMMISSION_UNMEASURABLE", detail: `commission:${r.result.reason ?? ""}:${r.result.detail}` };
  const std = dec(r.result.data?.standardCommission?.taker);
  if (std === null) return { ok: false, refusal: "COMMISSION_UNMEASURABLE", detail: `commission:${symbol}:standardCommission.taker okunamadı` };
  const d = r.result.data?.discount ?? {}, rate = dec(d.discount), asset = typeof d.discountAsset === "string" ? d.discountAsset : null;
  const flagged = d.enabledForAccount === true && d.enabledForSymbol === true && rate !== null && rate.gt(0) && asset !== null;
  // Bayrak açıksa YETMİYOR: indirim varlığının ÖLÇÜLEN quote karşılığı tahmini komisyonu karşılamalı. Ölçülemezse indirim UYGULANMAZ (muhafazakâr).
  let discountApplies = false, why = flagged ? "" : `borsa bayrağı kapalı (hesap=${d.enabledForAccount ?? "?"} sembol=${d.enabledForSymbol ?? "?"} oran=${d.discount ?? "?"})`;
  const need = dec(notional) === null ? null : (dec(notional) as Prisma.Decimal).mul(std).mul(COMMISSION_LEGS);
  if (flagged && need !== null) {
    const bal = await readFreeAsset(asset as string, { exchange: deps.exchange, ring: deps.ring, key: deps.key, now });
    const px = await readRate(asset as string, QUOTE_ASSET, { exchange: deps.exchange, now });
    const free = bal.ok ? dec(bal.free) : null, rt = px.ok ? dec(px.rate) : null;
    if (free === null || rt === null) why = `${asset} bakiyesi/kuru ÖLÇÜLEMEDİ (${bal.ok ? "" : bal.detail}${px.ok ? "" : " " + px.detail}) — indirim uygulanmadı`;
    else { const have = free.mul(rt); discountApplies = have.gte(need); why = `${asset} serbest ${free.toFixed(8)} × kur ${rt.toFixed(8)} = ${have.toFixed(8)} ${QUOTE_ASSET} ${discountApplies ? "≥" : "<"} gereken komisyon ${need.toFixed(8)} ⇒ indirim ${discountApplies ? "UYGULANDI" : "UYGULANMADI"}`; }
  } else if (flagged) why = `büyüklük okunamadı (notional=${notional}) — indirim uygulanmadı`;
  // ÖLÇÜLDÜ (Tur 18 madde 4, GERÇEK emir orderId 12580096104): `discount` alanı ÇARPANDIR — ücret × 0,75 (indirim %25), "1 − 0,75" DEĞİL. 6,3774 USDT'lik alım 0,00000675 BNB
  //   = 0,00478305 USDT ödedi = 7,5 bp/bacak (Tur 15–17'nin varsaydığı 2,5 değil). Yanlış çarpan maliyeti DÜŞÜK gösteriyordu (M-2'yi gevşetir, Ö-3); ölçümle düzeltildi.
  const eff = discountApplies && rate !== null ? std.mul(rate) : std;
  return { ok: true, standardTakerBp: bp(std).toFixed(6), effectiveTakerBp: bp(eff).toFixed(6), roundTripBp: bp(eff).mul(COMMISSION_LEGS).toFixed(6), discountApplied: discountApplies, discountDetail: why,
    source: `account/commission ${symbol} standardTaker=${std.toFixed(8)} @${new Date(now()).toISOString()}` };
}

export type SpreadReading = { ok: true; bid: string; ask: string; mid: string; spreadBp: string; source: string } | { ok: false; refusal: "SPREAD_UNMEASURABLE"; detail: string };
/** Yayılma defterin TEPESİNDEN ölçülür. Bozuk/çapraz defter (ask ≤ bid) ölçüm değildir → kapalı arıza. */
export async function readSpread(symbol: string, deps: CostDeps = {}): Promise<SpreadReading> {
  const now = deps.now ?? Date.now;
  const r = await requestWithEvents<{ bidPrice?: string; askPrice?: string }>({ ...BOOK_TICKER_CALL, query: { symbol } }, deps.exchange);
  if (!r.result.ok) return { ok: false, refusal: "SPREAD_UNMEASURABLE", detail: `bookTicker:${r.result.reason ?? ""}:${r.result.detail}` };
  const bid = dec(r.result.data?.bidPrice), ask = dec(r.result.data?.askPrice);
  if (bid === null || ask === null || !bid.gt(0) || !ask.gt(0)) return { ok: false, refusal: "SPREAD_UNMEASURABLE", detail: `bookTicker:${symbol}:bid=${r.result.data?.bidPrice ?? "?"} ask=${r.result.data?.askPrice ?? "?"}` };
  if (ask.lt(bid)) return { ok: false, refusal: "SPREAD_UNMEASURABLE", detail: `bookTicker:${symbol}:çapraz defter (ask ${ask.toFixed(8)} < bid ${bid.toFixed(8)})` };
  const mid = bid.add(ask).div(2);
  return { ok: true, bid: bid.toFixed(8), ask: ask.toFixed(8), mid: mid.toFixed(8), spreadBp: bp(ask.sub(bid).div(mid)).mul(SPREAD_LEGS).toFixed(6), source: `bookTicker ${symbol} @${new Date(now()).toISOString()}` };
}

export type DepthReading = { ok: true; impactBp: string; levels: number; best: string; avgFill: string; source: string } | { ok: false; refusal: "DEPTH_UNMEASURABLE" | "DEPTH_TOO_THIN"; detail: string };
/** SAF defter yürüyüşü: hedef büyüklük kademe kademe yenir, ortalama dolum ile en iyi kademe arasındaki sapma baz puan olarak döner. Defter taşımıyorsa sonuç YOKTUR. */
export function walkBook(levels: [string, string][], targetNotional: Prisma.Decimal): { impactBp: Prisma.Decimal; used: number; best: Prisma.Decimal; avg: Prisma.Decimal } | null {
  const first = levels[0]; if (!first) return null;
  const best = dec(first[0]); if (best === null || !best.gt(0)) return null;
  let spent = new D(0), qty = new D(0), used = 0;
  for (const [p, q] of levels) {
    const px = dec(p), amt = dec(q); if (px === null || amt === null || !px.gt(0)) return null;
    used++; const capacity = px.mul(amt), remaining = targetNotional.sub(spent);
    if (capacity.gte(remaining)) { spent = spent.add(remaining); qty = qty.add(remaining.div(px)); const avg = spent.div(qty); return { impactBp: bp(avg.sub(best).div(best)).abs(), used, best, avg }; }
    spent = spent.add(capacity); qty = qty.add(amt);
  }
  return null;
}
/** Derinlik etkisi PLANLANAN BÜYÜKLÜKLE ölçülür: alış defterin ASK tarafını, satış BID tarafını yürür. Sabit sıfır YAZILMAZ — büyüklükten türer. */
export async function readDepthImpact(symbol: string, side: Side, notional: string, deps: CostDeps = {}): Promise<DepthReading> {
  const now = deps.now ?? Date.now, target = dec(notional);
  if (target === null || !target.gt(0)) return { ok: false, refusal: "DEPTH_UNMEASURABLE", detail: `${symbol}:büyüklük=${notional}` };
  const r = await requestWithEvents<{ bids?: [string, string][]; asks?: [string, string][] }>({ ...DEPTH_CALL, query: { symbol, limit: DEPTH_LEVELS } }, deps.exchange);
  if (!r.result.ok) return { ok: false, refusal: "DEPTH_UNMEASURABLE", detail: `depth:${r.result.reason ?? ""}:${r.result.detail}` };
  const book = side === "BUY" ? r.result.data?.asks : r.result.data?.bids;
  if (!Array.isArray(book) || book.length === 0) return { ok: false, refusal: "DEPTH_UNMEASURABLE", detail: `depth:${symbol}:${side === "BUY" ? "asks" : "bids"} boş` };
  const w = walkBook(book, target);
  if (w === null) return { ok: false, refusal: "DEPTH_TOO_THIN", detail: `depth:${symbol}:${side} defterin ilk ${book.length} kademesi ${target.toFixed(8)} büyüklüğü taşımıyor` };
  return { ok: true, impactBp: w.impactBp.toFixed(6), levels: w.used, best: w.best.toFixed(8), avgFill: w.avg.toFixed(8), source: `depth ${symbol} limit=${DEPTH_LEVELS} ${side} @${new Date(now()).toISOString()}` };
}

export type CostRefusal = "COMMISSION_UNMEASURABLE" | "SPREAD_UNMEASURABLE" | "DEPTH_UNMEASURABLE" | "DEPTH_TOO_THIN";
export type CostReading =
  | { ok: true; symbol: string; side: Side; notional: string; commissionBp: string; standardCommissionBp: string; spreadBp: string; depthBp: string; totalBp: string; at: string; sources: string[]; discount: string }
  | { ok: false; refusal: CostRefusal; detail: string; at: string };
/** ÜÇÜNÜN TOPLAMI = o sembol ve o BÜYÜKLÜK için gidiş-dönüş maliyet (baz puan). Değerin TARİHİ ve KAYNAĞI birlikte döner (Ö-1). Biri ölçülemezse sonuç YOKTUR (kapalı arıza). */
export async function readRoundTripCost(i: { symbol: string; side: Side; notional: string }, deps: CostDeps = {}): Promise<CostReading> {
  const now = deps.now ?? Date.now, at = new Date(now()).toISOString();
  const c = await readCommission(i.symbol, i.notional, deps);
  if (!c.ok) return { ok: false, refusal: c.refusal, detail: c.detail, at };
  const s = await readSpread(i.symbol, deps);
  if (!s.ok) return { ok: false, refusal: s.refusal, detail: s.detail, at };
  const d = await readDepthImpact(i.symbol, i.side, i.notional, deps);
  if (!d.ok) return { ok: false, refusal: d.refusal, detail: d.detail, at };
  const total = new D(c.roundTripBp).add(s.spreadBp).add(d.impactBp);
  // standardCommissionBp (Tur 17 madde 2): İNDİRİMSİZ gidiş-dönüş komisyon — evren tavanlarının ÇAPASI (./universe.ts). Maliyete girmez; indirim yalnız `commissionBp`'yi (M-2 eşiğini) düşürür.
  return { ok: true, symbol: i.symbol, side: i.side, notional: i.notional, commissionBp: c.roundTripBp, standardCommissionBp: new D(c.standardTakerBp).mul(COMMISSION_LEGS).toFixed(6), spreadBp: s.spreadBp, depthBp: d.impactBp, totalBp: total.toFixed(6), at,
    discount: `${c.discountApplied ? "indirimli" : "standart"} · ${c.discountDetail}`, sources: [c.source, s.source, d.source] };
}
