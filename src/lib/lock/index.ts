// BİYOMETRİK KİLİT AYARI — SUNUCU YÜZÜ (Tur 40 · G20 parça 2B · Ö-2, S-1). Ayarın TEK OKUMA YOLU; YAZMA YÜZEYİ TUR 63'TE YAZILDI (aşağıdaki not) — tohum yine KAPALI/NULL'dur ve kod hiçbir değer önermez.
// KAPALI ARIZA (Ö-2): ayar okunamaz ya da satır yoksa VARSAYILAN ÜRETİLMEZ — sonuç `ok:false`, istemci bunu "kapalı" değil "bilinmiyor" sayar (UNREADABLE). Bu modülde SAYI yoktur.
// TUR 63 (G20 — kilit ayarını DEĞİŞTİREN yüzey): yazma yolu da BURADADIR ve TEKTİR (kapı `gate:pwa` (8) `lock-settings-writer-outside`: `lockSettings.update|upsert|create|delete` bu dosya dışında KIRMIZI).
//   `validateLockPatch` SAF: açık liste dışı alan, mantıksal olmayan `enabled`, 0/negatif/ondalık süre REDDEDİLİR (göçün CHECK'iyle aynı sınır); yama BÜTÜN olarak geçer ya da hiç geçmez.
//   SAYI İCAT EDİLMEZ (A-1/K-11): kilit açılırken süreye koddan bir değer ATANMAZ — `null` (seçilmedi) aynen kalır. `null` geçerli bir hâldir ve "seçimi kaldır" demektir.
//   BU AYAR DEĞİŞİKLİĞİNİN AYRI BİR DEFTER TABLOSU YOKTUR ve UYDURULMADI: `brain_setting_changes` / `risk_setting_changes` eşdeğeri bir tablo bu ayar için hiç açılmadı (ölçüldü, 2a-alfabe).
//   Kayıt olarak tablonun KENDİ `updated_at` sütunu kullanılır ve yüzeyde "en son ne zaman değişti" cümlesi olarak yazılır; olmayan bir defter VARMIŞ gibi gösterilmez (U-3).
import type { PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/db/client";
export { lockGate, LOCK_TEXT, type LockRead, type LockState } from "./client";
import type { LockRead } from "./client";
import { fill } from "@/lib/i18n";
import { srvFor, RECORD_LANG } from "@/lib/i18n/srv";
// TUR 79 (G34 · S5): cümleler SUNUCU SÖZLÜĞÜNDEN (src/lib/i18n/srv · lock). Dil verilmezse İÇ KAYIT DİLİ (tr); uç isteğin dilini geçer. Alanlar, kodlar ve durum kodları dilden bağımsızdır.

export interface LockRow { enabled: boolean; repromptSeconds: number | null; updatedAt?: Date | null }
export interface LockStore { read(): Promise<LockRow | null>; write?(next: { enabled: boolean; repromptSeconds: number | null }): Promise<void> }
export const prismaLockStore = (client?: PrismaClient): LockStore => ({
  read: async () => { const r = await (client ?? getDb()).lockSettings.findUnique({ where: { id: 1 } }); return r ? { enabled: r.enabled, repromptSeconds: r.repromptSeconds, updatedAt: r.updatedAt } : null; },
  write: async (next) => { await (client ?? getDb()).lockSettings.update({ where: { id: 1 }, data: { enabled: next.enabled, repromptSeconds: next.repromptSeconds } }); },
});
/** Fırlatmaz. Okunamayan/satırsız ayar `ok:false` döner (kilit KAPALI sayılmaz). */
export async function readLockSettings(store: LockStore = prismaLockStore(), lang: string = RECORD_LANG): Promise<LockRead> {
  const K = srvFor(lang).lock;
  try { const r = await store.read(); return r ? { ok: true, enabled: r.enabled, repromptSeconds: r.repromptSeconds, updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null } : { ok: false, detail: K.noRow }; }
  catch (e) { return { ok: false, detail: fill(K.readFailed, { name: e instanceof Error ? e.name : K.unknownName }) }; }
}

/** Değiştirilebilir alanların AÇIK LİSTESİ. Başka ad yamaya giremez (`id`, `updatedAt` dâhil). */
export const LOCK_FIELDS = ["enabled", "repromptSeconds"] as const;
export type LockPatch = { enabled?: unknown; repromptSeconds?: unknown };
export type LockNext = { enabled: boolean; repromptSeconds: number | null };
export type LockChange = { field: string; from: string | null; to: string | null };
export type LockValidation = { ok: true; next: LockNext; changes: LockChange[] } | { ok: false; errors: string[] };
const asText = (v: boolean | number | null): string | null => (v === null ? null : String(v));

/** SAF DOĞRULAMA — fırlatmaz, depoya dokunmaz. Yama BÜTÜNDÜR: bir alan geçersizse hiçbir alan uygulanmaz. */
export function validateLockPatch(cur: LockNext, patch: LockPatch, lang: string = RECORD_LANG): LockValidation {
  const errors: string[] = [], keys = Object.keys(patch ?? {}), E = srvFor(lang).lock.errors;
  for (const k of keys) if (!(LOCK_FIELDS as readonly string[]).includes(k)) errors.push(fill(E.unknownField, { field: k, fields: LOCK_FIELDS.join(E.and) }));
  if (keys.length === 0) errors.push(E.empty);
  const next: LockNext = { enabled: cur.enabled, repromptSeconds: cur.repromptSeconds };
  if ("enabled" in patch) { if (typeof patch.enabled !== "boolean") errors.push(E.notBoolean); else next.enabled = patch.enabled; }
  if ("repromptSeconds" in patch) { const v = patch.repromptSeconds;
    if (v === null) next.repromptSeconds = null;
    else if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) errors.push(E.reprompt);
    else next.repromptSeconds = v; }
  if (errors.length) return { ok: false, errors };
  const changes: LockChange[] = [];
  if (next.enabled !== cur.enabled) changes.push({ field: "enabled", from: asText(cur.enabled), to: asText(next.enabled) });
  if (next.repromptSeconds !== cur.repromptSeconds) changes.push({ field: "repromptSeconds", from: asText(cur.repromptSeconds), to: asText(next.repromptSeconds) });
  return { ok: true, next, changes };
}

