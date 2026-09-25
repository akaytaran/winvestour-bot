// SAĞLIK GÖSTERGESİ (G17 · M-5, M-1, M-2, M-4, K-1, K-8, Ö-1, Ö-2, U-3). Kapı: scripts/gate-health.mjs · kanarya: scripts/canary-health.mts.
// M-5 — KOMİSYONUN BRÜT KÂRA ORANI bir sağlık göstergesidir: oran eşiği aşarsa STRATEJİ KENDİNİ DURAKLATIR (yeni pozisyon açılmaz) ve olay düşer (FCM köprüsü G19'da; bu turda yalnız olay).
// EŞİK TÜRETİLİR, KODLANMAZ (Tur 24 denetçi kararı) — girdiler zaten verilmiş kararlardır: İŞ SAHİBİ KARARI FEE_BUDGET_PCT = 2 (dönem bütçesi = sermaye × %2 = fee_ledger.budget; Tur 10/11),
//   dönem = UTC takvim ayı (PERIOD_BASIS, Tur 11), M-2'nin çarpanı EDGE_MULTIPLE (beklenen hareket ≥ ölçülen maliyet × 3) ve defterin GERÇEK kayıtları (fees_paid + funding_paid borsadan okunan komisyon;
//   brüt kâr = dönemde kapanan pozisyonların GERÇEK dolumları: SELL quote − BUY quote, `orders.raw_response.cummulativeQuoteQty`).
//   · EŞİK τ = 1 / EDGE_MULTIPLE: M-2'yi geçen her pozisyon beklenen hareketi maliyetin (≥ komisyonun) EN AZ EDGE_MULTIPLE katı olarak açılır; gerçekleşen komisyon / brüt kâr oranı 1/EDGE_MULTIPLE'ı
//     aşıyorsa strateji kendi giriş ölçütünün ALTINDA gerçekleşiyordur = erime (M-5'in yakalamak istediği şey). Sayı yazılmadı: EDGE_MULTIPLE değişirse eşik onunla değişir (kapı: sayısal eşik KIRMIZI).
//   · KANIT TABANI = bütçe / EDGE_MULTIPLE: bütçe iş sahibinin dönem başına komisyon toleransıdır (FEE_BUDGET_PCT); toleransın EDGE_MULTIPLE'da biri harcanmadan oran bir-iki işlemin gürültüsüdür,
//     hüküm verilmez (INSUFFICIENT: giriş açık, cümle yazılır). Aynı çarpan iki yerde kullanıldı; ikinci bir sayı icat edilmedi (biçim SEÇİMİ, AÇIK — sicil).
//   · risk_profile.fee_health_ratio_max DOLUYSA iş sahibi kararı olarak o eşik kullanılır (M-7'nin cooldown_seconds emsali); NULL ise türetilmiş τ. Hangisi kullanıldığı cümleye yazılır (Ö-1).
// "STRATEJİ DURUR" = YALNIZ GİRİŞ KAPANIR. Bu modül yalnız giriş yolundan çağrılır: planEntries'te Beyin'den ve piyasa okumasından ÖNCE (para/ağırlık harcanmaz, M-4) ve openProtectedPosition'da
//   yeniden giriş kapısından sonra, taramadan önce. Çıkış ve borsadaki koruma bu modülü ÇAĞIRMAZ ve bilmez (M-1, K-1; kapı: çıkış/koruma gövdelerinde sağlık simgesi KIRMIZI).
// DURUM: fee_ledger.health_paused_at (defterin tek yazma yüzeyi fee-ledger modülüdür; buradan store.setHealthPause). Geçiş anında BİR KEZ olay (HEALTH_PAUSED / HEALTH_RECOVERED), her tikte değil (K-8:
//   sebep sicilde ve olayda; olay seli değil). Defter/kayıt okunamazsa sağlık BİLİNMİYOR ⇒ giriş yok, "sağlıklı" VARSAYILMAZ (Ö-2; HEALTH_UNKNOWN, STOPPED). U-3: her hüküm bir CÜMLE taşır.
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/db/client";
import { EDGE_MULTIPLE } from "@/lib/edge";
import { stopEngine, type Deps as EventDeps, type EmitResult } from "@/lib/events";
import { FEE_BUDGET_PCT, PERIOD_BASIS, periodOf, prismaLedgerStore, type LedgerStore } from "@/lib/fee-ledger";

