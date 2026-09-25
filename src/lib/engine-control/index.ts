// MOTOR KONTROL BAYRAĞI — DURDURMA SERVİSİ (G08 · K-7, K-8, S-8). Bayrak = ÇALIŞMA İZNİ: motor yalnız iki kopya da okunup ikisi de RUNNING ve izin süresi dolmamışsa çalışır;
// başka her durumda (okunamadı, yok, STOPPED, süresi dolmuş) DURMUŞ sayılır (kapalı arıza). Kopyalar: Neon `engine_control` (kalıcı) + Upstash `engine:control` (hızlı), aynı belge.
// DURDURMA YAZMA YOLU hiçbir depoya ZORUNLU bağlı değildir: iki kopyaya da en iyi çaba yazılır (`attempt`: zaman aşımlı, fırlatmaz); ikisi de düşse durdurma KABUL edilir, yanıt hangi
// kopyanın alındığını dürüstçe söyler ve yanıttan sonra yeniden dener (`defer`, izin ömrü kadar). Emir KAYBOLMAZ: (a) depo okunamazken motor zaten durmuştur (kapalı arıza);
// (b) çalışma izni süresiz değildir — RUN_PERMIT_MS içinde yenilenmezse kendiliğinden düşer ve motor kendi başına yeniden başlamaz (yalnız RESUME, hassas); (c) yeniden deneme
// penceresi = izin ömrü: depo izin düşmeden dönerse bayrak yerleşir, dönmezse izin zaten düşmüştür. Yenileme CAS'lidir: araya giren durdurma ezilmez.
// İki seçenek, varsayılan YOK (K-7): HOLD (yalnız durdur) | CLOSE_ALL (durdur ve kapat — bu turda NİYET olarak kaydedilir, icra G11/G12). Seçenek yoksa 400, bayrağa dokunulmaz.
// Olay (K-8): her durdurma STOP_BUTTON, yeniden başlatma RESTART (RESUMED) — sicilden (`stopEngine`). Olay yazılamazsa durdurma yine geçerlidir; sonuç yanıta girer, yayıcı stderr'e düşürür.
// İkinci doğrulama bu modülde YOKTUR (S-8): kimliğe uç karar verir (durdurma `stop` sınıfı; yeniden başlatma `sensitive` + ENGINE_RESTART). Beyin/zincir bu modülde yoktur.
// TUR 22 — NEON TİK YOLUNDAN ÇIKTI (A-9, K-7 aynen): tik (`peekRunPermit`) YALNIZ Upstash kopyasını okur. Kopya SÜRELİDİR (TTL = RUN_PERMIT_MS): süresi dolunca anahtar yok olur ⇒ NO_PERMIT ⇒ motor durur.
//   Kopya Neon'dan (kalıcı gerçek) PERMIT_REFRESH_MS aralığıyla TAZELENİR (`refreshPermitCopy`: Neon okunur, Neon izni CAS ile uzatılır, kopya CAS ile yeni TTL'le yazılır). Tazeleme düşerse kopya
//   UZATILMAZ (olay PERMIT_REFRESH_FAILED, K-8) ve kendiliğinden söner ⇒ Neon erişilemezse motor EN GEÇ TTL kadar sonra durur. Neon STOPPED diyorsa tazeleme bunu kopyaya taşır (motor durur).
//   DURDURMA kopyayı DOĞRUDAN ezer (TTL'siz STOPPED SET) — Neon'u da TTL'i de beklemez: bir sonraki tik durmuş görür. İki kopya okuyan sıkı okuyucu (`readRunPermit`) EMİR yolunda (executeSignal) kalır.
import type { PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/db/client";
import { pickEnv } from "@/lib/env";
import { redisPipeline } from "@/lib/upstash";
import { stopEngine, type Deps as EventDeps, type EmitResult } from "@/lib/events";

export type StopMode = "HOLD" | "CLOSE_ALL";
export const STOP_MODES: Record<StopMode, string> = {
  HOLD: "yalnız durdur: yeni pozisyon açılmaz; açık pozisyonlar ve borsadaki koruma emirleri olduğu gibi kalır",
  CLOSE_ALL: "durdur ve kapat: açık pozisyonların kapatılması istenir — bu turda NİYET kaydedilir, icra G11/G12 (kapatma YAPILMADI)",
};
/** `syncedAt`: YALNIZ Upstash kopyasında — kopyanın Neon'dan en son tazelendiği an (Tur 22); Neon satırında yoktur.
 *  `tickMs`/`tickNote` (Tur 67, Üretim K3 = [A]): YALNIZ RUNNING kopyada — motorun tik aralığı (ayar `brain_settings.tick_ms`), RESUME'da ve Neon tazelemesinde yazılır; tik onu buradan alır (ek komut yok).
 *  `null` = okunamadı/girilmedi (sebep `tickNote`), alan YOK = okuyucu verilmedi ya da bu sürümden önce yazılmış kopya — ikisinde de tik KAPALI ARIZALANIR. STOPPED belge tik alanı TAŞIMAZ:
 *  durdurma tik ayarından BAĞIMSIZDIR (K-7). Neon `engine_control` satırında bu alanlar YOKTUR (ayarın yeri `brain_settings`). */
export type ControlDoc = { state: "RUNNING" | "STOPPED"; mode: StopMode | null; permitUntil: string | null; by: string; at: string; syncedAt?: string; tickMs?: number | null; tickNote?: string };
/** TUR 22 SAYILARI (tek yerde; sicil, geri alınabilir):
 *  PERMIT_REFRESH_MS = 20 dk — Upstash kopyası Neon'dan bu aralıkla tazelenir. TÜRETİLDİ: Neon uyku eşiği 330 s ÖLÇÜLDÜ (Tur 21) ⇒ Neon uyanıklık ≈ (330 s + sorgu) / aralık: 20 dk'da ≈ %28
 *    ⇒ 0,25 CU'da ≈ 5,3 $/ay (10 $ tavanı için ≤ %45 ⇒ aralık ≥ 750 s). Aralık uzadıkça Neon daha çok uyur ama YALNIZ Neon'a ulaşabilmiş bir durdurmanın etkisi gecikir — 20 dk bu ödünleşimin
 *    SEÇİLMİŞ noktasıdır (ölçümden değil, AÇIK; rapor madde 1).
 *  PERMIT_GRACE_MS = 240 s — tazeleme vadesi geldikten sonra kopyanın yaşamaya devam ettiği pay: ucuz modda en uzun tik (180 s) + bir cron dönemi (60 s); eski RUN_PERMIT_MS değeri (A-1, UYDURULDU).
 *  RUN_PERMIT_MS = REFRESH + GRACE = 24 dk — iznin ÖMRÜ: Neon `permitUntil` ufku VE Upstash kopyasının TTL'i. Motor Neon'dan haber almadan en çok bu kadar çalışır; durdurma emri yalnız Neon'a
 *    ulaşabildiyse en geç bu kadar sonra etkilidir. Yenilenmezse düşer, motor kendi başına başlamaz (yalnız RESUME).
 *  PERMIT_REFRESH_TIMEOUT_MS = 10 s — tazelemede Neon okuma/uzatma tavanı (uyuyan Neon'un soğuk bağlantısı ÖLÇÜLDÜ 3,3 s ev ağından, Tur 21; ×3 pay). Durdurma yoluna girmez.
 *  STOP_TIMING (A-1, UYDURULDU): storeTimeoutMs her depo işleminin tavanı (durdurma hızlı döner); retryEveryMs/retryWindowMs: kalıcılaşmamış durdurma yanıttan sonra bu aralıkla, en çok
 *    PERMIT_GRACE_MS (240 s ≤ fonksiyon ömrü) yeniden denenir — pencere izin ömründen kısadır; kalan boşluğu kopyanın TTL'i kapatır (rapor madde 2). */
export const PERMIT_REFRESH_MS = 1_200_000;
export const PERMIT_GRACE_MS = 240_000;
export const RUN_PERMIT_MS = PERMIT_REFRESH_MS + PERMIT_GRACE_MS;
export const PERMIT_REFRESH_TIMEOUT_MS = 10_000;
export const STOP_TIMING = { storeTimeoutMs: 1500, retryEveryMs: 1000, retryWindowMs: PERMIT_GRACE_MS } as const;
export const CONTROL_KEY = "engine:control";
/** `renew(prev, next)`: karşılaştır-ve-yaz — Neon yalnız RUNNING ve `at` değişmemişse `permitUntil`'i alır; Upstash kopyası birebir eşitse `next` yazılır (RUNNING ise TTL = RUN_PERMIT_MS, Tur 22). */
export interface FlagStore { read(): Promise<ControlDoc | null>; write(doc: ControlDoc): Promise<void>; renew(prev: ControlDoc, next: ControlDoc): Promise<boolean> }
export type Stores = { neon: FlagStore; upstash: FlagStore };
export type StoreName = keyof Stores;
export type Persisted = Record<StoreName, boolean>;
/** Enjeksiyon yalnız kapı/kanarya için (S-9); üretimde depolar ortamdan, saat/uyku gerçek, `defer` = next/server after. */
export type Deps = { stores?: Stores; now?: () => number; sleep?: (ms: number) => Promise<void>; defer?: (task: () => Promise<void>) => void; events?: EventDeps; tickSource?: TickSource };
/** Tur 67 (K3 = [A]): tik aralığının okuyucusu ENJEKTE edilir — bu modül ayar modülünü içe AKTARMAZ (durdurma ucunun grafiği Beyin birimine uzanmasın, gate:stop-service (1), K-7). Üretimde zincir
 *  (tazeleme) ve RESUME ucu `readTickMs`'i verir. Verilmezse kopyaya tik alanı YAZILMAZ ve tik kapalı arızalanır (varsayılan sayı yok). */
export type TickSource = () => Promise<{ ok: true; tickMs: number } | { ok: false; detail: string }>;
/** Kopyaya yazılacak tik alanları; FIRLATMAZ (okuyucu fırlatsa da sebep alana düşer). Okuyucu yoksa boş nesne (alan yazılmaz). */
const tickOf = async (deps: Deps): Promise<Pick<ControlDoc, "tickMs" | "tickNote">> => { if (!deps.tickSource) return {};
  try { const t = await deps.tickSource(); return t.ok ? { tickMs: t.tickMs } : { tickMs: null, tickNote: t.detail }; } catch (e) { return { tickMs: null, tickNote: `tik aralığı okunamadı (${(e as { name?: string })?.name ?? "error"})` }; } };
type Attempt<T> = { ok: true; value: T; ms: number } | { ok: false; error: string; ms: number };

/** Depo işlemi: zaman aşımlı, ASLA fırlatmaz (kurulum/sözleşme hatası dâhil). Hata metni yalnız sınıf adı (S-2). */
export async function attempt<T>(fn: () => Promise<T>, timeoutMs: number = STOP_TIMING.storeTimeoutMs): Promise<Attempt<T>> {
  const t0 = performance.now(); let timer: ReturnType<typeof setTimeout> | undefined;
  try { const value = await Promise.race([fn(), new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("timeout")), timeoutMs); })]); return { ok: true, value, ms: Math.round(performance.now() - t0) }; }
  catch (e) { return { ok: false, error: e instanceof Error && e.message === "timeout" ? "timeout" : ((e as { name?: string })?.name ?? "error"), ms: Math.round(performance.now() - t0) }; }
  finally { if (timer) clearTimeout(timer); }
}
const fmt = (p: Persisted) => `neon:${p.neon},upstash:${p.upstash}`;
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---- kopyalar ----
const parse = (s: string | null): ControlDoc | null => { if (s === null) return null; const d = JSON.parse(s) as ControlDoc; if (d.state !== "RUNNING" && d.state !== "STOPPED") throw new Error("bad-doc"); return d; };
const rowToDoc = (r: { state: string; mode: string | null; permitUntil: Date | null; by: string; at: Date } | null): ControlDoc | null => r && { state: r.state as ControlDoc["state"], mode: r.mode as StopMode | null, permitUntil: r.permitUntil?.toISOString() ?? null, by: r.by, at: r.at.toISOString() };
/** Neon kopyası (kalıcı, `engine_control` id=1). İstemci tembel (dar sözleşme, db/client). Yenileme CAS: yalnız RUNNING ve `at` değişmemişse. */
export const neonFlagStore = (client?: PrismaClient): FlagStore => { const db = () => client ?? getDb(); return {
  read: async () => rowToDoc(await db().engineControl.findUnique({ where: { id: 1 } })),
  write: async (d) => { const data = { state: d.state, mode: d.mode, permitUntil: d.permitUntil ? new Date(d.permitUntil) : null, by: d.by, at: new Date(d.at) }; await db().engineControl.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data }); },
  renew: async (prev, next) => (await db().engineControl.updateMany({ where: { id: 1, state: "RUNNING", at: new Date(prev.at) }, data: { permitUntil: next.permitUntil ? new Date(next.permitUntil) : null } })).count === 1,
}; };
/** Upstash kopyası (hızlı, `engine:control`; `key` yalnız kanarya için — kendi ad alanı, S-9). Tur 22: RUNNING kopya SÜRELİDİR (SET … PX RUN_PERMIT_MS, `syncedAt` taşır) — TTL'siz RUNNING kopya YAZILAMAZ (kapı); STOPPED TTL'sizdir (durdurma
 *  bayrağı kendiliğinden silinmez). Dar sözleşme (yalnız Upstash adları). Yenileme CAS: EVAL — eski belge birebir eşitse yaz; ARGV[3] boş değilse PX (RUNNING), boşsa TTL'siz (STOPPED taşıma). */
