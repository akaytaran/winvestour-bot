// OLAY YAYICI (G07 · K-8, K-4, S-2). `engine_events`'e yazan TEK yüzey (kapı: scripts/gate-events.mjs). Sessiz durma yoktur: motoru durduran/duraklatan her yol buradan olay yazar.
// Girdi: kind (şemadaki enum), reason (BOŞ OLAMAZ; DB CHECK son savunma), exchangeResponse (ham, opsiyonel), zaman. Açık pozisyon sayısı verilmezse sayılır (K-8: pozisyon durumu).
// SIR TAŞIMAZ (S-2): gövde (reason + exchangeResponse) yazılmadan ÖNCE taranır; anahtar/zarf/token benzeri içerik varsa YAZILMAZ, hata döner; süreç kaydına da gövde düşmez.
// YAZMA HATASI YUTULMAZ: veritabanına yazılamazsa (1) süreç çıktısına (stderr) yapılandırılmış tek satır JSON düşer, (2) çağıran `ok:false` + `fallback` görür. Dönüş değeri fırlatmaz;
// çağıran onu `await` ile almak ve kullanmak zorundadır (kapı: dönüşü düşüren `void`/beklenmeyen çağrı ve sessiz catch KIRMIZI). Bu modülde console YOKTUR; tek çıkış yolu stderr sink'idir.
import type { EngineEventKind } from "@/generated/prisma/enums";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/db/client";
import { REQUEST_KINDS, STOP_REASONS, type StopReasonCode } from "./stop-reasons";
import { buildNotification, deliverNotification, type NotifyDeps } from "@/lib/notify";
import { scanForSecrets } from "./secret-scan";

export const KINDS = ["STOPPED", "CHAIN_BREAK", "IP_BANNED", "KEY_INVALID", "KEY_EXPIRING", "REGION_BLOCKED", "PROTECTION_FAILED", "BUDGET_EXHAUSTED", "HEALTH_PAUSED", "RESUMED", "POSITION_SKIPPED", "LEVERAGE_REQUEST", "ENTRY_SWITCH_OPENED"] as const satisfies readonly EngineEventKind[];
type KindsComplete = Exclude<EngineEventKind, (typeof KINDS)[number]>; // şemaya tür eklenince bu liste de büyümek zorunda (derleyici)
export const KINDS_COMPLETE: [KindsComplete] extends [never] ? true : never = true;

/** TUR 48 (K-A `winvestor-kaldirac-istegi-ayrintilari`): olayı doğuran İSTEĞİN ayrıntısı — `engine_events.request_details`. KAPALI ANAHTAR LİSTESİ; serbest metin taşıyacak alan YOKTUR.
 *  "kim" istemciden ALINMAZ: erişim sınıfından türeyen sabittir (tek kullanıcı, v1.0). Sembol yalnız büyük harfli çift adı biçiminde; kaldıraç ve tavan pozitif tam sayı ya da null (okunmadı/geçersiz). */