const D = Prisma.Decimal;
export const HEALTH_THRESHOLD_SOURCE = "EDGE_MULTIPLE'dan türetildi: eşik = bir bölü EDGE_MULTIPLE (M-2); sayı kodlanmadı";
/** TÜRETİLMİŞ EŞİK: komisyon / brüt kâr ≤ 1 / EDGE_MULTIPLE. Sayı yok; çarpan M-2'den. */
export const derivedThreshold = (): string => new D(1).div(EDGE_MULTIPLE).toFixed(10, D.ROUND_DOWN);
/** KANIT TABANI: dönem bütçesinin (sermaye × FEE_BUDGET_PCT / 100, defterde `budget`) EDGE_MULTIPLE'da biri — bu kadar komisyon ödenmeden hüküm verilmez. */
export const evidenceFloor = (budget: string): string => new D(budget).div(EDGE_MULTIPLE).toFixed(10);

export type GrossReading = { gross: string; closed: number; source: string };
export type GrossSource = (start: Date, end: Date) => Promise<GrossReading>;
/** Brüt kâr GERÇEK dolumlardan: dönemde kapanan pozisyonların emirleri, borsa yanıtındaki `cummulativeQuoteQty` (yoksa miktar × fiyat). SELL artı, BUY eksi. Tahmin yok (Ö-1). */
export const prismaGrossSource = (client?: PrismaClient): GrossSource => async (start, end) => {
  const r = await (client ?? getDb()).$queryRaw<{ closed: number; gross: string }[]>`SELECT count(DISTINCT p.id)::int AS closed, COALESCE(SUM(CASE WHEN o.side = 'SELL' THEN x.q ELSE -x.q END), 0)::text AS gross
    FROM positions p JOIN orders o ON o.position_id = p.id CROSS JOIN LATERAL (SELECT COALESCE((o.raw_response->>'cummulativeQuoteQty')::numeric, o.quantity * o.price, 0) AS q) x
    WHERE p.status IN ('CLOSED', 'FAILED_UNPROTECTED_CLOSED') AND p.closed_at >= ${start} AND p.closed_at < ${end} AND o.status <> 'TEST'`;
  return { gross: new D(r[0]?.gross ?? "0").toFixed(10), closed: r[0]?.closed ?? 0, source: "positions ⋈ orders (kapanan pozisyonların gerçek dolumları, cummulativeQuoteQty)" };
};
export const memoryGrossSource = (rows: () => GrossReading): GrossSource => async () => rows();
export type RatioLimitSource = () => Promise<string | null>;
/** risk_profile.fee_health_ratio_max: DOLUYSA iş sahibi kararı; NULL ise türetilmiş eşik. */
export const prismaRatioLimitSource = (client?: PrismaClient): RatioLimitSource => async () => { const r = await (client ?? getDb()).riskProfile.findUnique({ where: { id: 1 }, select: { feeHealthRatioMax: true } }); return r?.feeHealthRatioMax === null || r?.feeHealthRatioMax === undefined ? null : String(r.feeHealthRatioMax); };