const CAS_LUA = "if redis.call('GET', KEYS[1]) == ARGV[1] then if ARGV[3] ~= '' then redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3]) else redis.call('SET', KEYS[1], ARGV[2]) end return 1 end return 0";
const copyOf = (d: ControlDoc, syncedAt: string): ControlDoc => ({ ...d, syncedAt });
export const upstashFlagStore = (cfg?: { url: string; token: string }, key: string = CONTROL_KEY): FlagStore => { const c = () => { if (cfg) return cfg; const e = pickEnv("UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"); return { url: e.UPSTASH_REDIS_REST_URL, token: e.UPSTASH_REDIS_REST_TOKEN }; }; return {
  read: async () => parse((await redisPipeline([["GET", key]], c()))[0] as string | null),
  write: async (d) => { await redisPipeline([d.state === "RUNNING" ? ["SET", key, JSON.stringify(copyOf(d, d.syncedAt ?? d.at)), "PX", RUN_PERMIT_MS] : ["SET", key, JSON.stringify(d)]], c()); },
  renew: async (prev, next) => (await redisPipeline([["EVAL", CAS_LUA, 1, key, JSON.stringify(prev), JSON.stringify(next), next.state === "RUNNING" ? RUN_PERMIT_MS : ""]], c()))[0] === 1,
}; };
/** Kapı/kanarya deposu (S-9): `fail` fırlatır, `hang` asla dönmez (zaman aşımı ölçümü), `doc` içerik; `now` verilirse RUNNING kopyanın TTL'i (`exp`) sahte saatle ölçülür (Tur 22). */
export function memoryFlagStore(now: () => number = Date.now): FlagStore & { doc: ControlDoc | null; exp: number | null; fail: boolean; hang: boolean; writes: number } {
  const s = { doc: null as ControlDoc | null, exp: null as number | null, fail: false, hang: false, writes: 0 };
  const guard = async () => { if (s.hang) await new Promise<never>(() => {}); if (s.fail) throw new Error("store-down"); };
  const put = (d: ControlDoc) => { s.doc = d.state === "RUNNING" ? copyOf(d, d.syncedAt ?? d.at) : d; s.exp = d.state === "RUNNING" ? now() + RUN_PERMIT_MS : null; };
  const live = () => { if (s.exp !== null && s.exp <= now()) { s.doc = null; s.exp = null; } return s.doc; };
  return Object.assign(s, { read: async () => { await guard(); return live(); }, write: async (d: ControlDoc) => { await guard(); put(d); s.writes++; }, renew: async (prev: ControlDoc, next: ControlDoc) => { await guard(); if (JSON.stringify(live()) !== JSON.stringify(prev)) return false; put(next); return true; } });
}
let prodStores: Stores | null = null;
const defaultStores = (): Stores => (prodStores ??= { neon: neonFlagStore(), upstash: upstashFlagStore() });

