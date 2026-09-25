// BEYİN AYARLARI + FİYAT TABLOSU + MALİYET HESAPLAYICISI (Tur 25 · madde 1, 2, 4, 5 · A-1, A-9, M-1, M-4, Ö-1, Ö-2, Ö-3, U-3, U-4, E-1, S-8).
// Kapı: scripts/gate-brain-settings.mjs · kanarya: scripts/canary-brain-settings.mts.
// İŞ SAHİBİ TALİMATI (2026-09-11): "bunu panelden seçebileyim. maliyetleri de seçeneği de parametrik yap ayarlara koy" ⇒ model, çağrı sıklığı ve girdi büyüklüğü KOD DEĞİL AYARDIR,
//   her seçeneğin aylık maliyeti yüzeyde görünür. Bu modül ayarın TEK OKUMA YOLUDUR (kapı: ikinci okuyucu KIRMIZI); Beyin modülü ayarı kendi okumaz, çalışma değerini çağırandan alır.
// KAPALI ARIZA (Ö-2): ayar okunamaz ya da satır yoksa Beyin ÇAĞRILMAZ ve olay yazılır — "varsayılana düş" YASAKTIR (sessiz varsayılan = ölçülmemiş maliyet).
// AÇIK LİSTE: model adı serbest metin değildir; fiyat tablosunda karşılığı olmayan model REDDEDİLİR (maliyeti bilinmeyen model seçilemez). Sıklık/aday/mum sınırları TÜRETİLMİŞTİR (aşağıda).
// FİYAT VERİDİR, KOD DEĞİL (Ö-1): her satır kaynak URL'si ve OKUMA TARİHİ taşır; okuma tarihi bu DÖNEMDEN (PERIOD_BASIS = UTC takvim ayı) eskiyse satır "eski" işaretlenir ve yüzeyde görünür.
// HARCAMA TAVANI (madde 4): aylık $ tavanı ve günlük çağrı tavanı ayardır; NULL ise TÜRETİLİR. Tavan ÇAĞRIDAN ÖNCE denetlenir (Beyin modülü); aşılırsa çağrı yapılmaz, yeni pozisyon
//   açılmaz — ÇIKIŞ ve borsadaki KORUMA çalışmaya devam eder (M-1, K-1: bu modül çıkış/koruma yollarından çağrılmaz).
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/db/client";
import { RULE_BOUNDS } from "@/lib/brain/schema";
import { stopEngine, type Deps as EventDeps, type EmitResult } from "@/lib/events";
import { PERIOD_BASIS, periodOf } from "@/lib/fee-ledger";
import { PERMIT_REFRESH_MS } from "@/lib/engine-control";
// TUR 67: tik aralığının seçenek kümesi zincirde TÜRETİLİR (cron dönemi + tazeleme payı; gate:chain `setting-shape`). Zincir de bu modülü içe aktarır (Beyin ayarı) ⇒ DÖNGÜSEL içe aktarma:
//   `TICK_CHOICES_MS` bu modülde YALNIZ fonksiyon gövdelerinde okunur (modül üst düzeyinde değil), yükleme sırası ne olursa olsun canlı bağ çözülmüş olur.
import { TICK_CHOICES_MS } from "@/lib/chain";

const D = Prisma.Decimal;

// ---- FİYAT TABLOSU (madde 2): VERİ, kaynak + okuma tarihiyle. Tabloda olmayan model seçilemez (madde 1). ----
export type PriceRow = { model: string; inUsdPerMTok: string; outUsdPerMTok: string; source: string; readAt: string };
const PRICING_URL = "https://platform.claude.com/docs/en/about-claude/pricing";
/** OKUNDU 2026-09-11 (Tur 25; sağlayıcı fiyat sayfasının "Model pricing" tablosu canlı okundu — Tur 24'ün aynı sayfadan aldığı değerlerle birebir). Ezberden yazılmadı; tarih satırdadır. */
export const BRAIN_PRICES: readonly PriceRow[] = [
  { model: "claude-opus-5", inUsdPerMTok: "5", outUsdPerMTok: "25", source: PRICING_URL, readAt: "2026-09-11" },
  { model: "claude-sonnet-5", inUsdPerMTok: "2", outUsdPerMTok: "10", source: PRICING_URL, readAt: "2026-09-11" },
  { model: "claude-haiku-4-5", inUsdPerMTok: "1", outUsdPerMTok: "5", source: PRICING_URL, readAt: "2026-09-11" },
];
export const ALLOWED_MODELS: readonly string[] = BRAIN_PRICES.map((p) => p.model);
export const priceOf = (model: string): PriceRow | null => BRAIN_PRICES.find((p) => p.model === model) ?? null;
/** TAZELİK (Ö-1): eşik TÜRETİLDİ — okuma tarihi içinde bulunulan DÖNEMİN başından eskiyse "eski". Dönem, bütçenin dönemidir (PERIOD_BASIS, Tur 11): fiyat bu dönem içinde bir kez
 *  doğrulanmadıysa dönemin maliyet hükmü doğrulanmamış bir sayıya dayanıyor demektir. İkinci bir gün sayısı icat edilmedi. Eski fiyat SESSİZCE kullanılmaz: işaret yüzeye çıkar. */
export const priceStale = (row: PriceRow, nowMs: number): boolean => Date.parse(row.readAt + "T00:00:00.000Z") < periodOf(nowMs).start.getTime();

// ---- SINIRLAR (madde 1): hepsi TÜRETİLMİŞ, gerekçesi satırında ----
export const HOUR_MS = 3_600_000, DAY_MS = 86_400_000;
/** Sıklık: ALT UÇ 1 saat — MİMARİ §3.1 "1–4 saatte bir" ifadesinin en sık ucu (daha sık çağrı mimarinin yazdığı davranış değildir). ÜST UÇ 24 saat — günlük çağrı tavanının dönemi
 *  bir gündür; bundan seyrek bir sıklık günlük tavanla ifade edilemez. Seçenekler günün TAM BÖLENLERİDİR: gün sınırındaki kayma en az olur, günlük tavan tam sayı çıkar. */
