"use client";
// PANELİN DURDURMA FORMU (G32 · Tur 76 · K-7, S-8, U-3). Tek eylem: mevcut POST /api/engine/stop + x-stop-key — uç sözleşmesi aynen (gövde {mode}, varsayılan YOK).
// AYRI DOSYA, BİLEREK: gate:stop-service (13) durdurma isteği gönderen HER ekranı aynı sıkı kurallarla ölçer (anahtar maskeli ve saklanmaz, URL'ye/kütüğe düşmez, tek istek,
//   ikinci doğrulama yok, seçenek varsayılansız, sonuç ölçülenden, çevrimdışı cümlesi). Bu form o kuralların HEPSİNDEN geçer; panelin geri kalanı bu dosyaya girmez.
// Yön: panel bu formu içe aktarır; `/durdur` ekranı ve durdurma ucu panele HİÇ bağlı değildir (gate:stop-service K-7 grafiği) — panel kırılsa da `/durdur` çalışır.
// ANAHTAR her seferinde elle yazılır, hiçbir yerde saklanmaz; alan maskeli ve gönderilirken boşaltılır. Onay penceresi YOK (durdurma koşulsuzdur).
// Tur 77 (K-C): metnin TEK kaynağı sözlüktür (`@/lib/i18n` — panel ağacında DEĞİL, K-7 grafiği temiz); çevrimdışı cümlesi `S.panelOffline`.
import { useState } from "react";
import { fill, section } from "@/lib/i18n";

const S = section("stop"), C = section("common"); // Tur 79: etkin dilin sözlüğü, erişim anında (Panel render başında useActivateLang)
type Mode = "HOLD" | "CLOSE_ALL";
type Outcome = { ok?: boolean; mode?: Mode; closeRequested?: boolean; flag?: { state?: string; at?: string }; persisted?: { neon?: boolean; upstash?: boolean }; event?: { ok?: boolean; id?: number }; retry?: { scheduled?: boolean; windowMs?: number } };
export type DurdurSonucu = { ton: "OK" | "WARN" | "ALARM"; metin: string };
const MODES: { value: Mode; title: string; text: string }[] = [
  { value: "HOLD", title: S.modes.HOLD.title, text: S.modes.HOLD.text },
  { value: "CLOSE_ALL", title: S.modes.CLOSE_ALL.title, text: S.modes.CLOSE_ALL.text },
];
const OFFLINE = S.panelOffline;

function sonucOf(status: number, r: Outcome | null): DurdurSonucu {
  if (status === 401) return { ton: "ALARM", metin: S.panelRejected };
  if (status === 503) return { ton: "ALARM", metin: S.panelUnconfigured };
  if (status === 400) return { ton: "ALARM", metin: S.panelNoMode };
  if (!r?.ok || (status !== 200 && status !== 202)) return { ton: "ALARM", metin: S.panelUnexpected };
  const parts = [
    fill(S.panelAccepted, { state: r.flag?.state === "STOPPED" ? S.stateStopped : fill(S.stateUnread, { state: r.flag?.state ?? S.notInAnswer }) }),
    `${fill(S.choice, { mode: MODES.find((m) => m.value === r.mode)?.title ?? S.notInAnswer })}${r.closeRequested ? S.closeRecorded : ""}`,
    fill(S.panelStores, { neon: r.persisted?.neon ? S.written : S.panelNeonUnconfirmed, upstash: r.persisted?.upstash ? S.panelUpstashWritten : S.panelUpstashUnconfirmed }),
    r.event?.ok ? S.panelEventOk : S.eventFailed,
  ];
  return { ton: r.persisted?.neon && r.persisted?.upstash && r.event?.ok ? "OK" : "WARN", metin: `${parts.join(" ")} ${S.panelReread}` };
}