/** İki kopyaya paralel, en iyi çaba; `done` olan atlanır. `onlyIfNotNewer`: okuduğu anda depoda daha yeni niyet görürse yazmayı atlar, yine "yerleşti" sayılır.
 *  ATOMİK DEĞİLDİR (Tur 43 madde 2 düzeltmesi; Tur 42 ölçtü): okuma-sonra-yazmadır ve zaman aşımına uğrayan ilk yazım iptal edilmeden koşulsuz düşer ⇒ yeniden deneme
 *  penceresi (`STOP_TIMING.retryWindowMs`) içinde geç düşen bir DURDURMA, araya giren daha yeni bir RUNNING'in (RESUME) üzerine YAZABİLİR. Bu yön BİLEREK böyledir:
 *  K-7 durdurmayı koşulsuz sayar, durdurma kazanır (Üretim kararı 2026-09-18, Pusula decisions/winvestor-durdurma-yarisi = A). Atomik koşullu yazım sicilde, çapa G08. */
async function writeBoth(st: Stores, doc: ControlDoc, done: Persisted = { neon: false, upstash: false }, onlyIfNotNewer = false): Promise<Persisted> {
  const one = async (s: FlagStore) => { if (onlyIfNotNewer) { const cur = await s.read(); if (cur && cur.at > doc.at) return; } await s.write(doc); };
  const [n, u] = await Promise.all([done.neon ? Promise.resolve({ ok: true }) : attempt(() => one(st.neon)), done.upstash ? Promise.resolve({ ok: true }) : attempt(() => one(st.upstash))]);
  return { neon: n.ok, upstash: u.ok };
}
/** Yanıttan sonra: eksik kopya(lar) izin ömrü kadar yeniden denenir; sonucu olay olarak yazılır (K-8). */
async function retryPersist(st: Stores, flag: ControlDoc, first: Persisted, deps: Deps): Promise<void> {
  const now = deps.now ?? Date.now, sleep = deps.sleep ?? realSleep, until = now() + STOP_TIMING.retryWindowMs; let p = first, n = 0;
  while (!(p.neon && p.upstash) && now() < until) { await sleep(STOP_TIMING.retryEveryMs); n++; p = await writeBoth(st, flag, p, true); }
  if (n > 0) await stopEngine("STOP_BUTTON", `gecikmeli kalıcılaştırma · ${flag.by} · seçenek=${flag.mode} · deneme=${n} · kalıcı=${fmt(p)} · ${flag.at}`, {}, deps.events);
}

