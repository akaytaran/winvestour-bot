// TEK BİÇİMLEYİCİ (Tur 77, T3 · K-C). Sayıyı İNSAN BİRİMİYLE yazar: para USDT / $ ay, süre dakika/saat, oran %, an UTC. HESAP YAPMAZ: gelen sayıyı yalnız biçimler
// (yuvarlama gösterim içindir; kayıt ve karar sayıları değişmez). Ondalık ayırıcı dile göre (`Intl`), Tur 78'in dilleri aynı işlevlerden geçer. Birim testleri: scripts/gate-i18n.mjs.
// "Anlamı belirsiz sıfır" yazılmaz (U-3): 0'dan büyük ama gösterim hassasiyetinin altındaki tutar "< 0.01" diye yazılır.
import { EN } from "./en";

export type FmtLang = "en" | "tr" | "de" | "ru" | "it" | "fr" | "ar";
const LOCALE: Record<FmtLang, string> = { en: "en-US", tr: "tr-TR", de: "de-DE", ru: "ru-RU", it: "it-IT", fr: "fr-FR", ar: "ar" };
const U = EN.units;
const num = (v: number, digits: number, lang: FmtLang) => new Intl.NumberFormat(LOCALE[lang], { minimumFractionDigits: digits, maximumFractionDigits: digits, numberingSystem: "latn" }).format(v);
const small = (v: number, digits: number, lang: FmtLang) => { const floor = 10 ** -digits; return v !== 0 && Math.abs(v) < floor ? `${v < 0 ? "> −" : "< "}${num(floor, digits, lang)}` : num(v, digits, lang); };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** USDT tutarı: iki hane ("0.02 USDT"); 0 < |v| < 0,01 ise "< 0.01 USDT". Sayıya çevrilemeyen girdi FIRLATIR (bileşen okunamayan değeri zaten "unknown" yazar). */
export function usdt(v: string | number, lang: FmtLang = "en"): string { const n = Number(v); if (!Number.isFinite(n)) throw new Error("usdt: sayı değil"); return `${small(n, 2, lang)} ${U.usdt}`; }
/** Aylık dolar: "$7.10 / month". */
export function usdMonth(v: string | number, lang: FmtLang = "en"): string { const n = Number(v); if (!Number.isFinite(n)) throw new Error("usdMonth: sayı değil"); return `$${small(n, 2, lang)} ${U.perMonth}`; }
/** Tek seferlik dolar (ör. bir çağrının maliyeti): "$0.09". */
export function usd(v: string | number, lang: FmtLang = "en"): string { const n = Number(v); if (!Number.isFinite(n)) throw new Error("usd: sayı değil"); return `$${small(n, 2, lang)}`; }
/** Yüzde: "100%" · "12.5%" (en çok 3 hane, sondaki sıfırlar atılır). */
export function pct(v: string | number, lang: FmtLang = "en"): string { const n = Number(v); if (!Number.isFinite(n)) throw new Error("pct: sayı değil");
  return `${new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: 3, numberingSystem: "latn" }).format(n)}%`; }
/** Süre (ms): "45 seconds" · "1 minute" · "2 minutes" · "24 hours" · "1.5 hours". İşaretsizdir; yön cümlededir. */
export function duration(ms: number): string {
  const a = Math.abs(ms);
  if (a < 60_000) return plural(Math.round(a / 1000), U.second, U.seconds);
  if (a < 5_400_000) return plural(Math.round(a / 60_000), U.minute, U.minutes);
  const h = a / 3_600_000; return Number.isInteger(h) ? plural(h, U.hour, U.hours) : `${h.toFixed(1)} ${U.hours}`;
}
/** Aralık: "every 1 minute" · "every 24 hours". */
export const every = (ms: number): string => `${U.every} ${duration(ms)}`;
/** An: "2026-09-26 03:25 UTC" (saniyesiz; saat dilimi açık). */
export function dateTime(iso: string | number | Date): string { const d = new Date(iso); if (Number.isNaN(d.getTime())) throw new Error("dateTime: tarih değil"); return `${d.toISOString().replace("T", " ").slice(0, 16)} ${U.utc}`; }
/** Geçen süre: "3 minutes ago". */
export const ago = (iso: string | number | Date, now: number): string => `${duration(now - new Date(iso).getTime())} ${U.ago}`;
export const fmt = { usdt, usdMonth, usd, pct, duration, every, dateTime, ago };