export type HealthState = "HEALTHY" | "UNHEALTHY" | "INSUFFICIENT" | "UNKNOWN";
export type HealthVerdict = { state: HealthState; ledgerId: number | null; ratio: string | null; threshold: string; thresholdSource: string; fees: string; gross: string; budget: string; floor: string; closed: number; period: string; sentence: string; source: string };
const money = (v: string) => new D(v).toFixed(4);
/** SAF HÜKÜM (U-3: her sayı bir cümlede). Bütçesiz dönem (defter yok = işlem yok) ve kanıt tabanı altı → INSUFFICIENT (giriş açık); brüt kâr ≤ 0 iken komisyon varsa oran sonsuz sayılır → UNHEALTHY. */
export function judgeHealth(i: { ledgerId: number | null; fees: string; gross: string; budget: string; closed: number; ownerRatioMax: string | null; period: string; source: string }): HealthVerdict {
  const fees = new D(i.fees), gross = new D(i.gross), floor = evidenceFloor(i.budget), threshold = i.ownerRatioMax ?? derivedThreshold(), thresholdSource = i.ownerRatioMax === null ? HEALTH_THRESHOLD_SOURCE : "risk_profile.fee_health_ratio_max (iş sahibi kararı)";
  const ratio = gross.gt(0) ? fees.div(gross).toFixed(6) : null, base = { ledgerId: i.ledgerId, ratio, threshold, thresholdSource, fees: fees.toFixed(10), gross: gross.toFixed(10), budget: new D(i.budget).toFixed(10), floor, closed: i.closed, period: i.period, source: i.source };
  if (!new D(i.budget).gt(0) || fees.lt(floor)) return { ...base, state: "INSUFFICIENT", sentence: `${i.period} döneminde ödenen komisyon ${money(fees.toFixed(10))} USDT, kanıt tabanı ${money(floor)} USDT'nin (bütçe ${money(base.budget)} ÷ EDGE_MULTIPLE ${EDGE_MULTIPLE}) altında: ${i.closed} kapanış üzerinden hüküm verilmez; giriş açık (kaynak: ${i.source}).` };
  const unhealthy = ratio === null || new D(ratio).gt(threshold), thr = money(threshold);
  const sentence = unhealthy
    ? `${i.period} döneminde ${i.closed} kapanışta brüt kâr ${money(base.gross)} USDT, ödenen komisyon ${money(base.fees)} USDT: oran ${ratio ?? "sonsuz (brüt kâr yok)"} > eşik ${thr} (${thresholdSource}) — strateji kendi giriş ölçütünün (M-2) altında gerçekleşiyor; yeni pozisyon açılmaz, çıkış ve borsadaki koruma sürer (kaynak: ${i.source}).`
    : `${i.period} döneminde ${i.closed} kapanışta brüt kâr ${money(base.gross)} USDT, ödenen komisyon ${money(base.fees)} USDT: oran ${ratio} ≤ eşik ${thr} (${thresholdSource}) — sağlıklı; giriş açık (kaynak: ${i.source}).`;
  return { ...base, state: unhealthy ? "UNHEALTHY" : "HEALTHY", sentence };
}

export type HealthDeps = { ledger?: LedgerStore; gross?: GrossSource; limit?: RatioLimitSource; events?: EventDeps; now?: () => number };
const errName = (e: unknown) => (e as { name?: string })?.name ?? "error";
const unknown = (detail: string, period: string): HealthVerdict => ({ state: "UNKNOWN", ledgerId: null, ratio: null, threshold: derivedThreshold(), thresholdSource: HEALTH_THRESHOLD_SOURCE, fees: "?", gross: "?", budget: "?", floor: "?", closed: -1, period, source: "ölçülemedi", sentence: `${period} dönemi için sağlık BİLİNMİYOR: defter/kayıt okunamadı (${detail}); "sağlıklı" varsayılmadı, yeni pozisyon yok (Ö-2); çıkış ve koruma sürer.` });
/** OKUMA: bu dönemin defteri (yoksa işlem yok → INSUFFICIENT) + gerçek brüt kâr + iş sahibi eşiği. Fırlatmaz; okunamayan → UNKNOWN. */
export async function readHealth(deps: HealthDeps = {}): Promise<HealthVerdict> {
  const now = deps.now ?? Date.now, p = periodOf(now()), period = p.start.toISOString().slice(0, 7), store = deps.ledger ?? prismaLedgerStore();
  try {
    const L = await store.findPeriod(p.start, p.end);
    if (!L) return judgeHealth({ ledgerId: null, fees: "0", gross: "0", budget: "0", closed: 0, ownerRatioMax: null, period, source: "dönem defteri yok (bu dönemde işlem yok)" });
    const g = await (deps.gross ?? prismaGrossSource())(p.start, p.end), own = await (deps.limit ?? prismaRatioLimitSource())();
    return judgeHealth({ ledgerId: L.id, fees: new D(L.feesPaid).add(L.fundingPaid).toFixed(10), gross: g.gross, budget: L.budget, closed: g.closed, ownerRatioMax: own, period, source: `fee_ledger#${L.id} (${PERIOD_BASIS}, bütçe = sermaye × %${FEE_BUDGET_PCT}) · ${g.source}` });
  } catch (e) { return unknown(errName(e), period); }
}