export const LEVERAGE_REQUESTER = "sahip · oturum + TOTP" as const;
export type RequestDetails = { by: typeof LEVERAGE_REQUESTER; symbol: string | null; requestedLeverage: number | null; cap: number | null };
const DETAIL_KEYS = ["by", "cap", "requestedLeverage", "symbol"], DETAIL_SYMBOL = /^[A-Z0-9]{2,20}$/;
const detailInt = (v: unknown) => v === null || (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 9_999);
/** Ayrıntı yalnız İSTEK türünde ve yalnız kapalı biçimde yazılır (veritabanı CHECK'i `engine_events_request_details_closed` son savunmadır). İstek türünde ayrıntı ZORUNLUDUR. */
const requestDetailsOk = (kind: EngineEventKind, d: RequestDetails | null): boolean => {
  if (!(kind in REQUEST_KINDS)) return d === null;
  if (d === null || typeof d !== "object" || Object.keys(d).sort().join() !== DETAIL_KEYS.join()) return false;
  return d.by === LEVERAGE_REQUESTER && (d.symbol === null || (typeof d.symbol === "string" && DETAIL_SYMBOL.test(d.symbol))) && detailInt(d.requestedLeverage) && detailInt(d.cap);
};
export type EventInput = { kind: EngineEventKind; reason: string; exchangeResponse?: unknown; requestDetails?: RequestDetails | null; positionId?: number | null; openPositions?: number | null; at?: Date };
export type EventRow = { kind: EngineEventKind; reason: string; exchangeResponse: unknown; requestDetails: RequestDetails | null; positionId: number | null; openPositions: number | null; at: Date };
export type EmitFailure = "BAD_KIND" | "EMPTY_REASON" | "BAD_BODY" | "SECRET_IN_BODY" | "STORE_UNAVAILABLE";
export type EmitResult = { ok: true; id: number; kind: EngineEventKind; at: Date } | { ok: false; code: EmitFailure; rule?: string; fallback: "stderr" | "none"; kind: EngineEventKind; at: Date };
/** Yazma yüzeyi: üretimde Prisma; kapı/kanarya sahte ya da shadow depo enjekte eder (S-9).
 *  `settle` (Tur 49, G21-f): kabul edilen kaldıraç isteğinin SONUCU aynı satırın sebebine yazılır — yalnız tür istek ve sebep hâlâ `from` ise (koşullu, ikinci satır açılmaz). Yoksa sonuç yazılamaz sayılır. */
export interface EventStore { create(row: EventRow): Promise<{ id: number }>; countOpenPositions(): Promise<number>; settle?(id: number, from: string, to: string): Promise<boolean>; countPending?(from: string): Promise<number> }
export type Deps = { db?: EventStore; sink?: (line: string) => void; now?: () => number; notify?: NotifyDeps };

/** S-2 tarama kuralları ve tarayıcı `./secret-scan`'dedir (Tur 31: Beyin tarayıcıyı bildirim yolunu içe aktarmadan kullanabilsin diye ayrıldı; kurallar DEĞİŞMEDİ). Adlar buradan da dışa aktarılır. */
export { SECRET_RULES, scanForSecrets } from "./secret-scan";

const stderrSink = (line: string) => { process.stderr.write(line); };
/** Prisma yazma yüzeyi. Üretimde istemci getDb(); kanarya shadow istemcisi verir (S-9) — eşleme (DbNull, alanlar) her iki yolda aynı koddur. */
export const prismaEventStore = (client?: PrismaClient): EventStore => {
  const db = () => client ?? getDb();
  return {
    create: async (row) => ({ id: (await db().engineEvent.create({ data: { kind: row.kind, reason: row.reason, exchangeResponse: row.exchangeResponse === null ? Prisma.DbNull : (row.exchangeResponse as Prisma.InputJsonValue), requestDetails: row.requestDetails === null ? Prisma.DbNull : row.requestDetails, positionId: row.positionId, openPositions: row.openPositions, at: row.at }, select: { id: true } })).id }),
    countOpenPositions: () => db().position.count({ where: { status: "OPEN" } }),
    settle: async (id, from, to) => (await db().engineEvent.updateMany({ where: { id, kind: "LEVERAGE_REQUEST", reason: from }, data: { reason: to } })).count === 1,
    countPending: (from) => db().engineEvent.count({ where: { kind: "LEVERAGE_REQUEST", reason: from } }),
  };
};

