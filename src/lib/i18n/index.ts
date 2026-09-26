// SÖZLÜK YARDIMCISI (Tur 77, K-C · G32 parça 2/2). Metnin TEK kaynağı `./en.ts`tir; bileşen ve uçlar metni ANAHTAR YOLUYLA (T.bolum.anahtar) alır, cümleyi kendisi yazmaz.
// Yer tutucu biçimi `{ad}`: çeviri dosyaları (Tur 78) aynı adları taşır; `fill` bilinmeyen yer tutucuyu OLDUĞU GİBİ bırakır (boş dize yazmaz — eksik veri görünür kalsın, Ö-2).
import { EN, type Dict } from "./en";

export type Lang = "en";
export const LANG: Lang = "en";
/** Dil seçici Tur 78'in işidir; bugün tek sözlük vardır. Dönüş tipi `Dict`: yeni dil dosyası aynı şekli doldurmak zorundadır (derleyici zorlar). */
export const dict = (): Dict => EN;
/** `{ad}` yer tutucularını doldurur. Değer `null`/`undefined` ise yer tutucu olduğu gibi kalır. */
export function fill(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (m, k: string) => { const v = vars[k]; return v === null || v === undefined ? m : String(v); });
}
export { EN, type Dict };
