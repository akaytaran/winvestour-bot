// GİRİŞ ŞALTERİ — TEK OKUMA VE TEK YAZMA YOLU (Tur 64 · G28 kutu 4 · K-2, Ö-2, E-1, A-1, S-8).
//
// NE DEĞİŞTİ: giriş yolunun açık/kapalı olması 2026-09-23'e kadar bir KOD SABİTİYDİ
// (`src/lib/orders/index.ts` içinde `export const ENTRY_ENABLED = false`). İş sahibinin 20 Eyl 2026
// kararıyla şalter PANELDEN YÖNETİLEN AYAR oldu; ANAYASA K-2'nin altına aynı tarihli not düşüldü
// (kural metni DEĞİŞMEDİ). Kalıp `risk_settings` / `brain_settings` ile AYNIDIR, yeni kalıp icat edilmedi.
//
// DÖRT KURAL, DÖRDÜ DE ÖLÇÜLÜR:
//  (1) AÇMAK HASSAS EYLEMDİR — oturum + eylem başına TOTP (`ENTRY_SETTINGS_CHANGE`, S-8) + E-1 defteri.
//      KAPATMAK da aynı uçtan geçer ama ENGELLENEMEZ: kapatma para hareketini DURDURAN yöndedir ve
//      hiçbir arıza onu geciktiremez — ayar deposu düşse bile `/durdur` yolu bu ayara HİÇ bağlı değildir (K-7).
//  (2) KAPALI ARIZA (Ö-2) — ayar okunamıyorsa ya da satır yoksa şalter AÇIK SAYILMAZ. Ekran "okunamadı"
//      der, değer İCAT EDİLMEZ ve "kapalı" da DENMEZ: bilinmeyen hâl bilinmeyen olarak gösterilir.
//  (3) YENİ KURULUMDA AÇIK DOĞAR, VAR OLANIN DEĞERİ GÖÇLE DEĞİŞMEZ — tohum kararı göçün İÇİNDEDİR
//      (`prisma/migrations/…_entry_settings/migration.sql`); ölçümü Tur 64'ün göç kapısı ölçüm dosyasındadır (özel depo).
//      Gerekçe: bir göç üretimdeki etkin değeri kendiliğinden AÇIK'a çevirirse, bu PARA HAREKETİ BAŞLATAN
//      bir şalteri ajanın açması olur ve geri dönülmezdir. Şalteri fiilen açmak İŞ SAHİBİNİN EYLEMİDİR.
//  (4) AYAR HİÇBİR ŞEYİ GEVŞETMEZ — şalter AÇIK olsa bile koruma emri (K-1/K-2), icra kilidi (K-6),
//      durdurma (K-7), komisyon bütçesi (M-1) ve sağlık duraklatması (M-5) aynen çalışır. Bu ayar YALNIZ
//      "giriş emri gönderilebilir mi" sorusunu yanıtlar; çıkışa ve korumaya ASLA dokunmaz.
//
// MALİYET (A-9, 10 $ tavanı DEĞİŞMEDİ): bu ayar TİK BAŞINA OKUNMAZ. Halkada okuma yalnız PLAN TİKİNDE
// (`PLAN_PERIOD_MS`) yapılır — Tur 22/23'ün "tik başına Neon 0" kazanımı korunur (Tur 64 ölçümü, özel depo).
//
// SAYI YOKTUR (A-1/K-11): bu modülde eşik, süre, tavan ya da varsayılan bir sayı bulunmaz.
import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import { getDb } from "@/db/client";
import { recordEntrySwitchOpened, type Deps as EventDeps, type EmitResult } from "@/lib/events";
import { fill } from "@/lib/i18n";
import { srvFor, RECORD_LANG } from "@/lib/i18n/srv";
// TUR 79 (G34 · S5): cümleler SUNUCU SÖZLÜĞÜNDEN (src/lib/i18n/srv · entry). Dil verilmezse İÇ KAYIT DİLİ (tr); uç isteğin dilini geçer. Alanlar, kodlar ve durum kodları dilden bağımsızdır.