// ---- durdurma ----
export type StopOutcome =
  | { ok: true; status: 200 | 202; accepted: true; durable: boolean; persisted: Persisted; flag: ControlDoc; mode: StopMode; modeMeaning: string; closeRequested: boolean; closeExecuted: false; event: EmitResult; retry: { scheduled: boolean; windowMs: number } }
  | { ok: false; status: 400; reason: "MODE_REQUIRED"; options: Record<StopMode, string> };
/** Seçeneği ayrıştır — varsayılan YOK (K-7: yazılım seçmez). */
export const parseStopMode = (body: unknown): StopMode | null => { const m = (body as { mode?: unknown } | null)?.mode; return m === "HOLD" || m === "CLOSE_ALL" ? m : null; };
/** Durdur: bayrak (iki kopya, en iyi çaba) → olay → gerekirse yanıt sonrası yeniden deneme. Hiçbir depo, olay ya da dış servis ön koşul değildir; seçeneksiz istek reddedilir. */
export async function requestStop(body: unknown, by: string, deps: Deps = {}): Promise<StopOutcome> {
  const mode = parseStopMode(body); if (!mode) return { ok: false, status: 400, reason: "MODE_REQUIRED", options: STOP_MODES };
  const st = deps.stores ?? defaultStores(), flag: ControlDoc = { state: "STOPPED", mode, permitUntil: null, by, at: new Date((deps.now ?? Date.now)()).toISOString() };
  const persisted = await writeBoth(st, flag), durable = persisted.neon || persisted.upstash, complete = persisted.neon && persisted.upstash;
  const event = await stopEngine("STOP_BUTTON", `${by} · seçenek=${mode} (${STOP_MODES[mode]}) · kalıcı=${fmt(persisted)} · ${flag.at}`, {}, deps.events);
  const scheduled = !complete && deps.defer !== undefined; if (scheduled) deps.defer!(() => retryPersist(st, flag, persisted, deps));
  return { ok: true, status: durable ? 200 : 202, accepted: true, durable, persisted, flag, mode, modeMeaning: STOP_MODES[mode], closeRequested: mode === "CLOSE_ALL", closeExecuted: false, event, retry: { scheduled, windowMs: STOP_TIMING.retryWindowMs } };
}