export const INTERVAL_BOUNDS = { minMs: HOUR_MS, maxMs: DAY_MS };
export const INTERVAL_CHOICES: readonly number[] = [1, 2, 3, 4, 6, 8, 12, 24].map((h) => h * HOUR_MS);
/** Aday sayısı: ÜST UÇ = Beyin'in yazabileceği en çok kural (RULE_BOUNDS.rulesMax) — daha çok aday, kurala dönüşemeyecek girdi için jeton harcamaktır (M-4). ALT UÇ 1: adaysız çağrı yok. */
export const CANDIDATE_BOUNDS = { min: 1, max: RULE_BOUNDS.rulesMax };
/** Mum sayısı: ALT UÇ 2 (bir seri en az iki nokta). ÜST UÇ 1000 = Binance GET /api/v3/klines limit üst sınırı (BELGE; ölçülmedi — sicil, S-9). Maliyeti sınır değil HARCAMA TAVANI korur. */
export const CANDLE_BOUNDS = { min: 2, max: 1000 };
/** A-9 AYLIK TOPLAM MALİYET TAVANI — TUR 65'TEN BERİ AYAR, KOD SABİTİ DEĞİL (KARAR-DEFTERI 20 Eyl satır 85: "koda gömülmez; panelden yönetilen parametre, her kurulum kendi değerini
 *  girer"). Eskiden burada iş sahibinin 2026-09-11 kararı bir kod sabitiydi (10 $). Artık `brain_settings.total_cap_usd`dir: dolu kurulumda göç BUGÜNKÜ değeri (10) AYNEN tohumlar ⇒ etkin
 *  değer değişmez; boş kurulumda NULL doğar (yazılım sayı seçmez). Kaynakta bu tavanı sayı sabiti olarak yazan dosya KIRMIZI (`gate:brain-settings` kural 12, `cost-cap-hardcoded`).
 *  TAVAN BOŞKEN DAVRANIŞ da ayardır (20 Eyl satır 87 = [A], varsayılan): BRAIN_OFF = Beyin ÇAĞRILMAZ, motor tikler ve korur · NO_LIMIT = aylık $ sınırı yok (günlük çağrı tavanı sürer). */
export const CAP_EMPTY_BEHAVIORS = ["BRAIN_OFF", "NO_LIMIT"] as const;
export type CapEmptyBehavior = (typeof CAP_EMPTY_BEHAVIORS)[number];
/** ALTYAPI MALİYETİ — TUR 66'DAN BERİ KURULUM AYARI, KOD SABİTİ DEĞİL (Üretim kararı K2 = [A], 24 Eyl 2026 · KARAR-DEFTERI 20 Eyl satır 85 "her kurulum kendi değerini girer … hiçbir
 *  sayı icat edilmez"). Eskiden burada BİZİM kurulumumuzun ölçümü (Tur 23/24/63) bir kod sabitiydi ve açık kaynak kopyayı kuran herkesin Claude payından düşülüyordu. Artık
 *  `brain_settings.infra_usd`dir: dolu kurulumda göç bugünkü değeri AYNEN tohumlar (ölçüm yorumu kalemleriyle göçte, `gate:brain-settings` kural 11 tohumu yorumuna karşı ölçer) ⇒ etkin
 *  Claude payı DEĞİŞMEZ; boş kurulumda NULL doğar ve NULL iken TÜRETME YAPILMAZ. Kaynakta sayı sabiti olarak geri gelirse KIRMIZI (kural 12, `cost-cap-hardcoded`). */
/** TÜRETME (madde 4): aylık Beyin tavanı = toplam tavan (AYAR, Tur 65) − altyapı maliyeti (AYAR, Tur 66). Sayı icat edilmedi; iki girdi de kurulumun kendi ayarıdır.
 *  İKİSİNDEN BİRİ girilmemişse türetme YAPILMAZ (null). Toplam tavan altyapının altındaysa Beyin'e pay KALMAZ ⇒ 0 (negatif tavan yazılmaz; 0 tavanla Beyin çağrılmaz). */
export const derivedMonthlyCapUsd = (totalCapUsd: string | null, infraUsd: string | null): string | null => (totalCapUsd === null || infraUsd === null ? null : D.max(new D(totalCapUsd).sub(infraUsd), 0).toFixed(4));
/** Beyin payının DURUMU (Tur 66): `ayar` açıkça girilmiş aylık Claude tavanı · `türetildi` toplam − altyapı · `boş` toplam tavan girilmedi (davranış ayarı uygulanır) ·
 *  `türetilemedi` toplam tavan VAR ama altyapı maliyeti girilmedi ⇒ pay bilinmiyor ⇒ Beyin ÇAĞRILMAZ (davranıştan bağımsız: "sınır yok" yalnız BOŞ tavan içindir, girilmiş bir tavanı yok saymaz). */
export type BrainShare = { kind: "ayar" | "türetildi"; usd: string } | { kind: "boş" } | { kind: "türetilemedi" };
export const brainShareOf = (r: BrainSettingsRow): BrainShare => r.monthlyCapUsd !== null ? { kind: "ayar", usd: r.monthlyCapUsd } : r.totalCapUsd === null ? { kind: "boş" }
  : r.infraUsd === null ? { kind: "türetilemedi" } : { kind: "türetildi", usd: derivedMonthlyCapUsd(r.totalCapUsd, r.infraUsd) as string };
/** TÜRETME (madde 4): günlük çağrı tavanı = sıklığın ima ettiği çağrı sayısı + 1. "+1" gün sınırı payıdır (bir çağrı günün başında, bir sonraki aynı takvim gününün sonunda olabilir).
 *  "Makul kat" DEĞİL, en dar tavan: kayıt yolu düşse bile günde bundan fazla çağrı yapılamaz — Tur 24 §3.2'nin 1 440 çağrı/gün açığı buradan kapanır. */
export const derivedDailyCallCap = (intervalMs: number): number => Math.ceil(DAY_MS / intervalMs) + 1;
/** TİK ARALIĞI — İNSAN BİRİMİ (Tur 67, U-3 · P-2): ham milisaniye ekrana çıkmaz. Dakikanın katı "N dakikada bir", değilse "N saniyede bir". Sayı üretmez, yalnız verilen sayıyı okunur yapar. */
export const tickText = (ms: number): string => (ms % 60_000 === 0 ? `${ms / 60_000} dakikada bir` : `${ms / 1000} saniyede bir`);

// ---- AYAR ----
export type BrainSettingsRow = { model: string; callIntervalMs: number; candidates: number; candleLimit: number; monthlyCapUsd: string | null; dailyCallCap: number | null; totalCapUsd: string | null; capEmptyBehavior: CapEmptyBehavior; infraUsd: string | null; tickMs: number | null };
export type SettingChange = { field: keyof BrainSettingsRow; from: string | null; to: string | null };
/** Beyin'e verilen ÇALIŞMA DEĞERİ: ayar + çözülmüş fiyat + türetilmiş/ayarlanmış tavanlar + pencereler. Beyin bu nesneyi alır, ayarı KENDİ OKUMAZ — okuma yolu tektir (kapı: ikinci
 *  okuyucu KIRMIZI). Dönem ve gün hesapları burada yapılır; Beyin modülünde takvim mantığı yoktur. */