export type LockWrite = { ok: true; next: LockNext; changes: LockChange[] } | { ok: false; status: 400 | 409 | 503; errors: string[] };
/** Fırlatmaz. Okuma düşerse/satır yoksa YAZMAZ (Ö-2: bilinmeyen hâlin üstüne yazılmaz); yazma düşerse ayar DEĞİŞMEMİŞ sayılır ve bu dürüstçe söylenir. */
export async function writeLockSettings(patch: LockPatch, store: LockStore = prismaLockStore(), lang: string = RECORD_LANG): Promise<LockWrite> {
  let row: LockRow | null; const K = srvFor(lang).lock, W = K.write, nm = (e: unknown) => (e instanceof Error ? e.name : K.unknownName);
  try { row = await store.read(); } catch (e) { return { ok: false, status: 503, errors: [fill(W.readFailed, { name: nm(e) })] }; }
  if (row === null) return { ok: false, status: 409, errors: [W.noRow] };
  const v = validateLockPatch({ enabled: row.enabled, repromptSeconds: row.repromptSeconds }, patch, lang);
  if (!v.ok) return { ok: false, status: 400, errors: v.errors };
  if (typeof store.write !== "function") return { ok: false, status: 503, errors: [W.noWriter] };
  try { await store.write(v.next); } catch (e) { return { ok: false, status: 503, errors: [fill(W.writeFailed, { name: nm(e) })] }; }
  return { ok: true, next: v.next, changes: v.changes };
}
