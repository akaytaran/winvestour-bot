"use client";
// DURDURMA EKRANI (G20 parça 2B · Tur 33 madde 3 · K-7, S-8, U-3). Tek eylem: POST /api/engine/stop + x-stop-key. Başlatma/devam, giriş, emir YOK.
// ANAHTAR (iş sahibi kararı winvestor-durdurma-ekrani-anahtari): her seferinde ELLE yazılır, HİÇBİR YERDE saklanmaz — tarayıcı deposu, URL, kütük yok; alan maskeli ve gönderilirken boşaltılır.
// Oturum, tek kullanımlık kod, onay penceresi YOK (S-8: durdurma koşulsuzdur). İki seçenekten biri varsayılan seçili DEĞİL (K-7). Sonuç, uç yanıtında ÖLÇÜLENDEN kurulur; "gönderildi" yazıp susmaz.
// Tur 77 (K-C): metnin TEK kaynağı sözlüktür (`@/lib/i18n` — panel ağacında DEĞİL; K-7 içe aktarma grafiği panel 0). Çevrimdışı cümlesi `S.offline`. An tek biçimleyiciden.
// Kapı: npm run gate:stop-service (13) · kanarya: npm run canary:stop-screen.
import { useState } from "react";
import { dict, fill } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/format";

const S = dict().stop;
type Mode = "HOLD" | "CLOSE_ALL";
type Outcome = { ok?: boolean; reason?: string; durable?: boolean; mode?: Mode; closeRequested?: boolean; flag?: { state?: string; at?: string };
  persisted?: { neon?: boolean; upstash?: boolean }; event?: { ok?: boolean; id?: number }; retry?: { scheduled?: boolean; windowMs?: number } };
type Phase = "boş" | "eksik" | "gönderiliyor" | "durdu" | "reddedildi" | "yapılandırılmamış" | "seçenek-yok" | "ağ-yok" | "beklenmeyen";

const MODES: { value: Mode; title: string; text: string }[] = [
  { value: "HOLD", title: S.modes.HOLD.title, text: S.modes.HOLD.text },
  { value: "CLOSE_ALL", title: S.modes.CLOSE_ALL.title, text: S.modes.CLOSE_ALL.text },
];
const TONE: Record<"ok" | "warn" | "alarm" | "info", { bg: string; bd: string }> = {
  ok: { bg: "#0d2a16", bd: "#78e0a8" }, warn: { bg: "#2a220d", bd: "#ffd479" }, alarm: { bg: "#2a0d0d", bd: "#ff8a7a" }, info: { bg: "#0d1c2a", bd: "#8ec9ff" },
};
const OFFLINE: readonly string[] = S.offline;

function lines(phase: Phase, r: Outcome | null): { tone: keyof typeof TONE; text: readonly string[] } {
  if (phase === "eksik") return { tone: "warn", text: [S.missing] };
  if (phase === "gönderiliyor") return { tone: "info", text: [S.waiting] };
  if (phase === "ağ-yok") return { tone: "alarm", text: OFFLINE };
  if (phase === "reddedildi") return { tone: "alarm", text: S.rejected };
  if (phase === "yapılandırılmamış") return { tone: "alarm", text: [S.unconfigured] };
  if (phase === "seçenek-yok") return { tone: "alarm", text: [S.noMode] };
  if (phase === "beklenmeyen" || !r) return { tone: "alarm", text: S.unexpected };
  let at: string = S.atUnread; try { if (r.flag?.at) at = fmt.dateTime(r.flag.at); } catch { at = S.atUnread; }
  const out = [
    fill(S.accepted, { state: r.flag?.state === "STOPPED" ? S.stateStopped : fill(S.stateUnread, { state: r.flag?.state ?? S.notInAnswer }), at }),
    `${fill(S.choice, { mode: MODES.find((m) => m.value === r.mode)?.title ?? S.notInAnswer })}${r.closeRequested ? S.closeRecorded : ""}`,
    fill(S.neon, { state: r.persisted?.neon ? S.written : S.neonUnconfirmed }),
    fill(S.upstash, { state: r.persisted?.upstash ? S.upstashWritten : S.upstashUnconfirmed }),
    r.event?.ok ? fill(S.eventOk, { id: r.event.id ?? S.notInAnswer }) : S.eventFailed,
  ];
  if (r.retry?.scheduled) out.push(fill(S.retry, { minutes: Math.max(1, Math.round((r.retry.windowMs ?? 0) / 60_000)) }));
  return { tone: r.persisted?.neon && r.persisted?.upstash && r.event?.ok ? "ok" : "warn", text: out };
}

