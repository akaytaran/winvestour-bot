// DİL KÜMESİ (Tur 79 · G34 · karar defteri 25 Eyl: panel, /durdur ve API iletileri README'deki 7 dilde; varsayılan İngilizce; AR sağdan sola). Saf modül: React/Node bağımlılığı YOK —
//   aynı dosya sunucuda (kök düzen, uçlar) ve istemcide (dil seçici) okunur. Dil adları KENDİ dilinde yazılır (seçicide herkes kendi dilini tanır). Kapı: npm run gate:i18n (8).
// SEÇİM SIRASI: kullanıcının seçimi (çerez — YALNIZ dil kodu, sır yok) → tarayıcının `Accept-Language` başlığı (q değerleriyle) → EN. Dil çerezi erişim/kimlik kararına GİRMEZ (kapı (18)).
export const LANGS = ["en", "tr", "de", "ru", "it", "fr", "ar"] as const;
export type Lang = (typeof LANGS)[number];
export const LANG_NAMES: Record<Lang, string> = { en: "English", tr: "Türkçe", de: "Deutsch", ru: "Русский", it: "Italiano", fr: "Français", ar: "العربية" };
export const RTL: ReadonlySet<Lang> = new Set<Lang>(["ar"]);
export const dirOf = (l: Lang): "rtl" | "ltr" => (RTL.has(l) ? "rtl" : "ltr");
/** Seçim çerezinin adı. Değeri yalnız dil kodudur; başka bir şey yazılmaz, okunan değer dil kümesinde değilse yok sayılır. */
export const LANG_COOKIE = "wv-lang";
export const LANG_COOKIE_MAX_AGE = 31_536_000; // bir yıl (saniye); seçim tarayıcıda kalır, sunucuda saklanmaz
const isLang = (x: string, available: readonly Lang[]): x is Lang => (available as readonly string[]).includes(x);

/** Çerez başlığından dil çerezinin değeri (yoksa null). Yalnız `a-z` harfleri kabul edilir. */
export function cookieLang(cookieHeader: string | null | undefined): string | null {
  for (const part of (cookieHeader ?? "").split(";")) { const i = part.indexOf("="); if (i < 0) continue;
    if (part.slice(0, i).trim() === LANG_COOKIE) { const v = part.slice(i + 1).trim(); return /^[A-Za-z]{2}$/.test(v) ? v : null; } }
  return null;
}
/** Dil seçimi: çerez (mevcut bir dilse) → Accept-Language (q sırasıyla; bölge alt etiketi atılır; q=0 kabul edilmez) → "en". Fırlatmaz. */
export function pickLang(available: readonly Lang[], cookie: string | null | undefined, acceptLanguage: string | null | undefined): Lang {
  const c = typeof cookie === "string" && /^[A-Za-z]{2}$/.test(cookie.trim()) ? cookie.trim().toLowerCase() : null;
  if (c && isLang(c, available)) return c;
  const prefs = (acceptLanguage ?? "").split(",").map((raw, i) => { const [tag, ...params] = raw.trim().split(";");
    const qp = params.map((p) => p.trim()).find((p) => p.startsWith("q=")), q = qp === undefined ? 1 : Number(qp.slice(2));
    return { base: (tag ?? "").trim().toLowerCase().split("-")[0], q: Number.isFinite(q) ? q : 0, i }; })
    .filter((p) => p.base !== "" && p.base !== "*" && p.q > 0).sort((a, b) => b.q - a.q || a.i - b.i);
  for (const p of prefs) if (isLang(p.base, available)) return p.base;
  return "en";
}