export type BrainRuntime = {
  model: string; callIntervalMs: number; candidates: number; candleLimit: number;
  price: PriceRow & { stale: boolean };
  cap: { monthlyUsd: string | null; monthlyFrom: "ayar" | "türetildi" | "sınırsız"; totalUsd: string | null; infraUsd: string | null; emptyBehavior: CapEmptyBehavior; dailyCalls: number; dailyFrom: "ayar" | "türetildi"; periodStart: Date; periodEnd: Date; dayStart: Date };
  source: string;
};

export interface SettingsStore { read(): Promise<BrainSettingsRow | null>; write(next: BrainSettingsRow, by: string, changes: SettingChange[]): Promise<void>; changes(n: number): Promise<{ at: Date; by: string; changes: SettingChange[] }[]> }
const dec = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const rowOf = (r: { model: string; callIntervalMs: number; candidates: number; candleLimit: number; monthlyCapUsd: unknown; dailyCallCap: number | null; totalCapUsd: unknown; capEmptyBehavior: CapEmptyBehavior; infraUsd: unknown; tickMs: number | null }): BrainSettingsRow =>
  ({ model: r.model, callIntervalMs: r.callIntervalMs, candidates: r.candidates, candleLimit: r.candleLimit, monthlyCapUsd: dec(r.monthlyCapUsd), dailyCallCap: r.dailyCallCap, totalCapUsd: dec(r.totalCapUsd), capEmptyBehavior: r.capEmptyBehavior, infraUsd: dec(r.infraUsd), tickMs: r.tickMs });
/** Neon deposu. YAZMA VE DEFTER AYNI İŞLEMDE (E-1): defter yazılamazsa ayar da yazılmaz (kapı zorlar). */
export const prismaSettingsStore = (client?: PrismaClient): SettingsStore => { const db = () => client ?? getDb(); return {
  read: async () => { const r = await db().brainSettings.findUnique({ where: { id: 1 } }); return r ? rowOf(r) : null; },
  write: async (next, by, changes) => { await db().$transaction([
    db().brainSettings.update({ where: { id: 1 }, data: { model: next.model, callIntervalMs: next.callIntervalMs, candidates: next.candidates, candleLimit: next.candleLimit, monthlyCapUsd: next.monthlyCapUsd, dailyCallCap: next.dailyCallCap, totalCapUsd: next.totalCapUsd, capEmptyBehavior: next.capEmptyBehavior, infraUsd: next.infraUsd, tickMs: next.tickMs } }),
    db().brainSettingChange.create({ data: { by, changes: changes as unknown as Prisma.InputJsonValue } }),
  ]); },
  changes: async (n) => (await db().brainSettingChange.findMany({ orderBy: { at: "desc" }, take: n })).map((c) => ({ at: c.at, by: c.by, changes: c.changes as unknown as SettingChange[] })),
}; };
/** Kapı/kanarya deposu (S-9): `fail` fırlatır, `journalFail` yalnız defteri düşürür — ikisinde de ayar DEĞİŞMEZ (işlem taklidi). */
export function memorySettingsStore(row: BrainSettingsRow | null = null): SettingsStore & { row: BrainSettingsRow | null; log: { at: Date; by: string; changes: SettingChange[] }[]; fail: boolean; journalFail: boolean } {
  const s = { row, log: [] as { at: Date; by: string; changes: SettingChange[] }[], fail: false, journalFail: false };
  return Object.assign(s, {
    read: async () => { if (s.fail) throw new Error("brain-settings-store-down"); return s.row; },
    write: async (next: BrainSettingsRow, by: string, changes: SettingChange[]) => { if (s.fail) throw new Error("brain-settings-store-down"); if (s.journalFail) throw new Error("brain-settings-journal-down"); s.row = next; s.log.unshift({ at: new Date(), by, changes }); },
    changes: async (n: number) => s.log.slice(0, n),
  });
}