export default function StopScreen() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [stopKey, setStopKey] = useState("");
  const [phase, setPhase] = useState<Phase>("boş");
  const [result, setResult] = useState<Outcome | null>(null);

  const send = async () => {
    if (!mode || stopKey.length === 0) { setPhase("eksik"); return; }
    const key = stopKey; setStopKey("");
    setResult(null);
    if (typeof navigator !== "undefined" && navigator.onLine === false) { setPhase("ağ-yok"); return; }
    setPhase("gönderiliyor");
    let res: Response;
    try { res = await fetch("/api/engine/stop", { method: "POST", cache: "no-store", headers: { "content-type": "application/json", "x-stop-key": key }, body: JSON.stringify({ mode }) }); }
    catch { setPhase("ağ-yok"); return; }
    let body: Outcome | null = null; try { body = (await res.json()) as Outcome; } catch { body = null; }
    setResult(body);
    setPhase(body?.ok && (res.status === 200 || res.status === 202) ? "durdu" : res.status === 401 ? "reddedildi" : body?.reason === "STOP_UNCONFIGURED" ? "yapılandırılmamış" : res.status === 400 ? "seçenek-yok" : "beklenmeyen");
  };

  const shown = phase === "boş" ? null : lines(phase, result);
  const field: React.CSSProperties = { width: "100%", boxSizing: "border-box", minHeight: "2.75rem", fontSize: "1rem", padding: ".7rem .8rem", borderRadius: 6, border: "1px solid #6b6b73", background: "#141416", color: "#e8e8ea" };
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", background: "#0b0b0c", color: "#e8e8ea", minHeight: "100vh", padding: "2rem 1rem" }}>
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <h1 style={{ fontSize: "1.35rem", marginBottom: ".4rem" }}>{S.title}</h1>
        <p style={{ color: "#b4b4bb", lineHeight: 1.6, margin: "0 0 1.2rem" }}>{S.intro}</p>
        <fieldset style={{ border: "1px solid #3a3a40", borderRadius: 8, padding: ".8rem 1rem", margin: "0 0 1rem" }}>
          <legend style={{ padding: "0 .4rem" }}>{S.legend}</legend>
          {MODES.map((m) => (
            <label key={m.value} style={{ display: "flex", gap: ".6rem", alignItems: "flex-start", padding: ".5rem 0", cursor: "pointer" }}>
              <input type="radio" name="mode" value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} style={{ marginTop: ".3rem", width: "1.1rem", height: "1.1rem" }} />
              <span><strong>{m.title}</strong><br /><span style={{ color: "#b4b4bb", lineHeight: 1.5 }}>{m.text}</span></span>
            </label>
          ))}
        </fieldset>
        <label htmlFor="stop-key" style={{ display: "block", marginBottom: ".4rem" }}>{S.keyLabel}</label>
        <input id="stop-key" type="password" value={stopKey} onChange={(e) => setStopKey(e.target.value)} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} style={field} />
        <button id="stop-send" type="button" onClick={() => void send()} disabled={phase === "gönderiliyor"}
          style={{ marginTop: "1rem", width: "100%", minHeight: "2.75rem", fontSize: "1.05rem", fontWeight: 700, padding: ".85rem", borderRadius: 8, border: "none", background: phase === "gönderiliyor" ? "#3a3a40" : "#ff8a7a", color: phase === "gönderiliyor" ? "#e8e8ea" : "#1a0505", cursor: "pointer" }}>
          {phase === "gönderiliyor" ? S.sending : S.send}
        </button>
        <div id="stop-result" role="status" aria-live="polite" data-state={phase}
          style={shown ? { background: TONE[shown.tone].bg, border: `1px solid ${TONE[shown.tone].bd}`, borderRadius: 8, padding: ".9rem 1.1rem", marginTop: "1.2rem" } : undefined}>
          {shown?.text.map((l, i) => <p key={i} style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{l}</p>)}
        </div>
        <p style={{ marginTop: "1.6rem" }}><a href="/panel" style={{ color: "#8ec9ff" }}>{S.back}</a></p>
      </div>
    </main>
  );
}