// ---- yeniden başlatma (HASSAS; uç sensitive + ENGINE_RESTART) ----
export type ResumeOutcome = { ok: true; status: 200; flag: ControlDoc; persisted: Persisted; event: EmitResult } | { ok: false; status: 503; reason: "STORE_UNAVAILABLE"; persisted: Persisted; note: string }
  | { ok: false; status: 409; reason: "TICK_UNSET"; persisted: Persisted; note: string };
/** İki kopya da yazılmadan çalışma izni verilmez (kapalı arıza); kısmi yazımda okuyucu zaten çalıştırmaz. */
export async function requestResume(by: string, deps: Deps = {}): Promise<ResumeOutcome> {
  const st = deps.stores ?? defaultStores(), now = (deps.now ?? Date.now)();
  // ISINDIRMA (Tur 23, ÖLÇÜLDÜ üretimde prod-tur23.cjs 13:00:04Z): durmuş motorda Neon UYUR; soğuk bağlantı 3–4 s (Tur 21/22 ölçümü) > storeTimeoutMs 1,5 s ⇒ ilk RESUME 503 (neon:false) veriyordu. Yazımdan önce Neon
  //   tazeleme tavanıyla (10 s) bir kez okunur — bağlantı kurulur, sonraki 1,5 s'lik yazım ısınmış bağlantıda geçer. Okuma düşerse yazım yine denenir (sonuç dürüst: 503). Durdurma yoluna DOKUNMAZ (K-7: stop 1,5 s kalır).
  const warm = await attempt(() => st.neon.read(), PERMIT_REFRESH_TIMEOUT_MS);
  // TUR 67 (K3 = [A]): tik aralığı ısınmış Neon'dan okunur ve izin kopyasına YAZILIR (tik onu kopyadan alır). Okuyucu verildi ve aralık yok/okunamadı ⇒ izin VERİLMEZ (409), bayrak YAZILMADAN (yarım izin yok):
  //   aralıksız bir izin motoru dakikada bir kapalı arızaya (TICK_MISSED) sokardı. Durdurma yolu bu okumaya bağlı DEĞİLDİR (K-7).
  const tk = await attempt(() => tickOf(deps), PERMIT_REFRESH_TIMEOUT_MS), tick = tk.ok ? tk.value : { tickMs: null, tickNote: `tik aralığı okunamadı (${tk.error})` };
  if (deps.tickSource && typeof tick.tickMs !== "number") return { ok: false, status: 409, reason: "TICK_UNSET", persisted: { neon: false, upstash: false }, note: `çalışma izni verilmedi, bayrak yazılmadı: ${tick.tickNote ?? "tik aralığı yok"}` };
  const flag: ControlDoc = { state: "RUNNING", mode: null, permitUntil: new Date(now + RUN_PERMIT_MS).toISOString(), by, at: new Date(now).toISOString(), ...tick };
  const persisted = await writeBoth(st, flag);
  if (!(persisted.neon && persisted.upstash)) return { ok: false, status: 503, reason: "STORE_UNAVAILABLE", persisted, note: `iki kopya da yazılmadan çalışma izni verilmez; okuyucu kısmi yazımda çalıştırmaz · Neon ısındırma ${warm.ok ? "tamam" : warm.error} ${warm.ms} ms` };
  const event = await stopEngine("RESTART", `${by} · izin ${flag.permitUntil} · kalıcı=${fmt(persisted)}`, {}, deps.events);
  return { ok: true, status: 200, flag, persisted, event };
}