export type SettingsPatch = Partial<BrainSettingsRow>;
export type PatchOutcome = { ok: true; next: BrainSettingsRow; changes: SettingChange[] } | { ok: false; errors: string[] };
const intIn = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
/** DOĞRULAMA (madde 1): model AÇIK LİSTEDEN; sıklık/aday/mum türetilmiş sınırlar içinde; tavanlar pozitif ya da NULL (NULL ⇒ türetilir). Geçmeyen yama bütünüyle REDDEDİLİR. */
export function validatePatch(cur: BrainSettingsRow, patch: SettingsPatch): PatchOutcome {
  const errors: string[] = [], next: BrainSettingsRow = { ...cur };
  for (const k of Object.keys(patch) as (keyof BrainSettingsRow)[]) if (!(k in cur)) errors.push("bilinmeyen alan: " + String(k));
  if (patch.model !== undefined) { if (typeof patch.model !== "string" || priceOf(patch.model) === null) errors.push(`model açık listede değil (fiyat tablosunda karşılığı yok): ${String(patch.model)} — izinli: ${ALLOWED_MODELS.join(", ")}`); else next.model = patch.model; }
  if (patch.callIntervalMs !== undefined) { if (!intIn(patch.callIntervalMs, INTERVAL_BOUNDS.minMs, INTERVAL_BOUNDS.maxMs)) errors.push(`çağrı aralığı sınır dışı (${INTERVAL_BOUNDS.minMs}–${INTERVAL_BOUNDS.maxMs} ms): ${String(patch.callIntervalMs)}`); else next.callIntervalMs = patch.callIntervalMs; }
  if (patch.candidates !== undefined) { if (!intIn(patch.candidates, CANDIDATE_BOUNDS.min, CANDIDATE_BOUNDS.max)) errors.push(`aday sayısı sınır dışı (${CANDIDATE_BOUNDS.min}–${CANDIDATE_BOUNDS.max}): ${String(patch.candidates)}`); else next.candidates = patch.candidates; }
  if (patch.candleLimit !== undefined) { if (!intIn(patch.candleLimit, CANDLE_BOUNDS.min, CANDLE_BOUNDS.max)) errors.push(`mum sayısı sınır dışı (${CANDLE_BOUNDS.min}–${CANDLE_BOUNDS.max}): ${String(patch.candleLimit)}`); else next.candleLimit = patch.candleLimit; }
  if (patch.monthlyCapUsd !== undefined) { const v = patch.monthlyCapUsd; if (v !== null && !(typeof v === "string" && /^\d{1,6}(\.\d{1,4})?$/.test(v) && new D(v).gt(0))) errors.push("aylık tavan pozitif ondalık dize ya da null olmalı: " + String(v)); else next.monthlyCapUsd = v; }
  if (patch.dailyCallCap !== undefined) { const v = patch.dailyCallCap; if (v !== null && !intIn(v, 1, Number.MAX_SAFE_INTEGER)) errors.push("günlük çağrı tavanı pozitif tamsayı ya da null olmalı: " + String(v)); else next.dailyCallCap = v; }
  if (patch.totalCapUsd !== undefined) { const v = patch.totalCapUsd; if (v !== null && !(typeof v === "string" && /^\d{1,6}(\.\d{1,4})?$/.test(v) && new D(v).gt(0))) errors.push("aylık toplam maliyet tavanı pozitif ondalık dize ($/ay) ya da null (girilmedi) olmalı: " + String(v)); else next.totalCapUsd = v; }
  if (patch.infraUsd !== undefined) { const v = patch.infraUsd; if (v !== null && !(typeof v === "string" && /^\d{1,6}(\.\d{1,4})?$/.test(v))) errors.push("aylık altyapı maliyeti sıfır ya da pozitif ondalık dize ($/ay) ya da null (girilmedi) olmalı: " + String(v)); else next.infraUsd = v; }
  // Tur 67 (K3): tik aralığı YALNIZ türetilmiş seçenek kümesinden (TICK_CHOICES_MS: cron döneminin katları, aralık + cron dönemi ≤ tazeleme payı). BOŞALTMAK reddedilir: NULL "girilmedi"dir ve
  //   motoru tiklemez hâle getirir — bu gizli bir durdurma olurdu; durdurmanın yolu durdurma ucudur (K-7). Kayıtlı NULL (boş kurulum) kendi kendine doğrulanırken hata sayılmaz.
  if (patch.tickMs !== undefined) { const v = patch.tickMs; if (v === null) { if (cur.tickMs !== null && cur.tickMs !== undefined) errors.push("tik aralığı boşaltılamaz (boş aralık motoru tiklemez hâle getirir; motoru durdurmak için durdurma ucunu kullan)"); }
    else if (typeof v !== "number" || !TICK_CHOICES_MS.includes(v)) errors.push(`tik aralığı seçenek kümesinde değil: ${String(v)} — izinli: ${TICK_CHOICES_MS.map(tickText).join(", ")}`); else next.tickMs = v; }
  if (patch.capEmptyBehavior !== undefined) { if (!(CAP_EMPTY_BEHAVIORS as readonly string[]).includes(String(patch.capEmptyBehavior))) errors.push(`tavan boşken davranış açık listede değil: ${String(patch.capEmptyBehavior)} — izinli: ${CAP_EMPTY_BEHAVIORS.join(", ")}`); else next.capEmptyBehavior = patch.capEmptyBehavior; }
  if (errors.length) return { ok: false, errors };
  const changes: SettingChange[] = (Object.keys(cur) as (keyof BrainSettingsRow)[]).filter((k) => String(cur[k]) !== String(next[k])).map((k) => ({ field: k, from: cur[k] === null ? null : String(cur[k]), to: next[k] === null ? null : String(next[k]) }));
  return { ok: true, next, changes };
}

export type SettingsDeps = { store?: SettingsStore; events?: EventDeps; now?: () => number; direction?: "tighten" };
/** CAP_EMPTY bir ARIZA DEĞİLDİR, kurulumun kendi ayarıdır (20 Eyl satır 87): olay YAZILMAZ (her plan tikinde Neon yazımı ve bildirim olurdu — A-9), sebep planlama kaydına düşer. */
export type RuntimeOutcome = { ok: true; runtime: BrainRuntime; row: BrainSettingsRow } | { ok: false; refusal: "SETTINGS_UNREADABLE"; detail: string; event: EmitResult | null }
  | { ok: false; refusal: "CAP_EMPTY"; detail: string; event: null; row: BrainSettingsRow };
