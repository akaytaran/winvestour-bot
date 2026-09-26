// TEK BİÇİMLEYİCİ (Tur 77, T3 · K-C → Tur 79 · G34: 7 dil). Sayıyı İNSAN BİRİMİYLE yazar: para USDT / $ ay, süre dakika/saat, oran %, an UTC. HESAP YAPMAZ: gelen sayıyı yalnız biçimler
// (yuvarlama gösterim içindir; kayıt ve karar sayıları değişmez). Sayı, yüzde ve dolar `Intl` ile DİLİN biçiminde (ondalık/binlik ayırıcı, % ve $ yeri); rakamlar her dilde Batı rakamıdır
// (`latn`: kodlar, komutlar ve borsa ekranı da öyle). Birim sözcükleri ve çoğul biçimleri dilin sözlüğünden (`units`, `Intl.PluralRules`). AR'de biçimlenmiş değer SOLDAN SAĞA YALITILIR
// (U+2066 … U+2069): sağdan sola cümlenin içinde "12.5%" ya da "0.02 USDT" ters dönmez. Birim testleri: scripts/gate-i18n.mjs (4) ve (20).
// "Anlamı belirsiz sıfır" yazılmaz (U-3): 0'dan büyük ama gösterim hassasiyetinin altındaki tutar "< 0.01" diye yazılır.
// Dil parametresi verilmezse istemcinin etkin dili kullanılır (yalnız istemci bileşenleri parametresiz çağırır; sunucu kodu dili açıkça geçer).
import { activeLang, dictFor, fill, RTL, type Lang } from "./index";