// ---- Kas tarafı okuyucular ----
export type PermitDenial = "UNREADABLE" | "NO_PERMIT" | "STOPPED" | "PERMIT_EXPIRED";
/** Tazeleme sonucu (Tur 22): `ok` → Neon okundu, Neon izni uzatıldı, kopya yeni TTL'le yazıldı; `ok:false` → kopya UZATILMADI (TTL'i akmaya devam eder), sebep ve olay yanıtta. */
export type Refresh = { ok: true; neon: "RUNNING"; ms: number; renewed: Persisted } | { ok: false; neon: string; ms: number; event: EmitResult | null };
/** `since`: RUNNING belgesinin yazıldığı an (RESUME; yenileme değiştirmez) — Tur 21 cron tiki "atlanan tik" sayarken durdurma öncesi kaydı bununla ayırır. `refresh`: yalnız tik okuyucusunda (Tur 22). */
export type Permit = { run: true; permitUntil: string; msLeft: number; since: string; renewed: Persisted | null; refresh?: Refresh | null; tickMs?: number | null; tickNote?: string } | { run: false; reason: PermitDenial; stores: Record<StoreName, string>; doc: ControlDoc | null };
/** SIKI OKUYUCU (Tur 9) — EMİR yolunda (executeSignal, K-6/K-7): iki kopya da okunmadan, ikisi de RUNNING olmadan ya da izin süresi dolmuşsa run:false (sebepli). Yenileme CAS'lı: araya giren
 *  durdurma ezilmez. `renewBelowMs`: kalan izin bunun altındaysa yenilenir (varsayılan iznin yarısı). Tik yolu bunu KULLANMAZ (Tur 22: tik yalnız kopyayı okur, `peekRunPermit`). */
