// PANEL (G18 · Tur 26 · P-2, U-3, U-5, M-5, M-1, K-1, K-7, K-8, Ö-1, Ö-2, A-9). Kapı: scripts/gate-ui.mjs · kanarya: scripts/canary-ui.mts. YALNIZ OKUMA: bu modül hiçbir depoya yazmaz.
// Ö-2 — OKUNAMAYAN DEĞER "BİLİNMİYOR" DER: boş, sıfır ya da "sorun yok" göstermek yasaktır. Her okuma `Reading`'dir: ya `known` + değer + cümle, ya `bilinmiyor` + NEDEN + "sorun yok varsayılmadı".
// U-3 — HAM KOD EKRANA ÇIKMAZ: sebep SİCİLDEN gelir (engine_events satırının yazdığı kod → STOP_REASONS etiketi → PANEL_TEXT'in üç cümlesi: ne oldu · paraya etkisi · ne yapılacak). Yüzey sebep UYDURMAZ.
// P-2 — kâr/zarar taşıyan her satır BRÜT · KOMİSYON · NET üçünü ayrı gösterir; komisyon yalnız `fee_entries.actual` (borsadan okunan gerçek, quote'a çevrilmiş), tahmin değil.
// VERİ KAYNAĞI (rapor madde 1): motor durumu + son tik → YALNIZ Upstash (izin kopyası GET + son tik kaydı LINDEX; tazeleme YOK, yazma YOK ⇒ tik yolunun kopyaları bu yüzden ne uzar ne kısalır).
//   Pozisyon detayı, komisyon kalemi, kapanış sebebi, sağlık → Neon: kopya bu alanları TAŞIMAZ (kopyada yalnız tikin ihtiyacı var) ve panel sağlık için Neon'u zaten uyandırır ⇒ pozisyonu da
//   aynı uyanışta okumak açılış başına Neon UYANIŞINI artırmaz. Ölçüm ve günlük açılış varsayımı raporda AÇIK yazılıdır.
import { type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/db/client";
import { CHAIN_NS, CRON_PERIOD_MS, chainKeys, type TickRecord } from "@/lib/chain";
import { type ControlDoc, type PermitDenial, upstashFlagStore } from "@/lib/engine-control";
import { STOP_REASONS, type StopReasonCode } from "@/lib/events/stop-reasons";
import { readHealth, type HealthDeps, type HealthVerdict } from "@/lib/health";
import { giveBackLevel } from "@/lib/protection/trailing";
import { pickEnv } from "@/lib/env";
import { notifyState, type NotifyStateView } from "@/lib/notify";
import { redisPipeline } from "@/lib/upstash";
import { fill } from "@/lib/i18n";
import { srvFor, RECORD_LANG } from "@/lib/i18n/srv";

export type Level = "OK" | "INFO" | "WARN" | "ALARM";
const RANK: Record<Level, number> = { ALARM: 3, WARN: 2, INFO: 1, OK: 0 };
/** Bir hâlin ekran metni (U-3): ne oldu · paraya etkisi ne · ne yapılacak. Üçü de zorunlu; ham kod ya da "HATA" sözcüğü yoktur. */
export type PanelText = { level: Level; title: string; what: string; money: string; next: string };
/** Tur 77 (G32 parça 2, sade dil): uyarı kartı sebep KODUNU ve (varsa) sembolü de taşır — istemci sade dil cümlesini sözlükten KODLA seçer, cümleyi ayrıştırmaz (ek alan; hesap değişmez). */
export type Card = { level: Level; title: string; lines: string[]; code?: string; symbol?: string };
const say = (t: PanelText): string[] => [t.what, t.money, t.next];
// TUR 79 (G34 · S5): cümleler SUNUCU SÖZLÜĞÜNDEN (src/lib/i18n/srv) — bu dosyada Türkçe (ya da başka dilde) cümle yok (gate:i18n (16)). Dil parametresi verilmezse İÇ KAYIT DİLİ (tr):
//   iç çağrı (kanarya/kapı) bugünkü Türkçe cümlesini alır; uç (`/api/panel`) isteğin dilini geçer. Seviye (level) dilden bağımsızdır ve burada durur.
const S = (lang: string) => srvFor(lang), PL = (lang: string) => srvFor(lang).panel;
/** Ö-2: okunamayan değerin TEK yazılış biçimi. "Sorun yok" ya da 0 ASLA yazılmaz. */
export const unknownText = (what: string, why: string, lang: string = RECORD_LANG): string => fill(S(lang).common.unknown, { what, why });

/** İZİN KOPYASININ DÖRT REDDİ — seviye burada, cümle sözlükte. Record TAM: yeni bir reddediş eklenirse derleyici burayı da zorlar. */
const PERMIT_LEVEL: Record<PermitDenial, Level> = { UNREADABLE: "ALARM", NO_PERMIT: "WARN", STOPPED: "WARN", PERMIT_EXPIRED: "WARN" };
export const permitText = (lang: string = RECORD_LANG): Record<PermitDenial, PanelText> =>
  Object.fromEntries((Object.keys(PERMIT_LEVEL) as PermitDenial[]).map((k) => [k, { level: PERMIT_LEVEL[k], ...PL(lang).permit[k] }])) as Record<PermitDenial, PanelText>;
export const PERMIT_TEXT: Record<PermitDenial, PanelText> = permitText();
/** SİCİLDEKİ SEBEBİN EKRAN KARŞILIĞI. Anahtarlar STOP_REASONS sicilinden gelir (derleyici zorlar): yüzey sebep uyduramaz, yalnız sicildeki kodu insan cümlesine çevirir. */
const TEXT_LEVEL = {
  STOP_BUTTON: "WARN", POSITIONS_UNKNOWN: "ALARM", POSITION_COPY_MISMATCH: "WARN", MARKET_FEED_DOWN: "WARN", BRAIN_SETTINGS_UNREADABLE: "WARN", BRAIN_SPEND_CEILING: "INFO", FEE_BUDGET_EXHAUSTED: "INFO",
  HEALTH_PAUSED: "WARN", HEALTH_UNKNOWN: "ALARM", PROTECTION_LOST: "ALARM", PROTECTION_UNVERIFIABLE: "ALARM", TICK_MISSED: "WARN", CHAIN_BREAK: "WARN",
} as const satisfies Partial<Record<StopReasonCode, Level>>;
type TextCode = keyof typeof TEXT_LEVEL;
export const panelText = (lang: string = RECORD_LANG): Record<TextCode, PanelText> =>
  Object.fromEntries((Object.keys(TEXT_LEVEL) as TextCode[]).map((k) => [k, { level: TEXT_LEVEL[k], ...(PL(lang).text as Record<TextCode, Omit<PanelText, "level">>)[k] }])) as Record<TextCode, PanelText>;
export const PANEL_TEXT: Record<TextCode, PanelText> = panelText();
/** Madde 3'ün sekiz hâli EKRAN METNİ OLMADAN kalamaz: eksikse `never`'a `true` atanamaz ve derleme düşer. */
type MissingText = Exclude<"POSITIONS_UNKNOWN" | "MARKET_FEED_DOWN" | "BRAIN_SETTINGS_UNREADABLE" | "BRAIN_SPEND_CEILING" | "HEALTH_PAUSED" | "PROTECTION_LOST" | "PROTECTION_UNVERIFIABLE" | "STOP_BUTTON", TextCode>;
export const EVERY_REQUIRED_STATE_HAS_TEXT: [MissingText] extends [never] ? true : never = true;
/** Sicildeki koddan ekran metni. Kod sicilde yoksa metin UYDURULMAZ: sicilin kendi etiketi (sicil metni, çevrilmez) cümlenin içinde durur; o da yoksa null. */
export function textOf(code: string | null, lang: string = RECORD_LANG): PanelText | null {
  if (code === null) return null;
  const t = (panelText(lang) as Partial<Record<string, PanelText>>)[code]; if (t) return t;
  const m = (STOP_REASONS as Record<string, { label: string } | undefined>)[code], f = PL(lang).fallback;
  return m ? { level: "WARN", title: f.title, what: fill(f.what, { label: m.label }), money: f.money, next: f.next } : null;
}
/** Sicil satırının yazdığı kod (`KOD · etiket · ayrıntı`). Ayrıntı EKRANA ÇIKMAZ (U-3: ham metin/kod göstermeyiz), yalnız kod sicilden okunur. */
export const codeOf = (reason: string): string | null => { const c = reason.split(" · ")[0]?.trim() ?? ""; return /^[A-Z][A-Z0-9_]{2,}$/.test(c) ? c : null; };

// ---- OKUYUCULAR (hepsi SALT OKUMA; enjeksiyon yalnız kapı/kanarya için, S-9) ----
export type StopRow = { id: number; reason: string; at: Date };
export type PositionRow = { id: number; symbol: string; status: string; entry: string; qty: string; peak: string | null; pid: string | null; openedAt: Date; closedAt: Date | null; realized: string; fees: string; lastReason: string | null };
export type PanelDeps = { ceilings?: () => Promise<{ totalPct: string | null; singlePct: string | null }>; capital?: () => Promise<{ capital: string | null; quoteAsset: string; periodStart: string } | null>; permit?: () => Promise<ControlDoc | null>; tick?: () => Promise<TickRecord | null>; rows?: () => Promise<PositionRow[]>; stop?: () => Promise<StopRow | null>; health?: () => Promise<HealthVerdict>; healthDeps?: HealthDeps; now?: () => number };
/** İzin kopyası: TEK `GET`. Tazeleme YOK (tazeleme Neon'u uyandırır ve tikin işidir), yazma YOK ⇒ kopyanın ömrü bu açılıştan etkilenmez. */
export const upstashPermitRead = () => upstashFlagStore().read();
/** G32 (Tur 76): iki risk payı (K-9) — YALNIZ OKUMA, tek satır id=1. Satır yoksa ikisi de null (boş ≠ okunamadı; okunamazsa tryRead "okunamadı" der). Yazan uç YOKTUR (ölçüldü). */
export const prismaRiskCaps = (client?: PrismaClient) => async () => { const r = await (client ?? getDb()).riskProfile.findUnique({ where: { id: 1 }, select: { maxSinglePositionPct: true, maxTotalExposurePct: true } });
  return { singlePct: r?.maxSinglePositionPct == null ? null : String(r.maxSinglePositionPct), totalPct: r?.maxTotalExposurePct == null ? null : String(r.maxTotalExposurePct) }; };
/** G32 (Tur 76): komisyon defterinin SON dönem satırındaki hesap değeri (dönem açılışında ölçülmüş; bugünkü serbest bakiye DEĞİLDİR, ekranda böyle yazılır). YALNIZ OKUMA. */
export const prismaLastCapital = (client?: PrismaClient) => async () => { const r = await (client ?? getDb()).feeLedger.findFirst({ orderBy: { id: "desc" }, select: { capital: true, quoteAsset: true, periodStart: true } });
  return r ? { capital: r.capital === null ? null : String(r.capital), quoteAsset: r.quoteAsset, periodStart: r.periodStart.toISOString() } : null; };
/** Son tik kaydı: TEK `LINDEX` (liste başı). Tik listesine yazılmaz. */
export const upstashLastTick = async (): Promise<TickRecord | null> => { const e = pickEnv("UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"); // DAR sözleşme (K-7 dersi): ilgisiz bir değişkenin eksikliği paneli kör etmesin
  const v = (await redisPipeline([["LINDEX", chainKeys(CHAIN_NS).ticks, 0]], { url: e.UPSTASH_REDIS_REST_URL, token: e.UPSTASH_REDIS_REST_TOKEN }))[0]; return typeof v === "string" && v ? (JSON.parse(v) as TickRecord) : null; };
/** Pozisyon detayı — TEK Neon sorgusu: açık + kapanmış satırlar, pozisyon başına GERÇEK dolum toplamı ve GERÇEK komisyon (fee_entries.actual), son sicil sebebi. Tahmin yok (Ö-1, P-2). */
export const prismaPositionRows = (client?: PrismaClient) => async (): Promise<PositionRow[]> => (client ?? getDb()).$queryRaw<PositionRow[]>`
  SELECT p.id, p.symbol, p.status::text AS status, p.entry_price::text AS entry, p.quantity::text AS qty, p.peak_price::text AS peak, p.protection_order_id AS pid, p.opened_at AS "openedAt", p.closed_at AS "closedAt",
    (SELECT COALESCE(SUM(CASE WHEN o.side = 'SELL' THEN 1 ELSE -1 END * COALESCE((o.raw_response->>'cummulativeQuoteQty')::numeric, o.quantity * o.price, 0)), 0) FROM orders o WHERE o.position_id = p.id AND o.status <> 'TEST')::text AS realized,
    (SELECT COALESCE(SUM(COALESCE(fe.actual, 0)), 0) FROM orders o2 JOIN fee_entries fe ON fe.ref = o2.client_order_id WHERE o2.position_id = p.id AND o2.status <> 'TEST')::text AS fees,
    (SELECT ev.reason FROM engine_events ev WHERE ev.position_id = p.id ORDER BY ev.id DESC LIMIT 1) AS "lastReason"
  FROM positions p WHERE p.status::text = 'OPEN' OR p.closed_at IS NOT NULL ORDER BY (p.status::text = 'OPEN') DESC, COALESCE(p.closed_at, p.opened_at) DESC LIMIT 20`;
/** Son DURMA/duraklama kaydı — sebebin TEK kaynağı sicildir (K-8). */
export const prismaLastStop = (client?: PrismaClient) => async (): Promise<StopRow | null> => ((await (client ?? getDb()).$queryRaw<StopRow[]>`
  SELECT id, reason, at FROM engine_events WHERE kind::text IN ('STOPPED','HEALTH_PAUSED','BUDGET_EXHAUSTED','PROTECTION_FAILED','CHAIN_BREAK','REGION_BLOCKED','IP_BANNED','KEY_INVALID','RESUMED') ORDER BY id DESC LIMIT 1`)[0] ?? null);

// ---- CÜMLE KURUCULAR ----
const n2 = (v: string | number) => Number(v).toFixed(2), n8 = (v: string | number) => Number(v).toFixed(8);
/** Süre insan birimine çevrilir ve İŞARETSİZDİR: yön cümleyi kuran taraftadır (`when` = geçmiş, `till` = gelecek). Negatif sayı ekrana çıkamaz (U-3). Eşikler Tur 26'daki gibi; birim sözcüğü sözlükten. */
const dk = (ms: number, lang: string) => { const a = Math.abs(ms), u = S(lang).units; return a < 90_000 ? fill(u.second, { n: Math.round(a / 1000) }) : a < 5_400_000 ? fill(u.minute, { n: Math.round(a / 60_000) }) : fill(u.hour, { n: (a / 3_600_000).toFixed(1) }); };
const stamp = (t: number | string | Date) => `${new Date(t).toISOString().replace("T", " ").slice(0, 19)} UTC`;
const when = (t: number | string | Date, now: number, lang: string) => fill(S(lang).common.ago, { stamp: stamp(t), d: dk(now - new Date(t).getTime(), lang) });
/** Gelecekteki an. Geçmişte kalmışsa "önce" der — "eksi 600 saniye sonra" gibi bir cümle kurulamaz. */
const till = (t: number, now: number, lang: string) => (t >= now ? fill(S(lang).common.later, { stamp: stamp(t), d: dk(t - now, lang) }) : fill(S(lang).common.passed, { stamp: stamp(t), d: dk(now - t, lang) }));
/** P-2: brüt · komisyon · net AYRI AYRI. Brüt ölçülemiyorsa net de yazılmaz (Ö-2) ama ödenen komisyon yine ayrı kalem olarak görünür. */
export function pnlLine(gross: string | null, fees: string, what: string, lang: string = RECORD_LANG): string {
  const f = n8(fees), P = PL(lang).pnl;
  if (gross === null) return fill(P.noGross, { what, unknown: unknownText(P.grossWhat, P.grossWhy, lang), fee: f });
  const g = Number(gross), net = g - Number(fees);
  const oran = g > 0 ? fill(P.ratio, { pct: ((Number(fees) / g) * 100).toFixed(1) }) : g === 0 ? P.zero : P.loss;
  return fill(P.line, { what, gross: n8(gross), fee: f, net: n8(net), ratio: oran });
}

/** U-3 — VERİ METNE GÖMÜLMEZ: ekranda cümle, kayıtta ALAN. Okunamayan alan `null`'dır (0 değil, Ö-2); brüt/komisyon/net ayrı alanlardır (P-2). */
export type PositionFacts = { entryPrice: string; quantity: string; notionalUsdt: string; peakPrice: string | null; giveBackLevel: string | null; protectionOrderId: string | null; protectionState: string | null; protectionCheckedAt: string | null; markPrice: string | null; grossUsdt: string | null; feeUsdt: string; netUsdt: string | null };
/** Tur 79: `alarmLines` — satırlardan hangilerinin koruma alarmı olduğu (dizin). Uyarı kartı bu satırları DİZİNLE alır; eskiden Türkçe cümle deseniyle ayıklanıyordu (dil değişince kırılırdı). */
export type PositionView = { id: number; symbol: string; open: boolean; level: Level; alarm: "PROTECTION_LOST" | "PROTECTION_UNVERIFIABLE" | null; title: string; lines: string[]; alarmLines: number[]; facts: PositionFacts; openedAt: string; closedAt: string | null; reasonCode: string | null };
/** Bir pozisyonun satırları. `quote`: son tikte ÖLÇÜLEN orta fiyat (yoksa açık pozisyonun anlık kâr/zararı BİLİNMİYOR olur, 0 yazılmaz). `audit`: son tikin borsa doğrulaması. */
export function viewPosition(r: PositionRow, quote: { mid: string; at: number } | null, audit: { state: string; status: string | null; at: number } | null, now: number, lang: string = RECORD_LANG): PositionView {
  const open = r.status === "OPEN", lines: string[] = [], alarmLines: number[] = [], qty = Number(r.qty), entry = Number(r.entry), P = PL(lang).position;
  let level: Level = open ? "OK" : "INFO", alarm: "PROTECTION_LOST" | "PROTECTION_UNVERIFIABLE" | null = null;
  const alarmLine = (l: string) => { alarmLines.push(lines.length); lines.push(l); };
  lines.push(fill(P.head, { symbol: r.symbol, qty: n8(r.qty), entry: n8(r.entry), notional: n2(qty * entry), opened: when(r.openedAt, now, lang) }));
  const peak = r.peak === null ? null : Number(r.peak);
  lines.push(peak === null ? unknownText(P.peakWhat, P.peakWhy, lang)
    : fill(P.peak, { peak: n8(r.peak as string), pct: (((peak - entry) / entry) * 100).toFixed(2), moves: open ? P.movesOpen : P.movesClosed }));
  const gb = r.peak === null ? null : giveBackLevel(r.entry, r.peak);
  lines.push(gb === null ? P.noGiveBack : fill(open ? P.giveBackOpen : P.giveBackClosed, { level: n8(gb) }));
  if (open) {
    if (r.pid === null) { level = "ALARM"; alarm = "PROTECTION_LOST"; alarmLine(P.noProtectionId); }
    else if (audit === null) lines.push(fill(P.auditNone, { pid: r.pid, unknown: unknownText(P.auditWhat, P.auditWhy, lang) }));
    else if (audit.state === "PROTECTED") lines.push(fill(P.protected, { pid: r.pid, when: when(audit.at, now, lang), status: audit.status }));
    else if (audit.state === "FILLED") { level = "WARN"; lines.push(fill(P.filled, { pid: r.pid, when: when(audit.at, now, lang) })); }
    else if (audit.state === "UNVERIFIABLE") { level = "ALARM"; alarm = "PROTECTION_UNVERIFIABLE"; alarmLine(fill(P.unverifiable, { pid: r.pid, when: when(audit.at, now, lang) })); }
    else { level = "ALARM"; alarm = "PROTECTION_LOST"; alarmLine(fill(P.gone, { pid: r.pid, when: when(audit.at, now, lang) })); }
    const g = quote === null ? null : String((Number(quote.mid) - entry) * qty);
    lines.push(quote === null ? `${unknownText(P.pnlWhat, P.pnlWhy, lang)} ${fill(P.pnlFee, { fee: n8(r.fees) })}` : `${fill(P.lastPrice, { mid: n8(quote.mid), when: when(quote.at, now, lang) })} ${pnlLine(g, r.fees, P.ifClosedNow, lang)}`);
  } else {
    if (r.closedAt !== null && r.closedAt.getTime() < r.openedAt.getTime()) { level = "WARN"; lines.push(fill(P.contradiction, { closed: stamp(r.closedAt), opened: stamp(r.openedAt) })); }
    lines.push(fill(P.closed, { when: r.closedAt === null ? P.closedTimeUnknown : when(r.closedAt, now, lang), reason: textOf(r.lastReason === null ? null : codeOf(r.lastReason), lang)?.title ?? (r.status === "CLOSED" ? P.reasonNoRecord : P.reasonImmediate) }));
    lines.push(pnlLine(r.realized, r.fees, P.result, lang));
  }
  const grossUsdt = open ? (quote === null ? null : n8(String((Number(quote.mid) - entry) * qty))) : n8(r.realized);
  const facts: PositionFacts = { entryPrice: n8(r.entry), quantity: n8(r.qty), notionalUsdt: n2(qty * entry), peakPrice: r.peak === null ? null : n8(r.peak), giveBackLevel: gb === null ? null : n8(gb),
    protectionOrderId: r.pid, protectionState: audit?.state ?? null, protectionCheckedAt: audit === null ? null : new Date(audit.at).toISOString(), markPrice: quote === null ? null : n8(quote.mid),
    grossUsdt, feeUsdt: n8(r.fees), netUsdt: grossUsdt === null ? null : n8(String(Number(grossUsdt) - Number(r.fees))) };
  return { id: r.id, symbol: r.symbol, open, level, alarm, title: fill(open ? P.titleOpen : P.titleClosed, { symbol: r.symbol }), lines, alarmLines, facts, openedAt: new Date(r.openedAt).toISOString(), closedAt: r.closedAt === null ? null : new Date(r.closedAt).toISOString(), reasonCode: r.lastReason === null ? null : codeOf(r.lastReason) };
}

/** G32 (Tur 76): motorun hâli — panelin durum kartının TEK kaynağı; izin okumasının reddinden türetilir (PERMIT_EXPIRED ⇒ NO_PERMIT: ikisinde de izin yok). İstemci hâli başlık/cümleden tahmin ETMEZ. */
export type EngineState = "RUNNING" | "STOPPED" | "NO_PERMIT" | "UNKNOWN";
export type RiskCaps = { ok: true; singlePct: string | null; totalPct: string | null } | { ok: false; why: string };
export type CapitalView = { ok: true; capital: string | null; quoteAsset: string | null; periodStart: string | null } | { ok: false; why: string };
/** Tur 77 (G32 parça 2): Durum sekmesinin "bir bakışta" satırları için YAPILANDIRILMIŞ özet — aynı okumalardan (yeni sorgu YOK). Okunamayan alan null ya da `read: false` (0 değil, Ö-2). */
export type PanelSummary = { tick: { read: false } | { read: true; at: string | null; late: boolean | null }; openPositions: number | null; lastStop: { read: false } | { read: true; code: string | null; at: string | null };
  health: { state: string; feesUsdt: string; period: string } | null };
export type PanelView = { notifications: NotifyStateView; engineState: EngineState; riskCaps: RiskCaps; capital: CapitalView; at: string; engine: Card; tick: Card; health: Card; positions: { card: Card; rows: PositionView[] }; alerts: Card[]; sources: string[]; summary: PanelSummary };
const card = (level: Level, title: string, lines: string[]): Card => ({ level, title, lines });
/** PANELİN TAMAMI. Fırlatmaz: her okuma ayrı ayrı denenir, düşen okuma "bilinmiyor" olur (Ö-2) ve diğerleri yine gösterilir. `lang`: cümlelerin dili (uç isteğin dilini geçer; yoksa iç kayıt dili). */
export async function readPanel(deps: PanelDeps = {}, lang: string = RECORD_LANG): Promise<PanelView> {
  const now = (deps.now ?? Date.now)(), alerts: Card[] = [], sources: string[] = [], P = PL(lang), R = P.reads, PT = panelText(lang), PM = permitText(lang);
  const tryRead = async <T>(what: string, fn: () => Promise<T>): Promise<{ ok: true; v: T } | { ok: false; why: string }> => { try { return { ok: true, v: await fn() }; } catch (e) { return { ok: false, why: fill(S(lang).common.readFailed, { what, name: (e as { name?: string })?.name ?? "error" }) }; } };
  const [permit, tick, rows, stop, health, caps, capital] = await Promise.all([
    tryRead(R.permit, deps.permit ?? upstashPermitRead), tryRead(R.tick, deps.tick ?? upstashLastTick),
    tryRead(R.rows, deps.rows ?? prismaPositionRows()), tryRead(R.stop, deps.stop ?? prismaLastStop()),
    tryRead(R.health, deps.health ?? (() => readHealth(deps.healthDeps, lang))),
    tryRead(R.caps, deps.ceilings ?? prismaRiskCaps()), tryRead(R.capital, deps.capital ?? prismaLastCapital()),
  ]);
  sources.push(...P.sources);
  // 1 — MOTOR: çalışıyor mu, çalışmıyorsa NEDEN (sebep sicilden, yüzeyden uydurulmaz)
  const stopText = stop.ok && stop.v !== null ? textOf(codeOf(stop.v.reason), lang) : null;
  let engine: Card, running: boolean | null = null, engineState: EngineState = "UNKNOWN"; // null = izin okunamadı ⇒ motorun çalışıp çalışmadığı BİLİNMİYOR
  if (!permit.ok) engine = card(PM.UNREADABLE.level, PM.UNREADABLE.title, [...say(PM.UNREADABLE), unknownText(P.engine.unknownWhat, permit.why, lang)]);
  else {
    const d = permit.v, until = d?.permitUntil === null || d?.permitUntil === undefined ? 0 : Date.parse(d.permitUntil);
    const denial: PermitDenial | null = d === null ? "NO_PERMIT" : d.state === "STOPPED" ? "STOPPED" : until > now ? null : "PERMIT_EXPIRED";
    running = denial === null; engineState = denial === null ? "RUNNING" : denial === "STOPPED" ? "STOPPED" : "NO_PERMIT";
    if (denial === null) engine = card("OK", P.engine.runningTitle, [fill(P.engine.running, { till: till(until, now, lang) }), fill(P.engine.granted, { when: when((d as ControlDoc).at, now, lang) }), P.engine.runningDoes]);
    else { const t = PM[denial]; engine = card(t.level, t.title, [...say(t), stopText === null ? P.engine.noRecord : fill(P.engine.lastRecord, { title: stopText.title, what: stopText.what, when: when((stop.ok && stop.v ? stop.v.at : now), now, lang) })]); }
  // MOTOR kartı uyarı listesine KOPYALANMAZ: sayfa onu zaten en üstte gösterir; aynı üç cümleyi iki kez yazmak "kayıt kendisiyle çelişiyor mu" sorusunu doğuruyordu (İKİ GÖZ, Tur 26 madde 7).
  }
  // 2 — SON TUR: ne zaman atıldı, gecikme var mı (K-8), piyasa akışı açık mı
  let tickRec: TickRecord | null = null;
  const tickLines: string[] = [], K = P.tick;
  if (!tick.ok) tickLines.push(unknownText(K.what, tick.why, lang));
  else if (tick.v === null) tickLines.push(unknownText(K.what, K.none, lang));
  else { tickRec = tick.v; const gap = now - tickRec.at, budget = tickRec.tickMs + CRON_PERIOD_MS;
    tickLines.push(fill(K.line, { when: when(tickRec.at, now, lang), ms: tickRec.durationMs, interval: dk(tickRec.tickMs, lang) }));
    // Motor çalışmıyorken tur atılmaması BEKLENEN durumdur: gecikme hükmü yalnız çalışan motorda verilir, yoksa durdurma kendi kendine "gecikme" uyarısı doğururdu (kayıt kendisiyle çelişmez).
    tickLines.push(running === false ? fill(K.stopped, { gap: dk(gap, lang) })
      : running === null ? unknownText(K.lateWhat, K.lateWhy, lang)
      : gap > budget ? fill(K.late, { gap: dk(gap, lang), budget: dk(budget, lang) })
      : fill(K.notLate, { gap: dk(gap, lang), budget: dk(budget, lang) }));
    tickLines.push(tickRec.market === null ? unknownText(K.feedWhat, K.feedWhy, lang) : tickRec.market.ok ? fill(K.feedOk, { n: (tickRec.market.quotes ?? []).length }) : say(PT.MARKET_FEED_DOWN)[0]);
    if (tickRec.market !== null && !tickRec.market.ok) alerts.push({ ...card(PT.MARKET_FEED_DOWN.level, PT.MARKET_FEED_DOWN.title, say(PT.MARKET_FEED_DOWN)), code: "MARKET_FEED_DOWN" });
    if (tickRec.late !== null && running !== false) alerts.push({ ...card(PT.TICK_MISSED.level, PT.TICK_MISSED.title, [...say(PT.TICK_MISSED), fill(K.gap, { gap: dk(tickRec.late.gapMs, lang) })]), code: "TICK_MISSED" });
    if (tickRec.copy?.quarantined) alerts.push({ ...card(PT.POSITION_COPY_MISMATCH.level, PT.POSITION_COPY_MISMATCH.title, say(PT.POSITION_COPY_MISMATCH)), code: "POSITION_COPY_MISMATCH" });
    if (tickRec.positionsSource === "unknown") alerts.push({ ...card(PT.POSITIONS_UNKNOWN.level, PT.POSITIONS_UNKNOWN.title, say(PT.POSITIONS_UNKNOWN)), code: "POSITIONS_UNKNOWN" });
  }
  const tickCard = card(!tick.ok || tick.v === null ? "WARN" : running !== false && tickRec !== null && now - tickRec.at > tickRec.tickMs + CRON_PERIOD_MS ? "WARN" : "OK", K.title, tickLines);
  // 3 — SAĞLIK (G17): oran, eşik, kalan pay — hepsi ölçülen defterden
  let healthCard: Card; const H = P.health;
  if (!health.ok) healthCard = card("ALARM", PT.HEALTH_UNKNOWN.title, [...say(PT.HEALTH_UNKNOWN), unknownText(H.ratioWhat, health.why, lang)]);
  else { const v = health.v, t = v.state === "UNHEALTHY" ? PT.HEALTH_PAUSED : v.state === "UNKNOWN" ? PT.HEALTH_UNKNOWN : null;
    const pay = v.ratio === null || v.state === "UNKNOWN" ? null : Number(v.threshold) - Number(v.ratio);
    healthCard = card(t === null ? "OK" : t.level, t === null ? H.okTitle : t.title, [
      v.sentence,
      v.state === "UNKNOWN" ? unknownText(H.marginWhat, H.marginWhy, lang) : pay === null ? fill(H.noProfit, { fees: n2(v.fees), floor: n2(v.floor) }) : fill(pay >= 0 ? H.below : H.above, { pay: Math.abs(pay).toFixed(4) }),
      ...(t === null ? [] : say(t))]);
    // SAĞLIK kartı da kopyalanmaz (aynı gerekçe); seviyesi zaten kartın kendisinde.
  }
  // 4 — POZİSYONLAR (P-2: her kâr/zarar satırı brüt · komisyon · net)
  const quotes = (tickRec?.market?.ok ? tickRec.market.quotes : undefined) ?? [], quoteAt = tickRec?.market?.at ?? null, O = P.positions;
  const auditOf = (id: number) => { const a = tickRec?.protection?.rows.find((x) => x.positionId === id); return a === undefined || tickRec === null ? null : { state: a.state, status: a.status, at: tickRec.at }; };
  let posCard: Card, views: PositionView[] = [];
  if (!rows.ok) posCard = card("ALARM", O.title, [unknownText(O.what, rows.why, lang)]);
  else { views = rows.v.map((r) => { const q = quotes.find((x) => x.symbol === r.symbol); return viewPosition(r, q && quoteAt !== null ? { mid: q.mid, at: Date.parse(quoteAt) } : null, auditOf(r.id), now, lang); });
    const openN = views.filter((v) => v.open).length, worst = views.reduce<Level>((a, v) => (RANK[v.level] > RANK[a] ? v.level : a), "OK");
    const tikKopyasiYok = tickRec?.positionsSource === "unknown";
    posCard = card(worst, O.title, [openN === 0 ? O.noOpen : fill(O.someOpen, { n: openN }),
      ...(tikKopyasiYok ? [O.copyUnknown] : []), views.length - openN === 0 ? O.noClosed : fill(O.someClosed, { n: views.length - openN })]);
    for (const v of views.filter((x) => x.alarm !== null)) { const t = PT[v.alarm as "PROTECTION_LOST" | "PROTECTION_UNVERIFIABLE"]; alerts.push({ ...card(t.level, `${t.title} — ${v.symbol}`, [...say(t), ...v.alarmLines.map((i) => v.lines[i])]), code: v.alarm as string, symbol: v.symbol }); }
  }
  alerts.sort((a, b) => RANK[b.level] - RANK[a.level]);
  const riskCaps: RiskCaps = caps.ok ? { ok: true, singlePct: caps.v.singlePct, totalPct: caps.v.totalPct } : { ok: false, why: caps.why };
  const capitalView: CapitalView = !capital.ok ? { ok: false, why: capital.why } : capital.v === null ? { ok: true, capital: null, quoteAsset: null, periodStart: null } : { ok: true, capital: capital.v.capital, quoteAsset: capital.v.quoteAsset, periodStart: capital.v.periodStart };
  const summary: PanelSummary = {
    tick: !tick.ok ? { read: false } : { read: true, at: tickRec === null ? null : new Date(tickRec.at).toISOString(), late: tickRec === null || running !== true ? null : now - tickRec.at > tickRec.tickMs + CRON_PERIOD_MS },
    openPositions: rows.ok ? views.filter((x) => x.open).length : null,
    lastStop: !stop.ok ? { read: false } : { read: true, code: stop.v === null ? null : codeOf(stop.v.reason), at: stop.v === null ? null : new Date(stop.v.at).toISOString() },
    health: health.ok ? { state: health.v.state, feesUsdt: health.v.fees, period: health.v.period } : null };
  // Tur 82 (D2): bildirim eklentisinin durumu yalnız ad sözleşmesinden (Neon/Upstash okuması YOK ⇒ açılış maliyeti değişmez); değer taşımaz.
  return { notifications: notifyState(), engineState, riskCaps, capital: capitalView, at: new Date(now).toISOString(), engine, tick: tickCard, health: healthCard, positions: { card: posCard, rows: views }, alerts, sources, summary };
}