/** U-3 — boş tavanın anlamı, YALNIZ veriden. Panelde ve planlama kaydında aynı cümle. */
export const CAP_EMPTY_SENTENCE = "Aylık maliyet tavanı girilmedi ve tavan boşken davranış \"Beyin çağrılmaz\": karar motoru (Claude) çağrılmıyor, bu yüzden Claude için para harcanmıyor. Motor tiklemeye, açık pozisyonun çıkışına ve borsadaki korumaya devam ediyor. Tavanı panelden girersen karar motoru bir sonraki planlama turunda çalışır.";
/** U-3 — toplam tavan girilmiş, altyapı maliyeti girilmemiş: pay türetilemez. Sayı UYDURULMAZ (0 da yazılmaz). */
export const INFRA_EMPTY_SENTENCE = "Aylık altyapı maliyeti girilmedi: toplam tavandan karar motorunun (Claude) payı türetilemedi, bu yüzden karar motoru çağrılmıyor ve Claude için para harcanmıyor. Motor tiklemeye, açık pozisyonun çıkışına ve borsadaki korumaya devam ediyor. Altyapı maliyetini (kendi Neon, Vercel ve Upstash faturanın aylık toplamı) ya da karar motorunun aylık tavanını panelden girersen karar motoru bir sonraki planlama turunda çalışır.";
const errName = (e: unknown) => (e as { name?: string })?.name ?? "error";
/** TEK OKUMA YOLU. Fırlatmaz. Okunamaz / satır yok / kayıtlı ayar açık listeye uymuyor ⇒ KAPALI ARIZA: çağrı yapılmaz, olay yazılır, VARSAYILANA DÜŞÜLMEZ (Ö-2). */
export async function readBrainRuntime(deps: SettingsDeps = {}): Promise<RuntimeOutcome> {
  const now = (deps.now ?? Date.now)(), store = deps.store ?? prismaSettingsStore();
  const no = async (detail: string): Promise<RuntimeOutcome> => ({ ok: false, refusal: "SETTINGS_UNREADABLE", detail, event: await stopEngine("BRAIN_SETTINGS_UNREADABLE", `beyin ayarı okunamadı: ${detail} — Beyin çağrılmadı, varsayılana DÜŞÜLMEDİ (Ö-2); çıkış ve borsadaki koruma sürer`, {}, deps.events) });
  let row: BrainSettingsRow | null; try { row = await store.read(); } catch (e) { return no("depo hatası (" + errName(e) + ")"); }
  if (row === null) return no("brain_settings satırı yok (id=1)");
  const v = validatePatch(row, row); if (!v.ok) return no("kayıtlı ayar geçersiz: " + v.errors.join(" · "));
  const price = priceOf(row.model); if (price === null) return no("kayıtlı model fiyat tablosunda yok: " + row.model);
  // Tur 65: tavan ve davranış satırda EKSİKSE ayar geçersizdir (eksik alan "boş" SAYILMAZ, Ö-2) — boş tavan yalnız açıkça NULL yazılmış tavandır.
  if (row.totalCapUsd === undefined || row.infraUsd === undefined || !(CAP_EMPTY_BEHAVIORS as readonly string[]).includes(String(row.capEmptyBehavior))) return no(`kayıtlı ayar eksik: toplam tavan ${row.totalCapUsd === undefined ? "YOK" : "var"} · altyapı maliyeti ${row.infraUsd === undefined ? "YOK" : "var"} · tavan boşken davranış ${String(row.capEmptyBehavior)}`);
  // TAVAN (Tur 65): Beyin aylık tavanı = ayar; yoksa toplam tavandan TÜRETİLİR; ikisi de boşsa davranış AYARDAN — BRAIN_OFF ⇒ Beyin'e çalışma değeri VERİLMEZ (çağrı yapılamaz).
  // Tur 66: toplam tavan VAR ama altyapı maliyeti girilmedi ⇒ pay TÜRETİLEMEZ ⇒ Beyin çağrılmaz (davranıştan bağımsız; olay yok — arıza değil, kurulumun eksik ayarı).
  const share = brainShareOf(row), monthly = share.kind === "ayar" || share.kind === "türetildi" ? share.usd : null;
  if (share.kind === "türetilemedi") return { ok: false, refusal: "CAP_EMPTY", detail: INFRA_EMPTY_SENTENCE, event: null, row };
  if (monthly === null && row.capEmptyBehavior === "BRAIN_OFF") return { ok: false, refusal: "CAP_EMPTY", detail: CAP_EMPTY_SENTENCE, event: null, row };
  const p = periodOf(now), d = new Date(now), dayStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const runtime: BrainRuntime = { model: row.model, callIntervalMs: row.callIntervalMs, candidates: row.candidates, candleLimit: row.candleLimit,
    price: { ...price, stale: priceStale(price, now) },
    cap: { monthlyUsd: monthly, monthlyFrom: row.monthlyCapUsd !== null ? "ayar" : monthly !== null ? "türetildi" : "sınırsız", totalUsd: row.totalCapUsd, infraUsd: row.infraUsd, emptyBehavior: row.capEmptyBehavior, dailyCalls: row.dailyCallCap ?? derivedDailyCallCap(row.callIntervalMs), dailyFrom: row.dailyCallCap === null ? "türetildi" : "ayar", periodStart: p.start, periodEnd: p.end, dayStart },
    source: `brain_settings#1 (${PERIOD_BASIS}) · fiyat ${price.source} okuma ${price.readAt}` };
  return { ok: true, runtime, row };
}

/** U-3 — MALİYET TAVANI YÜZEYİ: her sayı insan biriminde ($/ay, çağrı/gün), boş hâlin anlamı CÜMLEYLE. Yalnız VERİDEN kurulur (satır: toplam tavan · altyapı · Claude tavanı); sayı uydurulmaz.
 *  Tur 66 (K2): altyapı maliyeti ayardır; girilmediyse "girilmedi" yazılır, 0 YAZILMAZ ve pay türetilmez. */
export function costCapView(r: BrainSettingsRow): { totalUsd: string | null; brainMonthlyUsd: string | null; brainMonthlyFrom: "ayar" | "türetildi" | "yok"; infraUsd: string | null; behavior: CapEmptyBehavior; dailyCalls: number; sentence: string; behaviorSentence: string } {
  const sh = brainShareOf(r), m = sh.kind === "ayar" || sh.kind === "türetildi" ? sh.usd : null, daily = r.dailyCallCap ?? derivedDailyCallCap(r.callIntervalMs), usd = (v: string) => `${new D(v).toFixed(2)} $/ay`;
  // Tur 66 (S65-2): "+1" gün sınırı payı cümleyle; tavan cümlesi faturanın KİMİN hesabına gittiğini ve altyapının kalemlerini yazar (kalem tutarı ayarda YOK ⇒ "ayrıntı girilmedi", sayı uydurulmaz).
  const dailyText = r.dailyCallCap !== null ? `günde en çok ${daily} kez (ayarda girildi)`
    : `günde en çok ${daily} kez (${hoursOf(r.callIntervalMs)} saatte bir çağrı günde ${daily - 1} eder; artı 1 gün sınırı payı: bir çağrı günün başında, bir sonraki aynı takvim gününün sonunda düşebilir)`;
  const bill = " Bu tutarların faturası kurulumu yapanın KENDİ hesaplarına gider: altyapı için kendi Neon (veritabanı), Vercel (sunucu) ve Upstash (önbellek) hesapların, karar motoru için kendi Anthropic (Claude) hesabın. Altyapının kalem kalem tutarı ayarda yok (ayrıntı girilmedi); ayarda yalnız aylık toplamı durur.";
  const behaviorSentence = r.capEmptyBehavior === "BRAIN_OFF" ? "Tavan boşken davranış: karar motoru ÇAĞRILMAZ (varsayılan). Tavan boş bırakılırsa Claude'a hiç para harcanmaz; motor tikler ve korur."
    : "Tavan boşken davranış: SINIR YOK. Tavan boş bırakılırsa karar motorunun aylık harcaması sınırlanmaz; yalnız günlük çağrı tavanı geçerli kalır.";
  const sentence = r.totalCapUsd !== null
    ? (r.infraUsd === null
      ? (r.monthlyCapUsd !== null ? `Aylık toplam maliyet tavanı ${usd(r.totalCapUsd)}. Aylık altyapı maliyeti girilmedi, bu yüzden karar motorunun payı toplam tavandan türetilmedi; karar motorunun (Claude) aylık tavanı ayarda ayrıca ${usd(r.monthlyCapUsd)} olarak girildiği için karar motoru bu tavanla çalışır. Karar motoru ${dailyText} çağrılır.${bill}`
        : `Aylık toplam maliyet tavanı ${usd(r.totalCapUsd)}. ${INFRA_EMPTY_SENTENCE}${bill}`)
      : `Aylık toplam maliyet tavanı ${usd(r.totalCapUsd)}. Bunun ${usd(r.infraUsd)}'ı girilen altyapı maliyetidir (veritabanı, sunucu, önbellek); karar motoruna (Claude) kalan pay ${r.monthlyCapUsd !== null ? `ayarda ayrıca ${usd(r.monthlyCapUsd)} olarak girildi` : usd(m as string)}. Karar motoru ${dailyText} çağrılır.${bill}`)
    : m !== null ? `Aylık toplam maliyet tavanı girilmedi. Karar motorunun (Claude) aylık tavanı ayarda ${usd(m)} olarak girildiği için karar motoru bu tavanla çalışır; ${dailyText} çağrılır.${bill}`
    : r.capEmptyBehavior === "BRAIN_OFF" ? CAP_EMPTY_SENTENCE
    : `Aylık maliyet tavanı girilmedi ve tavan boşken davranış "sınır yok": karar motorunun (Claude) aylık harcaması SINIRLANMIYOR; yalnız günlük çağrı tavanı (günde ${daily} çağrı) geçerli.`;
  return { totalUsd: r.totalCapUsd, brainMonthlyUsd: m, brainMonthlyFrom: sh.kind === "ayar" ? "ayar" : sh.kind === "türetildi" ? "türetildi" : "yok", infraUsd: r.infraUsd, behavior: r.capEmptyBehavior, dailyCalls: daily, sentence, behaviorSentence };
}