export async function readRunPermit(deps: Deps = {}, renewBelowMs: number = RUN_PERMIT_MS / 2): Promise<Permit> {
  const st = deps.stores ?? defaultStores(), now = (deps.now ?? Date.now)();
  const [n, u] = await Promise.all([attempt(() => st.neon.read()), attempt(() => st.upstash.read())]);
  const stores = { neon: n.ok ? (n.value?.state ?? "yok") : n.error, upstash: u.ok ? (u.value?.state ?? "yok") : u.error };
  if (!n.ok || !u.ok) return { run: false, reason: "UNREADABLE", stores, doc: null };
  const nd = n.value, ud = u.value;
  if (!nd || !ud) return { run: false, reason: "NO_PERMIT", stores, doc: nd ?? ud };
  const stopped = [nd, ud].filter((d) => d.state === "STOPPED").sort((a, b) => (a.at < b.at ? 1 : -1))[0];
  if (stopped) return { run: false, reason: "STOPPED", stores, doc: stopped };
  const until = Math.min(...[nd, ud].map((d) => (d.permitUntil ? Date.parse(d.permitUntil) : 0))); // izin = iki kopyanın en kısası
  if (!(until > now)) return { run: false, reason: "PERMIT_EXPIRED", stores, doc: nd };
  let renewed: Persisted | null = null;
  if (until - now < renewBelowMs) { const p = new Date(now + RUN_PERMIT_MS).toISOString(); const [rn, ru] = await Promise.all([attempt(() => st.neon.renew(nd, { ...nd, permitUntil: p })), attempt(() => st.upstash.renew(ud, { ...ud, permitUntil: p, syncedAt: new Date(now).toISOString() }))]); renewed = { neon: rn.ok && rn.value, upstash: ru.ok && ru.value }; }
  return { run: true, permitUntil: new Date(until).toISOString(), msLeft: until - now, since: nd.at > ud.at ? nd.at : ud.at, renewed };
}
/** TAZELEME (Tur 22) — kopyanın Neon'la buluştuğu TEK yer: Neon okunur (tavan PERMIT_REFRESH_TIMEOUT_MS); RUNNING ise Neon izni CAS ile uzatılır ve kopya CAS ile yeni `permitUntil`/`syncedAt`/TTL'le
 *  yazılır; STOPPED ise durdurma kopyaya taşınır (motor durur). Neon okunamadı/yok/CAS düştü ⇒ kopya UZATILMAZ, olay yazılır (K-8), tik bir sonraki turda yeniden dener; TTL dolunca motor durur. */
