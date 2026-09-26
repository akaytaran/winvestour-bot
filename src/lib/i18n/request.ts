// UÇ DİLİ (Tur 79 · G34). İsteğin dili: seçim çerezi (yalnız dil kodu) → `Accept-Language` → EN. Sunucuda "etkin dil" durumu YOKTUR: her uç dili bu yardımcıyla İSTEKTEN okur ve
//   insan metnini o dilin sözlüğünden kurar. Durum kodu, hata/ret kodu ve JSON anahtar adları dilden BAĞIMSIZDIR (sözleşme kanaryası 7 dilde aynı olduğunu ölçer).
// Dil çerezi erişim/kimlik kararına GİRMEZ: bu dosya src/lib/access'ten içe aktarılmaz (gate:i18n (18)).
import { AVAILABLE, dictFor, type Dict } from "./index";
import { cookieLang, pickLang, type Lang } from "./langs";
import { srvFor, type SrvDict } from "./srv";

/** İsteğin dili (mevcut dillerden; bilinmeyen → "en"). Fırlatmaz. */
export function reqLang(req: Request): Lang {
  return pickLang(AVAILABLE, cookieLang(req.headers.get("cookie")), req.headers.get("accept-language"));
}
/** Uç için tek çağrı: dil + istemci/uç sözlüğü (`T.api…`) + sunucu cümleleri sözlüğü (`S…`). */
export function forRequest(req: Request): { lang: Lang; T: Dict; S: SrvDict } {
  const lang = reqLang(req);
  return { lang, T: dictFor(lang), S: srvFor(lang) };
}
