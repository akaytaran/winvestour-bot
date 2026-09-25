// BİLDİRİM AYARLARI (Tur 28, G20 · U-2). Tur 27'nin AÇIK bıraktığı iki şeyin yeri BURADIR ve İŞ SAHİBİ KARARIYLA seçildi (2026-09-12): (1) kapatma tercihi (`mutedCodes`),
// (2) eleme penceresi (`dedupWindowMs`, varsayılan 30 dakika).
// TUR 29 (iş sahibi kararı K1 = [C], 2026-09-17): pencere SINIFA GÖREDİR — kapatılamaz sınıf `dedupWindowUndismissableMs` (başlangıç 2 dakika, UYDURMA, A-1 `NOTIFY_DEDUP_WINDOW_UNDISMISSABLE_MS`),
//   diğerleri `dedupWindowMs`. İkisinde de 0 = o sınıfta eleme yok. Eski `dedup_undismissable` bayrağı KULLANIMDAN KALDIRILDI ve burada OKUNMAZ (sütun şemada duruyor). SESSİZ SAAT YOKTUR (karar 3): bu dosyada gece penceresi alanı, saati ya da kontrolü YOK — alan icat edilmedi.
// TEK OKUMA YOLU: `loadNotifySettings`. Ayar okunamazsa HİÇBİR ŞEY KAPANMAZ ve HİÇBİR ŞEY ELENMEZ (`NOTHING_MUTED` + pencere 0) ⇒ bildirim gider ve bunu `readable:false` söyler.
// Yön gerekçesi: okunamayan bir ayarın "kapatılmış" sayılması sahibi sessizce habersiz bırakırdı; U-2 bunu yasaklar. Tavan/eşik ayarlarının kapalı-arıza yönüyle (M-1) karıştırılmamalı.
// DEPO BÜTÇESİ (Tur 28 DÜZELTMESİ · K-7, A-9). ÖLÇÜLEN KUSUR: eleme ve ayar eklendiğinde `deliverNotification` varsayılan olarak Neon ve Upstash'e gitmeye başladı ve DURDURMA YOLU
// senkron olduğu için durdurma bu iki çağrının arkasında BEKLİYORDU — `gate:stop-service` askıda depo ölçümünde 5 964 ms gördü (tavan 3 000 ms). Bildirim, durdurmayı geciktiremez.
// SAYI UYDURULMADI, TÜRETİLDİ: bildirim yolunun İKİ deposu BİRLİKTE, durdurmanın KENDİ tek depo bütçesini (engine-control `STOP_TIMING.storeTimeoutMs`) aşamaz ⇒ her birine yarısı.
// Değer buraya KOPYALANMIŞTIR çünkü `engine-control` → `events` → `notify` çevrimi var; kapı iki dosyadaki sayının EŞİTLİĞİNİ ölçer, sürüklenemez.
// SÜRE DOLARSA AÇIK ARIZALANIR: ayar okunamadı sayılır (hiçbir şey kapanmaz, hiçbir şey elenmez) ve bildirim GİDER — kaybolan bildirim, geciken durdurmadan da yinelenen bildirimden de kötüdür.
import { getDb } from "@/db/client";
import type { PrismaClient } from "@/generated/prisma/client";

export const NOTIFY_STORE_BUDGET_MS = 1500; // = STOP_TIMING.storeTimeoutMs (kapı eşitliği ölçer)
export const NOTIFY_STORE_TIMEOUT_MS = NOTIFY_STORE_BUDGET_MS / 2; // iki depo (ayar + eleme) bütçeyi paylaşır
/** Bir depo çağrısını süreyle sınırlar. Süre dolarsa `onTimeout` döner; çağrı iptal EDİLMEZ ama BEKLENMEZ (durdurma yolu serbest kalır). */
export async function withinBudget<T>(fn: () => Promise<T>, onTimeout: T, ms: number = NOTIFY_STORE_TIMEOUT_MS): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([fn(), new Promise<T>((res) => { t = setTimeout(() => res(onTimeout), ms); })]); } finally { if (t !== undefined) clearTimeout(t); }
}

export type NotifySettings = { readonly mutedCodes: readonly string[]; readonly dedupWindowMs: number; readonly dedupWindowUndismissableMs: number };
/** OKUNAMADI HÂLİ: kapalı-varsayılan kapatma (hiçbir şey kapalı değil) + eleme yok. Bildirimi ENGELLEYEN hiçbir alan burada dolu olamaz. */
export const SETTINGS_UNREADABLE: NotifySettings = { mutedCodes: [], dedupWindowMs: 0, dedupWindowUndismissableMs: 0 };
export type LoadedSettings = { readonly settings: NotifySettings; readonly readable: boolean };
export interface NotifySettingsStore { readonly name: string; read(): Promise<NotifySettings | null> }

export const prismaNotifySettingsStore = (client?: PrismaClient): NotifySettingsStore => ({
  name: "neon",
  read: async () => {
    const row = await (client ?? getDb()).notifySettings.findUnique({ where: { id: 1 }, select: { mutedCodes: true, dedupWindowMs: true, dedupWindowUndismissableMs: true } });
    return row === null ? null : { mutedCodes: row.mutedCodes, dedupWindowMs: row.dedupWindowMs, dedupWindowUndismissableMs: row.dedupWindowUndismissableMs };
  },
});
/** BELLEK DEPOSU — yalnız kapı/kanarya (S-9). */
export const memoryNotifySettingsStore = (s: NotifySettings | null): NotifySettingsStore => ({ name: "bellek", read: async () => s });

/** Ayarı oku. Satır yok ya da okuma düştü ⇒ `SETTINGS_UNREADABLE` + `readable:false`; fırlatmaz, varsayılan bir pencereye DÜŞMEZ (sayı icat edilmez). */
export async function loadNotifySettings(store: NotifySettingsStore = prismaNotifySettingsStore()): Promise<LoadedSettings> {
  try { const s = await withinBudget(() => store.read(), null); return s === null ? { settings: SETTINGS_UNREADABLE, readable: false } : { settings: s, readable: true }; }
  catch { return { settings: SETTINGS_UNREADABLE, readable: false }; }
}

/** İNSAN BİRİMİ (U-3): ham ms ekrana/bildirime çıkmaz. Tek yer; cümle kuran her yol buradan geçer (kapı ölçer). */
// Tur 29 İKİ GÖZ (ölçüldü): 1 saniyenin altı "0 saniye" (anlamı belirsiz sıfır) ve 90–119 saniye "2 dakika" (2 dakikalık pencerenin TAMAMI gibi) basılıyordu ⇒ saniyeye iner, yukarı yuvarlamaz.
export const human = (ms: number): string => { const a = Math.abs(ms), dk = Math.floor(a / 60_000), sn = Math.floor((a % 60_000) / 1000);
  return a < 1000 ? "1 saniyeden az" : a < 90_000 ? `${Math.round(a / 1000)} saniye` : a < 5_400_000 ? `${dk} dakika${sn > 0 ? ` ${sn} saniye` : ""}` : `${(a / 3_600_000).toFixed(1)} saat`; };
