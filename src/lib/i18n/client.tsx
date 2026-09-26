"use client";
// DİL SAĞLAYICISI + DİL SEÇİCİ (Tur 79 · G34 · karar defteri 25 Eyl). Kök düzen (sunucu) dili İSTEKTEN seçer (çerez → Accept-Language → EN) ve buraya verir ⇒ SSR ilk boyamada doğru dil.
// Sağlayıcı istemcinin "etkin dili"ni ayarlar; kök bileşenler (panel, /durdur) render'ın BAŞINDA `useActivateLang()` çağırır — `T.a.b` o render'da doğru sözlükten çözülür.
// SEÇİM: yalnız dil KODU çereze yazılır (sır yok, oturum/kimlik kararına girmez); `<html lang dir>` anında güncellenir, sayfa yeniden yüklenmez (açık kilit/oturum hâli korunur);
//   `wv-lang` olayı yayılır — panel verisini (sunucu cümleleri) yeni dilde yeniden okur. Seçici yerel `<details>/<summary>` + düğmelerdir: klavyeyle açılır/seçilir, Escape kapatır;
//   her hedef ≥ 44 px (2,75 rem). Dil adları KENDİ dilinde (langs.ts). Renkler TASARIM-SISTEMI'nin mevcut belirteçleri (yeni renk yok).
import { createContext, useContext, useState } from "react";
import { AVAILABLE, LANG_COOKIE, LANG_COOKIE_MAX_AGE, LANG_NAMES, dict, dirOf, fill, setActiveLang, type Lang } from "@/lib/i18n";

const Ctx = createContext<{ lang: Lang; set: (l: Lang) => void }>({ lang: "en", set: () => undefined });
const T = dict();
export const LANG_EVENT = "wv-lang";

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  const [current, setCurrent] = useState<Lang>(lang);
  setActiveLang(current); // render'ın başında: bu ağacın bütün sözlük okumaları bu dilden
  const set = (l: Lang) => {
    document.cookie = [`${LANG_COOKIE}=${l}`, "Path=/", `Max-Age=${LANG_COOKIE_MAX_AGE}`, "SameSite=Lax"].join("; "); // yalnız dil kodu
    document.documentElement.lang = l; document.documentElement.dir = dirOf(l);
    setActiveLang(l); setCurrent(l); window.dispatchEvent(new CustomEvent(LANG_EVENT, { detail: l }));
  };
  return <Ctx.Provider value={{ lang: current, set }}>{children}</Ctx.Provider>;
}
/** Kök istemci bileşeni render'ının BAŞINDA çağrılır: etkin dili sağlayıcının diline çeker ve dili döndürür. */
export function useActivateLang(): Lang { const { lang } = useContext(Ctx); setActiveLang(lang); return lang; }

const tus: React.CSSProperties = { minHeight: "2.75rem", boxSizing: "border-box", display: "inline-flex", alignItems: "center", gap: ".35rem", padding: ".35rem .75rem", borderRadius: 6, border: "1px solid #33333c", background: "#141419", color: "#e8e8ea", cursor: "pointer", fontSize: ".95rem" };
/** Dil seçici. `id` sayfadaki yerini ayırır (kanarya ve ölçü için). */
export function LangSelect({ id }: { id: string }) {
  const { lang, set } = useContext(Ctx); useActivateLang();
  // Liste yalnız açıkken çizilir: Chrome kapalı <details> içeriğine de yerleşim kutusu verir; kutu 390 px'te sayfa kenarından taşıyordu (Tur 79 ölçümü, AR'de sola).
  const [acik, setAcik] = useState(false);
  return (
    <details id={id} data-lang-select style={{ position: "relative", display: "inline-block" }} onToggle={(e) => setAcik(e.currentTarget.open)}
      onKeyDown={(e) => { if (e.key === "Escape") { const d = e.currentTarget; d.removeAttribute("open"); d.querySelector("summary")?.focus(); } }}>
      <summary aria-label={T.langSelect.label} title={T.langSelect.hint} style={{ ...tus, listStyle: "none" }}>{fill(T.langSelect.current, { name: LANG_NAMES[lang] })}</summary>
      {acik && <div role="group" aria-label={T.langSelect.label} style={{ marginTop: ".3rem", display: "grid", gap: ".25rem", minWidth: "11rem", padding: ".35rem", background: "#141419", border: "1px solid #33333c", borderRadius: 6 }}>
        {AVAILABLE.map((l) => (
          <button key={l} type="button" lang={l} dir={dirOf(l)} aria-pressed={l === lang} data-lang-option={l}
            onClick={(e) => { set(l); const d = e.currentTarget.closest("details"); d?.removeAttribute("open"); d?.querySelector("summary")?.focus(); }}
            style={{ ...tus, justifyContent: "flex-start", border: `1px solid ${l === lang ? "#2b7fc9" : "#33333c"}`, background: l === lang ? "#12354f" : "#141419", fontWeight: l === lang ? 700 : 400 }}>{LANG_NAMES[l]}</button>))}
      </div>}
    </details>
  );
}