export interface EntryRow { enabled: boolean; updatedAt?: Date | null }
export type EntryNext = { enabled: boolean };
export type EntryChange = { field: string; from: string; to: string };
export interface EntrySwitchStore {
  read(): Promise<EntryRow | null>;
  /** Ayar ve E-1 defteri AYNI İŞLEMDE yazılır: defter düşerse ayar da değişmez. */
  write(next: EntryNext, by: string, changes: EntryChange[]): Promise<void>;
  changes(n: number): Promise<{ at: Date; by: string; changes: EntryChange[] }[]>;
}
export type EntryDeps = { store?: EntrySwitchStore; now?: () => number; events?: EventDeps; /** Tur 79: dönen insan metninin dili (verilmezse iç kayıt dili) */ lang?: string };
const ES = (deps: EntryDeps = {}) => srvFor(deps.lang ?? RECORD_LANG).entry;

export const prismaEntryStore = (client?: PrismaClient): EntrySwitchStore => { const db = () => client ?? getDb(); return {
  read: async () => { const r = await db().entrySettings.findUnique({ where: { id: 1 } }); return r ? { enabled: r.enabled, updatedAt: r.updatedAt } : null; },
  write: async (next, by, changes) => { await db().$transaction([
    db().entrySettings.update({ where: { id: 1 }, data: { enabled: next.enabled } }),
    db().entrySettingChange.create({ data: { by, changes: changes as unknown as Prisma.InputJsonValue } }),
  ]); },
  changes: async (n) => (await db().entrySettingChange.findMany({ orderBy: { at: "desc" }, take: n })).map((c) => ({ at: c.at, by: c.by, changes: c.changes as unknown as EntryChange[] })),
}; };

export type EntryRead = { ok: true; enabled: boolean; updatedAt: string | null } | { ok: false; detail: string };
const errName = (e: unknown) => (e as { name?: string })?.name ?? "error";

/** TEK OKUMA YOLU. FIRLATMAZ. Satır yok / okunamaz ⇒ `ok:false` — "kapalı" da "açık" da SAYILMAZ (Ö-2). */
export async function readEntrySettings(deps: EntryDeps = {}): Promise<EntryRead> {
  try {
    const r = await (deps.store ?? prismaEntryStore()).read();
    return r ? { ok: true, enabled: r.enabled, updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null } : { ok: false, detail: ES(deps).noRow };
  } catch (e) { return { ok: false, detail: fill(ES(deps).readFailed, { name: errName(e) }) }; }
}

export type EntryVerdict = { allowed: true; detail: string } | { allowed: false; refusal: "ENTRY_SWITCH_OFF" | "ENTRY_SETTINGS_UNREADABLE"; detail: string };

/** GİRİŞ KARARININ TEK YERİ. Emir yolu ve halka BUNU çağırır; başka hiçbir yerde "giriş açık mı" kararı verilmez
 *  (kapı: `gate:order` + `gate:protection` — koda sabit giriş kararı yazan dosya KIRMIZI).
 *  Okunamazsa giriş AÇILMAZ (kapalı arıza) — ama sebebi "kapalı" değil "okunamadı"dır ve ekranda öyle yazar (U-3). */
export async function entrySwitch(deps: EntryDeps = {}): Promise<EntryVerdict> {
  const r = await readEntrySettings(deps);
  if (!r.ok) return { allowed: false, refusal: "ENTRY_SETTINGS_UNREADABLE", detail: r.detail };
  return r.enabled
    ? { allowed: true, detail: fill(ES(deps).allowed, { at: r.updatedAt ?? ES(deps).unknownAt }) }
    : { allowed: false, refusal: "ENTRY_SWITCH_OFF", detail: ES(deps).off };
}

/** Değiştirilebilir alanların AÇIK LİSTESİ. Başka ad yamaya giremez (`id`, `updatedAt` dâhil). */
export const ENTRY_FIELDS = ["enabled"] as const;
export type EntryPatch = { enabled?: unknown };
export type EntryValidation = { ok: true; next: EntryNext; changes: EntryChange[] } | { ok: false; errors: string[] };

