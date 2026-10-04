"use client";
// BİLGİ (i) MODALI — TEK BİLEŞEN (Tur 83 · G37 bileşeni · iş sahibi kararı D3, KARAR-DEFTERI 2 Eki 12:01 · Üretim S12-2). Uzun açıklama sayfada DURMAZ: ayarın/düğmenin yanındaki (i) düğmesi
//   bu modalı açar; sayfada yalnız ayar adı, değeri, kısa durum satırı ve kontrol kalır. Bu turda YALNIZ Tur 83'ün yeni satırlarında (kaldıraç tavanı, short) kullanılır; öteki sayfalar G37 turunda.
// ERİŞİLEBİLİRLİK (kapı: gate:ui (T83) · kanarya: canary:info-modal): düğme gerçek <button> (Enter/Space açar), erişilebilir adı ayarın adını taşır, `aria-haspopup="dialog"`, `aria-expanded`;
//   modal `role="dialog"` + `aria-modal="true"` + `aria-labelledby` (başlık) + `aria-describedby` (metin); açılınca odak modalın içine (kapat düğmesi) gider, Tab/Shift+Tab modalın içinde döner
//   (odak tuzağı), Esc ve "Kapat" kapatır, kapanınca odak (i) düğmesine GERİ döner. Hedefler 44 px (DOKUN). Renkler belgeler/TASARIM-SISTEMI.md paletinden — yeni renk YOK.
// METİN BU DOSYADA YOKTUR: başlık, gövde ve düğme adları çağırandan (sözlükten) gelir; 7 dil sözlükte durur.
// Tur 88 (G37 · D3, S17-6): panelin BÜTÜN sekmelerinde kullanılır. Bölümün "ne yapar" cümlesi modalın İLK satırıysa çağıran `data-ne-yapar` verir; işaret (i) düğmesine konur
//   (gate:ui "ne yapar" kuralı ve kanaryalar cümlenin bölümde bulunduğunu düğmeden ölçer; cümlenin kendisi modalda, sayfa gövdesinde DEĞİL).
import { useCallback, useEffect, useId, useRef, useState } from "react";

const DOKUN = "2.75rem";
export type BilgiMetni = { baslik: string; satirlar: string[]; acEtiketi: string; kapatEtiketi: string };

export function BilgiModali({ metin, kimlik, "data-ne-yapar": neYapar }: { metin: BilgiMetni; kimlik: string; "data-ne-yapar"?: boolean }) {
  const [acik, setAcik] = useState(false), id = useId(), dugme = useRef<HTMLButtonElement>(null), kutu = useRef<HTMLDivElement>(null), kapat = useRef<HTMLButtonElement>(null);
  const kapa = useCallback(() => { setAcik(false); setTimeout(() => dugme.current?.focus(), 0); }, []);
  useEffect(() => { if (acik) kapat.current?.focus(); }, [acik]);
  const tus = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); kapa(); return; }
    if (e.key !== "Tab" || !kutu.current) return;
    const odaklanir = [...kutu.current.querySelectorAll<HTMLElement>("button, a[href], [tabindex]:not([tabindex='-1'])")];
    if (odaklanir.length === 0) return;
    const ilk = odaklanir[0], son = odaklanir[odaklanir.length - 1];
    if (e.shiftKey && document.activeElement === ilk) { e.preventDefault(); son.focus(); } else if (!e.shiftKey && document.activeElement === son) { e.preventDefault(); ilk.focus(); }
  };
  return (<>
    <button ref={dugme} type="button" data-bilgi-dugme={kimlik} data-ne-yapar={neYapar ? "" : undefined} aria-label={metin.acEtiketi} aria-haspopup="dialog" aria-expanded={acik} onClick={() => setAcik(true)}
      style={{ minWidth: DOKUN, minHeight: DOKUN, borderRadius: 999, border: "1px solid #2b7fc9", background: "#141419", color: "#8ec9ff", fontWeight: 700, fontSize: "1rem", cursor: "pointer", flex: "0 0 auto" }}>i</button>
    {acik && <div data-bilgi-perde={kimlik} onClick={kapa} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(11, 11, 12, 0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div ref={kutu} role="dialog" aria-modal="true" aria-labelledby={`${id}-b`} aria-describedby={`${id}-m`} data-bilgi-modal={kimlik} onKeyDown={tus} onClick={(e) => e.stopPropagation()}
        style={{ background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 8, padding: "1rem 1.1rem", width: "100%", maxWidth: "34rem", maxHeight: "85vh", overflowY: "auto", boxSizing: "border-box" }}>
        <h3 id={`${id}-b`} style={{ fontSize: "1.05rem", margin: "0 0 .6rem" }}>{metin.baslik}</h3>
        <div id={`${id}-m`}>{metin.satirlar.map((s, i) => <p key={i} style={{ margin: ".4rem 0", lineHeight: 1.55, color: i === 0 ? "#e8e8ea" : "#b4b4bb" }}>{s}</p>)}</div>
        <p style={{ margin: ".8rem 0 0", textAlign: "end" }}><button ref={kapat} type="button" onClick={kapa}
          style={{ minHeight: DOKUN, padding: ".45rem .9rem", borderRadius: 6, border: "1px solid #2b7fc9", background: "#12354f", color: "#e8e8ea", cursor: "pointer" }}>{metin.kapatEtiketi}</button></p>
      </div>
    </div>}
  </>);
}