export type WriteOutcome = { ok: true; next: BrainSettingsRow; changes: SettingChange[] } | { ok: false; status: 400 | 403 | 409 | 503; reason: "INVALID" | "NO_ROW" | "STORE_UNAVAILABLE" | "NOT_TIGHTEN_FIELD" | "RAISES_SPEND"; errors: string[] };

// ---- YÖN (Tur 65 · 3e): harcama iznini ARTIRAN değişiklik HASSASTIR (TOTP + E-1, hassas uç); AZALTAN ya da boşaltan değişiklik SERBESTTİR (oturum, kodsuz uç). ----
/** Serbest yolun kabul ettiği alanlar — Tur 66 (1d, S-8): ayarın HER alanı; yön kararı alan başına `raisesSpend` içindedir (azaltan yön kodsuz, artıran ya da yönü ölçülemeyen yön TOTP). */
export const TIGHTEN_FIELDS = ["totalCapUsd", "monthlyCapUsd", "dailyCallCap", "capEmptyBehavior", "infraUsd", "model", "callIntervalMs", "candidates", "candleLimit", "tickMs"] as const satisfies readonly (keyof BrainSettingsRow)[];
/** Bir ayarın HARCAMA İZNİ: aylık Beyin $ · günlük çağrı · A-9 toplam. Boş tavan davranışa göre okunur: BRAIN_OFF ⇒ 0 (Beyin çağrılmaz), NO_LIMIT ⇒ sonsuz. Sayı seçilmedi: iki uç da tanımdır. */
export function spendAllowance(r: BrainSettingsRow): { monthly: InstanceType<typeof D>; daily: number; total: InstanceType<typeof D> } {
  const empty = r.capEmptyBehavior === "NO_LIMIT" ? new D(Infinity) : new D(0), sh = brainShareOf(r);
  // Tur 66: pay TÜRETİLEMİYORSA (altyapı girilmedi) Beyin çağrılmaz ⇒ izin 0 (davranıştan bağımsız, readBrainRuntime ile aynı hüküm).
  return { monthly: sh.kind === "boş" ? empty : sh.kind === "türetilemedi" ? new D(0) : new D(sh.usd), daily: r.dailyCallCap ?? derivedDailyCallCap(r.callIntervalMs), total: r.totalCapUsd === null ? empty : new D(r.totalCapUsd) };
}
/** MODEL YÖNÜ (Tur 66 · 1d) YALNIZ fiyat tablosundan: iki fiyat da (giriş VE çıkış) düşmüyor/artmıyorsa yön vardır; biri artıp diğeri düşerse jeton oranı bilinmeden yön
 *  SÖYLENEMEZ ("bilinmiyor"); fiyatı tabloda olmayan model de "bilinmiyor". Sayı seçilmedi: karşılaştırma fiyat satırlarının kendisidir. */