/** `bitti(sonuc, kabul)`: panel sonucu kendi durum satırına yazar ve hâli sunucudan YENİDEN okur (istemci "Stopped" yazmaz). */
export function DurdurFormu({ bitti, vazgec }: { bitti: (s: DurdurSonucu, kabul: boolean) => Promise<void>; vazgec: () => void }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [durdurAnahtar, setDurdurAnahtar] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const send = async () => {
    if (!mode || durdurAnahtar === "" || gonderiliyor) return;
    const key = durdurAnahtar; setDurdurAnahtar("");
    if (typeof navigator !== "undefined" && navigator.onLine === false) { await bitti({ ton: "ALARM", metin: OFFLINE }, false); return; }
    setGonderiliyor(true);
    let res: Response;
    try { res = await fetch("/api/engine/stop", { method: "POST", cache: "no-store", headers: { "content-type": "application/json", "x-stop-key": key }, body: JSON.stringify({ mode }) }); }
    catch { setGonderiliyor(false); await bitti({ ton: "ALARM", metin: OFFLINE }, false); return; }
    let body: Outcome | null = null; try { body = (await res.json()) as Outcome; } catch { body = null; }
    setGonderiliyor(false);
    const kabul = !!body?.ok && (res.status === 200 || res.status === 202);
    if (kabul) setMode(null);
    await bitti(sonucOf(res.status, body), kabul);
  };
  const field: React.CSSProperties = { display: "block", width: "100%", maxWidth: 320, minHeight: "2.75rem", boxSizing: "border-box", padding: ".7rem .8rem", fontSize: "1rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 6 };
  const etkin = !!mode && durdurAnahtar !== "" && !gonderiliyor;
  return (
    <div style={{ borderTop: "1px solid #23232a", paddingTop: ".6rem" }}>
      <fieldset style={{ border: "1px solid #3a3a40", borderRadius: 8, padding: ".6rem .9rem", margin: "0 0 .7rem" }}>
        <legend style={{ padding: "0 .4rem" }}>{S.legendPanel}</legend>
        {MODES.map((m) => (
          <label key={m.value} style={{ display: "flex", gap: ".6rem", alignItems: "flex-start", padding: ".35rem 0", minHeight: "2.75rem", cursor: "pointer" }}>
            <input type="radio" data-mod={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} style={{ marginTop: ".3rem" }} />
            <span><strong>{m.title}</strong><br /><span style={{ color: "#b4b4bb", lineHeight: 1.5 }}>{m.text}</span></span>
          </label>))}
      </fieldset>
      <label htmlFor="durdur-anahtar" style={{ display: "block", margin: "0 0 .3rem", color: "#b4b4bb" }}>{S.keyLabelPanel}</label>
      <input id="durdur-anahtar" type="password" value={durdurAnahtar} onChange={(x) => setDurdurAnahtar(x.target.value)} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} disabled={gonderiliyor} style={field} />
      <p style={{ display: "flex", flexWrap: "wrap", gap: ".6rem", margin: ".7rem 0 0" }}>
        <button id="durdur-gonder" type="button" onClick={() => void send()} disabled={!etkin}
          style={{ fontSize: "1.1rem", fontWeight: 700, padding: ".8rem 1.4rem", minWidth: "12rem", minHeight: "2.75rem", borderRadius: 8, border: `1px solid ${etkin ? "#ff8a7a" : "#33333c"}`, background: etkin ? "#ff8a7a" : "#1a1a20", color: etkin ? "#1a0505" : "#e8e8ea", cursor: etkin ? "pointer" : "not-allowed" }}>{gonderiliyor ? S.sendingPanel : S.sendPanel}</button>
        <button type="button" onClick={() => { setDurdurAnahtar(""); setMode(null); vazgec(); }} style={{ minHeight: "2.75rem", padding: ".45rem .9rem", borderRadius: 6, border: "1px solid #33333c", background: "#141419", color: "#e8e8ea", cursor: "pointer" }}>{C.cancel}</button>
      </p>
    </div>
  );
}