async function refreshPermitCopy(st: Stores, ud: ControlDoc, now: number, deps: Deps): Promise<{ refresh: Refresh; stopped: ControlDoc | null; next: ControlDoc | null }> {
  const n = await attempt(() => st.neon.read(), PERMIT_REFRESH_TIMEOUT_MS), iso = new Date(now).toISOString();
  const fail = async (neon: string): Promise<{ refresh: Refresh; stopped: null; next: null }> => ({ refresh: { ok: false, neon, ms: n.ms, event: await stopEngine("PERMIT_REFRESH_FAILED", `izin kopyası Neon'dan tazelenemedi: ${neon} · kopya ${ud.syncedAt ?? ud.at}'den beri · kopya en geç ${ud.permitUntil} söner (TTL), sonra motor durur ve yalnız RESUME başlatır (K-7)`, {}, deps.events) }, stopped: null, next: null });
  if (!n.ok) return fail(n.error);
  const nd = n.value; if (!nd) return fail("Neon satırı yok");
  if (nd.state === "STOPPED") { await attempt(() => st.upstash.renew(ud, nd), PERMIT_REFRESH_TIMEOUT_MS); return { refresh: { ok: false, neon: "STOPPED", ms: n.ms, event: null }, stopped: nd, next: null }; }
  const p = new Date(now + RUN_PERMIT_MS).toISOString(), rn = await attempt(() => st.neon.renew(nd, { ...nd, permitUntil: p }), PERMIT_REFRESH_TIMEOUT_MS);
  if (!rn.ok || !rn.value) return fail(rn.ok ? "Neon CAS düştü (araya yazım girdi)" : rn.error);
  // TUR 67 (K3 = [A]): tazeleme tik aralığını da taşır — Neon zaten uyanık, tik başına Neon 0 korunur. Aralık okunamazsa izin YİNE uzatılır (durdurma/izin tik ayarından bağımsız, K-7) ama kopyaya
  //   `tickMs: null` + sebep yazılır ⇒ tik kapalı arızalanır (TICK_MISSED) ve bir sonraki tazelemede yeniden denenir.
  const tk = await attempt(() => tickOf(deps), PERMIT_REFRESH_TIMEOUT_MS);
  const next: ControlDoc = { ...nd, permitUntil: p, syncedAt: iso, ...(tk.ok ? tk.value : { tickMs: null, tickNote: `tik aralığı okunamadı (${tk.error})` }) }, ru = await attempt(() => st.upstash.renew(ud, next), PERMIT_REFRESH_TIMEOUT_MS);
  if (!ru.ok || !ru.value) return fail(ru.ok ? "kopya CAS düştü (araya durdurma girdi)" : ru.error);
  return { refresh: { ok: true, neon: "RUNNING", ms: n.ms + rn.ms + ru.ms, renewed: { neon: true, upstash: true } }, stopped: null, next };
}
/** TİK OKUYUCUSU (Tur 20 nöbetçi → Tur 22 tek tik okuyucusu): YALNIZ Upstash kopyası okunur; Neon'a tik başına DOKUNULMAZ. KAPALI ARIZA aynen: okunamadı → UNREADABLE, yok/TTL ile söndü → NO_PERMIT,
 *  STOPPED → STOPPED, izin dolmuş → PERMIT_EXPIRED. Kopya `syncedAt`'ten PERMIT_REFRESH_MS geçtiyse tazelenir (Neon o zaman okunur — tek Neon yolu). Otomatik yeniden başlatma yok. */
export async function peekRunPermit(deps: Deps = {}): Promise<Permit> {
  const st = deps.stores ?? defaultStores(), now = (deps.now ?? Date.now)(), u = await attempt(() => st.upstash.read());
  if (!u.ok) return { run: false, reason: "UNREADABLE", stores: { neon: "okunmadı (Upstash kopyası okunamadı)", upstash: u.error }, doc: null };
  const ud = u.value;
  if (!ud) return { run: false, reason: "NO_PERMIT", stores: { neon: "okunmadı (Upstash kopyası yok ya da TTL ile söndü)", upstash: "yok" }, doc: null };
  if (ud.state !== "RUNNING") return { run: false, reason: "STOPPED", stores: { neon: "okunmadı (Upstash kopyası STOPPED)", upstash: ud.state }, doc: ud };
  const until = ud.permitUntil ? Date.parse(ud.permitUntil) : 0;
  if (!(until > now)) return { run: false, reason: "PERMIT_EXPIRED", stores: { neon: "okunmadı (kopyadaki izin dolmuş)", upstash: "RUNNING" }, doc: ud };
  let refresh: Refresh | null = null, cur = ud;
  if (now - Date.parse(ud.syncedAt ?? ud.at) >= PERMIT_REFRESH_MS) { const r = await refreshPermitCopy(st, ud, now, deps); if (r.stopped) return { run: false, reason: "STOPPED", stores: { neon: "STOPPED (tazelemede okundu)", upstash: "STOPPED (taşındı)" }, doc: r.stopped }; refresh = r.refresh; cur = r.next ?? ud; }
  return { run: true, permitUntil: cur.permitUntil as string, msLeft: Date.parse(cur.permitUntil as string) - now, since: ud.at, renewed: null, refresh, tickMs: cur.tickMs, tickNote: cur.tickNote }; // Tur 67: tik aralığı kopyadan (ek komut yok)
}
