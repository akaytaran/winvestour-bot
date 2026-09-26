// SUNUCU CÜMLELERİ SÖZLÜĞÜ — dizin (Tur 79 · G34 · S5). YALNIZ sunucuda içe aktarılır (panel/sağlık/ayar/anahtar modülleri, uçlar); istemci paketine girmez.
// `srvFor(lang)`: o dilin TAM sunucu sözlüğü — istemci sözlüğüyle aynı tamamlayıcıdan (`completeDict`) geçer: eksik/boş/yer tutucusu farklı yaprak EN'ye düşer.
// İÇ KAYIT DİLİ `tr`: modüllerin dil parametresi verilmeyen çağrısı `srvFor("tr")` kullanır (olay, kütük, kanarya bugünkü Türkçe cümlesini alır); uç isteğin dilini geçer.
import { completeDict, AVAILABLE } from "../index";
import type { Lang } from "../langs";
import { EN_SRV, type SrvDict } from "./en";
import { TR_SRV } from "./tr";
import { AR_SRV } from "./ar";
import { DE_SRV } from "./de";
import { RU_SRV } from "./ru";
import { IT_SRV } from "./it";
import { FR_SRV } from "./fr";

const RAW: Partial<Record<Lang, unknown>> = { en: EN_SRV, tr: TR_SRV, de: DE_SRV, ru: RU_SRV, it: IT_SRV, fr: FR_SRV, ar: AR_SRV }; // Tur 80: yedi dil
/** Sunucu sözlüğü olan diller — istemci sözlüğünün dilleriyle AYNI olmak zorunda (gate:i18n (9)). */
export const SRV_AVAILABLE: readonly Lang[] = AVAILABLE.filter((l) => RAW[l] !== undefined);
/** İç kayıt dili (dil parametresi verilmeyen iç çağrılar). */
export const RECORD_LANG: Lang = "tr";
const cache = new Map<string, SrvDict>();
export function srvFor(lang: string): SrvDict {
  const l = (Object.keys(RAW) as string[]).includes(lang) ? lang : "en"; let d = cache.get(l);
  if (!d) { d = l === "en" ? EN_SRV : completeDict<SrvDict>(EN_SRV, RAW[l as Lang]); cache.set(l, d); }
  return d;
}
export { EN_SRV, type SrvDict };
