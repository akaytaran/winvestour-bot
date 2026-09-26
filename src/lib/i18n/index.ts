// SÖZLÜK YARDIMCISI (Tur 77, K-C · G32 parça 2/2 → Tur 79 · G34: 7 dil). Metnin kaynağı sözlüklerdir: ANA sözlük `./en.ts`, diğer diller aynı şekli (`Dict`) doldurur (derleyici zorlar,
//   gate:i18n (9) eksik/fazla/boş/yer tutucu ölçer). Bileşen ve uçlar metni ANAHTAR YOLUYLA (T.bolum.anahtar) alır, cümleyi kendisi yazmaz. Yer tutucu biçimi `{ad}` — `fill`.
// ÇALIŞMA ANINDA EN'YE DÜŞME (K-7): her dilin sözlüğü `completeDict` ile EN'nin şekline oturtulur — eksik, boş, yanlış tipli ya da yer tutucusunu kaybetmiş yaprak EN metnine düşer; bütün sözlük
//   bozuksa EN'nin kendisi kullanılır ⇒ /durdur hiçbir dilde metinsiz ya da düğmesiz kalmaz (kanarya: bozuk sözlük).
// İKİ KULLANIM: (1) SUNUCU (uçlar, kök düzen): dil PARAMETREYLE geçer — `dictFor(lang)`; (2) İSTEMCİ bileşenleri: tek kullanıcılık "etkin dil" (`dict()`/`section()` vekilleri) — sağlayıcı
//   (client.tsx) her kök bileşenin render'ının BAŞINDA `setActiveLang` çağırır. Sunucu kodu etkin dili KULLANMAZ (gate:i18n (17)): eşzamanlı isteklerde dil karışmasın.
import { EN, type Dict } from "./en";
import { TR } from "./tr";
import { AR } from "./ar";
import { LANGS, type Lang } from "./langs";

// Tur 79 (G34 parça 1): en · tr · ar. Parça 2 (de · ru · it · fr) sözlükleri buraya eklenir; seçici yalnız sözlüğü OLAN dilleri sunar.
const RAW: Partial<Record<Lang, unknown>> = { en: EN, tr: TR, ar: AR };
/** Sözlüğü OLAN diller (hedefin alt kümesi; sıra LANGS sırası). Seçici yalnız bunları sunar. */
export const AVAILABLE: readonly Lang[] = LANGS.filter((l) => RAW[l] !== undefined);
const ph = (s: string) => [...s.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map((m) => m[1]).sort().join(",");
const good = (c: unknown, b: string): c is string => typeof c === "string" && c.trim() !== "" && ph(c) === ph(b);
/** Adayı `base`in şekline oturtur: geçerli yaprak adaydan, geçersiz (eksik/boş/yanlış tip/yer tutucusu farklı) yaprak base'ten. Diziler uzunluk eşitse eleman eleman, değilse base. Fırlatmaz. */
export function completeDict<T>(base: T, cand: unknown): T {
  if (typeof base === "string") return (good(cand, base) ? cand : base) as T;
  if (Array.isArray(base)) return (Array.isArray(cand) && cand.length === base.length ? base.map((b, i) => completeDict(b, cand[i])) : base) as T;
  if (base !== null && typeof base === "object") {
    const c = cand !== null && typeof cand === "object" && !Array.isArray(cand) ? (cand as Record<string, unknown>) : {};
    return Object.fromEntries(Object.entries(base as Record<string, unknown>).map(([k, v]) => [k, completeDict(v, c[k])])) as T;
  }
  return base;
}
const cache = new Map<Lang, Dict>();
const asLang = (l: string): Lang => ((AVAILABLE as readonly string[]).includes(l) ? (l as Lang) : "en");
/** Bir dilin TAM sözlüğü (EN'ye düşen tamamlayıcıdan geçmiş). Bilinmeyen/sözlüğü olmayan dil → EN. Sunucuda kullanılan yol budur. */
export function dictFor(lang: string): Dict {
  const l = asLang(lang); let d = cache.get(l);
  if (!d) { d = l === "en" ? EN : completeDict<Dict>(EN, RAW[l]); cache.set(l, d); }
  return d;
}

// ---- İSTEMCİ: etkin dil (tarayıcıda tek kullanıcı, tek dil) ----
let active: Lang = "en";
/** Kök istemci bileşeni render'ının başında çağrılır (client.tsx `useActivateLang`). Bilinmeyen dil → EN. */
export function setActiveLang(l: string): void { active = asLang(l); }
export const activeLang = (): Lang => active;
const live = new Proxy({} as Dict, {
  get: (_t, k) => (dictFor(active) as unknown as Record<string | symbol, unknown>)[k],
  has: (_t, k) => k in dictFor(active),
  ownKeys: () => Reflect.ownKeys(dictFor(active)),
  getOwnPropertyDescriptor: (_t, k) => ({ ...Reflect.getOwnPropertyDescriptor(dictFor(active), k), configurable: true }),
});
/** Etkin dilin sözlüğü — ERİŞİM ANINDA çözülür (modül düzeyinde `const T = dict()` güvenlidir; `T.a.b` render sırasında okunur). */
export const dict = (): Dict => live;
/** Etkin dilin bir bölümü, yine erişim anında (`const S = section("stop")` → `S.send`). */
export function section<K extends keyof Dict>(k: K): Dict[K] {
  return new Proxy({} as Dict[K] & object, { get: (_t, p) => (dictFor(active)[k] as unknown as Record<string | symbol, unknown>)[p] }) as Dict[K];
}
/** `{ad}` yer tutucularını doldurur. Değer `null`/`undefined` ise yer tutucu olduğu gibi kalır (boş dize yazmaz — eksik veri görünür kalsın, Ö-2). */
export function fill(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (m, k: string) => { const v = vars[k]; return v === null || v === undefined ? m : String(v); });
}
export { EN, type Dict };
export { LANGS, LANG_NAMES, LANG_COOKIE, LANG_COOKIE_MAX_AGE, RTL, dirOf, pickLang, cookieLang, type Lang } from "./langs";