export type FmtLang = Lang;
const LOCALE: Record<Lang, string> = { en: "en-US", tr: "tr-TR", de: "de-DE", ru: "ru-RU", it: "it-IT", fr: "fr-FR", ar: "ar" };
const U = (lang: Lang) => dictFor(lang).units;
/** AR (sağdan sola) için soldan sağa yalıtım; diğer dillerde değer olduğu gibi. */
const iso = (s: string, lang: Lang) => (RTL.has(lang) ? `⁦${s}⁩` : s);
const num = (v: number, digits: number, lang: Lang) => new Intl.NumberFormat(LOCALE[lang], { minimumFractionDigits: digits, maximumFractionDigits: digits, numberingSystem: "latn" }).format(v);
const small = (v: number, digits: number, lang: Lang, f: (x: number) => string) => { const floor = 10 ** -digits; return v !== 0 && Math.abs(v) < floor ? `${v < 0 ? "> −" : "< "}${f(floor)}` : f(v); };
const dollars = (v: number, lang: Lang) => new Intl.NumberFormat(LOCALE[lang], { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", minimumFractionDigits: 2, maximumFractionDigits: 2, numberingSystem: "latn" }).format(v).replace(/[‎‏؜]/g, "");
type Unit = "second" | "minute" | "hour";
/** Çoğul biçim dilin kuralından (`Intl.PluralRules`): EN one/other · RU one/few/many · AR zero/one/two/few/many/other. Kalıp `{n}` taşır. */
const plural = (n: number, unit: Unit, lang: Lang) => fill(U(lang)[unit][new Intl.PluralRules(LOCALE[lang]).select(n) as "zero" | "one" | "two" | "few" | "many" | "other"], { n: num(n, Number.isInteger(n) ? 0 : 1, lang) });

/** USDT tutarı: iki hane ("0.02 USDT"); 0 < |v| < 0,01 ise "< 0.01 USDT". Sayıya çevrilemeyen girdi FIRLATIR (bileşen okunamayan değeri zaten "unknown" yazar). */
export function usdt(v: string | number, lang: Lang = activeLang()): string { const n = Number(v); if (!Number.isFinite(n)) throw new Error("usdt: sayı değil"); return iso(`${small(n, 2, lang, (x) => num(x, 2, lang))} ${U(lang).usdt}`, lang); }
/** Aylık dolar: "$7.10 / month" (kalıp dilin sözlüğünde). */
export function usdMonth(v: string | number, lang: Lang = activeLang()): string { const n = Number(v); if (!Number.isFinite(n)) throw new Error("usdMonth: sayı değil"); return iso(fill(U(lang).usdMonth, { usd: small(n, 2, lang, (x) => dollars(x, lang)) }), lang); }
/** Tek seferlik dolar (ör. bir çağrının maliyeti): "$0.09". */
export function usd(v: string | number, lang: Lang = activeLang()): string { const n = Number(v); if (!Number.isFinite(n)) throw new Error("usd: sayı değil"); return iso(small(n, 2, lang, (x) => dollars(x, lang)), lang); }
/** Yüzde: "100%" · "12.5%" · tr "%12,5" · de "12,5 %" (en çok 3 hane, sondaki sıfırlar atılır). Değer 100'e BÖLÜNÜP Intl yüzde biçimine verilir; gösterilen sayı girilen sayının aynısıdır. */
export function pct(v: string | number, lang: Lang = activeLang()): string { const n = Number(v); if (!Number.isFinite(n)) throw new Error("pct: sayı değil");
  return iso(new Intl.NumberFormat(LOCALE[lang], { style: "percent", maximumFractionDigits: 3, numberingSystem: "latn" }).format(n / 100).replace(/[‎‏؜]/g, ""), lang); }
/** Süre (ms): "45 seconds" · "1 minute" · "2 minutes" · "24 hours" · "1.5 hours". İşaretsizdir; yön cümlededir. */
export function duration(ms: number, lang: Lang = activeLang()): string {
  const a = Math.abs(ms);
  if (a < 60_000) return plural(Math.round(a / 1000), "second", lang);
  if (a < 5_400_000) return plural(Math.round(a / 60_000), "minute", lang);
  const h = a / 3_600_000; return Number.isInteger(h) ? plural(h, "hour", lang) : fill(U(lang).hoursDecimal, { n: num(Number(h.toFixed(1)), 1, lang) });
}
/** Aralık: "every 1 minute" · tr "1 dakikada bir" · ar "كل 1 دقيقة". */
export const every = (ms: number, lang: Lang = activeLang()): string => fill(U(lang).every, { d: duration(ms, lang) });
/** An: EN "2026-09-26 03:25 UTC" (saniyesiz, bugünkü biçim); diğer dillerde `Intl` sayısal tarih + 24 saat, saat dilimi açık (UTC). */
export function dateTime(iso8601: string | number | Date, lang: Lang = activeLang()): string { const d = new Date(iso8601); if (Number.isNaN(d.getTime())) throw new Error("dateTime: tarih değil");
  if (lang === "en") return `${d.toISOString().replace("T", " ").slice(0, 16)} ${U(lang).utc}`;
  const s = new Intl.DateTimeFormat(LOCALE[lang], { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC", numberingSystem: "latn" }).format(d).replace(/[‎‏؜]/g, "");
  return iso(`${s} ${U(lang).utc}`, lang); }
/** Yalnız gün: EN "2026-09-10"; diğer dillerde `Intl` sayısal tarih (UTC). */
export function date(iso8601: string | number | Date, lang: Lang = activeLang()): string { const d = new Date(iso8601); if (Number.isNaN(d.getTime())) throw new Error("date: tarih değil");
  if (lang === "en") return d.toISOString().slice(0, 10);
  return iso(new Intl.DateTimeFormat(LOCALE[lang], { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC", numberingSystem: "latn" }).format(d).replace(/[‎‏؜]/g, ""), lang); }
/** Geçen süre: "3 minutes ago" · tr "3 dakika önce" · ar "منذ 3 دقائق". */
export const ago = (at: string | number | Date, now: number, lang: Lang = activeLang()): string => fill(U(lang).ago, { d: duration(now - new Date(at).getTime(), lang) });
export const fmt = { usdt, usdMonth, usd, pct, duration, every, dateTime, date, ago };