/** Olay yaz. Sıra: tür → sebep boş mu → gövde JSON → S-2 taraması → açık pozisyon sayısı → veritabanı → (düşerse) stderr kaydı. Asla fırlatmaz; sonucu çağıran kullanır. */
export async function emitEngineEvent(input: EventInput, deps: Deps = {}): Promise<EmitResult> {
  const at = input.at ?? new Date((deps.now ?? Date.now)()), sink = deps.sink ?? stderrSink, kind = input.kind;
  const fail = (code: EmitFailure, rule?: string, row?: EventRow): EmitResult => {
    // Kademe 2: süreç çıktısına yapılandırılmış kayıt. Gövde yalnız taramayı GEÇMİŞSE (row verilmişse) düşer; sır/bozuk gövde hiçbir çıktıya girmez.
    const rec = { engine_event_fallback: true, code, rule, kind, at: at.toISOString(), ...(row ? { reason: row.reason, exchangeResponse: row.exchangeResponse, requestDetails: row.requestDetails, positionId: row.positionId, openPositions: row.openPositions } : {}) };
    let fallback: "stderr" | "none" = "none";
    try { sink(JSON.stringify(rec) + "\n"); fallback = "stderr"; } catch { fallback = "none"; }
    return { ok: false, code, rule, fallback, kind, at };
  };
  if (!(KINDS as readonly string[]).includes(kind)) return fail("BAD_KIND");
  if (typeof input.reason !== "string" || input.reason.trim().length === 0) return fail("EMPTY_REASON");
  const exchangeResponse = input.exchangeResponse === undefined ? null : input.exchangeResponse, requestDetails = input.requestDetails ?? null;
  if (!requestDetailsOk(kind, requestDetails)) return fail("BAD_BODY", "request-details");
  let body: string; try { body = JSON.stringify({ reason: input.reason, exchangeResponse, requestDetails }); } catch { return fail("BAD_BODY", "json"); }
  const hit = scanForSecrets(body); if (hit) return fail("SECRET_IN_BODY", hit);
  const db = deps.db ?? prismaEventStore();
  let openPositions: number | null;
  if (input.openPositions !== undefined) openPositions = input.openPositions;
  else { try { openPositions = await db.countOpenPositions(); } catch { openPositions = null; } } // sayılamadı: bilinmiyor (null), olay yine yazılır
  const row: EventRow = { kind, reason: input.reason, exchangeResponse, requestDetails, positionId: input.positionId ?? null, openPositions, at };
  try { const r = await db.create(row); return { ok: true, id: r.id, kind, at }; }
  catch { return fail("STORE_UNAVAILABLE", undefined, row); }
}

/** Sicildeki bir sebeple durma olayı yaz: reason = `<KOD> · <etiket> · <bildirim sonucu> · <ayrıntı>`. Tür sicilden gelir; çağıran tür seçemez.
 *  G19 (U-2, K-8) — DURMA SEBEBİ → BİLDİRİM, TEK BOĞAZ: bildirim gerektiren her sebep buradan geçer (46 kod; sessiz sınıf `POSITION_SKIPPED` bildirim gerektirmez, M-4).
 *  Bildirim olay yazımından ÖNCE gönderilir ve sonucu AYNI olayın sebebine yazılır: gönderilemeyen bildirim sessizce düşmez (ölçülebilir) ve ikinci bir olay satırı açılmaz (A-9). */
export async function stopEngine(code: StopReasonCode, detail: string, extra: Omit<EventInput, "kind" | "reason"> = {}, deps?: Deps): Promise<EmitResult> {
  const m = STOP_REASONS[code], at = extra.at ?? new Date((deps?.now ?? Date.now)());
  const n = buildNotification(code, at, at.getTime());
  const d = n === null ? null : await deliverNotification(n, deps?.notify);
  return emitEngineEvent({ kind: m.kind, reason: `${code} · ${m.label}${d === null ? "" : ` · ${d.sentence}`} · ${detail}`, ...extra, at }, deps);
}

/** TUR 31 — ANAYASA B-3 GENİŞLETMESİ (iş sahibi, 2026-09-17): Beyin durma olayı YAZMAZ, durma İSTEĞİ döndürür; isteği olaya çeviren KASTIR (zincir) ve çeviri BURADAN geçer.
 *  Böylece bildirim, eleme deposu (Upstash) ve olay yazımı Beyin'in çağrı yığınının DIŞINDA kalır; eleme ve pencereleri değişmeden `stopEngine` boğazında uygulanır. `null` = istek yok (olay yok). */
