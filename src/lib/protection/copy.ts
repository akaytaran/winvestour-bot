// POZİSYON DURUMU KOPYASI (Tur 23 · K-1, K-2, K-7, K-8, K-10, M-1, Ö-2, A-9). Kapı: scripts/gate-chain.mjs (tik yolu) + gate-protection.mjs (K-2, kapanış) + gate-trailing.mjs (tepe).
// NEDEN: Tur 22 Neon'u izin yolundan çıkardı ama açık pozisyon varken G12/G14 `positions` tablosunu HER TİK okuyor/yazıyordu ⇒ Neon uyumuyor ⇒ ≈ 20,6 $/ay (Tur 22 §4). Pozisyon verisi
//   sık DEĞİŞMEZ (açılış, tepe, koruma taşıma, kapanış) ama her tikte OKUNUR. Bu modül tik için gereken özeti (sembol, giriş, büyüklük, tepe, KORUMA EMRİ KİMLİĞİ) Upstash'te SÜRELİ bir kopyada tutar.
// NEON KALICI GERÇEKTİR: her değişim ÖNCE Neon'a yazılır (`withPositionCopy`: open/protect/reprotect/close Neon'a, kapanış DERHAL), SONRA kopya güncellenir. Tepe (K-10) yalnız kopyaya yazılır;
//   Neon'a OLAY TETİKLİ yazılır (koruma taşınırken, kapanışta, tazelemede) — her tikte değil. Kopya yazılamazsa SİLİNİR (bir sonraki tik Neon'dan kurar) + olay; tepe için Neon'a yazılır (K-10 gecikmez).
// TİK YALNIZ KOPYAYI OKUR (`readPositions`). Neon'a yalnız TAZELEMEDE dokunulur (`refreshPositionCopy`): kopya yoksa, vadesi geldiyse ya da izin tazelemesi aynı tikteyse (Neon zaten uyanık).
//   Tazelemede kopya ile Neon KARŞILAŞTIRILIR: uyuşmazlıkta NEON KAZANIR, olay yazılır, bir sonraki TUTARLI tazelemeye kadar YENİ POZİSYON AÇILMAZ (`quarantine`; çıkış ve koruma sürer, M-1).
// "OKUNAMADI" ≠ "BOŞ" (madde 2, en tehlikeli hata): kopya BOŞ (`positions: []`) → gerçekten açık pozisyon yok → normal. Kopya OKUNAMIYOR ya da YOK (TTL ile söndü) ve Neon'dan kurulamadı →
//   durum BİLİNMİYOR → `ok:false` (motor durmuş sayılır: iş yapılmaz, giriş yok, olay POSITIONS_UNKNOWN). ASLA "pozisyon yok" varsayılmaz. Koruma borsada (K-1) — bu tik iş yapmasa da koruma durur.
// K-2: koruma kimliği OLMAYAN açık pozisyon kopyaya YAZILAMAZ (`assertProtected` — depo düzeyinde, her yazımda; DB CHECK'in kopyadaki karşılığı).
import { Prisma } from "@/generated/prisma/client";
import { PERMIT_GRACE_MS, PERMIT_REFRESH_MS, PERMIT_REFRESH_TIMEOUT_MS, STOP_TIMING, attempt } from "@/lib/engine-control";
import { pickEnv } from "@/lib/env";
import { stopEngine, type Deps as EventDeps, type EmitResult } from "@/lib/events";
import { redisPipeline } from "@/lib/upstash";
import { prismaPositionStore, type OpenPosition, type PositionSeed, type PositionStore } from "./index";

