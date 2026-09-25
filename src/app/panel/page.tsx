"use client";
// PANEL EKRANI (G18 · Tur 26 madde 1–4 · P-2, U-3, U-4, U-5, Ö-2). Ekran KENDİ BAŞINA hiçbir sayı üretmez: her satır uçların kurduğu CÜMLEDİR (`lines`), burada yalnız sıralanır ve boyanır.
// Veri ÜÇ uçtan gelir: GET /api/panel (motor · son tur · sağlık · pozisyonlar · uyarılar) · GET /api/brain/settings (harcama + ayar seçenekleri) ·
//   GET /api/risk/settings (Tur 37, G21 kalemi b: kaldıraç tavanı · futures şalteri · SHORT kipi · M-2 futures çarpanı). Üçünde de ikinci bir hesap YAZILMADI.
// Ham kod, ham hata metni ve test verisi ekrana ÇIKMAZ (U-3, U-5): yükleme, oturumsuzluk ve uç düşmesi ayrı ayrı, insan cümlesiyle yazılır.
// RİSK AYARI YÜZEYİ (Tur 37 madde 4-5): ekran ayarın TEK OKUMA YOLUNU (`/api/risk/settings`) okur; kip listesini, kip açıklamalarını ve ret sebebinin insan cümlesini
//   uçtan ALIR — burada kip adı, kaldıraç sayısı ya da eşik SABİTİ YOKTUR (kapı: gate:ui). NULL alan BOŞ BIRAKILMAZ: "SEÇİLMEDİ" diye insan cümlesiyle yazılır (U-3).
//   Değiştirme yüzeyi S-8'e uyar: oturum + eylem başına TOTP; varsayılan doldurulmuş değer YOK, otomatik gönderim YOK, hiçbir alan kendiliğinden yamaya girmez.
import { useCallback, useEffect, useState } from "react";
import type { PanelView, Card, Level } from "@/lib/panel";
import { enroll, lockGate, LOCK_TEXT, platformAvailable, unlock, type LockRead, type LockState } from "@/lib/lock/client";

type CostRow = { model: string; intervalMs: number; brainUsd: string; totalUsd: string | null; underCap: boolean | null; current: boolean; sentence: string };
// Tur 65: A-9 aylık toplam maliyet tavanı ve "tavan boşken davranış" AYAR (brain_settings). `capEmpty` = tavan girilmedi + davranış "Beyin çağrılmaz" (arıza DEĞİL, kurulumun ayarı).
type CostCap = { totalUsd: string | null; brainMonthlyUsd: string | null; brainMonthlyFrom: string; infraUsd: string | null; behavior: "BRAIN_OFF" | "NO_LIMIT"; dailyCalls: number; sentence: string; behaviorSentence: string };
type Settings = { ok: boolean; capEmpty?: boolean; capSentence?: string; costCap?: CostCap; runtime?: { model: string; callIntervalMs: number; candidates: number; candleLimit: number; source: string }; price?: { note: string; stale: boolean };
  cap?: { monthlyUsd: string | null; monthlyFrom: string; dailyCalls: number; dailyFrom: string; period: string }; spend?: { sentence?: string; detail?: string };
  options?: { rows?: CostRow[]; note?: string }; changes?: { at: string; by: string; changes: { field: string; from: string | null; to: string | null }[] }[];
  settings?: { model: string; callIntervalMs: number; candidates: number; candleLimit: number }; allowed?: { models: string[]; intervalChoicesMs: number[]; candidates: { min: number; max: number }; candleLimit: { min: number; max: number } };
  tickView?: TickView };
// Tur 67 (K3): tik aralığı yüzeyi — cümleler ve seçenek etiketleri ürünün kurucusundan (`tickView`) gelir; ekranda ham milisaniye ve kendi hesabı YOKTUR (gate:ui 13).
type TickView = { tickMs: number | null; sentence: string; effectSentence: string; directionSentence: string; choices: { ms: number; label: string; current: boolean }[] };
type Defter = { at: string; by: string; changes: { field: string; from: string | null; to: string | null }[] };
type EntryView = { ok: boolean; enabled?: boolean; updatedAt?: string | null; detail?: string; sentence?: string };
type RiskView = { ok: boolean; settings?: { leverageCap: number | null; futuresEnabled: boolean; shortMode: string; m2FuturesMultiple: string | null };
  futures?: { allowed: boolean; note?: string }; allowed?: { shortModes?: string[]; shortModeNotes?: Record<string, string>; shortModeToday?: Record<string, string> }; changes?: Defter[] };
/** Değiştirilebilir dört alan ve ekrandaki adı. Alan adları uçla BİREBİR aynıdır (yama bu adlarla gider); ekranda gösterilen ad Türkçedir (U-3: kod adı ekranda tek başına durmaz). */
const RISK_ALANLARI = [
  { alan: "leverageCap", ad: "Kaldıraç tavanı", tip: "sayı" },
  { alan: "futuresEnabled", ad: "Futures şalteri", tip: "şalter" },
  { alan: "shortMode", ad: "SHORT kipi", tip: "kip" },
  { alan: "m2FuturesMultiple", ad: "M-2 futures çarpanı", tip: "ondalık" },
] as const;
const RISK_ADI: Record<string, string> = Object.fromEntries(RISK_ALANLARI.map((f) => [f.alan, f.ad]));
/** TAVAN SEÇİLMEDEN "AÇIK" SEÇENEĞİ SUNULMAZ (Tur 38 madde 2a · üretim kararı `winvestor-panel-tavansiz-acik-secenegi` = B · U-3, K-11). Etkin tavan: bu yamada tavan
 *  alanı işaretliyse yazılan değer (boş = seçimi kaldır ⇒ tavan YOK), işaretli değilse kayıtlı ayar. Bu bir YÜZEY savunmasıdır: sunucu reddi AYNEN kalır (validatePatch, 400 INVALID). */
const tavanVar = (r: RiskView, secili: Record<string, boolean>, deger: Record<string, string>) =>
  secili.leverageCap ? /^[1-9][0-9]*$/.test((deger.leverageCap ?? "").trim()) : typeof r.settings?.leverageCap === "number";
const anTr = (iso: string) => `${iso.replace("T", " ").slice(0, 19)} UTC`;
/** Defter satırının insan cümlesi: KİM · NE ZAMAN · NEYİ (eski → yeni). Boş değer "seçilmemiş" diye yazılır; ekranda çıplak boşluk kalmaz (U-3). */
const defterCumlesi = (c: Defter) => `${anTr(c.at)} · ${c.by} · ${c.changes.map((x) => `${RISK_ADI[x.field] ?? x.field}: ${x.from ?? "seçilmemişti"} → ${x.to ?? "seçilmemiş"}`).join(" · ")}`;
/** RİSK AYARININ SATIRLARI — YALNIZ VERİDEN. Hiçbir satır boş hücre bırakmaz: NULL alan "SEÇİLMEDİ" diye ve NE ANLAMA GELDİĞİYLE yazılır (U-3). */
function riskSatirlari(r: RiskView): string[] {
  const s = r.settings; if (!s) return [];
  const kipNotu = r.allowed?.shortModeNotes?.[s.shortMode], kipBugun = r.allowed?.shortModeToday?.[s.shortMode];
  return [
    s.leverageCap === null
      ? "Kaldıraç tavanı: SEÇİLMEDİ — futures yolu bu yüzden kapalı. Bu boş bir hücre değil, kapalı varsayılanın kendisidir: tavan seçilmeden kaldıraçlı işlem açılmaz ve yazılım kendi başına bir sayı seçmez."
      : `Kaldıraç tavanı: ${s.leverageCap}× — borsaya bildirilecek en yüksek kaldıraç budur; motor bunun üstüne çıkamaz.`,
    `Futures şalteri: ${s.futuresEnabled ? "AÇIK" : "KAPALI"} — ${s.futuresEnabled ? "ayar futures yoluna izin veriyor." : "futures yolu ayar düzeyinde kapalı; bu ekrandan açılması tek başına yetmez, futures hesabı ve borsa anahtarının yetkisi de gerekir."}`,
    `SHORT kipi: ${s.shortMode} — ${kipNotu ? `${kipNotu}.` : "bu kipin açıklaması ayar ucundan okunamadı; kipin ne yaptığı BİLİNMİYOR sayılmalı."} ${kipBugun ? `Bugün: ${kipBugun}.` : "Bu kipin bugün emir üretip üretmediği ayar ucundan okunamadı; ürettiği VARSAYILMAMALI."}`,
    s.m2FuturesMultiple === null
      ? "M-2 futures çarpanı: SEÇİLMEDİ. Birim ÇARPANdır (maliyetin kaç katı kenar aranacağı), baz puan değil. Seçilmediği için futures kenarı ölçülemez."
      : `M-2 futures çarpanı: ${s.m2FuturesMultiple}× — maliyetin bu katı kadar kenar aranır (birim: çarpan, baz puan değil).`,
    // Görsel denetimde ölçüldü (Tur 37): "Futures yolu: KAPALI. ... futures yolu KAPALI." — hüküm iki kez yazılıyordu; uç cümlesi hükmü zaten taşıdığı için bir kez yazılır.
    r.futures?.note ? `Futures yolu — ${r.futures.note}` : `Futures yolu: ${r.futures?.allowed ? "ayara göre AÇIK" : "KAPALI"}; sebebi ayar ucundan okunamadı, açık olduğu VARSAYILMADI.`,
    (r.changes ?? []).length === 0
      ? "Son değişiklik: bu ayar bugüne kadar HİÇ DEĞİŞTİRİLMEDİ — değişiklik defterinde tek satır yok. Ekrandaki değerler kurulumdaki kapalı/seçilmemiş hâldir."
      : `Son değişiklik: ${defterCumlesi((r.changes as Defter[])[0])}.`,
  ];
}