export type HealthRefusal = "HEALTH_PAUSED" | "HEALTH_UNKNOWN";
export type HealthOutcome = { ok: true; verdict: HealthVerdict; event: EmitResult | null } | { ok: false; refusal: HealthRefusal; verdict: HealthVerdict; pausedAt: Date | null; event: EmitResult | null };
/** GİRİŞ KAPISI: UNHEALTHY → giriş yok + duraklama durumu (bir kez) + HEALTH_PAUSED olayı (geçişte); UNKNOWN → giriş yok + HEALTH_UNKNOWN olayı; HEALTHY/INSUFFICIENT → geçer, duraklama varsa
 *  kaldırılır + HEALTH_RECOVERED olayı. Çıkış/koruma bu fonksiyonu çağırmaz (M-1, K-1). Fırlatmaz. */
export async function screenHealth(deps: HealthDeps = {}): Promise<HealthOutcome> {
  const now = deps.now ?? Date.now, store = deps.ledger ?? prismaLedgerStore(), v = await readHealth(deps);
  if (v.state === "UNKNOWN") return { ok: false, refusal: "HEALTH_UNKNOWN", verdict: v, pausedAt: null, event: await stopEngine("HEALTH_UNKNOWN", v.sentence, {}, deps.events) };
  let paused: Date | null = null;
  if (v.ledgerId !== null) { try { paused = await store.healthPause(v.ledgerId); } catch (e) { const u = unknown(`duraklama durumu okunamadı: ${errName(e)}`, v.period); return { ok: false, refusal: "HEALTH_UNKNOWN", verdict: u, pausedAt: null, event: await stopEngine("HEALTH_UNKNOWN", u.sentence, {}, deps.events) }; } }
  if (v.state === "UNHEALTHY") {
    // geçiş yok: olay seli yok (K-8), sebep sicilde + tik kaydında
    if (paused !== null) return { ok: false, refusal: "HEALTH_PAUSED", verdict: v, pausedAt: paused, event: null };
    const at = new Date(now()); let set = false; try { set = v.ledgerId !== null && (await store.setHealthPause(v.ledgerId, at)); } catch { set = false; }
    return { ok: false, refusal: "HEALTH_PAUSED", verdict: v, pausedAt: at, event: await stopEngine("HEALTH_PAUSED", `${v.sentence}${set ? "" : " · duraklama durumu YAZILAMADI (her tikte olay düşebilir)"}`, {}, deps.events) };
  }
  if (paused === null) return { ok: true, verdict: v, event: null };
  let cleared = false; try { cleared = v.ledgerId !== null && (await store.setHealthPause(v.ledgerId, null)); } catch { cleared = false; }
  return { ok: true, verdict: v, event: await stopEngine("HEALTH_RECOVERED", `${v.sentence} · duraklama ${paused.toISOString()} tarihinden beri sürüyordu${cleared ? ", kaldırıldı" : "; durum SİLİNEMEDİ"}`, {}, deps.events) };
}