/** TUR 23 SAYILARI (tek yerde; sicil, geri alınabilir) — SEÇİM, AÇIK (A-1):
 *  POSITION_REFRESH_MS = PERMIT_REFRESH_MS (20 dk): kopya Neon'la bu aralıkla KARŞILAŞTIRILIR. Bu bir tutarlılık denetimidir, veri yolu değil — kopya her değişimde yazılır. İzin tazelemesiyle
 *    AYNI tikte koşar (`readPositions(deps, force = permit.refresh.ok)`) ⇒ ek Neon uyanışı 0. Daha sık ayrı bir aralık her uyanışta ≈ 330 s Neon demektir (uyku eşiği ÖLÇÜLDÜ, Tur 21/22):
 *    10 dk ⇒ ≈ %55 ⇒ 0,25 CU'da ≈ 10,5 $/ay (tavan aşılır) · 15 dk ⇒ ≈ %37 ⇒ 7,1 $ (izin döngüsüyle çakışmayan uyanışlar eklenince aşar) · 20 dk hizalı ⇒ ≈ %28 ⇒ 5,3 $ (Tur 22 ile aynı).
 *    "Sıkılık" buradan değil, DEĞİŞİM ANINDA YAZIM + yazılamayan kopyanın SİLİNMESİ kuralından gelir: kopya hiçbir zaman bilerek eski bir durum taşımaz.
 *  POSITION_COPY_TTL_MS = POSITION_REFRESH_MS + PERMIT_GRACE_MS (24 dk): kopyanın ÖMRÜ. TTL `syncedAt`'e ÇAPALIDIR: değişim yazımı ömrü UZATMAZ (Neon'la buluşmadan kopya sonsuza dek yaşayamaz).
 *    Dolunca kopya YOK ⇒ Neon'dan kurulur; Neon da erişilemezse durum BİLİNMİYOR (motor durmuş sayılır). Neon erişilemezken motor en geç 24 dk çalışır (izin kopyasıyla aynı bedel, K-7).
 *  POSITION_COPY_TIMEOUT_MS = STOP_TIMING.storeTimeoutMs (1,5 s): kopya okuma/yazma tavanı. POSITION_REFRESH_TIMEOUT_MS = PERMIT_REFRESH_TIMEOUT_MS (10 s): tazelemede Neon tavanı (soğuk Neon ÖLÇÜLDÜ 3,3–4,3 s). */
export const POSITION_REFRESH_MS = PERMIT_REFRESH_MS;
export const POSITION_COPY_TTL_MS = POSITION_REFRESH_MS + PERMIT_GRACE_MS;
export const POSITION_COPY_TIMEOUT_MS = STOP_TIMING.storeTimeoutMs;
export const POSITION_REFRESH_TIMEOUT_MS = PERMIT_REFRESH_TIMEOUT_MS;
export const POSITION_COPY_KEY = "positions:copy";

const D = Prisma.Decimal, iso = (ms: number) => new Date(ms).toISOString();
/** Kopya belgesi: tik için gereken özet + `syncedAt` (Neon'la son buluşma; TTL çapası) + `quarantine` (son tazelemede uyuşmazlık: giriş kapalı, tutarlı tazelemede silinir). */
export type CopyDoc = { positions: OpenPosition[]; syncedAt: string; quarantine: { at: string; detail: string } | null };
export interface PositionCopyStore { read(): Promise<CopyDoc | null>; write(doc: CopyDoc): Promise<void>; cas(prev: CopyDoc, next: CopyDoc): Promise<boolean>; del(): Promise<void> }
/** K-2 — kimliksiz açık pozisyon kopyaya GİREMEZ: her depo her yazımda çağırır; ihlal fırlatır (yazım olmaz, çağıran olay yazar). */
export function assertProtected(doc: CopyDoc): CopyDoc { const bad = doc.positions.filter((p) => !p.protectionOrderId); if (bad.length) throw new Error(`K-2: koruma kimliksiz pozisyon kopyaya yazılamaz (${bad.map((p) => p.id).join(",")})`); return doc; }
/** TTL `syncedAt`'e çapalı: kalan ömür = syncedAt + TTL − şimdi (en az 1 ms; dolmuşsa anahtar hemen söner). */
export const pxOf = (doc: CopyDoc, now: number) => Math.max(1, Date.parse(doc.syncedAt) + POSITION_COPY_TTL_MS - now);
const CAS_LUA = "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3]) return 1 end return 0";
const parse = (s: unknown): CopyDoc | null => { if (typeof s !== "string") return null; const d = JSON.parse(s) as CopyDoc; if (!Array.isArray(d.positions) || typeof d.syncedAt !== "string") throw new Error("bad-doc"); return d; };
/** Upstash kopyası (`positions:copy`; `key` yalnız kanarya ad alanı, S-9). Dar sözleşme. */
export const upstashPositionCopy = (cfg?: { url: string; token: string }, key: string = POSITION_COPY_KEY, now: () => number = Date.now): PositionCopyStore => { const c = () => { if (cfg) return cfg; const e = pickEnv("UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"); return { url: e.UPSTASH_REDIS_REST_URL, token: e.UPSTASH_REDIS_REST_TOKEN }; }; return {
  read: async () => parse((await redisPipeline([["GET", key]], c()))[0]),
  write: async (d) => { await redisPipeline([["SET", key, JSON.stringify(assertProtected(d)), "PX", pxOf(d, now())]], c()); },
  cas: async (p, n) => (await redisPipeline([["EVAL", CAS_LUA, 1, key, JSON.stringify(p), JSON.stringify(assertProtected(n)), pxOf(n, now())]], c()))[0] === 1,
  del: async () => { await redisPipeline([["DEL", key]], c()); },
}; };
/** Kapı/kanarya deposu (S-9): sahte saatle TTL (`exp`), `fail` fırlatır; `writes` sayılır. */
export function memoryPositionCopy(now: () => number = Date.now): PositionCopyStore & { doc: CopyDoc | null; exp: number | null; fail: boolean; writes: number } {
  const s = { doc: null as CopyDoc | null, exp: null as number | null, fail: false, writes: 0 };
  const g = () => { if (s.fail) throw new Error("copy-store-down"); }, live = () => { if (s.exp !== null && s.exp <= now()) { s.doc = null; s.exp = null; } return s.doc; }, put = (d: CopyDoc) => { s.doc = assertProtected(JSON.parse(JSON.stringify(d)) as CopyDoc); s.exp = now() + pxOf(d, now()); s.writes++; };
  return Object.assign(s, { read: async () => { g(); return live(); }, write: async (d: CopyDoc) => { g(); put(d); }, cas: async (p: CopyDoc, n: CopyDoc) => { g(); if (JSON.stringify(live()) !== JSON.stringify(p)) return false; put(n); return true; }, del: async () => { g(); s.doc = null; s.exp = null; } });
}
let prodCopy: PositionCopyStore | null = null;
export const defaultPositionCopy = () => (prodCopy ??= upstashPositionCopy());
export type CopyDeps = { positions?: PositionStore; copy?: PositionCopyStore; events?: EventDeps; now?: () => number };