export type StopRequest = { code: StopReasonCode; detail: string };
export async function stopEngineFor(req: StopRequest | null, deps?: Deps): Promise<EmitResult | null> { if (req === null) return null; return stopEngine(req.code, req.detail, {}, deps); }
/** TUR 65 (S64-1, K1 = [C]) — GİRİŞ ŞALTERİ AÇILDI: hassas eylemin olayı + bildirimi, `stopEngine` ile AYNI boğaz kalıbı (bildirim ÖNCE kurulur ve gönderilir, sonucu AYNI olayın
 *  sebebine yazılır ⇒ ikinci satır yok, gönderilemeyen bildirim sessizce düşmez). Durma DEĞİLDİR: tür istek sicilindedir (`REQUEST_KINDS`), durma sicilinde değil. KAPATMA bunu ÇAĞIRMAZ.
 *  Köprü yokken (Tur 28) sonuç "bildirim=GÖNDERİLEMEDİ (taşıyıcı YAPILANDIRILMADI…)" olur: olay defterde durur, "gönderildi" SAYILMAZ. */
export async function recordEntrySwitchOpened(detail: string, deps?: Deps): Promise<EmitResult> {
  const kind = "ENTRY_SWITCH_OPENED" as const, m = REQUEST_KINDS[kind], at = new Date((deps?.now ?? Date.now)());
  const n = buildNotification(kind, at, at.getTime());
  const d = n === null ? null : await deliverNotification(n, deps?.notify);
  // Ayrıntı Tur 48'in KAPALI biçimidir (istek türünde ZORUNLU; DB CHECK aynı biçimi zorlar): "kim" erişim sınıfından türeyen sabit; sembol/kaldıraç/tavan bu istekte YOKTUR ⇒ null.
  const requestDetails: RequestDetails = { by: LEVERAGE_REQUESTER, symbol: null, requestedLeverage: null, cap: null };
  return emitEngineEvent({ kind, reason: `${kind} · ${m.label}${d === null ? "" : ` · ${d.sentence}`} · ${detail}`, requestDetails, at }, deps);
}
/** Kas kaydına düşen kısa olay notu: sonuç düşürülmez (K-8) — yazılamadıysa kodu görünür. */
export const eventNote = (e: EmitResult | null): string => (e === null ? "yok" : e.ok ? `yazıldı#${e.id}` : `YAZILAMADI:${e.code}`);

/** TUR 48 — KALDIRAÇ İSTEĞİ KAYDI (G21 · K-A `winvestor-kaldirac-istegi-ayrintilari` = [A]; BİLDİRİMSİZ — bildirim yolundan GEÇMEZ). reason = sonuç kodu (ret sebebi; kabul yolu G21-f ile doğar).
 *  Ayrıntı yalnız DOĞRULANMIŞ istekten kurulur: ham istemci girdisi (geçersiz sembol, fazla alan, "kim" iddiası) ayrıntıya GİRMEZ. Sonuç çağırana döner; çağıran kaydı yazılamamış isteği REDDEDER. */
export async function recordLeverageRequest(outcomeCode: string, requested: { symbol: string; leverage: number } | null, cap: number | null, deps?: Deps): Promise<LeverageRecordResult> {
  const requestDetails: RequestDetails = { by: LEVERAGE_REQUESTER, symbol: requested && DETAIL_SYMBOL.test(requested.symbol) ? requested.symbol : null,
    requestedLeverage: requested && detailInt(requested.leverage) ? requested.leverage : null, cap: detailInt(cap) ? cap : null };
  const r = await emitEngineEvent({ kind: "LEVERAGE_REQUEST", reason: outcomeCode, requestDetails }, deps);
  return r.ok ? { ...r, id: r.id as LeverageRecordId } : r;
}