export function priceDirection(a: PriceRow | null, b: PriceRow | null): "azalır" | "artar" | "aynı" | "bilinmiyor" {
  if (a === null || b === null) return "bilinmiyor";
  const i = new D(b.inUsdPerMTok).cmp(a.inUsdPerMTok), o = new D(b.outUsdPerMTok).cmp(a.outUsdPerMTok);
  return i === 0 && o === 0 ? "aynı" : i <= 0 && o <= 0 ? "azalır" : i >= 0 && o >= 0 ? "artar" : "bilinmiyor";
}
/** Değişiklik harcama iznini ARTIRIYOR mu? Boş dizi = artırmıyor (azaltıyor ya da aynı). Her gerekçe bir cümledir (U-3). */
export function raisesSpend(cur: BrainSettingsRow, next: BrainSettingsRow): string[] {
  // U-3: her gerekçe YALNIZ VERİDEN, birimiyle: sonlu iki değer "eski → yeni $/ay"; sonsuz uç "sınır yok"; 0 (boş tavan + Beyin çağrılmaz) "karar motoru çağrılmıyor".
  const a = spendAllowance(cur), b = spendAllowance(next), out: string[] = [], m = (d: InstanceType<typeof D>) => (d.isFinite() ? (d.isZero() ? "0 $/ay (karar motoru çağrılmıyor)" : `${d.toFixed(2)} $/ay`) : "sınır yok");
  if (b.total.gt(a.total)) out.push(`aylık toplam maliyet tavanı ${m(a.total)} → ${m(b.total)}`);
  if (b.monthly.gt(a.monthly)) out.push(`karar motorunun aylık harcama izni ${m(a.monthly)} → ${m(b.monthly)}`);
  if (b.daily > a.daily) out.push(`karar motorunun günlük çağrı izni günde ${a.daily} → ${b.daily} çağrı`);
  // Tur 66 · 0.2 (Üretim K1, 24 Eyl: "NO_LIMIT'e geçmek hassas eylemdir"): tavan doluyken geçiş bugünkü izni değiştirmez ama "tavan boşalırsa sınır yok" hükmünü KURAR ⇒ hassas.
  if (cur.capEmptyBehavior !== "NO_LIMIT" && next.capEmptyBehavior === "NO_LIMIT") out.push("tavan boşken davranış \"karar motoru çağrılmaz\" → \"sınır yok\" (tavan boşalırsa aylık harcama sınırlanmaz)");
  // Tur 66 · 1d (S-8): çağrı başına ve ayda harcamayı belirleyen dört alan. Azaltan yön serbest; artıran ya da yönü ÖLÇÜLEMEYEN değişiklik hassas uçtan.
  if (cur.model !== next.model) { const d = priceDirection(priceOf(cur.model), priceOf(next.model));
    if (d === "artar") out.push(`model ${cur.model} → ${next.model}: fiyat tablosunda çağrı başına maliyet ARTIYOR`);
    if (d === "bilinmiyor") out.push(`model ${cur.model} → ${next.model}: fiyat tablosundan yön KARAR VERİLEMEDİ (fiyatı tabloda yok ya da giriş ve çıkış fiyatı ters yönde)`); }
  if (next.callIntervalMs < cur.callIntervalMs) out.push(`çağrı aralığı ${new D(cur.callIntervalMs).div(HOUR_MS).toFixed(0)} saatten ${new D(next.callIntervalMs).div(HOUR_MS).toFixed(0)} saate KISALIYOR (ayda daha çok çağrı)`);
  if (next.candidates > cur.candidates) out.push(`aday sayısı ${cur.candidates} → ${next.candidates} (çağrı başına daha çok girdi)`);
  if (next.candleLimit > cur.candleLimit) out.push(`mum sayısı ${cur.candleLimit} → ${next.candleLimit} (çağrı başına daha çok girdi)`);
  // Tur 67 (K3, S-8 yönü): tik aralığını KISALTMAK (daha sık) Vercel çağrısını artırır ⇒ hassas; girilmemiş (motor tiklemiyor) aralığa değer vermek de çağrıyı 0'dan artırır ⇒ hassas. Uzatmak serbest.
  if (typeof next.tickMs === "number" && (cur.tickMs === null || (typeof cur.tickMs === "number" && next.tickMs < cur.tickMs))) out.push(`tik aralığı ${cur.tickMs === null ? "girilmemişti (motor tiklemiyordu)" : tickText(cur.tickMs)} → ${tickText(next.tickMs)}: motor daha SIK tikler (ayda daha çok sunucu çağrısı)`);
  return out;
}
/** YAZMA (E-1 izi, S-8 hassas eylem): doğrula → ayarı ve defteri AYNI işlemde yaz. Değişiklik ANINDA etkilidir: motor ayarı her planlama turunda okur, yeniden dağıtım gerekmez. */
export async function writeBrainSettings(patch: SettingsPatch, by: string, deps: SettingsDeps = {}): Promise<WriteOutcome> {
  const store = deps.store ?? prismaSettingsStore();
  let cur: BrainSettingsRow | null; try { cur = await store.read(); } catch (e) { return { ok: false, status: 503, reason: "STORE_UNAVAILABLE", errors: ["ayar okunamadı (" + errName(e) + ")"] }; }
  if (cur === null) return { ok: false, status: 409, reason: "NO_ROW", errors: ["brain_settings satırı yok (id=1); göç uygulanmamış olabilir"] };
  if (deps.direction === "tighten") { const extra = Object.keys(patch).filter((k) => !(TIGHTEN_FIELDS as readonly string[]).includes(k));
    if (extra.length) return { ok: false, status: 400, reason: "NOT_TIGHTEN_FIELD", errors: [`serbest (kodsuz) yol yalnız tavan alanlarını değiştirir; bu alanlar hassas uçtan (tek kullanımlık kodla) değişir: ${extra.join(", ")}`] }; }
  const v = validatePatch(cur, patch); if (!v.ok) return { ok: false, status: 400, reason: "INVALID", errors: v.errors };
  if (deps.direction === "tighten") { const why = raisesSpend(cur, v.next);
    if (why.length) return { ok: false, status: 403, reason: "RAISES_SPEND", errors: [`harcama izni artıyor: ${why.join(" · ")}`] }; }
  // Tur 65 (ölçüldü: shadow defterinde serbest uçtan iki `changes: []` satırı): değişmeyen yama YAZILMAZ ve deftere satır düşmez — E-1 değişikliğin izidir, değişiklik yoksa iz de yoktur
  // (giriş şalteri kalıbı, `writeEntrySettings`). Kodsuz serbest uç bu yüzden defteri boş satırla dolduramaz.
  if (v.changes.length === 0) return { ok: true, next: v.next, changes: [] };
  try { await store.write(v.next, by, v.changes); } catch (e) { return { ok: false, status: 503, reason: "STORE_UNAVAILABLE", errors: ["ayar ya da E-1 defteri yazılamadı (" + errName(e) + ") — ayar DEĞİŞMEDİ"] }; }
  return { ok: true, next: v.next, changes: v.changes };
}

// ---- TİK ARALIĞI (Tur 67 · bitiş listesi madde 2 · Üretim kararı K3 = [A]) — AYAR `brain_settings.tick_ms`; tik onu izin kopyasından alır, Neon'dan DEĞİL ----
export type TickRead = { ok: true; tickMs: number } | { ok: false; detail: string };
/** TİK ARALIĞININ TEK OKUMA YOLU. Yalnız izin kopyasını yazan iki yerden çağrılır: Neon tazelemesi (engine-control `refreshPermitCopy`, 20 dakikada bir, Neon zaten uyanık) ve RESUME. Tik yolundan
 *  ÇAĞRILMAZ (tik başına Neon 0). Fırlatmaz. KAPALI ARIZA: okunamadı / satır yok / alan YOK (eksik alan "boş" sayılmaz) / NULL (girilmedi) / seçenek kümesi dışı ⇒ ok:false ve sebep; varsayılan sayı YOK.
 *  Okuyucu `engine-control`e ENJEKTE edilir (o modül bu modülü içe aktaramaz: durdurma ucunun grafiği Beyin birimine uzanırdı — gate:stop-service (1), K-7). */