// ---- DEĞİŞİM ANINDA KOPYA: Neon önce (kalıcı gerçek), kopya sonra; kopya yazılamazsa silinir + olay; tepe yalnız kopyaya (Neon'a olay tetikli) ----
/** Üretimde tik bunu kullanır: `withPositionCopy(Neon deposu, Upstash kopyası)`. Kanarya kendi depolarını enjekte eder (S-9). */
export const positionStore = (deps: CopyDeps): PositionStore => withPositionCopy(deps.positions ?? prismaPositionStore(), deps.copy ?? defaultPositionCopy(), deps);
export function withPositionCopy(neon: PositionStore, copy: PositionCopyStore, deps: { events?: EventDeps; now?: () => number } = {}): PositionStore {
  const seeds = new Map<number, PositionSeed>();
  /** Kopyayı değiştir (CAS). Kopya yoksa: dokunma (bir sonraki tik Neon'dan kurar); `fallback` (tepe → Neon) çalışır. Okunamadı/CAS düştü: kopya SİLİNİR (eski durum taşımasın) + olay (K-8) + fallback. */
  const change = async (what: string, mutate: (d: CopyDoc) => CopyDoc | null, fallback?: () => Promise<unknown>): Promise<boolean> => {
    const r = await attempt(() => copy.read(), POSITION_COPY_TIMEOUT_MS); let why: string | null = null;
    if (r.ok && r.value !== null) { const next = mutate(r.value); if (next === null) return true; const w = await attempt(() => copy.cas(r.value as CopyDoc, next), POSITION_COPY_TIMEOUT_MS); if (w.ok && w.value) return true; why = w.ok ? "CAS düştü (araya yazım girdi)" : `yazılamadı: ${w.error}`; }
    else if (!r.ok) why = `okunamadı: ${r.error}`;
    if (fallback) await attempt(fallback, POSITION_REFRESH_TIMEOUT_MS);
    if (why !== null) { const d = await attempt(() => copy.del(), POSITION_COPY_TIMEOUT_MS); await stopEngine("POSITION_COPY_STALE", `${what}: pozisyon kopyası ${why}; kopya ${d.ok ? "SİLİNDİ — bir sonraki tik Neon'dan kurar" : `silinemedi (${d.error}) — en geç TTL'de söner`}; Neon kalıcı gerçek${fallback ? ", tepe Neon'a yazıldı (K-10)" : ""}`, {}, deps.events); }
    return false;
  };
  const upd = (id: number, f: (p: OpenPosition) => OpenPosition | null) => (d: CopyDoc): CopyDoc | null => { const cur = d.positions.find((p) => p.id === id); if (!cur) return null; const np = f(cur); return { ...d, positions: np === null ? d.positions.filter((p) => p.id !== id) : d.positions.map((p) => (p.id === id ? np : p)) }; };
  return {
    open: async (s) => { const r = await neon.open(s); seeds.set(r.id, s); return r; }, listOpen: () => neon.listOpen(), history: (s, a, b) => neon.history(s, a, b),
    protect: async (id, pid) => { const ok = await neon.protect(id, pid); if (!ok) return false; let row: OpenPosition | null = null; const s = seeds.get(id);
      if (s) row = { id, symbol: s.symbol, market: s.market, quantity: s.quantity, entryPrice: s.entryPrice, protectionOrderId: pid, peakPrice: null }; else { const n = await attempt(() => neon.listOpen(), POSITION_REFRESH_TIMEOUT_MS); row = n.ok ? (n.value.find((p) => p.id === id) ?? null) : null; }
      if (row) await change("açılış", (d) => ({ ...d, positions: [...d.positions.filter((p) => p.id !== id), row as OpenPosition] })); return true; },
    close: async (id, status, at, peak) => { const ok = await neon.close(id, status, at, peak); if (ok) await change("kapanış", upd(id, () => null)); return ok; }, // Neon DERHAL, kopya sonra
    reprotect: async (id, pid, peak) => { const ok = await neon.reprotect(id, pid, peak); if (ok) await change("koruma taşıma", upd(id, (p) => ({ ...p, protectionOrderId: pid, peakPrice: peak ?? p.peakPrice }))); return ok; },
    peak: async (id, price) => change("tepe", upd(id, (p) => ({ ...p, peakPrice: price })), () => neon.peak(id, price)), // K-10: kopyaya; kopya yoksa/yazılamazsa Neon'a (gecikmez)
  };
}

// ---- TİK OKUYUCUSU: yalnız kopya; Neon yalnız tazelemede ----
export type CopyRefresh = { ok: true; neon: number; mismatch: string | null; peaksToNeon: number; copyWritten: boolean; ms: number; event: EmitResult | null } | { ok: false; detail: string; ms: number; event: EmitResult | null };
export type PositionsRead = { ok: true; positions: OpenPosition[]; source: "copy" | "neon"; syncedAt: string; quarantined: string | null; refresh: CopyRefresh | null } | { ok: false; reason: "UNREADABLE" | "UNKNOWN"; detail: string; event: EmitResult };
const key = (p: OpenPosition) => `${p.id}|${p.symbol}|${p.market}|${p.quantity}|${p.entryPrice}|${p.protectionOrderId}`;
/** TAZELEME — kopyanın Neon'la buluştuğu TEK yer: Neon okunur (tavan 10 s), kopyayla KARŞILAŞTIRILIR (kimlik alanları; tepe hariç — tepe DÜŞMEZ, en yükseği alınır ve Neon'daki düşükse Neon'a yazılır, K-10),
 *  uyuşmazlıkta NEON KAZANIR + olay + `quarantine`; tutarlıysa `quarantine` silinir; kopya yeni `syncedAt`/TTL ile yazılır (CAS). Neon okunamazsa kopya UZATILMAZ (olay; TTL'de söner). */
export async function refreshPositionCopy(doc: CopyDoc | null, now: number, deps: CopyDeps): Promise<CopyRefresh & ({ ok: true; doc: CopyDoc } | { ok: false })> {
  const neon = deps.positions ?? prismaPositionStore(), copy = deps.copy ?? defaultPositionCopy(), n = await attempt(() => neon.listOpen(), POSITION_REFRESH_TIMEOUT_MS);
  if (!n.ok) return { ok: false, detail: n.error, ms: n.ms, event: doc === null ? null : await stopEngine("POSITION_REFRESH_FAILED", `pozisyon kopyası Neon'la karşılaştırılamadı: ${n.error} · kopya ${doc.syncedAt}'den beri · en geç ${iso(Date.parse(doc.syncedAt) + POSITION_COPY_TTL_MS)} söner, sonra durum BİLİNMİYOR sayılır (Ö-2)`, {}, deps.events) };
  const a = doc === null ? null : doc.positions.map(key).sort().join(" "), b = n.value.map(key).sort().join(" "), mismatch = a !== null && a !== b ? `kopya [${a || "boş"}] ≠ Neon [${b || "boş"}]` : null, peaks: { id: number; peak: string }[] = [];
  const positions = n.value.map((p) => { const c = doc?.positions.find((x) => x.id === p.id), cp = c?.peakPrice ?? null; if (cp !== null && (p.peakPrice === null || new D(cp).gt(p.peakPrice))) { peaks.push({ id: p.id, peak: cp }); return { ...p, peakPrice: cp }; } return p; });
  for (const p of peaks) await attempt(() => neon.peak(p.id, p.peak), POSITION_REFRESH_TIMEOUT_MS); // olay tetikli Neon tepe yazımı (tazeleme); Neon zaten uyanık
  const next: CopyDoc = { positions, syncedAt: iso(now), quarantine: mismatch === null ? null : { at: iso(now), detail: mismatch } };
  const w = await attempt(() => (doc === null ? copy.write(next).then(() => true) : copy.cas(doc, next)), POSITION_COPY_TIMEOUT_MS), copyWritten = w.ok && w.value;
  const event = mismatch === null ? null : await stopEngine("POSITION_COPY_MISMATCH", `${mismatch} · NEON KAZANDI, kopya Neon'dan yeniden yazıldı (${copyWritten ? "yazıldı" : "yazılamadı, sonraki tik yeniden dener"}); bir sonraki TUTARLI tazelemeye kadar yeni pozisyon açılmaz — çıkış ve koruma sürer (M-1)`, {}, deps.events);
  return { ok: true, doc: next, neon: n.value.length, mismatch, peaksToNeon: peaks.length, copyWritten, ms: n.ms, event };
}
/** TİK OKUYUCUSU: YALNIZ kopya (1 GET). Kopya okunamadı → UNREADABLE; kopya yok (hiç yazılmadı / TTL) → Neon'dan kurulur, o da olmazsa UNKNOWN. İkisi de "durum bilinmiyor" = iş yok (olay).
 *  Kopya BOŞ ([]) → ok, pozisyon yok. Vade (POSITION_REFRESH_MS) ya da `force` (izin tazeleme tiki) → tazeleme; tazeleme düşerse eldeki kopya (hâlâ geçerli) kullanılır. */
export async function readPositions(deps: CopyDeps = {}, force = false): Promise<PositionsRead> {
  const copy = deps.copy ?? defaultPositionCopy(), t = (deps.now ?? Date.now)(), r = await attempt(() => copy.read(), POSITION_COPY_TIMEOUT_MS);
  const unknown = async (reason: "UNREADABLE" | "UNKNOWN", detail: string): Promise<PositionsRead> => ({ ok: false, reason, detail, event: await stopEngine("POSITIONS_UNKNOWN", `${detail} · durum BİLİNMİYOR: bu tikte iş yapılmadı, giriş yok; "pozisyon yok" VARSAYILMADI (Ö-2); koruma borsada (K-1)`, {}, deps.events) });
  if (!r.ok) return unknown("UNREADABLE", `pozisyon kopyası okunamadı (${r.error})`);
  const doc = r.value, due = doc === null || force || t - Date.parse(doc.syncedAt) >= POSITION_REFRESH_MS, refresh = due ? await refreshPositionCopy(doc, t, deps) : null;
  if (refresh?.ok) return { ok: true, positions: refresh.doc.positions, source: "neon", syncedAt: refresh.doc.syncedAt, quarantined: refresh.doc.quarantine?.detail ?? null, refresh };
  if (doc === null) return unknown("UNKNOWN", `pozisyon kopyası yok (hiç yazılmadı ya da TTL ile söndü) ve Neon'dan kurulamadı (${refresh && !refresh.ok ? refresh.detail : "?"})`);
  return { ok: true, positions: doc.positions, source: "copy", syncedAt: doc.syncedAt, quarantined: doc.quarantine?.detail ?? null, refresh };
}