/** SAF DOĞRULAMA — fırlatmaz, depoya dokunmaz. Yama BÜTÜNDÜR: bir alan geçersizse hiçbir alan uygulanmaz. */
export function validateEntryPatch(cur: EntryNext, patch: EntryPatch, lang: string = RECORD_LANG): EntryValidation {
  const errors: string[] = [], keys = Object.keys(patch ?? {}), E = srvFor(lang).entry.errors;
  for (const k of keys) if (!(ENTRY_FIELDS as readonly string[]).includes(k)) errors.push(fill(E.unknownField, { field: k, fields: ENTRY_FIELDS.join(E.and) }));
  if (keys.length === 0) errors.push(E.empty);
  const next: EntryNext = { enabled: cur.enabled };
  if ("enabled" in patch) { if (typeof patch.enabled !== "boolean") errors.push(E.notBoolean); else next.enabled = patch.enabled; }
  if (errors.length) return { ok: false, errors };
  const changes: EntryChange[] = [];
  if (next.enabled !== cur.enabled) changes.push({ field: "enabled", from: String(cur.enabled), to: String(next.enabled) });
  return { ok: true, next, changes };
}

export type EntryWrite = { ok: true; next: EntryNext; changes: EntryChange[]; event: EmitResult | null } | { ok: false; status: 400 | 409 | 503; errors: string[] };

/** TEK YAZMA YOLU. Okunamayan hâlin ÜSTÜNE YAZILMAZ (Ö-2): önce mevcut satır okunur; yoksa/okunamazsa yazılmaz.
 *  Ayar ve E-1 defteri aynı işlemde gider; defter düşerse ayar da DEĞİŞMEZ. */
export async function writeEntrySettings(patch: EntryPatch, by: string, deps: EntryDeps = {}): Promise<EntryWrite> {
  const store = deps.store ?? prismaEntryStore();
  let cur: EntryRow | null;
  const W = ES(deps).write;
  try { cur = await store.read(); } catch (e) { return { ok: false, status: 503, errors: [fill(W.readFailed, { name: errName(e) })] }; }
  if (!cur) return { ok: false, status: 409, errors: [W.noRow] };
  const v = validateEntryPatch({ enabled: cur.enabled }, patch, deps.lang ?? RECORD_LANG);
  if (!v.ok) return { ok: false, status: 400, errors: v.errors };
  if (v.changes.length === 0) return { ok: true, next: v.next, changes: [], event: null };
  try { await store.write(v.next, by, v.changes); } catch (e) { return { ok: false, status: 503, errors: [fill(W.writeFailed, { name: errName(e) })] }; }
  // TUR 65 (S64-1, K1 = [C]): YALNIZ AÇMA (kapalı → açık) olay + bildirim üretir; KAPATMA SESSİZDİR. Olay ayar YAZILDIKTAN sonra doğar: ayar değişmediyse (yukarıdaki 503) olay da yoktur.
  // Olay yazılamazsa ayar GERİ ALINMAZ (E-1 defteri değişikliği zaten aynı işlemde tuttu); sonuç yanıtta kodla görünür ve yayıcının kademe 2 kaydı (stderr) düşer — sessiz kayıp yok (K-8).
  const opened = !cur.enabled && v.next.enabled;
  const event = opened ? await recordEntrySwitchOpened(fill(srvFor(RECORD_LANG).entry.event, { by }), deps.events) : null;
  return { ok: true, next: v.next, changes: v.changes, event };
}

/** U-3 — YALNIZ VERİDEN CÜMLE: ekranda ve kütükte aynı cümle; okunamayan hâl "bilinmiyor" der. */
export const entrySentence = (r: EntryRead, lang: string = RECORD_LANG): string => { const S = srvFor(lang).entry;
  return r.ok ? (r.enabled ? S.sentenceOn : S.sentenceOff) : fill(S.sentenceUnknown, { detail: r.detail }); };

/** ÖLÇÜM ÇIKTILARI İÇİN TEK DİZE (Tur 64). Kanaryalar eskiden hüküm satırında `ENTRY_ENABLED=false` sabitini
 *  basardı; sabit KALKTIĞI için artık kararın NEREDE durduğunu basarlar. Bir kanarya şalterin DEĞERİNİ
 *  ölçmek istiyorsa sahte depo enjekte edip `entrySwitch` çağırır (S-9) — dizeyi değer yerine KULLANAMAZ. */
export const ENTRY_DECISION_SOURCE = "entry_settings (ayar, tek okuma yolu entrySwitch) — kod sabiti YOK";