export async function readTickMs(deps: { store?: SettingsStore } = {}): Promise<TickRead> {
  let row: BrainSettingsRow | null; try { row = await (deps.store ?? prismaSettingsStore()).read(); } catch (e) { return { ok: false, detail: `ayar okunamadı (${errName(e)})` }; }
  if (row === null) return { ok: false, detail: "brain_settings satırı yok (id=1); göç uygulanmamış olabilir" };
  if (row.tickMs === undefined) return { ok: false, detail: "kayıtlı ayarda tik aralığı alanı YOK (eksik alan boş sayılmaz)" };
  if (row.tickMs === null) return { ok: false, detail: "tik aralığı girilmedi (boş kurulum): panelden bir aralık seçilmeden motor tiklemez" };
  if (!TICK_CHOICES_MS.includes(row.tickMs)) return { ok: false, detail: `kayıtlı tik aralığı seçenek kümesinde değil (${tickText(row.tickMs)})` };
  return { ok: true, tickMs: row.tickMs };
}
/** U-3 — TİK ARALIĞI YÜZEYİ: her süre insan biriminde (saniye/dakika; ham milisaniye YOK), boş hâlin anlamı cümleyle, değişikliğin ne zaman etkili olduğu TAZELEME ARALIĞINDAN türetilmiş dakikayla,
 *  yön (daha sık = kod ister, daha seyrek = kodsuz) cümleyle. Yalnız VERİDEN kurulur; sayı uydurulmaz. */
export function tickView(r: BrainSettingsRow): { tickMs: number | null; sentence: string; effectSentence: string; directionSentence: string; choices: { ms: number; label: string; current: boolean }[] } {
  const t = r.tickMs ?? null, refreshMin = PERMIT_REFRESH_MS / 60_000;
  const sentence = t === null ? "Tik aralığı girilmedi: motor bir aralık seçilmeden başlatılamaz ve tiklemez (yazılım aralığı kendisi seçmez). Aşağıdan bir aralık seç."
    : `Motor ${tickText(t)} tikler: her tikte çalışma izni, açık pozisyonlar ve piyasa okunur, korumalar denetlenir.`;
  const effectSentence = `Değişiklik en geç ${refreshMin} dakikada (izin kopyasının bir sonraki tazelemesinde) ya da motor yeniden başlatılınca etkili olur. Durdurma bu ayardan bağımsızdır: her an, anında geçerlidir.`;
  const directionSentence = "Daha seyrek bir aralık (sunucu çağrısı azalır) kod istemez; daha sık bir aralık (sunucu çağrısı artar) tek kullanımlık kod ister. Aralık ancak cron döneminin katı olabilir.";
  return { tickMs: t, sentence, effectSentence, directionSentence, choices: TICK_CHOICES_MS.map((ms) => ({ ms, label: tickText(ms), current: ms === t })) };
}

// ---- MALİYET HESAPLAYICISI (madde 2, 5) — jetonlar ÖLÇÜMDEN gelir; kodda sabit jeton sayısı YOKTUR (kapı) ----
export type TokenReading = { input: number; output: number; at: string; model: string; source: string };
export type CostRow = { model: string; intervalMs: number; callsPerMonth: string; perCallUsd: string; brainUsd: string; totalUsd: string | null; underCap: boolean | null; current: boolean; sentence: string };
const money = (v: string | InstanceType<typeof D>) => new D(v).toFixed(2);
/** Bir çağrının maliyeti = giriş jetonu × giriş fiyatı + çıkış jetonu × çıkış fiyatı (MTok başına). Aylık çağrı sayısı dönemin GERÇEK gün sayısından gelir (30 varsayılmaz). */
export function costOf(i: { price: PriceRow; tokens: TokenReading; intervalMs: number; periodStart: Date; periodEnd: Date }): { perCallUsd: string; callsPerMonth: string; monthUsd: string } {
  const perCall = new D(i.tokens.input).mul(i.price.inUsdPerMTok).add(new D(i.tokens.output).mul(i.price.outUsdPerMTok)).div(1_000_000);
  const calls = new D(i.periodEnd.getTime() - i.periodStart.getTime()).div(i.intervalMs);
  return { perCallUsd: perCall.toFixed(6), callsPerMonth: calls.toFixed(1), monthUsd: perCall.mul(calls).toFixed(4) };
}
const hoursOf = (ms: number) => new D(ms).div(HOUR_MS).toFixed(0);
/** SEÇENEK TABLOSU (madde 5, U-3/U-4): model × sıklık; her satır aylık $, altyapı dâhil TOPLAM $ ve 10 $ tavanına göre ✓/✗ taşır ve bir CÜMLE kurar. Jeton ölçülmediyse tablo ÜRETİLMEZ
 *  (çağıran "ölçülmedi" der; sayı uydurulmaz). Jetonlar ÖLÇÜLEN son gerçek çağrının jetonlarıdır: aday/mum ayarı değişirse bir sonraki gerçek çağrı yeni sayıyı ölçer ve tablo güncellenir. */
export function costOptions(i: { tokens: TokenReading; runtime: BrainRuntime }): { rows: CostRow[]; infraUsd: string | null; totalCapUsd: string | null; tokens: TokenReading } {
  const cap = i.runtime.cap.totalUsd, infra = i.runtime.cap.infraUsd; // Tur 65/66: toplam tavan ve altyapı AYARDAN; girilmediyse satır toplamı/karşılaştırması UYDURULMAZ
  const rows: CostRow[] = [];
  for (const price of BRAIN_PRICES) for (const intervalMs of INTERVAL_CHOICES) {
    const c = costOf({ price, tokens: i.tokens, intervalMs, periodStart: i.runtime.cap.periodStart, periodEnd: i.runtime.cap.periodEnd });
    const total = infra === null ? null : new D(c.monthUsd).add(infra), underCap = cap === null || total === null ? null : total.lte(cap), current = price.model === i.runtime.model && intervalMs === i.runtime.callIntervalMs;
    const tail = total === null ? "aylık altyapı maliyeti girilmedi: toplam hesaplanamadı, bu satır bir tavanla karşılaştırılamadı"
      : `girilen altyapı ${money(infra as string)} $/ay ile toplam ${money(total)} $/ay — ${cap === null ? "aylık toplam maliyet tavanı girilmedi: bu satır bir tavanla karşılaştırılamadı" : `${money(cap)} $/ay tavanının ${underCap ? money(new D(cap).sub(total)) + " $/ay ALTINDA" : money(total.sub(cap)) + " $/ay ÜSTÜNDE"}`}`;
    rows.push({ model: price.model, intervalMs, callsPerMonth: c.callsPerMonth, perCallUsd: c.perCallUsd, brainUsd: c.monthUsd, totalUsd: total === null ? null : total.toFixed(4), underCap, current,
      sentence: `${price.model}, ${hoursOf(intervalMs)} saatte bir: ayda ${c.callsPerMonth} çağrı × çağrı başına ${c.perCallUsd} $ = Beyin ${money(c.monthUsd)} $/ay; ${tail}${current ? " (şu anki ayar)" : ""}.` });
  }
  return { rows, infraUsd: infra, totalCapUsd: cap, tokens: i.tokens };
}
