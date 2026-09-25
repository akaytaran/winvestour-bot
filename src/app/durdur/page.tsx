"use client";
// DURDURMA EKRANI (G20 parça 2B · Tur 33 madde 3 · K-7, S-8, U-3). Tek eylem: POST /api/engine/stop + x-stop-key. Başlatma/devam, giriş, emir YOK.
// ANAHTAR (iş sahibi kararı winvestor-durdurma-ekrani-anahtari): her seferinde ELLE yazılır, HİÇBİR YERDE saklanmaz — tarayıcı deposu, URL, kütük yok; alan maskeli ve gönderilirken boşaltılır.
// Oturum, tek kullanımlık kod, onay penceresi YOK (S-8: durdurma koşulsuzdur). İki seçenekten biri varsayılan seçili DEĞİL (K-7). Sonuç, uç yanıtında ÖLÇÜLENDEN kurulur; "gönderildi" yazıp susmaz.
// Kapı: npm run gate:stop-service (13) · kanarya: npm run canary:stop-screen.
import { useState } from "react";

type Mode = "HOLD" | "CLOSE_ALL";
type Outcome = { ok?: boolean; reason?: string; durable?: boolean; mode?: Mode; closeRequested?: boolean; flag?: { state?: string; at?: string };
  persisted?: { neon?: boolean; upstash?: boolean }; event?: { ok?: boolean; id?: number }; retry?: { scheduled?: boolean; windowMs?: number } };
type Phase = "boş" | "eksik" | "gönderiliyor" | "durdu" | "reddedildi" | "yapılandırılmamış" | "seçenek-yok" | "ağ-yok" | "beklenmeyen";

const MODES: { value: Mode; title: string; text: string }[] = [
  { value: "HOLD", title: "Yalnız durdur", text: "Yeni pozisyon açılmaz. Açık pozisyonlar ve borsadaki koruma emirleri olduğu gibi kalır." },
  { value: "CLOSE_ALL", title: "Durdur ve kapatma iste", text: "Motor durur ve açık pozisyonların kapatılmasını istediğin kaydedilir. Bugün yazılım pozisyonları kendisi KAPATMAZ; borsadaki koruma emirleri yerinde kalır." },
];
const TONE: Record<"ok" | "warn" | "alarm" | "info", { bg: string; bd: string }> = {
  ok: { bg: "#0d2a16", bd: "#78e0a8" }, warn: { bg: "#2a220d", bd: "#ffd479" }, alarm: { bg: "#2a0d0d", bd: "#ff8a7a" }, info: { bg: "#0d1c2a", bd: "#8ec9ff" },
};
const OFFLINE = ["İstek sunucuya ulaşmadı: bu cihazın bağlantısı yok ya da sunucuya erişilemiyor.", "Durdurma isteğinin sunucuya ulaşması gerekir; bağlantı yokken YAPILAMAZ. Motor DURDURULMADI, motorun durumu BİLİNMİYOR.", "Bağlantı gelince anahtarı yeniden yazıp gönder."];