// Kenar/etiket renkleri koyu zeminde OKUNABİLİR seçildi (denetçi gözü, Tur 26 madde 7): ilk seçim (#c0392b vb.) küçük punto için ≈ 2,7:1 kontrast veriyordu; bunlar ≥ 7:1.
const TONE: Record<Level, { bg: string; bd: string; tag: string }> = {
  ALARM: { bg: "#2a0d0d", bd: "#ff8a7a", tag: "ACİL" }, WARN: { bg: "#2a220d", bd: "#ffd479", tag: "DİKKAT" },
  INFO: { bg: "#0d1c2a", bd: "#8ec9ff", tag: "BİLGİ" }, OK: { bg: "#0d2a16", bd: "#78e0a8", tag: "NORMAL" },
};
/** BİYOMETRİK KİLİT EKRANI (Tur 40, G20 parça 2B). K-7: durdurma bağlantısı kilitliyken de burada durur. Panel verisi kilit açılmadan OKUNMAZ. */
function KilitEkrani({ durum, not, ac, tanit, ayar, dogrulayiciVar, yenile }: { durum: LockState | "CHECKING"; not: string | null; ac: () => void; tanit: () => void; ayar: LockRead | null; dogrulayiciVar: boolean | null; yenile: () => Promise<void> }) {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", background: "#0b0b0c", color: "#e8e8ea", minHeight: "100vh", padding: "2rem 1rem" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <h1 style={{ fontSize: "1.35rem" }}>Winvestour · motor paneli</h1>
        <p style={{ margin: "0 0 .6rem" }}><a href="/durdur" style={{ color: "#ff8a7a", fontWeight: 700 }}>Motoru durdur</a> (kilit ve oturum istemez)</p>
        <p style={{ lineHeight: 1.6 }}>{durum === "CHECKING" ? "Kilit ayarı okunuyor; okunmadan panel içeriği gösterilmez." : LOCK_TEXT[durum]}</p>
        {durum === "LOCKED" && <p style={{ display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
          <button onClick={ac} style={{ padding: ".45rem .9rem", borderRadius: 6, border: "1px solid #2b7fc9", background: "#12354f", color: "#e8e8ea", cursor: "pointer" }}>Kilidi aç</button>
          <button onClick={tanit} style={{ padding: ".45rem .9rem", borderRadius: 6, border: "1px solid #33333c", background: "#141419", color: "#e8e8ea", cursor: "pointer" }}>Bu cihazı kilide tanıt</button>
        </p>}
        {not !== null && <p role="status" aria-live="polite" style={{ lineHeight: 1.55, color: "#9a9aa2" }}>{not}</p>}
        {/* U-3 KILITLENME TUZAGI (Tur 63): ayar yuzeyi YALNIZ panelin icinde olsaydi, kilit ACIKKEN dogrulayicisi olmayan cihazda
            kullanici ne panele girebilir ne kilidi kapatabilirdi. Bu yuzden ayni yuzey BURADA da durur; korumasi TOTP'dir (S-8), kilit degil. */}
        <h2 style={{ fontSize: "1.05rem", marginTop: "1.6rem" }}>Biyometrik kilit ayarı</h2>
        <KilitAyarYuzeyi ayar={ayar} dogrulayiciVar={dogrulayiciVar} yenile={yenile} yer="kilit ekranı" />
      </div>
    </main>
  );
}
/** Kilit ayarının ekran cümlesi (U-3): NULL süre "seçilmedi" diye ve NE ANLAMA GELDİĞİYLE yazılır. */
const kilitSatiri = (k: LockRead | null) => !k?.ok ? "Biyometrik kilit: ayar okunamadı." : `Biyometrik kilit: ${k.enabled ? "AÇIK — panel her açılışta bu cihazın parmak izi ya da yüz doğrulamasını ister." : "KAPALI — panel açılırken doğrulama sorulmaz (kurulumdaki kapalı hâl)."} Yeniden sorma süresi: ${k.repromptSeconds === null ? "SEÇİLMEDİ — açık sayfa kendiliğinden yeniden kilitlenmez; kilit açıksa her açılışta yine sorar" : `${k.repromptSeconds} saniye — açık sayfa bu süre sonunda yeniden kilitlenir`}. Bu ayarı aşağıdan değiştirebilirsin (tek kullanımlık kod ister); durdurma bu kilide bağlı değildir.${k.updatedAt ? ` Bu ayar en son ${anTr(k.updatedAt)} güncellendi.` : " Bu ayarın en son ne zaman güncellendiği okunamadı."}`;

/** Ham saniyeyi İNSAN BİRİMİNE çevirir (P-2: ham saniye tek başına bırakılmaz). Sayı ÜRETMEZ, yalnız verilen sayıyı okunur hâle getirir. */
export const insanSure = (sn: number): string => {
  const s = sn % 60, d = Math.floor(sn / 60) % 60, h = Math.floor(sn / 3600);
  const p = [h > 0 ? `${h} saat` : "", d > 0 ? `${d} dakika` : "", s > 0 ? `${s} saniye` : ""].filter((x) => x !== "");
  return p.length === 0 ? "0 saniye" : p.join(" ");
};
/** KİLİT AYARINI DEĞİŞTİREN YÜZEY (Tur 63 · G20 · S-8, U-3, A-1, Ö-2). AYNI bileşen İKİ yerde: kilit ekranında (kilitlenme tuzağına karşı) ve panelde.
 *  SAYI İCAT ETMEZ: süre için hazır seçenek listesi YOKTUR ve hiçbir alan önceden doldurulmaz — `leverageCap` emsali (A-1/K-11: sayı iş sahibinindir).
 *  "AÇIK" seçeneği bu cihazda doğrulayıcı YOKKEN SUNULMAZ (U-3 · Tur 38 emsali `winvestor-panel-tavansiz-acik-secenegi`). Bu bir YÜZEY savunmasıdır:
 *  sunucu tarafı ayrıca ve bağımsız doğrular (`validateLockPatch`), yüzey kapatılsa bile geçersiz yama 400 ile reddedilir.
 *  SEÇENEK DEĞERLERİ `kilit-acik`/`kilit-kapali`dir, düz `acik`/`kapali` DEĞİL: futures şalteri aynı dosyada `acik` değerini kullanıyor ve `gate:ui`nin Tur 38 kuralı
 *  (`risk-open-option-without-cap`) o değeri dosya genelinde arıyor. Değerleri ayırmak o kuralın alfabesini (1 aday) ve katılığını AYNEN korur — kural gevşetilmedi. */
// ---- GİRİŞ ŞALTERİ (Tur 64 · G28 kutu 4 · K-2, S-8, Ö-2, U-3) ----
// AÇMA ONAYI: onaylı uyarı metninin 2. maddesi ve 3. maddesinin tek cümlesi, onay kutusuyla birlikte,
// HER AÇMADA gösterilir. Karar §3 "ilk açılışta" diyordu; burada DAHA KATI davranıldı çünkü "ilk açılış"
// ayrı bir durum tutmayı gerektirir ve o durum kaybolursa uyarı HİÇ görünmeyebilir — ölçülebilir olan "her açma"dır.
// KAPATMADA onay kutusu YOKTUR: kapatma para hareketini DURDURAN yöndedir ve geciktirilmez (K-7'nin ruhu).
// METNİN TEK KAYNAĞI `scripts/lib/disclaimer.mjs`tir; kapı (`gate:ui`) bu iki cümleyi orada AYNEN arar —
// panel metni kaynaktan bir kelime saparsa kapı KIRMIZI olur.
const GIRIS_ONAY_UYARI = "**Bu yazılım gerçek parayla kendi kararıyla emir gönderebilir.** Kurulumun ilk hâlinde giriş yolu **AÇIK** doğar. Emir çıkması için kendi Binance anahtarını, sermayeni ve risk ayarlarını girmen gerekir; bunlar boşken emir çıkmaz. Şalteri panelden her an kapatabilirsin.";
const GIRIS_ONAY_RISK = "Kayıp riski gerçektir ve tamamı sana aittir.";
const kalinsiz = (t: string) => t.replace(/\*\*/g, "");

const girisSatiri = (e: EntryView | null) => !e?.ok
  ? `Giriş yolu: AYAR OKUNAMADI — açık mı kapalı mı BİLİNMİYOR. Okunamayan ayar "kapalı" sayılmaz ama giriş de açılmaz: motor giriş emri göndermez. Çıkış, koruma ve durdurma bundan etkilenmez.${e?.detail ? ` Sebep: ${e.detail}` : ""}`
  : `Giriş yolu: ${e.enabled ? "AÇIK — motor uygun fırsat bulduğunda kendi kararıyla GİRİŞ EMRİ gönderebilir. Emir çıkması için Binance anahtarı, sermaye, risk ayarları ve motorun çalışma izni de dolu olmalıdır." : "KAPALI — motor hiçbir giriş emri göndermez. Açık pozisyonların çıkışı ve koruması bundan etkilenmez."} Durdurma bu ayara hiç bağlı değildir.${e.updatedAt ? ` Bu ayar en son ${anTr(e.updatedAt)} güncellendi.` : " Bu ayarın en son ne zaman güncellendiği okunamadı."}`;

function GirisSalteriYuzeyi({ ayar, yenile }: { ayar: EntryView | null; yenile: () => Promise<void> }) {
  const [secili, setSecili] = useState(false);
  const [deger, setDeger] = useState("");
  const [onay, setOnay] = useState(false);
  const [totp, setTotp] = useState("");
  const [sonuc, setSonuc] = useState<string | null>(null);
  const acmaDenemesi = secili && deger === "giris-acik";
  const hazir = secili && deger !== "" && (!acmaDenemesi || onay) && totp.length === 6;
  const uygula = async () => {
    let r: Response;
    try { r = await fetch("/api/entry/settings", { method: "POST", headers: { "content-type": "application/json", "x-totp-code": totp }, body: JSON.stringify({ enabled: deger === "giris-acik" }) }); }
    catch { setSonuc("Değişiklik gönderilemedi: sunucuya ulaşılamadı. Giriş şalterinin değişip değişmediği BİLİNMİYOR; aşağıdaki değeri yeniden okut."); return; }
    const b = (await r.json().catch(() => ({}))) as { ok?: boolean; applied?: { field: string; from: string; to: string }[]; errors?: string[] };
    const niye = (b.errors ?? []).join(" · "), oku = (s: string) => (s === "true" ? "AÇIK" : "KAPALI");
    setSonuc(r.ok && b.ok
      ? `Giriş şalteri değişti: ${(b.applied ?? []).map((c) => `${oku(c.from)} → ${oku(c.to)}`).join(", ") || "değişen alan yok"}. Değişiklik anında geçerlidir. Şalter AÇIK olsa bile emir çıkması için Binance anahtarı, sermaye, risk ayarları ve motorun çalışma izni de gerekir. Koruma, çıkış ve durdurma bu ayardan etkilenmez.`
      : r.status === 403 ? "Değişiklik uygulanmadı: tek kullanımlık kod istendi ve doğrulanamadı. Giriş şalteri gerçek parayla emir göndermeye izin veren ayar olduğu için kod olmadan değiştirilemez. Hiçbir alan yazılmadı."
      : r.status === 401 ? "Değişiklik uygulanmadı: oturumun düşmüş. Yeniden giriş yapman gerekiyor. Hiçbir alan yazılmadı."
      : r.status === 400 ? `Değişiklik uygulanmadı — DEĞER KABUL EDİLMEDİ. Yama bütünüyle reddedildi, hiçbir alan yazılmadı. Sebep: ${niye || "değer doğrulamadan geçmedi"}.`
      : r.status === 409 ? `Değişiklik uygulanmadı — AYAR SATIRI YOK. Giriş şalteri kaydı henüz oluşmamış (göç uygulanmamış olabilir); bu yüzden değiştirilecek bir şey de yok. Sebep: ${niye || "ayar satırı bulunamadı"}.`
      : r.status === 503 ? `Değişiklik uygulanmadı — AYAR DEPOSU YA DA DEĞİŞİKLİK DEFTERİ YAZILAMADI. Şalter DEĞİŞMEDİ; bilinmeyen hâlin üstüne yazılmadı. Sebep: ${niye || "depo yanıt vermedi"}.`
      : `Değişiklik uygulanmadı ve sunucunun yanıtı anlaşılamadı; şalterin değişip değişmediği BİLİNMİYOR. Sebep: ${niye || "beklenmeyen yanıt"}.`);
    setTotp(""); setSecili(false); setDeger(""); setOnay(false); await yenile();
  };
  return (
    <section style={box(!ayar?.ok || ayar.enabled ? "WARN" : "INFO")} aria-label="Giriş şalteri">
      <p style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{girisSatiri(ayar)}</p>
      <details style={{ marginTop: ".6rem" }}>
        <summary style={{ cursor: "pointer" }}>Bu ayarı değiştir (tek kullanımlık kod ister)</summary>
        <p style={{ margin: ".4rem 0", lineHeight: 1.55, color: "#9a9aa2" }}>Bu şalter yalnız GİRİŞ emirlerini yönetir. Kapatmak açık pozisyonları kapatmaz, korumayı kaldırmaz ve motoru durdurmaz; motoru durdurmak için ayrı ekran vardır.</p>
        <div style={{ borderTop: "1px solid #23232a", padding: ".5rem 0" }}>
          <label style={{ display: "block" }}>
            <input type="checkbox" checked={secili} onChange={(e) => { setSecili(e.target.checked); if (!e.target.checked) { setDeger(""); setOnay(false); } }} aria-label="Giriş şalteri alanını değiştir" />
            <span style={{ marginLeft: ".4rem" }}>Giriş şalteri</span>
          </label>
          {secili && <label htmlFor="giris-deger" style={{ display: "block", margin: ".35rem 0 .2rem", color: "#9a9aa2" }}>Giriş şalteri — yeni değer</label>}
          {secili && <select id="giris-deger" value={deger} onChange={(e) => { setDeger(e.target.value); setOnay(false); }} style={{ padding: ".3rem .5rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 5, maxWidth: "100%" }}>
            <option value="">— seç —</option>
            <option value="giris-kapali">KAPALI</option>
            <option value="giris-acik">AÇIK</option>
          </select>}
          {secili && deger === "giris-kapali" && <p style={{ margin: ".35rem 0 0", lineHeight: 1.5, color: "#9a9aa2" }}>Şalter kapanırsa motor yeni giriş emri göndermez. Açık pozisyonların çıkışı ve koruması sürer.</p>}
          {acmaDenemesi && <div style={{ ...box("WARN"), margin: ".5rem 0 0" }}>
            <p style={{ margin: ".2rem 0 .5rem", lineHeight: 1.55, fontWeight: 600 }}>Açmadan önce oku</p>
            <p style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{kalinsiz(GIRIS_ONAY_UYARI)}</p>
            <p style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{GIRIS_ONAY_RISK}</p>
            <label style={{ display: "block", marginTop: ".5rem" }}>
              <input type="checkbox" checked={onay} onChange={(e) => setOnay(e.target.checked)} aria-label="Giriş şalterini açma uyarısını okudum ve kabul ediyorum" />
              <span style={{ marginLeft: ".4rem" }}>Okudum, riski kabul ediyorum.</span>
            </label>
          </div>}
        </div>
        <label style={{ display: "block", margin: ".5rem 0" }}>
          <span style={{ display: "block", marginBottom: ".2rem", color: "#9a9aa2" }}>Tek kullanımlık kod (6 hane)</span>
          <input value={totp} onChange={(e) => setTotp(e.target.value)} inputMode="numeric" maxLength={6} autoComplete="off" aria-label="Giriş şalteri için tek kullanımlık kod" style={{ padding: ".3rem .5rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 5, width: "6rem" }} />
        </label>
        <button onClick={() => void uygula()} disabled={!hazir} style={{ padding: ".45rem .9rem", borderRadius: 6, border: eylemKenari(hazir), background: hazir ? "#12354f" : "#1a1a20", color: "#e8e8ea", cursor: hazir ? "pointer" : "not-allowed" }}>Giriş şalterini değiştir</button>
        {sonuc !== null && <p role="status" aria-live="polite" style={{ margin: ".5rem 0", lineHeight: 1.55 }}>{sonuc}</p>}
      </details>
    </section>
  );
}

function KilitAyarYuzeyi({ ayar, dogrulayiciVar, yenile, yer }: { ayar: LockRead | null; dogrulayiciVar: boolean | null; yenile: () => Promise<void>; yer: string }) {
  const [kilitSecili, setKilitSecili] = useState(false);
  const [sureSecili, setSureSecili] = useState(false);
  const [kilitDeger, setKilitDeger] = useState("");
  const [sureDeger, setSureDeger] = useState("");
  const [totp, setTotp] = useState("");
  const [sonuc, setSonuc] = useState<string | null>(null);
  const sureSayi = sureDeger.trim() === "" ? null : Number(sureDeger.trim());
  const sureGecerli = sureDeger.trim() === "" || (Number.isInteger(sureSayi) && (sureSayi as number) > 0);
  const hazir = (kilitSecili || sureSecili) && (!kilitSecili || kilitDeger !== "") && sureGecerli && totp.length === 6;
  const yama = (): Record<string, unknown> => {
    const y: Record<string, unknown> = {};
    if (kilitSecili) y.enabled = kilitDeger === "kilit-acik";
    if (sureSecili) y.repromptSeconds = sureDeger.trim() === "" ? null : Number(sureDeger.trim());
    return y;
  };
  const uygula = async () => {
    let r: Response;
    try { r = await fetch("/api/lock/settings", { method: "POST", headers: { "content-type": "application/json", "x-totp-code": totp }, body: JSON.stringify(yama()) }); }
    catch { setSonuc("Değişiklik gönderilemedi: sunucuya ulaşılamadı. Ayarın değişip değişmediği BİLİNMİYOR; aşağıdaki değerleri yeniden okut."); return; }
    const b = (await r.json().catch(() => ({}))) as { ok?: boolean; applied?: { field: string; from: string | null; to: string | null }[]; errors?: string[] };
    const niye = (b.errors ?? []).join(" · "), adi: Record<string, string> = { enabled: "Biyometrik kilit", repromptSeconds: "Yeniden sorma süresi" };
    setSonuc(r.ok && b.ok
      ? `Kilit ayarı değişti: ${(b.applied ?? []).map((c) => `${adi[c.field] ?? c.field} ${c.from ?? "seçilmemişti"} → ${c.to ?? "seçilmemiş"}`).join(", ") || "değişen alan yok"}. Değişiklik anında geçerlidir. Bu ayar motoru başlatmaz, durdurmaz ve hiçbir emir göndermez; durdurma ekranı bu kilide bağlı değildir.`
      : r.status === 403 ? "Değişiklik uygulanmadı: tek kullanımlık kod istendi ve doğrulanamadı. Kilit ayarı erişim korumasını belirlediği için kod olmadan değiştirilemez. Hiçbir alan yazılmadı."
      : r.status === 401 ? "Değişiklik uygulanmadı: oturumun düşmüş. Yeniden giriş yapman gerekiyor. Hiçbir alan yazılmadı."
      : r.status === 400 ? `Değişiklik uygulanmadı — DEĞER KABUL EDİLMEDİ. Yama bütünüyle reddedildi, hiçbir alan yazılmadı. Sebep: ${niye || "değer doğrulamadan geçmedi"}.`
      : r.status === 409 ? `Değişiklik uygulanmadı — AYAR SATIRI YOK. Kilit ayarı kaydı henüz oluşmamış (göç uygulanmamış olabilir); bu yüzden değiştirilecek bir şey de yok. Sebep: ${niye || "ayar satırı bulunamadı"}.`
      : r.status === 503 ? `Değişiklik uygulanmadı — AYAR DEPOSU OKUNAMADI YA DA YAZILAMADI. Ayar DEĞİŞMEDİ; bilinmeyen hâlin üstüne yazılmadı. Sebep: ${niye || "depo yanıt vermedi"}.`
      : `Değişiklik uygulanmadı ve sunucunun yanıtı anlaşılamadı; ayarın değişip değişmediği BİLİNMİYOR. Sebep: ${niye || "beklenmeyen yanıt"}.`);
    setTotp(""); setKilitSecili(false); setSureSecili(false); setKilitDeger(""); setSureDeger(""); await yenile();
  };
  return (
    <section style={box(ayar?.ok ? "INFO" : "WARN")} aria-label={`Biyometrik kilit ayarı — ${yer}`}>
      <p style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{kilitSatiri(ayar)}</p>
      <p style={{ margin: ".3rem 0", lineHeight: 1.55, color: "#9a9aa2" }}>
        {dogrulayiciVar === null ? "Bu cihazda parmak izi ya da yüz doğrulayıcısı olup olmadığı henüz ölçülmedi; ölçülmeden var sayılmaz."
          : dogrulayiciVar ? "Bu cihazda kullanıcı doğrulamalı bir parmak izi ya da yüz doğrulayıcısı VAR: kilit bu cihazda açılabilir."
          : "Bu cihazda kullanıcı doğrulamalı parmak izi ya da yüz doğrulayıcısı YOK. Bu yüzden aşağıda kilidi AÇIK yapma seçeneği sunulmuyor: açsaydın bu cihazdan panele bir daha giremezdin. Doğrulayıcısı olan bir cihazdan aynı ayarı açabilirsin."}
      </p>
      <details style={{ marginTop: ".6rem" }}>
        <summary style={{ cursor: "pointer" }}>Bu ayarı değiştir (tek kullanımlık kod ister)</summary>
        <p style={{ margin: ".4rem 0", lineHeight: 1.55, color: "#9a9aa2" }}>Değiştirmek istediğin alanı işaretle. İşaretlemediğin alan gönderilmez ve olduğu gibi kalır. Ekran senin yerine hiçbir süre önermez.</p>
        <div style={{ borderTop: "1px solid #23232a", padding: ".5rem 0" }}>
          <label style={{ display: "block" }}>
            <input type="checkbox" checked={kilitSecili} onChange={(e) => { setKilitSecili(e.target.checked); if (!e.target.checked) setKilitDeger(""); }} aria-label="Biyometrik kilit alanını değiştir" />
            <span style={{ marginLeft: ".4rem" }}>Biyometrik kilit</span>
          </label>
          {kilitSecili && <label htmlFor={`kilit-deger-${yer}`} style={{ display: "block", margin: ".35rem 0 .2rem", color: "#9a9aa2" }}>Biyometrik kilit — yeni değer</label>}
          {kilitSecili && <select id={`kilit-deger-${yer}`} value={kilitDeger} onChange={(e) => setKilitDeger(e.target.value)} style={{ padding: ".3rem .5rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 5, maxWidth: "100%" }}>
            <option value="">— seç —</option>
            <option value="kilit-kapali">KAPALI</option>
            {dogrulayiciVar && <option value="kilit-acik">AÇIK</option>}
          </select>}
          {kilitSecili && kilitDeger === "kilit-acik" && <p style={{ margin: ".35rem 0 0", lineHeight: 1.5, color: "#9a9aa2" }}>Kilit açılırsa panel her açılışta bu cihazın parmak izi ya da yüz doğrulamasını ister. Durdurma ekranı bundan etkilenmez.</p>}
          {kilitSecili && kilitDeger === "kilit-kapali" && <p style={{ margin: ".35rem 0 0", lineHeight: 1.5, color: "#9a9aa2" }}>Kilit kapanırsa panel açılırken doğrulama sorulmaz; panel yine de oturum ister.</p>}
          {kilitSecili && dogrulayiciVar === false && <p style={{ margin: ".35rem 0 0", lineHeight: 1.5, color: "#9a9aa2" }}>“AÇIK” seçeneği burada yok: bu cihazda doğrulayıcı olmadığı için kilit açılsa da açılamaz ve panel erişilemez olurdu. Yazılım senin yerine bu riski almaz.</p>}
        </div>
        <div style={{ borderTop: "1px solid #23232a", padding: ".5rem 0" }}>
          <label style={{ display: "block" }}>
            <input type="checkbox" checked={sureSecili} onChange={(e) => { setSureSecili(e.target.checked); if (!e.target.checked) setSureDeger(""); }} aria-label="Yeniden sorma süresi alanını değiştir" />
            <span style={{ marginLeft: ".4rem" }}>Yeniden sorma süresi</span>
          </label>
          {sureSecili && <label htmlFor={`sure-deger-${yer}`} style={{ display: "block", margin: ".35rem 0 .2rem", color: "#9a9aa2" }}>Yeniden sorma süresi — saniye cinsinden yaz (boş bırakırsan seçim kaldırılır)</label>}
          {sureSecili && <input id={`sure-deger-${yer}`} value={sureDeger} onChange={(e) => setSureDeger(e.target.value)} inputMode="numeric" autoComplete="off"
            style={{ padding: ".3rem .5rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 5, width: "8rem" }} />}
          {sureSecili && <p style={{ margin: ".35rem 0 0", lineHeight: 1.5, color: sureGecerli ? "#9a9aa2" : TONE.WARN.bd }}>
            {sureDeger.trim() === "" ? "Boş: yeniden sorma süresinin SEÇİMİ KALDIRILIR — açık panel kendiliğinden yeniden kilitlenmez; kilit açıksa her yeni açılışta yine sorar."
              : !sureGecerli ? "Bu değer kabul edilmez: süre yalnız POZİTİF TAM SAYI saniye olabilir. Veritabanı da bunu böyle kısıtlıyor ve sunucu böyle bir isteği zaten reddeder."
              : `Açık panel ${insanSure(sureSayi as number)} boyunca dokunulmazsa yeniden kilitlenir ve doğrulama yeniden sorulur (${sureSayi} saniye).`}
          </p>}
        </div>
        <label style={{ ...kodEtiket, margin: ".6rem 0 .3rem" }}>Tek kullanımlık kod (bu ayar erişim korumasını belirler, bu yüzden kod ister)
          <input value={totp} onChange={(e) => setTotp(e.target.value)} inputMode="numeric" maxLength={6} autoComplete="off" style={{ padding: ".3rem .5rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 5, width: "6rem" }} />
        </label>
        <button onClick={() => void uygula()} disabled={!hazir} style={{ padding: ".45rem .9rem", borderRadius: 6, border: eylemKenari(hazir), background: hazir ? "#12354f" : "#1a1a20", color: "#e8e8ea", cursor: hazir ? "pointer" : "not-allowed" }}>İşaretlenen alanları değiştir</button>
        {sonuc !== null && <p role="status" aria-live="polite" style={{ margin: ".5rem 0", lineHeight: 1.55 }}>{sonuc}</p>}
      </details>
    </section>
  );
}

const hours = (ms: number) => `${Math.round(ms / 3_600_000)} saatte bir`;
/** Seçenek satırının yazma gövdesi (model · aralık) — Tur 66 · 1d: kodsuz ve kodlu yol AYNI gövdeyi gönderir. */
const secimGovdesi = (model: string, ms: string) => JSON.stringify({ model, callIntervalMs: Number(ms) });
/** Tur 67: tik aralığı yaması (seçilen seçeneğin değeri; sayı ekranda üretilmez). Modül düzeyinde: gate:ui (6) ok gövdesindeki JSON.stringify'ı ekrana basılan ifade sanar (Tur 66 dersi). */
const tikGovdesi = (ms: string) => JSON.stringify({ tickMs: Number(ms) });
// Tur 46 madde 3 (ÖLÇÜLDÜ: 390 px'te kod alanı alt satıra geçince etiketin 8 px İÇİNDEN başlıyordu; devre dışı eylem düğmesi etkin kenarını koruyordu). Yeni değer YOK:
//   boşluk .5rem/.3rem ve kenar #2b7fc9 (etkin) / #33333c (panel alan/düğme kenarı) TASARIM-SISTEMI §3.1/§3.3/§5'teki mevcut değerlerdir.
const kodEtiket: React.CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: ".5rem", rowGap: ".3rem" };
const eylemKenari = (etkin: boolean) => `1px solid ${etkin ? "#2b7fc9" : "#33333c"}`;
const box = (level: Level): React.CSSProperties => ({ background: TONE[level].bg, border: `1px solid ${TONE[level].bd}`, borderRadius: 8, padding: "0.9rem 1.1rem", margin: "0.6rem 0" });

function CardBlock({ c, head }: { c: Card; head?: string }) {
  return (
    <section style={box(c.level)} aria-label={`${head ?? ""} ${c.title}`.trim()}>
      <h3 style={{ margin: "0 0 .45rem", fontSize: "1rem" }}><span style={{ fontSize: ".72rem", letterSpacing: ".08em", color: TONE[c.level].bd, marginRight: ".5rem" }}>{TONE[c.level].tag}</span>{c.title}</h3>
      {c.lines.map((l, i) => <p key={i} style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{l}</p>)}
    </section>
  );
}

/** KALDIRAÇ İSTEĞİ (Tur 44 · G21 kalemi i · K-11, S-8, U-4). Önizleme `GET /api/risk/leverage` (oturum) komisyon VE funding yükünü SAYI + BİRİMLE ucun cümlesinden gösterir;
 *  ölçülemeyen yük için sayı YOK, sebep var (U-3: "0" yazılmaz). İstek `POST` eylem başına kod ister. Varsayılan doldurulmuş değer YOK, otomatik gönderim YOK; yazılım kaldıraç sayısı SEÇMEZ. */
type LevOut = { refusal?: string; text?: string; cap?: number | null; load?: { funding: { sentence: string }; commission: { sentence: string } } | null; reason?: string };
function KaldiracYuzeyi() {
  const [sym, setSym] = useState(""), [lev, setLev] = useState(""), [kod, setKod] = useState(""), [out, setOut] = useState<LevOut | null>(null), [hata, setHata] = useState<string | null>(null);
  const hazir = /^[A-Z0-9]{2,20}$/.test(sym) && /^[1-9][0-9]{0,3}$/.test(lev);
  const gonder = async (post: boolean) => {
    setHata(null); setOut(null);
    try { const r = post ? await fetch("/api/risk/leverage", { method: "POST", headers: { "content-type": "application/json", "x-totp-code": kod }, body: JSON.stringify({ symbol: sym, leverage: Number(lev) }) })
        : await fetch("/api/risk/leverage?" + new URLSearchParams({ symbol: sym, leverage: lev }).toString(), { cache: "no-store" });
      const j = (await r.json()) as LevOut; if (post) setKod("");
      if (r.status === 401 || r.status === 403 || r.status === 423) setHata("İstek gönderilmedi: oturum ya da tek kullanımlık kod doğrulanamadı. Kaldıraç paranın riskini büyüttüğü için kod olmadan istenemez; hiçbir şey değişmedi.");
      else setOut(j); } catch { setHata("Sunucuya ulaşılamadı; hiçbir şey değişmedi ve kaldıracın yükü bu yüzden gösterilemiyor."); } };
  const inp = { padding: ".3rem .5rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 5, width: "8rem", maxWidth: "100%" } as const;
  return (<details style={{ marginTop: ".6rem" }}><summary style={{ cursor: "pointer" }}>Kaldıraç iste — önce komisyon ve funding yükünü gör</summary>
    <p style={{ margin: ".4rem 0", lineHeight: 1.5, color: "#9a9aa2" }}>Kaldıraç her sembol için ayrı istenir. Tavanı aşan istek reddedilir, tavana indirilmez; yazılım senin yerine sayı seçmez. Yük teminatına göre baz puanla yazılır.</p>
    <label style={{ display: "block", margin: ".3rem 0" }}>Sembol <input value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} autoComplete="off" style={{ ...inp, marginLeft: ".5rem" }} /></label>
    <label style={{ display: "block", margin: ".3rem 0" }}>Kaldıraç (kat) <input value={lev} onChange={(e) => setLev(e.target.value)} inputMode="numeric" autoComplete="off" style={{ ...inp, marginLeft: ".5rem", width: "5rem" }} /></label>
    <button onClick={() => void gonder(false)} disabled={!hazir} style={{ padding: ".45rem .9rem", borderRadius: 6, border: "1px solid #33333c", background: hazir ? "#141419" : "#1a1a20", color: "#e8e8ea", cursor: hazir ? "pointer" : "not-allowed", marginRight: ".5rem" }}>Yükü göster</button>
    <label style={{ ...kodEtiket, margin: ".6rem 0 .3rem" }}>Tek kullanımlık kod (istek için)
      <input value={kod} onChange={(e) => setKod(e.target.value)} inputMode="numeric" maxLength={6} autoComplete="off" style={{ ...inp, width: "6rem" }} /></label>
    <button onClick={() => void gonder(true)} disabled={!hazir || kod.length !== 6} style={{ padding: ".45rem .9rem", borderRadius: 6, border: eylemKenari(hazir && kod.length === 6), background: hazir && kod.length === 6 ? "#12354f" : "#1a1a20", color: "#e8e8ea", cursor: hazir && kod.length === 6 ? "pointer" : "not-allowed" }}>Kaldıraç isteğini gönder</button>
    {hata !== null && <p role="status" aria-live="polite" style={{ margin: ".5rem 0", lineHeight: 1.55 }}>{hata}</p>}
    {out !== null && <div role="status" aria-live="polite">
      <p style={{ margin: ".5rem 0", lineHeight: 1.55 }}>{out.text ?? "Uç bir cümle döndürmedi; sonuç bilinmiyor sayılmalı ve kaldıraç uygulanmış VARSAYILMAMALI."}</p>
      {out.load ? <><p style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{out.load.commission.sentence}</p><p style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{out.load.funding.sentence}</p></>
        : <p style={{ margin: ".3rem 0", lineHeight: 1.55, color: "#9a9aa2" }}>Komisyon ve funding yükü bu istekte ölçülmedi (istek yükü ölçmeden önceki bir adımda durdu); bu yüzden sayı yok.</p>}
    </div>}
  </details>);
}

/** PANEL GİRİŞ FORMU (G30 · Tur 74 · KİMLİK yüzeyi, S-8, U-3). YALNIZ mevcut `POST /api/auth/login` ucuna JSON {password} gönderir — yeni uç yok, sözleşme aynı.
 *  Parola alanının `name` özniteliği YOKTUR ve form yerel gönderimi `preventDefault` ile keser: betik yüklenmeden gönderilse bile parola URL'ye / sorgu dizesine düşmez.
 *  Parola hiçbir depoya ya da konsola yazılmaz; yanıt gelince alan boşaltılır. Başarıda aynı sayfa oturumlu panele geçer (yeni sayfa gezinmesi yok). */
// Kilit cümlesindeki dakika = LOCKOUT_SEC / 60 (src/lib/access/index.ts, SUNUCU SABİTİ). Giriş ucu 423 yanıtında kalan süreyi TAŞIMAZ ⇒ "en geç" (üst sınır) yazılır, kalan süre uydurulmaz.
// İstemci o modülü içe aktaramaz (node:crypto); eşitliği gate:ui ÖLÇER, sunucu sabiti değişip bu sayı kalırsa KIRMIZI.
const GIRIS_KILIT_DK = 15;
function GirisFormu({ girdi, not }: { girdi: () => void; not: string | null }) {
  const [parola, setParola] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [sonuc, setSonuc] = useState<{ ton: Level; metin: string } | null>(null);
  const hazir = parola !== "" && !gonderiliyor;
  const gonder = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); if (!hazir) return;
    setGonderiliyor(true); setSonuc(null); let r: Response | null = null;
    try { r = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: parola }), cache: "no-store" }); } catch { r = null; }
    setParola(""); setGonderiliyor(false);
    if (r?.ok) { girdi(); return; }
    setSonuc(r === null ? { ton: "WARN", metin: "Sunucuya ulaşılamadı; bağlantını kontrol edip yeniden dene." }
      : r.status === 401 ? { ton: "WARN", metin: "Parola yanlış, yeniden dene." }
      : r.status === 423 ? { ton: "ALARM", metin: `Çok fazla yanlış deneme yapıldı; giriş kilitlendi, en geç ${GIRIS_KILIT_DK} dakika sonra yeniden dene.` }
      : r.status === 503 ? { ton: "WARN", metin: "Giriş şu an doğrulanamıyor; biraz sonra yeniden dene." }
      : { ton: "WARN", metin: "Giriş yapılamadı; biraz sonra yeniden dene." });
  };
  return (
    <form method="post" onSubmit={(e) => void gonder(e)} aria-label="Panele giriş" style={{ marginTop: "1rem", maxWidth: 360 }}>
      <label htmlFor="giris-parola" style={{ display: "block", marginBottom: ".3rem", color: "#9a9aa2" }}>Parola</label>
      <input id="giris-parola" type="password" autoComplete="current-password" required disabled={gonderiliyor} value={parola} onChange={(e) => setParola(e.target.value)} style={{ display: "block", width: "100%", boxSizing: "border-box", padding: ".7rem .8rem", fontSize: "1rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 6 }} />
      <button id="giris-gonder" type="submit" disabled={!hazir} style={{ marginTop: ".8rem", padding: ".45rem .9rem", borderRadius: 6, border: eylemKenari(hazir), background: hazir ? "#12354f" : "#1a1a20", color: "#e8e8ea", cursor: hazir ? "pointer" : "not-allowed" }}>{gonderiliyor ? "Giriş yapılıyor…" : "Giriş yap"}</button>
      <div id="giris-sonuc" role="alert">{sonuc !== null && <p style={{ ...box(sonuc.ton), lineHeight: 1.55 }}>{sonuc.metin}</p>}</div>
      {not !== null && <p role="status" style={{ margin: ".6rem 0", lineHeight: 1.55, color: "#9a9aa2" }}>{not}</p>}
    </form>
  );
}

/** BINANCE ANAHTARI BÖLÜMÜ (G31 · Tur 75 · güvenlik yüzeyi ANAHTAR/PARA; P-1, S-1, S-2, S-6, S-8, U-3). YALNIZ mevcut `POST /api/exchange-key` ucuna gönderir — uç davranışı DEĞİŞMEDİ
 *  (oturum + eylem başına kod; Binance'ten izin okuma; çekim ya da evrensel transfer açıksa ret; şifreleyerek kayıt). Durum satırları ucun GET'inin kurduğu cümlelerdir (`lines`); ekran hesap yapmaz.
 *  Özel anahtar alanı `type="password"` + autocomplete kapalı; hiçbir alanın `name`i yok; form yerel gönderimi `preventDefault` ile keser. Anahtar ve özel anahtar hiçbir depoya, konsola, URL'ye
 *  ya da sonuç cümlesine YAZILMAZ; yanıt gelince (başarı ya da ret) bütün alanlar boşaltılır. Ret cümleleri sebep koduna göre sabittir, ucun `detail`i ekrana basılmaz. */
type KeyView = { ok: boolean; present?: boolean; lines?: string[] };
/** Tek satırlı parola alanı yapıştırılan PEM'in satır sonlarını SİLER (tarayıcı kuralı). Gövde, başlık etiketi KORUNARAK yeniden satırlara bölünür: içerik değişmez, yalnız biçim.
 *  Başlık yoksa değer olduğu gibi gider ve uç onu biçim denetiminde reddeder (uydurma başlık eklenmez). */
const pemYap = (v: string): string => { const m = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/.exec(v.trim()); if (!m) return v.trim();
  const govde = m[2].replace(/\s+/g, ""); return `-----BEGIN ${m[1]}-----\n${(govde.match(/.{1,64}/g) ?? []).join("\n")}\n-----END ${m[1]}-----\n`; };
function AnahtarYuzeyi({ durum, yenile }: { durum: KeyView | null; yenile: () => Promise<void> }) {
  const [ad, setAd] = useState("");
  const [apiAnahtari, setApiAnahtari] = useState("");
  const [ozel, setOzel] = useState("");
  const [kod, setKod] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [sonuc, setSonuc] = useState<{ ton: Level; metin: string } | null>(null);
  const hazir = ad.trim() !== "" && apiAnahtari.trim() !== "" && ozel.trim() !== "" && /^\d{6}$/.test(kod) && !gonderiliyor;
  const gonder = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); if (!hazir) return;
    setGonderiliyor(true); setSonuc(null); let r: Response | null = null;
    try { r = await fetch("/api/exchange-key", { method: "POST", headers: { "content-type": "application/json", "x-totp-code": kod }, body: JSON.stringify({ label: ad.trim(), keyType: "ed25519", apiKey: apiAnahtari.trim(), privateKeyPem: pemYap(ozel) }), cache: "no-store" }); } catch { r = null; }
    setAd(""); setApiAnahtari(""); setOzel(""); setKod(""); setGonderiliyor(false);
    const b = r ? ((await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string; restrictions?: { enableSpotAndMarginTrading?: boolean; enableFutures?: boolean } }) : {};
    const kalan = "Anahtar hiçbir yere kaydedilmedi.";
    setSonuc(r === null ? { ton: "WARN", metin: `Sunucuya ulaşılamadı; anahtarın kaydedilip kaydedilmediği BİLİNMİYOR. Yukarıdaki durum satırını yeniden okut.` }
      : r.ok && b.ok ? { ton: "OK", metin: `Anahtar Binance'te doğrulandı ve şifrelenerek kaydedildi. Binance'in bildirdiği izinler: spot işlem ${b.restrictions?.enableSpotAndMarginTrading ? "AÇIK" : "KAPALI"}, futures ${b.restrictions?.enableFutures ? "AÇIK" : "KAPALI"}, çekim ve evrensel transfer KAPALI. Motor bundan sonra bu anahtarı kullanır. Eski bir anahtarın varsa onu Binance'te silmeyi unutma.` }
      : r.status === 401 ? { ton: "WARN", metin: `Oturumun düşmüş; ${kalan} Sayfayı yenileyip yeniden giriş yap.` }
      : r.status === 403 ? { ton: "WARN", metin: `Tek kullanımlık kod doğrulanamadı; ${kalan} Anahtar paranın yönetimine erişim verdiği için kod olmadan eklenemez.` }
      : r.status === 423 ? { ton: "ALARM", metin: `Çok fazla yanlış deneme yapıldı; hassas işlemler geçici olarak kilitli. ${kalan}` }
      : b.reason === "P1_WITHDRAWALS" ? { ton: "ALARM", metin: `Anahtar REDDEDİLDİ: Binance'te bu anahtarın çekim izni açık. ${kalan} Binance'te çekim iznini kapat ya da çekim izni olmayan yeni bir anahtar oluşturup onu ekle.` }
      : b.reason === "P1_UNIVERSAL_TRANSFER" ? { ton: "ALARM", metin: `Anahtar REDDEDİLDİ: Binance'te bu anahtarın evrensel transfer izni açık. ${kalan} Binance'te evrensel transfer iznini kapat ya da bu izin kapalı yeni bir anahtar ekle.` }
      : b.reason === "READ_DISABLED" ? { ton: "WARN", metin: `Anahtar REDDEDİLDİ: Binance'te bu anahtarın okuma izni kapalı; izinler okunamadığı için anahtar denetlenemez. ${kalan} Okuma iznini açıp yeniden ekle.` }
      : b.reason === "PRIVATE_KEY_NOT_ED25519" || b.reason === "KEY_TYPE_NOT_ED25519" ? { ton: "WARN", metin: `Anahtar REDDEDİLDİ: özel anahtar Ed25519 PEM biçiminde değil. ${kalan} Ed25519 özel anahtarını BEGIN ve END satırları dahil tamamıyla yapıştır.` }
      : b.reason === "BAD_INPUT" ? { ton: "WARN", metin: `Alanlardan biri boş ya da çok uzun (ad en çok 64 karakter). ${kalan}` }
      : r.status === 503 || r.status === 502 ? { ton: "WARN", metin: `Binance'e ulaşılamadı ya da anahtarın izinleri okunamadı; ${kalan} Biraz sonra yeniden dene.` }
      : { ton: "WARN", metin: `Sunucunun yanıtı anlaşılamadı; anahtarın kaydedilip kaydedilmediği BİLİNMİYOR. Yukarıdaki durum satırını yeniden okut.` });
    await yenile();
  };
  const alan = { display: "block", width: "100%", boxSizing: "border-box", padding: ".7rem .8rem", fontSize: "1rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 6 } as const;
  return (
    <section id="anahtar-bolumu" style={box(!durum?.ok ? "WARN" : durum.present ? "INFO" : "WARN")} aria-label="Binance API anahtarı">
      <div id="anahtar-durum">{(durum?.lines ?? ["Kayıtlı Binance anahtarının durumu bu açılışta OKUNAMADI — anahtar var mı yok mu BİLİNMİYOR."]).map((l, i) => <p key={i} style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{l}</p>)}</div>
      <details id="anahtar-detay" style={{ marginTop: ".6rem" }}>
        <summary style={{ cursor: "pointer" }}>{durum?.present ? "Anahtarı değiştir (tek kullanımlık kod ister)" : "Anahtar ekle (tek kullanımlık kod ister)"}</summary>
        <div style={{ margin: ".5rem 0", lineHeight: 1.55, color: "#9a9aa2" }}>
          <p style={{ margin: ".3rem 0" }}>Binance'te anahtarı şöyle oluştur: önce Binance'in anahtar üretme aracıyla kendi bilgisayarında bir Ed25519 anahtar çifti üret (özel anahtar sende kalır). Sonra Binance'te Profil → API Management → Create API → Self-generated seç, ortak anahtarı (public key) yapıştır, bir ad ver ve iki adımlı doğrulamayı tamamla. Binance sana API key'i gösterir.</p>
          <p style={{ margin: ".3rem 0" }}>İzinler: okuma AÇIK olmalı (kapalıysa anahtar reddedilir) · motorun emir gönderebilmesi için spot işlem AÇIK · futures yalnız futures kullanacaksan · çekim ve evrensel transfer KAPALI olmalı — açıksa bu ekran anahtarı reddeder ve hiçbir yere kaydetmez.</p>
          <p style={{ margin: ".3rem 0" }}>IP kısıtı: bu yazılımın sunucudan çıkış adresi ölçülmedi, bu yüzden bir IP kısıtı önerilmiyor. IP kısıtı olmayan anahtarın 30 gün emirsiz kalınca silinme sayacı yukarıdaki durum satırında izlenir.</p>
          <p style={{ margin: ".3rem 0" }}>Yeni anahtar kaydedilince motor en yenisini kullanır; eski kayıt kullanılmaz ama Binance'te kendiliğinden kapanmaz.</p>
        </div>
        <form method="post" onSubmit={(e) => void gonder(e)} aria-label="Binance anahtarı ekle" style={{ maxWidth: 520 }}>
          <label htmlFor="anahtar-ad" style={{ display: "block", margin: ".5rem 0 .3rem", color: "#9a9aa2" }}>Ad (yalnız senin için; en çok 64 karakter)</label>
          <input id="anahtar-ad" value={ad} onChange={(e) => setAd(e.target.value)} maxLength={64} autoComplete="off" spellCheck={false} disabled={gonderiliyor} style={alan} />
          <label htmlFor="anahtar-api" style={{ display: "block", margin: ".7rem 0 .3rem", color: "#9a9aa2" }}>API key (Binance'in gösterdiği)</label>
          <input id="anahtar-api" value={apiAnahtari} onChange={(e) => setApiAnahtari(e.target.value)} maxLength={256} autoComplete="off" spellCheck={false} disabled={gonderiliyor} style={alan} />
          <label htmlFor="anahtar-ozel" style={{ display: "block", margin: ".7rem 0 .3rem", color: "#9a9aa2" }}>Özel anahtar (Ed25519, PEM — tamamını yapıştır; ekranda gizli kalır)</label>
          <input id="anahtar-ozel" type="password" value={ozel} onChange={(e) => setOzel(e.target.value)} autoComplete="off" spellCheck={false} disabled={gonderiliyor} style={alan} />
          <label htmlFor="anahtar-kod" style={{ display: "block", margin: ".7rem 0 .3rem", color: "#9a9aa2" }}>Tek kullanımlık kod (6 hane)</label>
          <input id="anahtar-kod" value={kod} onChange={(e) => setKod(e.target.value)} inputMode="numeric" maxLength={6} autoComplete="off" disabled={gonderiliyor} style={{ ...alan, width: "8rem" }} />
          <button id="anahtar-gonder" type="submit" disabled={!hazir} style={{ marginTop: ".8rem", padding: ".45rem .9rem", borderRadius: 6, border: eylemKenari(hazir), background: hazir ? "#12354f" : "#1a1a20", color: "#e8e8ea", cursor: hazir ? "pointer" : "not-allowed" }}>{gonderiliyor ? "Binance'te doğrulanıyor…" : "Anahtarı doğrula ve kaydet"}</button>
        </form>
        <div id="anahtar-sonuc" role="status" aria-live="polite">{sonuc !== null && <p style={{ ...box(sonuc.ton), lineHeight: 1.55 }}>{sonuc.metin}</p>}</div>
      </details>
    </section>
  );
}

export default function Panel() {
  const [view, setView] = useState<PanelView | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [state, setState] = useState<"yükleniyor" | "hazır" | "oturumsuz" | "ulaşılamadı">("yükleniyor");
  const [pick, setPick] = useState<string>("");
  const [totp, setTotp] = useState("");
  const [applied, setApplied] = useState<string | null>(null);
  // MALİYET TAVANI (Tur 65 · 3e/3i): yama YALNIZ işaretlenen alandan kurulur (önceden doldurulmuş değer YOK). Kod yazılmadıysa SERBEST uca gider (yalnız harcamayı azaltan yön kabul edilir);
  // kod yazıldıysa HASSAS uca gider (her yön). Hangi yönün serbest olduğu sunucuda karar verilir, burada değil.
  const [capSecili, setCapSecili] = useState<{ tavan: boolean; beyin: boolean; davranis: boolean; altyapi: boolean }>({ tavan: false, beyin: false, davranis: false, altyapi: false });
  const [capAltyapi, setCapAltyapi] = useState("");
  // Tur 66 · 1d: karar motoru ayarı (model · sıklık · aday · mum) — kod yazılmazsa serbest uç (yalnız harcamayı AZALTAN yön), yazılırsa hassas uç.
  const [bSecili, setBSecili] = useState<{ model: boolean; siklik: boolean; aday: boolean; mum: boolean }>({ model: false, siklik: false, aday: false, mum: false });
  const [bDeger, setBDeger] = useState<{ model: string; siklik: string; aday: string; mum: string }>({ model: "", siklik: "", aday: "", mum: "" });
  const [bTotp, setBTotp] = useState("");
  const [bSonuc, setBSonuc] = useState<string | null>(null);
  // Tur 67 · 1c: tik aralığı — seçim önceden doldurulmaz; kod yazılmazsa serbest uç (yalnız daha SEYREK), yazılırsa hassas uç.
  const [tikDeger, setTikDeger] = useState("");
  const [tikTotp, setTikTotp] = useState("");
  const [tikSonuc, setTikSonuc] = useState<string | null>(null);
  const [capBeyin, setCapBeyin] = useState("");
  const [capDeger, setCapDeger] = useState("");
  const [capDavranis, setCapDavranis] = useState("");
  const [capTotp, setCapTotp] = useState("");
  const [capSonuc, setCapSonuc] = useState<string | null>(null);
  const [risk, setRisk] = useState<RiskView | null>(null);
  // GIRIS SALTERI (Tur 64): panel acilisinda AYARDAN okunur; okunamazsa "bilinmiyor" yazilir, deger ICAT EDILMEZ (O-2).
  const [giris, setGiris] = useState<EntryView | null>(null);
  // G31 (Tur 75): kayıtlı Binance anahtarının durumu — ucun kurduğu cümleler; okunamazsa "bilinmiyor" yazılır, "yok" sayılmaz.
  const [anahtar, setAnahtar] = useState<KeyView | null>(null);
  const [riskSecili, setRiskSecili] = useState<Record<string, boolean>>({});
  const [riskDeger, setRiskDeger] = useState<Record<string, string>>({});
  const [riskTotp, setRiskTotp] = useState("");
  const [riskSonuc, setRiskSonuc] = useState<string | null>(null);
  const [kilit, setKilit] = useState<LockState | "CHECKING" | "ACIK">("CHECKING");
  const [kilitAyar, setKilitAyar] = useState<LockRead | null>(null);
  const [kilitNot, setKilitNot] = useState<string | null>(null);
  // U-3: doğrulayıcı durumu ÖLÇÜLÜR ve saklanır; ölçülmeden "var" SAYILMAZ (null = henüz ölçülmedi). Ayar yüzeyi "AÇIK" seçeneğini buna göre sunar ya da SUNMAZ.
  const [dogrulayici, setDogrulayici] = useState<boolean | null>(null);
  // G30 (Tur 74): çıkıştan sonra formun altında gösterilen tek cümle; çıkış yapılamazsa panelde kalınır ve sebebi söylenir.
  const [cikisNot, setCikisNot] = useState<string | null>(null);
  const [cikisHata, setCikisHata] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, s, k, g, x] = await Promise.all([fetch("/api/panel", { cache: "no-store" }), fetch("/api/brain/settings", { cache: "no-store" }), fetch("/api/risk/settings", { cache: "no-store" }), fetch("/api/entry/settings", { cache: "no-store" }), fetch("/api/exchange-key", { cache: "no-store" })]);
      if (p.status === 401 || s.status === 401 || k.status === 401) { setState("oturumsuz"); return; }
      setView(p.ok ? ((await p.json()) as PanelView) : null);
      setSettings((await s.json()) as Settings);
      setRisk((await k.json().catch(() => ({ ok: false }))) as RiskView);
      setGiris((await g.json().catch(() => ({ ok: false }))) as EntryView);
      setAnahtar((await x.json().catch(() => ({ ok: false }))) as KeyView);
      setState(p.ok ? "hazır" : "ulaşılamadı");
    } catch { setState("ulaşılamadı"); }
  }, []);
  // KİLİT ÖNCE (Tur 40): ayar okunur; kapalıysa doğrulayıcı sorulmadan panel BUGÜNKÜ gibi yüklenir. Açıksa panel verisi kilit açılmadan okunmaz.
  const baslat = useCallback(async () => {
    let r: Response; try { r = await fetch("/api/lock/settings", { cache: "no-store" }); } catch { setKilitAyar({ ok: false }); setKilit("UNREADABLE"); return; }
    if (r.status === 401) { setKilit("ACIK"); setState("oturumsuz"); return; }
    const k = (await r.json().catch(() => ({ ok: false }))) as LockRead;
    let has = false; try { has = await platformAvailable(); } catch { has = false; } // sonda düşerse YOK sayılır (açık davranılmaz, U-3)
    setDogrulayici(has);
    const s = await lockGate(k, async () => has);
    setKilitAyar(k); if (s === "OFF") { setKilit("ACIK"); await load(); } else setKilit(s);
  }, [load]);
  useEffect(() => { const t = setTimeout(() => void baslat(), 0); return () => clearTimeout(t); }, [baslat]); // ilk okuma bağlanmadan SONRA: durum güncellemesi render zincirine girmez
  // Yeniden sorma: süre AYARDAN gelir; NULL ise zamanlayıcı kurulmaz (sayı seçilmez). Yeniden kilitlenince ekrandaki veri de bırakılır.
  useEffect(() => { const sn = kilitAyar?.ok && kilitAyar.enabled ? kilitAyar.repromptSeconds : null; if (kilit !== "ACIK" || sn === null) return;
    const t = setTimeout(() => { setView(null); setState("yükleniyor"); setKilit("LOCKED"); }, sn * 1000); return () => clearTimeout(t); }, [kilit, kilitAyar]);
  // Giriş başarılı: aynı sayfa, açılıştaki sırayla (kilit ayarı → panel verisi) yeniden okunur.
  const girdi = () => { setCikisNot(null); setState("yükleniyor"); setKilit("CHECKING"); void baslat(); };
  // Çıkış: mevcut POST /api/auth/logout (çerezi düşürür). Başarısızsa ekran oturumlu kalır ve bunu söyler — çerez tarayıcıda kalmış olabilir.
  const cikis = async () => { let ok = false; try { ok = (await fetch("/api/auth/logout", { method: "POST", cache: "no-store" })).ok; } catch { ok = false; }
    if (!ok) { setCikisHata("Çıkış yapılamadı: sunucuya ulaşılamadı ya da istek reddedildi, oturum hâlâ açık olabilir. Yeniden dene."); return; }
    setCikisHata(null); setView(null); setSettings(null); setRisk(null); setGiris(null); setAnahtar(null); setCikisNot("Çıkış yapıldı; bu tarayıcıdaki oturum kapandı."); setState("oturumsuz"); };
  const kilidiAc = async () => { if (await unlock()) { setKilitNot(null); setKilit("ACIK"); await load(); } else setKilitNot(LOCK_TEXT.FAILED); };
  const tanit = async () => setKilitNot(await enroll() ? "Bu cihaz kilide tanıtıldı. Şimdi \"Kilidi aç\" ile doğrula." : LOCK_TEXT.ENROLL_FAILED);

  const apply = async () => {
    const [model, ms] = pick.split("|");
    const govde = secimGovdesi(model, ms);
    // Tur 66 · 1d: kod yoksa serbest uç (yalnız harcamayı azaltan yön); her fetch( doğrudan "/api/…" dizesiyle başlar (gate:binance-budget izin gerekçesi).
    const r = totp.length === 6 ? await fetch("/api/brain/settings", { method: "POST", headers: { "content-type": "application/json", "x-totp-code": totp }, body: govde })
      : await fetch("/api/brain/settings/tighten", { method: "POST", headers: { "content-type": "application/json" }, body: govde });
    const b = (await r.json()) as { ok?: boolean; reason?: string; applied?: { field: string; from: string | null; to: string | null }[]; errors?: string[] };
    setApplied(r.ok && b.ok
      ? `Ayar değişti ve kim/ne zaman/eski→yeni olarak deftere yazıldı: ${(b.applied ?? []).map((c) => `${c.field} ${c.from} → ${c.to}`).join(", ") || "değişen alan yok"}. Değişiklik anında geçerli; yeniden kurulum gerekmiyor.`
      : r.status === 403 && b.reason === "RAISES_SPEND" ? `Değişiklik uygulanmadı ve ayar DEĞİŞMEDİ: bu seçim harcamayı ARTIRABİLİR (${(b.errors ?? []).join(" · ") || "harcama izni artıyor"}). Harcamayı artıran seçim tek kullanımlık kod ister; kodu yazıp yeniden gönder.`
      : r.status === 403 ? "Değişiklik uygulanmadı: tek kullanımlık kod doğrulanamadı. Ayar DEĞİŞMEDİ."
      : r.status === 401 ? "Değişiklik uygulanmadı: oturumun düşmüş. Yeniden giriş yapman gerekiyor."
      : `Değişiklik uygulanmadı, hiçbir alan yazılmadı. Sebep: ${(b.errors ?? ["ayar deposu yanıt vermedi"]).join(" · ")}`);
    setTotp(""); await load();
  };

  // ---- MALİYET TAVANINI DEĞİŞTİR (Tur 65 · 3e) ----
  const capYamasi = (): Record<string, unknown> => { const y: Record<string, unknown> = {};
    if (capSecili.tavan) y.totalCapUsd = capDeger.trim() === "" ? null : capDeger.trim().replace(",", ".");
    if (capSecili.beyin) y.monthlyCapUsd = capBeyin.trim() === "" ? null : capBeyin.trim().replace(",", ".");
    if (capSecili.davranis && capDavranis !== "") y.capEmptyBehavior = capDavranis;
    if (capSecili.altyapi) y.infraUsd = capAltyapi.trim() === "" ? null : capAltyapi.trim().replace(",", ".");
    return y; };
  const capHazir = (capSecili.tavan || capSecili.beyin || capSecili.altyapi || (capSecili.davranis && capDavranis !== "")) && (capTotp.length === 0 || capTotp.length === 6);
  const capUygula = async () => {
    const kodlu = capTotp.length === 6, govde = JSON.stringify(capYamasi());
    // gate:binance-budget (panel izin gerekçesi): her fetch( çağrısı doğrudan kendi kökenimizdeki "/api/…" dizesiyle başlar — iki uç iki ayrı düz çağrı (Tur 65 gerilemesi ölçtü).
    const r = kodlu ? await fetch("/api/brain/settings", { method: "POST", headers: { "content-type": "application/json", "x-totp-code": capTotp }, body: govde })
      : await fetch("/api/brain/settings/tighten", { method: "POST", headers: { "content-type": "application/json" }, body: govde });
    const b = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string; applied?: { field: string; from: string | null; to: string | null }[]; errors?: string[] };
    const niye = (b.errors ?? []).join(" · "), ad = (f: string) => (f === "totalCapUsd" ? "aylık toplam maliyet tavanı" : f === "monthlyCapUsd" ? "karar motorunun aylık tavanı" : f === "capEmptyBehavior" ? "tavan boşken davranış" : f === "infraUsd" ? "aylık altyapı maliyeti" : f);
    setCapSonuc(r.ok && b.ok
      ? `Ayar değişti ve kim/ne zaman/eski→yeni olarak deftere AYNI işlemde yazıldı: ${(b.applied ?? []).map((c) => `${ad(c.field)} ${c.from ?? "girilmemişti"} → ${c.to ?? "girilmedi (boş)"}`).join(", ") || "değişen alan yok"}. Değişiklik anında geçerli.`
      : r.status === 403 && b.reason === "RAISES_SPEND" ? `Değişiklik uygulanmadı ve ayar DEĞİŞMEDİ: bu değişiklik harcamayı ARTIRABİLİR (${niye || "harcama izni artıyor"}). Harcamayı artıran değişiklik tek kullanımlık kod ister; kodu yazıp yeniden gönder.`
      : r.status === 403 ? "Değişiklik uygulanmadı: tek kullanımlık kod doğrulanamadı. Ayar DEĞİŞMEDİ."
      : r.status === 401 ? "Değişiklik uygulanmadı: oturumun düşmüş. Yeniden giriş yapman gerekiyor. Ayar DEĞİŞMEDİ."
      : r.status === 400 ? `Değişiklik uygulanmadı — DEĞER KABUL EDİLMEDİ, hiçbir alan yazılmadı. Sebep: ${niye || "değer doğrulamadan geçmedi"}.`
      : `Değişiklik uygulanmadı ya da sonucu anlaşılamadı; ayarın değişip değişmediği BİLİNMİYOR. Aşağıdaki değerleri yeniden okut. Sebep: ${niye || "beklenmeyen yanıt"}.`);
    setCapTotp(""); setCapSecili({ tavan: false, beyin: false, davranis: false, altyapi: false }); setCapDeger(""); setCapBeyin(""); setCapAltyapi(""); setCapDavranis(""); await load();
  };

  // ---- KARAR MOTORU AYARINI DEĞİŞTİR (Tur 66 · 1d · S-8: azaltan yön kodsuz, artıran yön kod ister) ----
  const bYamasi = (): Record<string, unknown> => { const y: Record<string, unknown> = {};
    if (bSecili.model && bDeger.model !== "") y.model = bDeger.model;
    if (bSecili.siklik && bDeger.siklik !== "") y.callIntervalMs = Number(bDeger.siklik);
    if (bSecili.aday && bDeger.aday.trim() !== "") y.candidates = Number(bDeger.aday.trim());
    if (bSecili.mum && bDeger.mum.trim() !== "") y.candleLimit = Number(bDeger.mum.trim());
    return y; };
  const bHazir = Object.keys(bYamasi()).length > 0 && (bTotp.length === 0 || bTotp.length === 6);
  const bUygula = async () => {
    const kodlu = bTotp.length === 6, govde = JSON.stringify(bYamasi());
    const r = kodlu ? await fetch("/api/brain/settings", { method: "POST", headers: { "content-type": "application/json", "x-totp-code": bTotp }, body: govde })
      : await fetch("/api/brain/settings/tighten", { method: "POST", headers: { "content-type": "application/json" }, body: govde });
    const b = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string; applied?: { field: string; from: string | null; to: string | null }[]; errors?: string[] };
    const niye = (b.errors ?? []).join(" · "), ad = (f: string) => (f === "model" ? "model" : f === "callIntervalMs" ? "çağrı sıklığı" : f === "candidates" ? "aday sayısı" : f === "candleLimit" ? "mum sayısı" : f);
    const deger = (f: string, v: string | null) => (v === null ? "girilmemiş" : f === "callIntervalMs" ? hours(Number(v)) : v);
    setBSonuc(r.ok && b.ok
      ? `Ayar değişti ve kim/ne zaman/eski→yeni olarak deftere AYNI işlemde yazıldı: ${(b.applied ?? []).map((c) => `${ad(c.field)} ${deger(c.field, c.from)} → ${deger(c.field, c.to)}`).join(", ") || "değişen alan yok"}. Değişiklik bir sonraki planlama turunda geçerli.`
      : r.status === 403 && b.reason === "RAISES_SPEND" ? `Değişiklik uygulanmadı ve ayar DEĞİŞMEDİ: bu değişiklik harcamayı ARTIRABİLİR ya da yönü ölçülemedi (${niye || "harcama izni artıyor"}). Tek kullanımlık kodu yazıp yeniden gönder.`
      : r.status === 403 ? "Değişiklik uygulanmadı: tek kullanımlık kod doğrulanamadı. Ayar DEĞİŞMEDİ."
      : r.status === 401 ? "Değişiklik uygulanmadı: oturumun düşmüş. Yeniden giriş yapman gerekiyor. Ayar DEĞİŞMEDİ."
      : r.status === 400 ? `Değişiklik uygulanmadı — DEĞER KABUL EDİLMEDİ, hiçbir alan yazılmadı. Sebep: ${niye || "değer doğrulamadan geçmedi"}.`
      : `Değişiklik uygulanmadı ya da sonucu anlaşılamadı; ayarın değişip değişmediği BİLİNMİYOR. Aşağıdaki değerleri yeniden okut. Sebep: ${niye || "beklenmeyen yanıt"}.`);
    setBTotp(""); setBSecili({ model: false, siklik: false, aday: false, mum: false }); setBDeger({ model: "", siklik: "", aday: "", mum: "" }); await load();
  };

  // ---- TİK ARALIĞINI DEĞİŞTİR (Tur 67 · 1c · K3, S-8: daha seyrek kodsuz, daha sık kod ister; yön sunucuda karar verilir) ----
  const tikHazir = tikDeger !== "" && (tikTotp.length === 0 || tikTotp.length === 6);
  const tikEtiket = (v: string | null) => (v === null ? "girilmemişti" : settings?.tickView?.choices.find((c) => String(c.ms) === v)?.label ?? "seçenek kümesi dışında bir değer");
  const tikUygula = async () => {
    const kodlu = tikTotp.length === 6, govde = tikGovdesi(tikDeger);
    const r = kodlu ? await fetch("/api/brain/settings", { method: "POST", headers: { "content-type": "application/json", "x-totp-code": tikTotp }, body: govde })
      : await fetch("/api/brain/settings/tighten", { method: "POST", headers: { "content-type": "application/json" }, body: govde });
    const b = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string; applied?: { field: string; from: string | null; to: string | null }[]; errors?: string[] };
    const niye = (b.errors ?? []).join(" · ");
    setTikSonuc(r.ok && b.ok
      ? ((b.applied ?? []).length === 0 ? "Seçtiğin aralık zaten kayıtlı; hiçbir şey değişmedi ve deftere satır yazılmadı." : `Ayar değişti ve kim/ne zaman/eski→yeni olarak deftere AYNI işlemde yazıldı: tik aralığı ${(b.applied ?? []).map((c) => `${tikEtiket(c.from)} → ${tikEtiket(c.to)}`).join(", ")}. ${settings?.tickView?.effectSentence ?? ""}`)
      : r.status === 403 && b.reason === "RAISES_SPEND" ? "Değişiklik uygulanmadı ve ayar DEĞİŞMEDİ: bu aralık motoru daha SIK çalıştırır (sunucu çağrısı artar). Daha sık aralık tek kullanımlık kod ister; kodu yazıp yeniden gönder."
      : r.status === 403 ? "Değişiklik uygulanmadı: tek kullanımlık kod doğrulanamadı. Ayar DEĞİŞMEDİ."
      : r.status === 401 ? "Değişiklik uygulanmadı: oturumun düşmüş. Yeniden giriş yapman gerekiyor. Ayar DEĞİŞMEDİ."
      : r.status === 400 ? `Değişiklik uygulanmadı — DEĞER KABUL EDİLMEDİ, hiçbir alan yazılmadı. Sebep: ${niye || "değer doğrulamadan geçmedi"}.`
      : `Değişiklik uygulanmadı ya da sonucu anlaşılamadı; ayarın değişip değişmediği BİLİNMİYOR. Aşağıdaki değeri yeniden okut. Sebep: ${niye || "beklenmeyen yanıt"}.`);
    setTikTotp(""); setTikDeger(""); await load();
  };

  // ---- RİSK AYARINI DEĞİŞTİR (Tur 37 madde 5 · S-8) ----
  // Yama YALNIZ İŞARETLENMİŞ alanlardan kurulur: işaretlenmemiş alan gönderilmez (varsayılan doldurulmuş değer YOK).
  // İşaretli ama BOŞ bırakılan alan "seçimi kaldır" demektir ve null gider — bu ekranda ikisi AYNI ŞEY DEĞİLDİR.
  // Tavan yokken daha önce seçilmiş "AÇIK" değeri yamaya GİRMEZ: seçenek ekrandan kalkınca değeri de düşer (seçim "— seç —"e döner, gönderim düğmesi kapanır).
  const acikSunulur = !!risk?.ok && tavanVar(risk, riskSecili, riskDeger);
  const deger = (alan: string) => (alan === "futuresEnabled" && riskDeger[alan] === "acik" && !acikSunulur ? "" : (riskDeger[alan] ?? ""));
  const riskYamasi = (): Record<string, unknown> => {
    const y: Record<string, unknown> = {};
    for (const f of RISK_ALANLARI) { if (!riskSecili[f.alan]) continue; const v = deger(f.alan).trim();
      if (f.tip === "sayı") y[f.alan] = v === "" ? null : Number(v);
      else if (f.tip === "şalter") y[f.alan] = v === "acik";
      else if (f.tip === "kip") y[f.alan] = v;
      else y[f.alan] = v === "" ? null : v; }
    return y;
  };
  const riskHazir = RISK_ALANLARI.some((f) => riskSecili[f.alan]) && RISK_ALANLARI.every((f) => !riskSecili[f.alan] || f.tip === "sayı" || f.tip === "ondalık" || deger(f.alan) !== "") && riskTotp.length === 6;
  const riskUygula = async () => {
    const r = await fetch("/api/risk/settings", { method: "POST", headers: { "content-type": "application/json", "x-totp-code": riskTotp }, body: JSON.stringify(riskYamasi()) });
    const b = (await r.json().catch(() => ({}))) as { ok?: boolean; applied?: { field: string; from: string | null; to: string | null }[]; errors?: string[] };
    const niye = (b.errors ?? []).join(" · ");
    setRiskSonuc(r.ok && b.ok
      ? `Ayar değişti ve kim/ne zaman/eski→yeni olarak deftere AYNI işlemde yazıldı: ${(b.applied ?? []).map((c) => `${RISK_ADI[c.field] ?? c.field} ${c.from ?? "seçilmemişti"} → ${c.to ?? "seçilmemiş"}`).join(", ") || "değişen alan yok"}. Değişiklik anında geçerlidir ve tek başına HİÇBİR EMİR GÖNDERMEZ.`
      : r.status === 403 ? "Değişiklik uygulanmadı: tek kullanımlık kod istendi ve doğrulanamadı. Bu ayar paranın riskini belirlediği için kod olmadan değiştirilemez. Hiçbir alan yazılmadı."
      : r.status === 401 ? "Değişiklik uygulanmadı: oturumun düşmüş. Yeniden giriş yapman gerekiyor. Hiçbir alan yazılmadı."
      : r.status === 400 ? `Değişiklik uygulanmadı — DEĞER KABUL EDİLMEDİ. Yama bütünüyle reddedildi, hiçbir alan yazılmadı. Sebep: ${niye || "değer doğrulamadan geçmedi"}.`
      : r.status === 409 ? `Değişiklik uygulanmadı — AYAR SATIRI YOK. Ayar kaydı henüz oluşmamış (göç uygulanmamış olabilir); bu yüzden değiştirilecek bir şey de yok. Sebep: ${niye || "ayar satırı bulunamadı"}.`
      : r.status === 503 ? `Değişiklik uygulanmadı — AYAR DEPOSU YA DA DEĞİŞİKLİK DEFTERİ YAZILAMADI. Defter yazılamıyorsa ayar da yazılmaz (ikisi aynı işlemdedir): ayar DEĞİŞMEDİ. Sebep: ${niye || "depo yanıt vermedi"}.`
      : `Değişiklik uygulanmadı ve sunucunun verdiği yanıt anlaşılamadı; ayarın değişip değişmediği BİLİNMİYOR. Aşağıdaki değerleri yeniden okut. Sebep: ${niye || "beklenmeyen yanıt"}.`);
    setRiskTotp(""); setRiskSecili({}); setRiskDeger({}); await load();
  };

  // Ayar değişince YALNIZ kilit ayarı yeniden okunur (panel verisi kilit ekranında zaten okunmaz).
  const kilitAyariniYenile = async () => { try { const r = await fetch("/api/lock/settings", { cache: "no-store" }); setKilitAyar((await r.json().catch(() => ({ ok: false }))) as LockRead); } catch { setKilitAyar({ ok: false }); } };
  if (kilit !== "ACIK") return <KilitEkrani durum={kilit} not={kilitNot} ac={() => void kilidiAc()} tanit={() => void tanit()} ayar={kilitAyar} dogrulayiciVar={dogrulayici} yenile={kilitAyariniYenile} />;
  if (state !== "hazır") return (
    <main style={{ fontFamily: "system-ui, sans-serif", background: "#0b0b0c", color: "#e8e8ea", minHeight: "100vh", padding: "2rem 1rem" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <h1 style={{ fontSize: "1.35rem" }}>Winvestour · motor paneli</h1>
        <p style={{ margin: "0 0 .6rem" }}><a href="/durdur" style={{ color: "#ff8a7a", fontWeight: 700 }}>Motoru durdur</a> (oturum istemez)</p>
        <p style={{ lineHeight: 1.6 }}>{state === "yükleniyor" ? "Panel yükleniyor: motorun durumu, son turu, sağlık göstergesi ve pozisyonlar okunuyor. Rakamlar okunmadan hiçbir kutu doldurulmaz."
          : state === "oturumsuz" ? "Bu panel hesabının parasını gösterdiği için oturum ister. Parolanı yazıp giriş yap."
          : "Panel verisi alınamadı, bu yüzden ekranda rakam gösterilmiyor: eldeki en son rakamları yeniymiş gibi göstermek yanlış olurdu. Motorun kendisi bu sayfadan bağımsız çalışır; borsadaki koruma emirleri yerinde durur."}</p>
        {state === "oturumsuz" && <GirisFormu girdi={girdi} not={cikisNot} />}
      </div>
    </main>
  );

  const v = view as PanelView, opts = settings?.options?.rows ?? [];
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", background: "#0b0b0c", color: "#e8e8ea", minHeight: "100vh", padding: "2rem 1rem" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <h1 style={{ fontSize: "1.35rem", marginBottom: ".2rem" }}>Winvestour · motor paneli</h1>
        <p style={{ margin: "0 0 .6rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: ".4rem 1.2rem" }}><a href="/durdur" style={{ color: "#ff8a7a", fontWeight: 700 }}>Motoru durdur</a>
          <button id="cikis-yap" type="button" onClick={() => void cikis()} style={{ padding: ".45rem .9rem", borderRadius: 6, border: "1px solid #33333c", background: "#141419", color: "#e8e8ea", cursor: "pointer" }}>Çıkış yap</button></p>
        {cikisHata !== null && <p role="alert" style={{ ...box("WARN"), lineHeight: 1.55 }}>{cikisHata}</p>}
        <p style={{ color: "#9a9aa2", margin: "0 0 1rem" }}>Bu sayfadaki her satır ölçülen bir kayıttan gelir. Okunamayan bir değer &quot;bilinmiyor&quot; yazar; hiçbir yerde boş ya da sıfır gösterilmez.</p>
        {v.alerts.length > 0 && <><h2 style={{ fontSize: "1.05rem", marginTop: "1.2rem" }}>Önce bunlar</h2>{v.alerts.map((c, i) => <CardBlock key={i} c={c} head="uyarı" />)}</>}
        <h2 style={{ fontSize: "1.05rem", marginTop: "1.4rem" }}>Motor</h2>
        <CardBlock c={v.engine} /><CardBlock c={v.tick} /><CardBlock c={v.health} />
        <h2 style={{ fontSize: "1.05rem", marginTop: "1.4rem" }}>Pozisyonlar</h2>
        <CardBlock c={v.positions.card} />
        {v.positions.rows.map((p) => <CardBlock key={p.id} c={{ level: p.level, title: p.title, lines: p.lines }} head="pozisyon" />)}
        <h2 style={{ fontSize: "1.05rem", marginTop: "1.4rem" }}>Binance API anahtarı</h2>
        <AnahtarYuzeyi durum={anahtar} yenile={load} />
        <h2 style={{ fontSize: "1.05rem", marginTop: "1.4rem" }}>Aylık maliyet tavanı</h2>
        <section style={box(settings?.ok && settings.costCap ? (settings.costCap.brainMonthlyUsd === null ? "WARN" : "INFO") : "WARN")} aria-label="Aylık maliyet tavanı">
          {!settings?.ok || !settings.costCap ? <p style={{ lineHeight: 1.55 }}>Aylık maliyet tavanı bu açılışta okunamadı, bu yüzden buraya rakam yazılmadı. Okunamayan tavan &quot;boş&quot; SAYILMAZ; ayar okunamadığında karar motoru zaten çağrılmaz.</p> : <>
            <p data-tavan style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{settings.costCap.sentence}</p>
            <p style={{ margin: ".3rem 0", lineHeight: 1.55, color: "#9a9aa2" }}>{settings.costCap.behaviorSentence}</p>
            <details style={{ marginTop: ".6rem" }}>
              <summary style={{ cursor: "pointer" }}>Tavanı değiştir (düşürmek ve boşaltmak kod istemez; yükseltmek kod ister)</summary>
              <p style={{ margin: ".4rem 0", lineHeight: 1.55, color: "#9a9aa2" }}>Değiştirmek istediğin alanı işaretle. İşaretlemediğin alan gönderilmez. Tavan alanını işaretleyip boş bırakırsan tavan BOŞALTILIR. Kod yazmazsan yalnız harcamayı azaltan değişiklik kabul edilir; harcamayı artırabilecek değişiklik (tavanı yükseltmek, &quot;sınır yok&quot;u seçmek) tek kullanımlık kod ister.</p>
              <div style={{ borderTop: "1px solid #23232a", padding: ".5rem 0" }}>
                <label style={{ display: "block" }}><input type="checkbox" checked={capSecili.tavan} onChange={(e) => setCapSecili({ ...capSecili, tavan: e.target.checked })} aria-label="Aylık toplam maliyet tavanını değiştir" /><span style={{ marginLeft: ".4rem" }}>Aylık toplam maliyet tavanı</span></label>
                {capSecili.tavan && <label htmlFor="tavan-deger" style={{ display: "block", margin: ".35rem 0 .2rem", color: "#9a9aa2" }}>Yeni tavan, dolar/ay (boş bırakırsan tavan boşaltılır)</label>}
                {capSecili.tavan && <span style={{ whiteSpace: "nowrap" }}><input id="tavan-deger" value={capDeger} onChange={(e) => setCapDeger(e.target.value)} inputMode="decimal" style={{ padding: ".3rem .5rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 5, width: "7rem" }} /> $/ay</span>}
              </div>
              <div style={{ borderTop: "1px solid #23232a", padding: ".5rem 0" }}>
                <label style={{ display: "block" }}><input type="checkbox" checked={capSecili.beyin} onChange={(e) => setCapSecili({ ...capSecili, beyin: e.target.checked })} aria-label="Karar motorunun aylık tavanını değiştir" /><span style={{ marginLeft: ".4rem" }}>Karar motorunun (Claude) aylık tavanı</span></label>
                {capSecili.beyin && <label htmlFor="tavan-beyin" style={{ display: "block", margin: ".35rem 0 .2rem", color: "#9a9aa2" }}>Yeni tavan, dolar/ay (boş bırakırsan toplam tavandan türetilir)</label>}
                {capSecili.beyin && <span style={{ whiteSpace: "nowrap" }}><input id="tavan-beyin" value={capBeyin} onChange={(e) => setCapBeyin(e.target.value)} inputMode="decimal" style={{ padding: ".3rem .5rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 5, width: "7rem" }} /> $/ay</span>}
              </div>
              <div style={{ borderTop: "1px solid #23232a", padding: ".5rem 0" }}>
                <label style={{ display: "block" }}><input type="checkbox" checked={capSecili.altyapi} onChange={(e) => setCapSecili({ ...capSecili, altyapi: e.target.checked })} aria-label="Aylık altyapı maliyetini değiştir" /><span style={{ marginLeft: ".4rem" }}>Aylık altyapı maliyeti (kendi Neon, Vercel ve Upstash faturanın toplamı)</span></label>
                {capSecili.altyapi && <label htmlFor="tavan-altyapi" style={{ display: "block", margin: ".35rem 0 .2rem", color: "#9a9aa2" }}>Yeni değer, dolar/ay (boş bırakırsan &quot;girilmedi&quot; olur ve karar motorunun payı türetilmez; düşürmek payı artırdığı için kod ister)</label>}
                {capSecili.altyapi && <span style={{ whiteSpace: "nowrap" }}><input id="tavan-altyapi" value={capAltyapi} onChange={(e) => setCapAltyapi(e.target.value)} inputMode="decimal" style={{ padding: ".3rem .5rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 5, width: "7rem" }} /> $/ay</span>}
              </div>
              <div style={{ borderTop: "1px solid #23232a", padding: ".5rem 0" }}>
                <label style={{ display: "block" }}><input type="checkbox" checked={capSecili.davranis} onChange={(e) => setCapSecili({ ...capSecili, davranis: e.target.checked })} aria-label="Tavan boşken davranışı değiştir" /><span style={{ marginLeft: ".4rem" }}>Tavan boşken davranış</span></label>
                {capSecili.davranis && <label htmlFor="tavan-davranis" style={{ display: "block", margin: ".35rem 0 .2rem", color: "#9a9aa2" }}>Tavan boşken ne olsun</label>}
                {capSecili.davranis && <select id="tavan-davranis" value={capDavranis} onChange={(e) => setCapDavranis(e.target.value)} style={{ padding: ".3rem .5rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 5 }}>
                  <option value="">— seç —</option><option value="BRAIN_OFF">Karar motoru çağrılmaz (varsayılan)</option><option value="NO_LIMIT">Sınır yok (kod ister)</option></select>}
              </div>
              <label style={{ ...kodEtiket, margin: ".5rem 0 .3rem" }}>Tek kullanımlık kod (yalnız harcamayı artırabilecek değişiklik için)
                <input value={capTotp} onChange={(e) => setCapTotp(e.target.value)} inputMode="numeric" maxLength={6} style={{ padding: ".3rem .5rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 5, width: "6rem" }} />
              </label>
              <button onClick={() => void capUygula()} disabled={!capHazir} style={{ padding: ".45rem .9rem", borderRadius: 6, border: eylemKenari(capHazir), background: capHazir ? "#12354f" : "#1a1a20", color: "#e8e8ea", cursor: capHazir ? "pointer" : "not-allowed" }}>{capTotp.length === 6 ? "Kodla uygula" : "Kodsuz uygula (yalnız azaltan yön)"}</button>
              {capSonuc !== null && <p style={{ margin: ".5rem 0", lineHeight: 1.55 }}>{capSonuc}</p>}
            </details>
          </>}
        </section>
        <h2 style={{ fontSize: "1.05rem", marginTop: "1.4rem" }}>Karar motoru ayarı — model · sıklık · aday · mum</h2>
        <section style={box(settings?.ok && settings.settings ? "INFO" : "WARN")} aria-label="Karar motoru ayarı">
          {!settings?.ok || !settings.settings || !settings.allowed ? <p style={{ lineHeight: 1.55 }}>Karar motorunun ayarı bu açılışta okunamadı, bu yüzden buraya değer yazılmadı ve değiştirme formu gösterilmiyor.</p> : <>
            {settings.capEmpty && <p data-tavan-bos-ayar style={{ margin: ".3rem 0", lineHeight: 1.55 }}>Karar motoru şu an ÇAĞRILMIYOR: aylık maliyet tavanından karar motoruna pay ayrılmadı (tavan boş ya da altyapı maliyeti girilmedi). Aşağıdaki ayar, pay ayrıldığında geçerli olur; sebebin tam cümlesi &quot;Aylık maliyet tavanı&quot; bölümünde.</p>}
            <p data-beyin-ayar style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{settings.capEmpty ? "Kayıtlı ayar (pay ayrılınca geçerli olur)" : "Şu an"}: model {settings.settings.model}, {hours(settings.settings.callIntervalMs)} {settings.capEmpty ? "çağrılacak" : "çağrılır"}, her çağrıda en likit {settings.settings.candidates} aday ve aday başına {settings.settings.candleLimit} saatlik mum okunur.</p>
            <details style={{ marginTop: ".6rem" }}>
              <summary style={{ cursor: "pointer" }}>Değiştir (daha ucuz model, daha seyrek çağrı, daha az aday ya da mum kod istemez; ters yönü kod ister)</summary>
              <p style={{ margin: ".4rem 0", lineHeight: 1.55, color: "#9a9aa2" }}>Değiştirmek istediğin alanı işaretle; işaretlemediğin alan gönderilmez. Kod yazmazsan yalnız harcamayı azaltan değişiklik kabul edilir. Modelin ucuz ya da pahalı olduğu fiyat tablosundan ölçülür; ölçülemezse kod istenir.</p>
              <div style={{ borderTop: "1px solid #23232a", padding: ".5rem 0" }}>
                <label style={{ display: "block" }}><input type="checkbox" checked={bSecili.model} onChange={(e) => setBSecili({ ...bSecili, model: e.target.checked })} aria-label="Modeli değiştir" /><span style={{ marginLeft: ".4rem" }}>Model</span></label>
                {bSecili.model && <select aria-label="Yeni model" value={bDeger.model} onChange={(e) => setBDeger({ ...bDeger, model: e.target.value })} style={{ padding: ".3rem .5rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 5 }}><option value="">— seç —</option>{settings.allowed.models.map((m) => <option key={m} value={m}>{m}</option>)}</select>}
              </div>
              <div style={{ borderTop: "1px solid #23232a", padding: ".5rem 0" }}>
                <label style={{ display: "block" }}><input type="checkbox" checked={bSecili.siklik} onChange={(e) => setBSecili({ ...bSecili, siklik: e.target.checked })} aria-label="Çağrı sıklığını değiştir" /><span style={{ marginLeft: ".4rem" }}>Çağrı sıklığı</span></label>
                {bSecili.siklik && <select aria-label="Yeni çağrı sıklığı" value={bDeger.siklik} onChange={(e) => setBDeger({ ...bDeger, siklik: e.target.value })} style={{ padding: ".3rem .5rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 5 }}><option value="">— seç —</option>{settings.allowed.intervalChoicesMs.map((ms) => <option key={ms} value={String(ms)}>{hours(ms)}</option>)}</select>}
              </div>
              <div style={{ borderTop: "1px solid #23232a", padding: ".5rem 0" }}>
                <label style={{ display: "block" }}><input type="checkbox" checked={bSecili.aday} onChange={(e) => setBSecili({ ...bSecili, aday: e.target.checked })} aria-label="Aday sayısını değiştir" /><span style={{ marginLeft: ".4rem" }}>Aday sayısı (çağrı başına)</span></label>
                {bSecili.aday && <span style={{ whiteSpace: "nowrap" }}><input aria-label="Yeni aday sayısı" value={bDeger.aday} onChange={(e) => setBDeger({ ...bDeger, aday: e.target.value })} inputMode="numeric" style={{ ...{ padding: ".3rem .5rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 5 }, width: "5rem" }} /> aday ({settings.allowed.candidates.min}–{settings.allowed.candidates.max})</span>}
              </div>
              <div style={{ borderTop: "1px solid #23232a", padding: ".5rem 0" }}>
                <label style={{ display: "block" }}><input type="checkbox" checked={bSecili.mum} onChange={(e) => setBSecili({ ...bSecili, mum: e.target.checked })} aria-label="Mum sayısını değiştir" /><span style={{ marginLeft: ".4rem" }}>Mum sayısı (aday başına, saatlik)</span></label>
                {bSecili.mum && <span style={{ whiteSpace: "nowrap" }}><input aria-label="Yeni mum sayısı" value={bDeger.mum} onChange={(e) => setBDeger({ ...bDeger, mum: e.target.value })} inputMode="numeric" style={{ ...{ padding: ".3rem .5rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 5 }, width: "5rem" }} /> mum ({settings.allowed.candleLimit.min}–{settings.allowed.candleLimit.max})</span>}
              </div>
              <label style={{ ...kodEtiket, margin: ".5rem 0 .3rem" }}>Tek kullanımlık kod (yalnız harcamayı artırabilecek değişiklik için)
                <input value={bTotp} onChange={(e) => setBTotp(e.target.value)} inputMode="numeric" maxLength={6} style={{ padding: ".3rem .5rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 5, width: "6rem" }} />
              </label>
              <button onClick={() => void bUygula()} disabled={!bHazir} style={{ padding: ".45rem .9rem", borderRadius: 6, border: eylemKenari(bHazir), background: bHazir ? "#12354f" : "#1a1a20", color: "#e8e8ea", cursor: bHazir ? "pointer" : "not-allowed" }}>{bTotp.length === 6 ? "Kodla uygula" : "Kodsuz uygula (yalnız azaltan yön)"}</button>
              {bSonuc !== null && <p style={{ margin: ".5rem 0", lineHeight: 1.55 }}>{bSonuc}</p>}
            </details>
          </>}
        </section>
        <h2 style={{ fontSize: "1.05rem", marginTop: "1.4rem" }}>Tik aralığı — motor ne sıklıkla çalışır</h2>
        <section style={box(settings?.ok && settings.tickView ? (settings.tickView.tickMs === null ? "WARN" : "INFO") : "WARN")} aria-label="Tik aralığı">
          {!settings?.ok || !settings.tickView ? <p style={{ lineHeight: 1.55 }}>Tik aralığı bu açılışta okunamadı, bu yüzden buraya değer yazılmadı ve değiştirme formu gösterilmiyor. Okunamayan aralık &quot;boş&quot; sayılmadı; motorun kendisi aralığı izin kopyasından okur ve okuyamazsa tiklemez.</p> : <>
            <p data-tik-ayar style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{settings.tickView.sentence}</p>
            <p style={{ margin: ".3rem 0", lineHeight: 1.55, color: "#9a9aa2" }}>{settings.tickView.effectSentence}</p>
            <details style={{ marginTop: ".6rem" }}>
              <summary style={{ cursor: "pointer" }}>Değiştir (daha seyrek kod istemez; daha sık kod ister)</summary>
              <p style={{ margin: ".4rem 0", lineHeight: 1.55, color: "#9a9aa2" }}>{settings.tickView.directionSentence}</p>
              <label style={{ display: "block", margin: ".3rem 0" }}>Yeni aralık{" "}
                <select aria-label="Yeni tik aralığı" value={tikDeger} onChange={(e) => setTikDeger(e.target.value)} style={{ padding: ".3rem .5rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 5 }}><option value="">— seç —</option>{settings.tickView.choices.map((c) => <option key={c.ms} value={String(c.ms)}>{c.current ? `${c.label} (şu anki)` : c.label}</option>)}</select>
              </label>
              <label style={{ ...kodEtiket, margin: ".5rem 0 .3rem" }}>Tek kullanımlık kod (yalnız daha SIK aralık için)
                <input value={tikTotp} onChange={(e) => setTikTotp(e.target.value)} inputMode="numeric" maxLength={6} style={{ padding: ".3rem .5rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 5, width: "6rem" }} />
              </label>
              <button onClick={() => void tikUygula()} disabled={!tikHazir} style={{ padding: ".45rem .9rem", borderRadius: 6, border: eylemKenari(tikHazir), background: tikHazir ? "#12354f" : "#1a1a20", color: "#e8e8ea", cursor: tikHazir ? "pointer" : "not-allowed" }}>{tikTotp.length === 6 ? "Kodla uygula" : "Kodsuz uygula (yalnız daha seyrek)"}</button>
              {tikSonuc !== null && <p style={{ margin: ".5rem 0", lineHeight: 1.55 }}>{tikSonuc}</p>}
            </details>
          </>}
        </section>
        <h2 style={{ fontSize: "1.05rem", marginTop: "1.4rem" }}>Karar motorunun maliyeti ve ayarı</h2>
        <section style={box(settings?.ok ? "INFO" : "WARN")}>
          {!settings?.ok ? <p style={{ lineHeight: 1.55 }}>Karar motorunun ayarı ve bu ayın harcaması bu açılışta okunamadı, bu yüzden buraya rakam yazılmadı. Ayar okunamadığında karar motoru zaten çağrılmaz: para harcanmaz, yeni pozisyon açılmaz; çıkış ve borsadaki koruma etkilenmez.</p>
          : settings.capEmpty ? <p data-tavan-bos style={{ lineHeight: 1.55 }}>Karar motoru şu an çağrılmıyor; sebebi ve ne yapabileceğin yukarıdaki &quot;Aylık maliyet tavanı&quot; bölümünde yazılı (aynı cümle burada tekrar edilmedi). Bu yüzden bu ay için harcama ve seçenek tablosu gösterilmiyor.</p> : <>
            <p style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{settings.spend?.sentence ?? settings.spend?.detail ?? "Bu dönemin harcaması okunamadı; harcanmamış varsayılmadı."}</p>
            <p style={{ margin: ".3rem 0", lineHeight: 1.55 }}>Şu anki ayar: {settings.runtime?.model}, {hours(settings.runtime?.callIntervalMs ?? 0)}, her turda {settings.runtime?.candidates} aday ve {settings.runtime?.candleLimit} mum. Karar motorunun aylık tavanı {settings.cap?.monthlyUsd == null ? "yok (tavan boş, \"sınır yok\" seçildi)" : `${settings.cap.monthlyUsd} $/ay`} ({settings.cap?.monthlyFrom}), günlük çağrı hakkı günde {settings.cap?.dailyCalls} çağrı ({settings.cap?.dailyFrom}).</p>
            <p style={{ margin: ".3rem 0", lineHeight: 1.55, color: settings.price?.stale ? TONE.WARN.bd : undefined }}>{settings.price?.note}</p>
            {opts.length === 0 ? <p style={{ lineHeight: 1.55 }}>{settings.options?.note}</p> : <>
              {/* Tur 49 madde 1: 6 sütunlu tablo 390 px'te "$"ı sayıdan koparıyor, model adını ve sıklığı 2–3 satıra kırıyordu (ölçüldü: 144 hücrenin 55'i). SATIR DÜZENİ: her seçenek iki satır;
                  sayı + birim ve model adı BÖLÜNMEZ parça (nowrap), parçalar arasında sarar. Yeni renk/boşluk/ölçü YOK: tablonun kendi belirteçleri (.92rem · .25rem .4rem · #23232a · #14231a · #9a9aa2). */}
              {/* Tur 70 madde 7c (Tur 49–50 borcu, ÖLÇÜLDÜ: 1280 px'te "$/ay" sağ kenarı satırdan satıra 7,93 / 15,88 px kayıyordu): ikinci satırın üç parçası artık ORTAK SÜTUNDUR — grup bir ızgara,
                  her seçenek satırı alt ızgara (subgrid) ⇒ sütun genişliği satırlar arasında paylaşılır; para sütunları sağa yaslı ⇒ "$/ay" sağ kenarları alt alta. Sütunlar min-content ile
                  max-content arasında (sayı YOK): 1280'de yan yana, 390'da sütun daralır ve etiket ("karar motoru") değerden AYRI satıra sarar — sayı + birim yine BÖLÜNMEZ parça (nowrap).
                  @media yok, yeni renk/boşluk/ölçü YOK: sütun aralığı bu bloğun kendi .4rem dolgu değeri. Dördüncü (boş, 1fr) iz artan genişliği alır ⇒ satır çizgisi ve "şu anki" zemini
                  eskisi gibi bölümün tam genişliğinde (ölçüldü: dolgu izi olmadan çizgi 1280'de sütunların bittiği yerde kesiliyordu). */}
              <div role="radiogroup" aria-label="Karar motoru seçenekleri" style={{ margin: ".7rem 0", fontSize: ".92rem", display: "grid", gridTemplateColumns: "repeat(3, minmax(min-content, max-content)) 1fr", columnGap: ".4rem" }}>
                <p style={{ color: "#9a9aa2", margin: "0 0 .35rem", gridColumn: "1 / -1" }}>Seçenekler — her satır aylık parayla yazılıdır; tavanı aşan satır işaretlidir (U-4).</p>
                {opts.map((o) => { const id = `${o.model}|${o.intervalMs}`; return (
                  <label key={id} data-secenek style={{ display: "grid", gridTemplateColumns: "subgrid", gridColumn: "1 / -1", columnGap: ".4rem", padding: ".25rem .4rem", borderTop: "1px solid #23232a", background: o.current ? "#14231a" : undefined, cursor: "pointer", lineHeight: 1.55 }}>
                    <span style={{ gridColumn: "1 / -1" }}><input type="radio" name="ayar" value={id} checked={pick === id} onChange={() => setPick(id)} aria-label={o.sentence} />{" "}
                      <span data-birim style={{ whiteSpace: "nowrap" }}>{o.model}{o.current ? " (şu anki)" : ""}</span> · <span data-birim style={{ whiteSpace: "nowrap" }}>{hours(o.intervalMs)}</span></span>
                    <span data-sutun="karar-motoru" style={{ justifySelf: "end", textAlign: "right" }}><span style={{ color: "#9a9aa2" }}>karar motoru</span> <span data-birim style={{ whiteSpace: "nowrap" }}>{o.brainUsd} $/ay</span></span>
                    <span data-sutun="toplam" style={{ justifySelf: "end", textAlign: "right" }}><span style={{ color: "#9a9aa2" }}>altyapı dâhil toplam</span> {o.totalUsd === null ? "hesaplanamadı (altyapı maliyeti girilmedi)" : <span data-birim style={{ whiteSpace: "nowrap" }}>{o.totalUsd} $/ay</span>}</span>
                    <span data-sutun="tavan">{o.underCap === null ? "tavan girilmedi: karşılaştırılamadı" : <><span data-birim style={{ whiteSpace: "nowrap" }}>{settings.costCap?.totalUsd ?? "?"} $/ay</span> tavanının {o.underCap ? "altında" : "ÜSTÜNDE — AŞIYOR"}</>}</span>
                  </label>); })}
              </div>
              <p style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{opts.find((o) => `${o.model}|${o.intervalMs}` === pick)?.sentence ?? "Bir satır seç: seçtiğin satırın aylık maliyeti burada tam cümleyle yazılacak."}</p>
              <label style={{ ...kodEtiket, margin: ".5rem 0 .3rem" }}>Tek kullanımlık kod (yalnız harcamayı artırabilecek seçim için; daha ucuz model ya da daha seyrek çağrı kodsuz uygulanır)
                <input value={totp} onChange={(e) => setTotp(e.target.value)} inputMode="numeric" maxLength={6} style={{ padding: ".3rem .5rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 5, width: "6rem" }} />
              </label>
              <button onClick={() => void apply()} disabled={!pick || (totp.length !== 0 && totp.length !== 6)} style={{ padding: ".45rem .9rem", borderRadius: 6, border: eylemKenari(!!pick && (totp.length === 0 || totp.length === 6)), background: !pick || (totp.length !== 0 && totp.length !== 6) ? "#1a1a20" : "#12354f", color: "#e8e8ea", cursor: !pick || (totp.length !== 0 && totp.length !== 6) ? "not-allowed" : "pointer" }}>{totp.length === 6 ? "Seçilen ayarı kodla uygula" : "Seçilen ayarı kodsuz uygula (yalnız azaltan yön)"}</button>
              {applied !== null && <p style={{ margin: ".5rem 0", lineHeight: 1.55 }}>{applied}</p>}
            </>}
            {(settings.changes ?? []).length > 0 && <p style={{ margin: ".4rem 0", lineHeight: 1.55, color: "#9a9aa2" }}>Son ayar değişikliği: {(settings.changes as NonNullable<Settings["changes"]>)[0].at.replace("T", " ").slice(0, 19)} UTC, {(settings.changes as NonNullable<Settings["changes"]>)[0].by} — {(settings.changes as NonNullable<Settings["changes"]>)[0].changes.map((c) => `${c.field} ${c.from} → ${c.to}`).join(", ") || "değişen alan yok"}.</p>}
          </>}
        </section>
        <h2 style={{ fontSize: "1.05rem", marginTop: "1.4rem" }}>Risk ayarı — kaldıraç · futures · SHORT yönü</h2>
        <section style={box(risk?.ok ? (risk?.futures?.allowed ? "WARN" : "INFO") : "WARN")} aria-label="Risk ayarı">
          {!risk?.ok ? <p style={{ lineHeight: 1.55 }}>Risk ayarı bu açılışta okunamadı, bu yüzden buraya hiçbir değer yazılmadı. Okunamayan ayar &quot;her şey kapalı&quot; demek DEĞİLDİR ve kapalı olduğu VARSAYILMADI; yazılım bu hâlde futures yolunu açmaz ve yeni pozisyon açmaz.</p> : <>
            {riskSatirlari(risk).map((l, i) => <p key={i} style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{l}</p>)}
            <details style={{ marginTop: ".6rem" }}>
              <summary style={{ cursor: "pointer" }}>Bu ayarı değiştir (tek kullanımlık kod ister)</summary>
              <p style={{ margin: ".4rem 0", lineHeight: 1.55, color: "#9a9aa2" }}>Değiştirmek istediğin alanı işaretle. İşaretlemediğin alan gönderilmez ve olduğu gibi kalır. İşaretleyip boş bıraktığın alanın seçimi KALDIRILIR (yeniden &quot;seçilmedi&quot; olur). Ekran senin yerine hiçbir sayı önermez.</p>
              {RISK_ALANLARI.map((f) => (
                <div key={f.alan} style={{ borderTop: "1px solid #23232a", padding: ".5rem 0" }}>
                  <label style={{ display: "block" }}>
                    <input type="checkbox" checked={!!riskSecili[f.alan]} onChange={(e) => setRiskSecili({ ...riskSecili, [f.alan]: e.target.checked })} aria-label={`${f.ad} alanını değiştir`} />
                    <span style={{ marginLeft: ".4rem" }}>{f.ad}</span>
                  </label>
                  {/* Tur 38 madde 2c: değer alanının GÖRÜNÜR etiketi `htmlFor` ile bağlı (yalnız aria-label değil) — ekran okuyucu ve göz aynı adı okur. */}
                  {riskSecili[f.alan] && <label htmlFor={`risk-deger-${f.alan}`} style={{ display: "block", margin: ".35rem 0 .2rem", color: "#9a9aa2" }}>{f.ad} — yeni değer{f.tip === "sayı" || f.tip === "ondalık" ? " (boş bırakırsan seçim kaldırılır)" : ""}</label>}
                  {riskSecili[f.alan] && (f.tip === "kip"
                    ? <select id={`risk-deger-${f.alan}`} value={deger(f.alan)} onChange={(e) => setRiskDeger({ ...riskDeger, [f.alan]: e.target.value })} style={{ padding: ".3rem .5rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 5, maxWidth: "100%" }}>
                        <option value="">— seç —</option>
                        {(risk.allowed?.shortModes ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    : f.tip === "şalter"
                    ? <select id={`risk-deger-${f.alan}`} value={deger(f.alan)} onChange={(e) => setRiskDeger({ ...riskDeger, [f.alan]: e.target.value })} style={{ padding: ".3rem .5rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 5, maxWidth: "100%" }}>
                        <option value="">— seç —</option><option value="kapali">KAPALI</option>{acikSunulur && <option value="acik">AÇIK</option>}
                      </select>
                    : <input id={`risk-deger-${f.alan}`} value={deger(f.alan)} onChange={(e) => setRiskDeger({ ...riskDeger, [f.alan]: e.target.value })} inputMode="decimal"
                        style={{ padding: ".3rem .5rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 5, width: "8rem" }} />)}
                  {riskSecili[f.alan] && f.tip === "şalter" && !acikSunulur && <p style={{ margin: ".35rem 0 0", lineHeight: 1.5, color: "#9a9aa2" }}>“AÇIK” seçeneği burada yok: kaldıraç tavanı seçilmediği için futures şalteri açılamaz — sunucu böyle bir isteği zaten reddeder. Kaldıraç tavanı alanını işaretleyip bir tavan yazdığında seçenek burada görünür; yazılım senin yerine tavan seçmez.</p>}
                  {riskSecili[f.alan] && f.tip === "kip" && <p style={{ margin: ".35rem 0 0", lineHeight: 1.5, color: "#9a9aa2" }}>{riskDeger[f.alan] ? `${riskDeger[f.alan]}: ${risk.allowed?.shortModeNotes?.[riskDeger[f.alan]] ?? "bu kipin açıklaması ayar ucundan okunamadı"}. Bugün: ${risk.allowed?.shortModeToday?.[riskDeger[f.alan]] ?? "bu kipin emir üretip üretmediği ayar ucundan okunamadı; ürettiği varsayılmamalı"}.` : "Bir kip seç: seçtiğin kipin ne yaptığı burada tam cümleyle yazılacak."}</p>}
                </div>))}
              <label style={{ ...kodEtiket, margin: ".6rem 0 .3rem" }}>Tek kullanımlık kod (bu ayar paranın riskini belirler, bu yüzden kod ister)
                <input value={riskTotp} onChange={(e) => setRiskTotp(e.target.value)} inputMode="numeric" maxLength={6} autoComplete="off" style={{ padding: ".3rem .5rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 5, width: "6rem" }} />
              </label>
              <button onClick={() => void riskUygula()} disabled={!riskHazir} style={{ padding: ".45rem .9rem", borderRadius: 6, border: eylemKenari(riskHazir), background: riskHazir ? "#12354f" : "#1a1a20", color: "#e8e8ea", cursor: riskHazir ? "pointer" : "not-allowed" }}>İşaretlenen alanları değiştir</button>
              {riskSonuc !== null && <p role="status" aria-live="polite" style={{ margin: ".5rem 0", lineHeight: 1.55 }}>{riskSonuc}</p>}
            </details>
            <KaldiracYuzeyi />
          </>}
        </section>
        <h2 style={{ fontSize: "1.05rem", marginTop: "1.4rem" }}>Giriş şalteri</h2>
        <GirisSalteriYuzeyi ayar={giris} yenile={load} />
        <h2 style={{ fontSize: "1.05rem", marginTop: "1.4rem" }}>Biyometrik kilit</h2>
        <KilitAyarYuzeyi ayar={kilitAyar} dogrulayiciVar={dogrulayici} yenile={kilitAyariniYenile} yer="panel" />
        <h2 style={{ fontSize: "1.05rem", marginTop: "1.4rem" }}>Bu sayfadaki rakamlar nereden geldi</h2>
        <section style={box("INFO")}>{v.sources.map((s, i) => <p key={i} style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{s}</p>)}
          <p style={{ margin: ".3rem 0", lineHeight: 1.55 }}>Sayfa {v.at.replace("T", " ").slice(0, 19)} UTC&apos;de dolduruldu. Kendiliğinden yenilenmez: aşağıdaki düğmeye bastığında kayıtlar yeniden okunur.</p>
          <button onClick={() => void load()} style={{ padding: ".45rem .9rem", borderRadius: 6, border: "1px solid #33333c", background: "#141419", color: "#e8e8ea", cursor: "pointer" }}>Kayıtları yeniden oku</button>
        </section>
      </div>
    </main>
  );
}