/** TUR 49 — G21 kalemi (f) birinci dilim: DEFTERE YAZILMIŞ istek kaydının kimliği. Markalıdır ve YALNIZ `recordLeverageRequest` basar ⇒ borsaya kaldıraç yazan sürücü (src/lib/orders/futures-driver)
 *  kaydı OLMAYAN bir istekle derlenemez: "kayıt ÖNCE, çağrı SONRA" sırası yorumla değil TİPLE gömülüdür (kapı: marka tek dosyada basılır). */
declare const LEVERAGE_RECORDED: unique symbol;
export type LeverageRecordId = number & { readonly [LEVERAGE_RECORDED]: true };
export type LeverageRecordResult = (Extract<EmitResult, { ok: true }> & { id: LeverageRecordId }) | Extract<EmitResult, { ok: false }>;
/** Kabul edilen isteğin SONUCU (sürücünün yanıt kodu) AYNI satırın sebebine yazılır — `from` (beklemede kodu) hâlâ yerindeyse. Yazılamazsa stderr kaydı düşer ve çağıran sonucu BİLDİRMEZ. */
export async function settleLeverageRequest(id: LeverageRecordId, from: string, to: string, deps: Deps = {}): Promise<{ ok: true } | { ok: false; code: EmitFailure; fallback: "stderr" | "none" }> {
  const sink = deps.sink ?? stderrSink, at = new Date((deps.now ?? Date.now)());
  const fail = (code: EmitFailure) => { let fallback: "stderr" | "none" = "none"; try { sink(JSON.stringify({ engine_event_fallback: true, code, kind: "LEVERAGE_REQUEST", at: at.toISOString(), settle: { id, from, to } }) + "\n"); fallback = "stderr"; } catch { fallback = "none"; } return { ok: false as const, code, fallback }; };
  if (typeof to !== "string" || to.trim().length === 0) return fail("EMPTY_REASON");
  if (scanForSecrets(JSON.stringify({ reason: to }))) return fail("SECRET_IN_BODY");
  const db = deps.db ?? prismaEventStore();
  if (typeof db.settle !== "function") return fail("STORE_UNAVAILABLE");
  try { return (await db.settle(id, from, to)) ? { ok: true } : fail("STORE_UNAVAILABLE"); } catch { return fail("STORE_UNAVAILABLE"); }
}
/** TUR 49 (G21-f): kabul edilen isteğin kaydı sürücü çağrısından ÖNCE bu kodla yazılır; sürücünün sonucu AYNI satıra yazılınca yerini sonuç kodu alır. Kalırsa: sürücüye gidildi, sonucu kaydedilemedi.
 *  Tur 50: sayım bu modülde yapıldığı için sabit buraya taşındı (src/lib/risk-settings/leverage.ts aynı adla dışa aktarır; değer DEĞİŞMEDİ). */
export const LEVERAGE_ACCEPTED_PENDING = "leverage-accepted:driver-pending" as const;
/** TUR 50 (S49-2): BEKLEMEDE kalan istek satırları SAYILABİLİR — sürücüye gidilmiş ama sonucu aynı satıra yazılamamış satırlar. Sayılamazsa `ok:false` döner; 0 sanılmaz (Ö-2).
 *  Beklemede satırı kapatan yol yalnız sürücünün KENDİ dönüşüdür (settleLeverageRequest: oldu · olmadı · bilmiyorum). Borsadan okuyarak kapatma YAZILMADI (K-C; A-5 sonrası, sicil S50-2). */
export async function countPendingLeverageRequests(deps: Deps = {}): Promise<{ ok: true; count: number } | { ok: false }> {
  const db = deps.db ?? prismaEventStore();
  if (typeof db.countPending !== "function") return { ok: false };
  try { const n = await db.countPending(LEVERAGE_ACCEPTED_PENDING); return Number.isInteger(n) && n >= 0 ? { ok: true, count: n } : { ok: false }; } catch { return { ok: false }; }
}