function lines(phase: Phase, r: Outcome | null): { tone: keyof typeof TONE; text: string[] } {
  if (phase === "eksik") return { tone: "warn", text: ["Gönderilmedi: önce ne olacağını seç ve durdurma anahtarını yaz."] };
  if (phase === "gönderiliyor") return { tone: "info", text: ["Gönderiliyor. Sunucunun yanıtı bekleniyor; yanıt gelmeden sonuç yazılmaz."] };
  if (phase === "ağ-yok") return { tone: "alarm", text: OFFLINE };
  if (phase === "reddedildi") return { tone: "alarm", text: ["Durdurma anahtarı kabul edilmedi. Motor DURDURULMADI; hiçbir şey değişmedi.", "Anahtarı yeniden yazıp gönder."] };
  if (phase === "yapılandırılmamış") return { tone: "alarm", text: ["Sunucuda durdurma anahtarı tanımlı değil; istek bu yüzden işlenemedi. Motor DURDURULMADI."] };
  if (phase === "seçenek-yok") return { tone: "alarm", text: ["Seçenek sunucuya ulaşmadı. Motor DURDURULMADI. Seçeneği işaretleyip yeniden gönder."] };
  if (phase === "beklenmeyen" || !r) return { tone: "alarm", text: ["Sunucu beklenmeyen bir yanıt verdi; durdurmanın gerçekleşip gerçekleşmediği BİLİNMİYOR.", "Yeniden gönder: durdurmayı birden çok kez göndermenin zararı yoktur."] };
  const at = r.flag?.at ? new Date(r.flag.at).toLocaleString("tr-TR") : "zamanı okunamadı";
  const out = [
    `İstek sunucuya ulaştı ve kabul edildi. Motorun yeni durumu: ${r.flag?.state === "STOPPED" ? "DURDU" : `okunamadı (${r.flag?.state ?? "yanıtta yok"})`} · ${at}.`,
    `Seçenek: ${MODES.find((m) => m.value === r.mode)?.title ?? "yanıtta yok"}.${r.closeRequested ? " Kapatma isteği kaydedildi; yazılım pozisyonları kendisi kapatmadı." : ""}`,
    `Kalıcı kayıt (Neon veritabanı): ${r.persisted?.neon ? "yazıldı" : "yanıt süresi içinde yazıldığı doğrulanamadı"}.`,
    `Hızlı kayıt (Upstash): ${r.persisted?.upstash ? "yazıldı — motor bir sonraki turunda çalışmaz" : "yanıt süresi içinde yazıldığı doğrulanamadı — bu kayıt yazılana kadar motor bir sonraki izin tazelemesine kadar çalışmayı sürdürebilir"}.`,
    r.event?.ok ? `Olay kaydı yazıldı: ${r.event.id} numaralı kayıt.` : "Olay kaydı YAZILAMADI; durdurma yine geçerlidir.",
  ];
  if (r.retry?.scheduled) out.push(`Doğrulanamayan kayıt için sunucu ${Math.max(1, Math.round((r.retry.windowMs ?? 0) / 60_000))} dakika boyunca yeniden deniyor.`);
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
  const field: React.CSSProperties = { width: "100%", boxSizing: "border-box", fontSize: "1rem", padding: ".7rem .8rem", borderRadius: 6, border: "1px solid #6b6b73", background: "#141416", color: "#e8e8ea" };
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", background: "#0b0b0c", color: "#e8e8ea", minHeight: "100vh", padding: "2rem 1rem" }}>
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <h1 style={{ fontSize: "1.35rem", marginBottom: ".4rem" }}>Winvestour · motoru durdur</h1>
        <p style={{ color: "#b4b4bb", lineHeight: 1.6, margin: "0 0 1.2rem" }}>Bu ekran yalnız durdurur. İstek sunucuya gider; oturum ve tek kullanımlık kod istemez. Durdurma anahtarı her seferinde elle yazılır ve bu cihazda hiçbir yere kaydedilmez.</p>
        <fieldset style={{ border: "1px solid #3a3a40", borderRadius: 8, padding: ".8rem 1rem", margin: "0 0 1rem" }}>
          <legend style={{ padding: "0 .4rem" }}>Ne olsun?</legend>
          {MODES.map((m) => (
            <label key={m.value} style={{ display: "flex", gap: ".6rem", alignItems: "flex-start", padding: ".5rem 0", cursor: "pointer" }}>
              <input type="radio" name="mode" value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} style={{ marginTop: ".3rem", width: "1.1rem", height: "1.1rem" }} />
              <span><strong>{m.title}</strong><br /><span style={{ color: "#b4b4bb", lineHeight: 1.5 }}>{m.text}</span></span>
            </label>
          ))}
        </fieldset>
        <label htmlFor="stop-key" style={{ display: "block", marginBottom: ".4rem" }}>Durdurma anahtarı</label>
        <input id="stop-key" type="password" value={stopKey} onChange={(e) => setStopKey(e.target.value)} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} style={field} />
        <button id="stop-send" type="button" onClick={() => void send()} disabled={phase === "gönderiliyor"}
          style={{ marginTop: "1rem", width: "100%", fontSize: "1.05rem", fontWeight: 700, padding: ".85rem", borderRadius: 8, border: "none", background: phase === "gönderiliyor" ? "#3a3a40" : "#ff8a7a", color: phase === "gönderiliyor" ? "#e8e8ea" : "#1a0505", cursor: "pointer" }}>
          {phase === "gönderiliyor" ? "Gönderiliyor" : "Durdur"}
        </button>
        <div id="stop-result" role="status" aria-live="polite" data-state={phase}
          style={shown ? { background: TONE[shown.tone].bg, border: `1px solid ${TONE[shown.tone].bd}`, borderRadius: 8, padding: ".9rem 1.1rem", marginTop: "1.2rem" } : undefined}>
          {shown?.text.map((l, i) => <p key={i} style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{l}</p>)}
        </div>
        <p style={{ marginTop: "1.6rem" }}><a href="/panel" style={{ color: "#8ec9ff" }}>Panele dön</a></p>
      </div>
    </main>
  );
}
