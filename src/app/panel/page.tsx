"use client";
// PANEL EKRANI (G18 · Tur 26 · P-2, U-3, U-4, U-5, Ö-2 · Tur 77 G32 parça 2/2: SADE DİL + SEKMELER). Ekran KENDİ BAŞINA hiçbir sayı üretmez: sayılar uçların verdiği alanlardan gelir,
//   yalnız TEK biçimleyiciden (`@/lib/i18n/format`) geçip insan birimiyle yazılır. KULLANICI METNİNİN TEK KAYNAĞI `@/lib/i18n/en` (K-C): bu dosyada çıplak kullanıcı cümlesi YOKTUR (gate:i18n ölçer).
// Veri ÜÇ uçtan gelir: GET /api/panel (motor · son tur · sağlık · pozisyonlar · uyarılar · özet) · GET /api/brain/settings (harcama + ayar seçenekleri) · GET /api/risk/settings (Tur 37).
// SADE DİL (T3): ana görünüm (Status · Settings gövdesi · History) sözlükten ve YAPILANDIRILMIŞ alanlardan kurulur. Sunucunun kurduğu cümleler (bugün Türkçe) SİLİNMEDİ: her ayar
//   bölümünde katlanır "Technical details" ve Technical sekmesinde AYNEN durur (ölçüm ilkesi). SEKMELER (T4): Status · Settings · History · Technical; hâl `?tab=` sorgusunda (sır yok);
//   gizli sekme SÖKÜLMEZ (`hidden`), çapalar ve kanaryaların ölçtüğü öğeler DOM'da kalır. Ham kod, ham hata metni ve test verisi ekrana ÇIKMAZ (U-3, U-5).
// RİSK AYARI YÜZEYİ (Tur 37 madde 4-5): ekran ayarın TEK OKUMA YOLUNU (`/api/risk/settings`) okur; kip listesini uçtan ALIR — kip adı, kaldıraç sayısı ya da eşik SABİTİ YOKTUR (kapı: gate:ui).
//   Değiştirme yüzeyi S-8'e uyar: oturum + eylem başına TOTP; varsayılan doldurulmuş değer YOK, otomatik gönderim YOK, hiçbir alan kendiliğinden yamaya girmez.
// RİSK PAYLARI (Tur 78 · G33 · K-9, S-8, A-1/A-6): tek pozisyon payı + toplam maruziyet Settings'teki bölümden GET/POST /api/risk/shares ile okunur/yazılır (her kaydetme kod ister).
//   Alanlar BOŞ başlar, placeholder/örnek/varsayılan sayı YOKTUR (sayı sahibinindir); boş alan gönderilmez; sonuç sunucudan YENİDEN okunur. Ön koşul "First: …" bağlantısı bu bölüme gider.
// KOD ALANLARI (Tur 77, Tur 76 tam denetim notu): 6 haneli TOTP alanlarının HEPSİ `autoComplete="one-time-code"` (WHATWG'nin tek kullanımlık kod belirteci: telefonun parola yöneticisi
//   o anki kodu önerebilir; kod 30 s geçerli ve sunucu aynı kodu ikinci kez kabul etmez). SIR alanları (durdurma anahtarı, özel anahtar) `off` kalır.
import { useCallback, useEffect, useState } from "react";
import type { PanelView, Card, Level, PositionView } from "@/lib/panel";
import { DurdurFormu } from "./DurdurFormu";
import { enroll, lockGate, platformAvailable, unlock, type LockRead, type LockState } from "@/lib/lock/client";
import { dict, fill } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/format";
import { LangSelect, LANG_EVENT, useActivateLang } from "@/lib/i18n/client";

// TUR 79 (G34 · 7 dil): `T` ETKİN DİLİN sözlüğüdür ve ERİŞİM ANINDA çözülür (Panel render'ının başında useActivateLang). Bu yüzden modül düzeyinde metin DEĞERİ tutulmaz —
//   alan adları, seviye etiketleri, onay cümleleri ve durum etiketleri render sırasında sözlükten okunur (bir kez çözülen sabit dil değişince eski dilde kalırdı).
const T = dict();
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
/** Değiştirilebilir dört alan. Alan adları uçla BİREBİR aynıdır (yama bu adlarla gider); ekrandaki ad sözlükten gelir (U-3: kod adı ekranda tek başına durmaz). */
const RISK_ALANLARI = [
  { alan: "leverageCap", tip: "sayı" },
  { alan: "futuresEnabled", tip: "şalter" },
  { alan: "shortMode", tip: "kip" },
  { alan: "m2FuturesMultiple", tip: "ondalık" },
] as const;
const riskAd = (alan: (typeof RISK_ALANLARI)[number]["alan"]) => T.risk.fields[alan];
const riskAdi = (): Record<string, string> => Object.fromEntries(RISK_ALANLARI.map((f) => [f.alan, riskAd(f.alan)]));
/** Tur 78: risk payı defter alanlarının ekrandaki adı (uç alan adı → sözlük). */
const payAdi = (): Record<string, string> => ({ maxSinglePositionPct: T.prereq.names.single, maxTotalExposurePct: T.prereq.names.total });
type SharesView = { ok: boolean; shares?: { singlePositionPct: string | null; totalExposurePct: string | null }; changes?: Defter[] | null };
/** TAVAN SEÇİLMEDEN "AÇIK" SEÇENEĞİ SUNULMAZ (Tur 38 madde 2a · üretim kararı `winvestor-panel-tavansiz-acik-secenegi` = B · U-3, K-11). Etkin tavan: bu yamada tavan
 *  alanı işaretliyse yazılan değer (boş = seçimi kaldır ⇒ tavan YOK), işaretli değilse kayıtlı ayar. Bu bir YÜZEY savunmasıdır: sunucu reddi AYNEN kalır (validatePatch, 400 INVALID). */
const tavanVar = (r: RiskView, secili: Record<string, boolean>, deger: Record<string, string>) =>
  secili.leverageCap ? /^[1-9][0-9]*$/.test((deger.leverageCap ?? "").trim()) : typeof r.settings?.leverageCap === "number";
const anTr = (iso: string) => fmt.dateTime(iso);
/** Kip adının ekrandaki karşılığı: sözlükte adı yoksa kod GÖSTERİLMEZ, "adı olmayan kip" yazılır (gate:i18n sözlük ↔ kip sicili eşitliğini ölçer). */
const kipAdi = (m: string) => (T.risk.modes as Record<string, { label: string; meaning: string }>)[m]?.label ?? T.risk.modeUnknownLabel;
const kipAnlami = (m: string) => (T.risk.modes as Record<string, { label: string; meaning: string }>)[m]?.meaning ?? "";
/** Değişen bir alanın değerinin okunur hâli (defter satırı): kip kodu → kip adı, boş → "not set". */
const defterDegeri = (field: string, v: string | null) => (v === null ? T.common.nowUnset : field === "shortMode" ? kipAdi(v) : field === "futuresEnabled" ? (v === "true" ? T.common.on : T.common.off) : v);
/** Defter satırının insan cümlesi: KİM · NE ZAMAN · NEYİ (eski → yeni). Boş değer "not set" diye yazılır; ekranda çıplak boşluk kalmaz (U-3). */
// Defterdeki "by" sunucunun Türkçe kaydıdır (uçlar: "sahip · oturum + TOTP" / tighten "sahip · oturum (serbest yön…)"); ana görünüm sade adını gösterir, ham kayıt ilgili bölümün Technical details satırında kalır (Beyin/maliyet/tik: seçenekler bölümü; risk: risk bölümü).
/** Tur 79: sunucunun kaynak KODU ("ayar" · "türetildi" · "sınırsız" — sözleşme değeri) Technical details'te sade adıyla; bilinmeyen kod olduğu gibi. */
const kaynakAdi = (k: string) => (T.technical.capFrom as Record<string, string>)[k] ?? k;
const kimAdi = (by: string) => (/^sahip/.test(by) ? (/TOTP/.test(by) ? T.history.byOwnerCode : /serbest/.test(by) ? T.history.byOwnerFree : T.history.byOwner) : T.history.byOther);
const defterCumlesi = (c: Defter) => `${anTr(c.at)} · ${kimAdi(c.by)} · ${c.changes.map((x) => `${riskAdi()[x.field] ?? T.history.unknownField}: ${x.from === null ? T.common.wasUnset : defterDegeri(x.field, x.from)} → ${defterDegeri(x.field, x.to)}`).join(" · ")}`;
/** RİSK AYARININ TEKNİK SATIRLARI — YALNIZ VERİDEN (Technical details). Hiçbir satır boş hücre bırakmaz: NULL alan "NOT SET" diye ve NE ANLAMA GELDİĞİYLE yazılır (U-3).
 *  Kipin açıklaması ve BUGÜNKÜ gerçeği (emir üretip üretmediği) uçtan gelir (`shortModeNotes` · `shortModeToday`); ekran uydurmaz. */
function riskSatirlari(r: RiskView): string[] {
  const s = r.settings; if (!s) return [];
  const kipNotu = r.allowed?.shortModeNotes?.[s.shortMode], kipBugun = r.allowed?.shortModeToday?.[s.shortMode];
  return [
    s.leverageCap === null ? T.risk.leverageUnset : fill(T.risk.leverageSet, { value: s.leverageCap }),
    s.futuresEnabled ? T.risk.futuresOn : T.risk.futuresOff,
    `${fill(T.risk.modeNote, { mode: kipAdi(s.shortMode), note: kipNotu ?? T.risk.modeNoNote })} ${kipBugun ? fill(T.risk.modeToday, { today: kipBugun }) : T.risk.modeNoToday}`,
    s.m2FuturesMultiple === null ? T.risk.m2Unset : fill(T.risk.m2Set, { value: s.m2FuturesMultiple }),
    r.futures?.note ? fill(T.risk.futuresNote, { note: r.futures.note }) : fill(T.risk.futuresNoNote, { state: r.futures?.allowed ? T.risk.futuresPathOpen : T.risk.futuresPathClosed }),
    (r.changes ?? []).length === 0 ? T.risk.neverChanged : fill(T.risk.lastChange, { line: defterCumlesi((r.changes as Defter[])[0]) }),
  ];
}
/** RİSK AYARININ SADE ÖZETİ (ana görünüm): yalnız yapılandırılmış alanlardan; uçtan gelen cümleler teknik ayrıntıdadır. */
function riskOzeti(r: RiskView): string[] {
  const s = r.settings; if (!s) return [];
  return [s.leverageCap === null ? T.risk.leverageUnset : fill(T.risk.leverageSet, { value: s.leverageCap }), s.futuresEnabled ? T.risk.futuresOn : T.risk.futuresOff,
    `${fill(T.risk.mode, { label: kipAdi(s.shortMode) })} ${kipAnlami(s.shortMode)} ${T.risk.modeTodaySee}`.trim(),
    s.m2FuturesMultiple === null ? T.risk.m2Unset : fill(T.risk.m2Set, { value: s.m2FuturesMultiple }),
    fill(T.risk.futuresPath, { state: r.futures?.allowed ? T.risk.futuresPathOpen : T.risk.futuresPathClosed })];
}

// Kenar/etiket renkleri koyu zeminde OKUNABİLİR seçildi (denetçi gözü, Tur 26 madde 7): ilk seçim küçük punto için ≈ 2,7:1 kontrast veriyordu; bunlar ≥ 7:1.
const TONE: Record<Level, { bg: string; bd: string }> = {
  ALARM: { bg: "#2a0d0d", bd: "#ff8a7a" }, WARN: { bg: "#2a220d", bd: "#ffd479" },
  INFO: { bg: "#0d1c2a", bd: "#8ec9ff" }, OK: { bg: "#0d2a16", bd: "#78e0a8" },
};
// DOKUNMA HEDEFİ (Tur 77, T4): düğme ve alanlar en az 44 px (2,75 rem) yüksek — telefon parmağı için. Renk/boşluk yeni değil (TASARIM-SISTEMI §3.1/§3.3).
const DOKUN = "2.75rem";
const dugme = (etkin: boolean, vurgu = false): React.CSSProperties => ({ minHeight: DOKUN, padding: ".45rem .9rem", borderRadius: 6, border: vurgu ? eylemKenari(etkin) : "1px solid #33333c", background: vurgu ? (etkin ? "#12354f" : "#1a1a20") : "#141419", color: "#e8e8ea", cursor: etkin ? "pointer" : "not-allowed" });
const alanStili: React.CSSProperties = { minHeight: DOKUN, boxSizing: "border-box", padding: ".3rem .5rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 5, maxWidth: "100%" };
const secimEtiketi: React.CSSProperties = { display: "flex", alignItems: "center", gap: ".4rem", minHeight: DOKUN };
/** BİYOMETRİK KİLİT EKRANI (Tur 40, G20 parça 2B). K-7: durdurma bağlantısı kilitliyken de burada durur. Panel verisi kilit açılmadan OKUNMAZ. */
function KilitEkrani({ durum, not, ac, tanit, ayar, dogrulayiciVar, yenile }: { durum: LockState | "CHECKING"; not: string | null; ac: () => void; tanit: () => void; ayar: LockRead | null; dogrulayiciVar: boolean | null; yenile: () => Promise<void> }) {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", background: "#0b0b0c", color: "#e8e8ea", minHeight: "100vh", padding: "2rem 1rem" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: ".5rem" }}><h1 style={{ fontSize: "1.35rem" }}>{T.panel.title}</h1><LangSelect id="dil-kilit" /></div>
        <p style={{ margin: "0 0 .6rem" }}><a href="/durdur" style={{ color: "#ff8a7a", fontWeight: 700 }}>{T.panel.stopLink}</a> {T.panel.stopLinkHintLocked}</p>
        <p style={{ lineHeight: 1.6 }}>{durum === "CHECKING" ? T.lock.checking : T.lock.state[durum]}</p>
        {durum === "LOCKED" && <p style={{ display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
          <button onClick={ac} style={{ ...dugme(true, true) }}>{T.lock.unlock}</button>
          <button onClick={tanit} style={dugme(true)}>{T.lock.enroll}</button>
        </p>}
        {not !== null && <p role="status" aria-live="polite" style={{ lineHeight: 1.55, color: "#9a9aa2" }}>{not}</p>}
        {/* U-3 KILITLENME TUZAGI (Tur 63): ayar yuzeyi YALNIZ panelin icinde olsaydi, kilit ACIKKEN dogrulayicisi olmayan cihazda
            kullanici ne panele girebilir ne kilidi kapatabilirdi. Bu yuzden ayni yuzey BURADA da durur; korumasi TOTP'dir (S-8), kilit degil. */}
        <h2 style={{ fontSize: "1.05rem", marginTop: "1.6rem" }}>{T.lock.heading}</h2>
        <KilitAyarYuzeyi ayar={ayar} dogrulayiciVar={dogrulayiciVar} yenile={yenile} yer="kilit-ekrani" />
      </div>
    </main>
  );
}
/** Kilit ayarının ekran cümlesi (U-3): NULL süre "not set" diye ve NE ANLAMA GELDİĞİYLE yazılır. */
const kilitSatiri = (ayar: LockRead | null) => ayar === null ? T.lock.reading : !ayar.ok ? T.lock.summaryUnreadable : [ayar.enabled ? T.lock.summaryOn : T.lock.summaryOff,
  ayar.repromptSeconds === null ? T.lock.repromptNone : fill(T.lock.repromptSet, { time: insanSure(ayar.repromptSeconds) }), T.lock.stopIndependent,
  ayar.updatedAt ? fill(T.lock.updated, { at: anTr(ayar.updatedAt) }) : T.lock.updatedUnknown].join(" ");

/** Ham saniyeyi İNSAN BİRİMİNE çevirir (P-2: ham saniye tek başına bırakılmaz). Sayı ÜRETMEZ, yalnız verilen sayıyı TEK biçimleyiciden geçirir. */
export const insanSure = (sn: number): string => fmt.duration(sn * 1000);
/** KİLİT AYARINI DEĞİŞTİREN YÜZEY (Tur 63 · G20 · S-8, U-3, A-1, Ö-2). AYNI bileşen İKİ yerde: kilit ekranında (kilitlenme tuzağına karşı) ve panelde.
 *  SAYI İCAT ETMEZ: süre için hazır seçenek listesi YOKTUR ve hiçbir alan önceden doldurulmaz — `leverageCap` emsali (A-1/K-11: sayı iş sahibinindir).
 *  "AÇIK" seçeneği bu cihazda doğrulayıcı YOKKEN SUNULMAZ (U-3 · Tur 38 emsali `winvestor-panel-tavansiz-acik-secenegi`). Bu bir YÜZEY savunmasıdır:
 *  sunucu tarafı ayrıca ve bağımsız doğrular (`validateLockPatch`), yüzey kapatılsa bile geçersiz yama 400 ile reddedilir.
 *  SEÇENEK DEĞERLERİ `kilit-acik`/`kilit-kapali`dir, düz `acik`/`kapali` DEĞİL: futures şalteri aynı dosyada `acik` değerini kullanıyor ve `gate:ui`nin Tur 38 kuralı
 *  (`risk-open-option-without-cap`) o değeri dosya genelinde arıyor. Değerleri ayırmak o kuralın alfabesini (1 aday) ve katılığını AYNEN korur — kural gevşetilmedi. */
// ---- GİRİŞ ŞALTERİ (Tur 64 · G28 kutu 4 · K-2, S-8, Ö-2, U-3) ----
// AÇMA ONAYI: onaylı uyarı metninin 2. maddesi ve 3. maddesinin tek cümlesi, onay kutusuyla birlikte, HER AÇMADA gösterilir.
// KAPATMADA onay kutusu YOKTUR: kapatma para hareketini DURDURAN yöndedir ve geciktirilmez (K-7'nin ruhu).
// METNİN TEK KAYNAĞI `scripts/lib/disclaimer.mjs`tir (onaylı EN hâli, 20 Eyl); sözlük (`T.entry.consent`) onu AYNEN taşır, kapı (`gate:ui`) eşitliği ölçer — bir kelime saparsa KIRMIZI.
const kalinsiz = (t: string) => t.replace(/\*\*/g, "");

const girisSatiri = (e: EntryView | null) => !e?.ok
  ? `${T.entry.unreadable}${e?.detail ? ` ${fill(T.common.serverSaid, { why: e.detail })}` : ""}`
  : [e.enabled ? T.entry.on : T.entry.off, T.entry.independent, e.updatedAt ? fill(T.entry.updated, { at: anTr(e.updatedAt) }) : T.entry.updatedUnknown].join(" ");
/** Ret cümlesi: ortak sözlükten (403 metni bölüme özgü). Sunucunun `errors` dizisi SEBEP olarak eklenir (ham kod değil, doğrulayıcının cümlesi). */
const sonucMetni = (status: number, niye: string, ret403: string) =>
  status === 403 ? ret403 : status === 401 ? T.common.sessionLost : status === 423 ? T.common.locked
    : status === 400 ? fill(T.common.invalidValue, { why: niye ? fill(T.common.serverSaid, { why: niye }) : "" })
    : status === 409 ? fill(T.common.noRow, { why: niye ? fill(T.common.serverSaid, { why: niye }) : "" })
    : status === 503 ? fill(T.common.storeDown, { why: niye ? fill(T.common.serverSaid, { why: niye }) : "" })
    : fill(T.common.unexpected, { why: niye ? fill(T.common.serverSaid, { why: niye }) : "" });

function GirisSalteriYuzeyi({ ayar, yenile }: { ayar: EntryView | null; yenile: () => Promise<void> }) {
  const GIRIS_ONAY_UYARI = T.entry.consent.warning;
  const GIRIS_ONAY_RISK = T.entry.consent.risk;
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
    catch { setSonuc(T.common.unreachable); return; }
    const b = (await r.json().catch(() => ({}))) as { ok?: boolean; applied?: { field: string; from: string; to: string }[]; errors?: string[] };
    const niye = (b.errors ?? []).join(" · "), oku = (s: string) => (s === "true" ? T.common.on : T.common.off);
    setSonuc(r.ok && b.ok ? fill(T.entry.applied, { changes: (b.applied ?? []).map((c) => `${oku(c.from)} → ${oku(c.to)}`).join(", ") || T.common.noFieldChanged }) : sonucMetni(r.status, niye, T.entry.rejected403));
    setTotp(""); setSecili(false); setDeger(""); setOnay(false); await yenile();
  };
  return (
    <section style={box(!ayar?.ok || ayar.enabled ? "WARN" : "INFO")} aria-label={T.entry.heading}>
      <p style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{girisSatiri(ayar)}</p>
      {ayar?.ok && <p style={{ display: "flex", alignItems: "center", gap: ".7rem", flexWrap: "wrap", margin: ".6rem 0 .2rem" }}>
        <button id="giris-anahtar" type="button" role="switch" aria-checked={!!ayar.enabled} aria-label={T.entry.toggleAria} onClick={() => { if (secili) { setSecili(false); setDeger(""); setOnay(false); setTotp(""); } else { setSonuc(null); setSecili(true); setDeger(ayar.enabled ? "giris-kapali" : "giris-acik"); setOnay(false); } }}
          style={{ position: "relative", width: "3.4rem", height: DOKUN, borderRadius: "1.4rem", border: `1px solid ${ayar.enabled ? "#78e0a8" : "#6b6b73"}`, background: ayar.enabled ? "#0d2a16" : "#141419", cursor: "pointer", padding: 0 }}>
          <span aria-hidden="true" style={{ position: "absolute", top: ".6rem", left: ayar.enabled ? "1.7rem" : ".2rem", width: "1.4rem", height: "1.4rem", borderRadius: "50%", background: ayar.enabled ? "#78e0a8" : "#b4b4bb" }} /></button>
        <span><strong>{ayar.enabled ? T.common.on : T.common.off}</strong> {T.entry.toggleHint}</span></p>}
      {secili && (<div>
        <p style={{ margin: ".4rem 0", lineHeight: 1.55, color: "#9a9aa2" }}>{T.entry.scope}</p>
        <div style={{ borderTop: "1px solid #23232a", padding: ".5rem 0" }}>
          <p style={{ margin: ".2rem 0", lineHeight: 1.5 }}>{fill(T.entry.newValue, { value: deger === "giris-acik" ? T.common.on : T.common.off })}</p>
          {secili && deger === "giris-kapali" && <p style={{ margin: ".35rem 0 0", lineHeight: 1.5, color: "#9a9aa2" }}>{T.entry.offNote}</p>}
          {acmaDenemesi && <div style={{ ...box("WARN"), margin: ".5rem 0 0" }}>
            <p style={{ margin: ".2rem 0 .5rem", lineHeight: 1.55, fontWeight: 600 }}>{T.entry.readFirst}</p>
            <p style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{kalinsiz(GIRIS_ONAY_UYARI)}</p>
            <p style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{GIRIS_ONAY_RISK}</p>
            <label style={{ ...secimEtiketi, marginTop: ".5rem" }}>
              <input type="checkbox" checked={onay} onChange={(e) => setOnay(e.target.checked)} aria-label={T.entry.consentAria} />
              <span>{T.entry.consentLabel}</span>
            </label>
          </div>}
        </div>
        <label style={{ display: "block", margin: ".5rem 0" }}>
          <span style={{ display: "block", marginBottom: ".2rem", color: "#9a9aa2" }}>{T.common.codeLabel}</span>
          <input id="giris-kod" value={totp} onChange={(e) => setTotp(e.target.value)} inputMode="numeric" maxLength={6} autoComplete="one-time-code" aria-label={T.entry.codeAria} style={{ ...alanStili, width: "7rem" }} />
        </label>
        <button onClick={() => void uygula()} disabled={!hazir} style={dugme(hazir, true)}>{T.entry.apply}</button>
      </div>)}
      {sonuc !== null && <p role="status" aria-live="polite" style={{ margin: ".5rem 0", lineHeight: 1.55 }}>{sonuc}</p>}
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
    catch { setSonuc(T.common.unreachable); return; }
    const b = (await r.json().catch(() => ({}))) as { ok?: boolean; applied?: { field: string; from: string | null; to: string | null }[]; errors?: string[] };
    const niye = (b.errors ?? []).join(" · "), adi = T.lock.fieldNames as Record<string, string>;
    setSonuc(r.ok && b.ok ? fill(T.lock.applied, { changes: (b.applied ?? []).map((c) => `${adi[c.field] ?? T.history.unknownField} ${c.from ?? T.common.wasUnset} → ${c.to ?? T.common.nowUnset}`).join(", ") || T.common.noFieldChanged }) : sonucMetni(r.status, niye, T.lock.rejected403));
    setTotp(""); setKilitSecili(false); setSureSecili(false); setKilitDeger(""); setSureDeger(""); await yenile();
  };
  return (
    <section style={box(ayar?.ok ? "INFO" : "WARN")} aria-label={yer === "panel" ? T.lock.heading : `${T.lock.heading} — ${T.lock.onLockScreen}`}>
      <p style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{kilitSatiri(ayar)}</p>
      <p style={{ margin: ".3rem 0", lineHeight: 1.55, color: "#9a9aa2" }}>
        {dogrulayiciVar === null ? T.lock.authUnmeasured : dogrulayiciVar ? T.lock.authYes : T.lock.authNo}
      </p>
      {/* Tur 79 (S5): ayar OKUNMADAN (null) değiştirme formu ve "off/on" seçenekleri GÖSTERİLMEZ — üstteki satır "Reading …" der. */}
      {ayar !== null && <details style={{ marginTop: ".6rem" }}>
        <summary style={{ cursor: "pointer", minHeight: DOKUN, display: "flex", alignItems: "center" }}>{T.lock.change}</summary>
        <p style={{ margin: ".4rem 0", lineHeight: 1.55, color: "#9a9aa2" }}>{T.lock.changeHelp}</p>
        <div style={{ borderTop: "1px solid #23232a", padding: ".5rem 0" }}>
          <label style={secimEtiketi}>
            <input type="checkbox" checked={kilitSecili} onChange={(e) => { setKilitSecili(e.target.checked); if (!e.target.checked) setKilitDeger(""); }} aria-label={T.lock.fieldLockAria} />
            <span>{T.lock.fieldLock}</span>
          </label>
          {kilitSecili && <label htmlFor={`kilit-deger-${yer}`} style={{ display: "block", margin: ".35rem 0 .2rem", color: "#9a9aa2" }}>{T.lock.fieldLockNew}</label>}
          {kilitSecili && <select id={`kilit-deger-${yer}`} value={kilitDeger} onChange={(e) => setKilitDeger(e.target.value)} style={alanStili}>
            <option value="">{T.common.choose}</option>
            <option value="kilit-kapali">{T.common.off}</option>
            {dogrulayiciVar && <option value="kilit-acik">{T.common.on}</option>}
          </select>}
          {kilitSecili && kilitDeger === "kilit-acik" && <p style={{ margin: ".35rem 0 0", lineHeight: 1.5, color: "#9a9aa2" }}>{T.lock.noteOn}</p>}
          {kilitSecili && kilitDeger === "kilit-kapali" && <p style={{ margin: ".35rem 0 0", lineHeight: 1.5, color: "#9a9aa2" }}>{T.lock.noteOff}</p>}
          {kilitSecili && dogrulayiciVar === false && <p style={{ margin: ".35rem 0 0", lineHeight: 1.5, color: "#9a9aa2" }}>{T.lock.noteNoOn}</p>}
        </div>
        <div style={{ borderTop: "1px solid #23232a", padding: ".5rem 0" }}>
          <label style={secimEtiketi}>
            <input type="checkbox" checked={sureSecili} onChange={(e) => { setSureSecili(e.target.checked); if (!e.target.checked) setSureDeger(""); }} aria-label={T.lock.fieldTimeAria} />
            <span>{T.lock.fieldTime}</span>
          </label>
          {sureSecili && <label htmlFor={`sure-deger-${yer}`} style={{ display: "block", margin: ".35rem 0 .2rem", color: "#9a9aa2" }}>{T.lock.fieldTimeNew}</label>}
          {sureSecili && <input id={`sure-deger-${yer}`} value={sureDeger} onChange={(e) => setSureDeger(e.target.value)} inputMode="numeric" autoComplete="off" style={{ ...alanStili, width: "8rem" }} />}
          {sureSecili && <p style={{ margin: ".35rem 0 0", lineHeight: 1.5, color: sureGecerli ? "#9a9aa2" : TONE.WARN.bd }}>
            {sureDeger.trim() === "" ? T.lock.timeEmpty : !sureGecerli ? T.lock.timeInvalid : fill(T.lock.timeOk, { time: insanSure(sureSayi as number), seconds: sureSayi })}
          </p>}
        </div>
        {(kilitSecili || sureSecili) && <label style={{ ...kodEtiket, margin: ".6rem 0 .3rem" }}>{T.lock.codeLabel}
          <input value={totp} onChange={(e) => setTotp(e.target.value)} inputMode="numeric" maxLength={6} autoComplete="one-time-code" style={{ ...alanStili, width: "7rem" }} />
        </label>}
        <button onClick={() => void uygula()} disabled={!hazir} style={dugme(hazir, true)}>{T.lock.apply}</button>
        {sonuc !== null && <p role="status" aria-live="polite" style={{ margin: ".5rem 0", lineHeight: 1.55 }}>{sonuc}</p>}
      </details>}
    </section>
  );
}

/** Seçenek satırının yazma gövdesi (model · aralık) — Tur 66 · 1d: kodsuz ve kodlu yol AYNI gövdeyi gönderir. */
const secimGovdesi = (model: string, ms: string) => JSON.stringify({ model, callIntervalMs: Number(ms) });
/** Tur 67: tik aralığı yaması (seçilen seçeneğin değeri; sayı ekranda üretilmez). Modül düzeyinde: gate:ui (6) ok gövdesindeki JSON.stringify'ı ekrana basılan ifade sanar (Tur 66 dersi). */
const tikGovdesi = (ms: string) => JSON.stringify({ tickMs: Number(ms) });
// Tur 46 madde 3 (ÖLÇÜLDÜ: 390 px'te kod alanı alt satıra geçince etiketin 8 px İÇİNDEN başlıyordu; devre dışı eylem düğmesi etkin kenarını koruyordu). Yeni değer YOK:
//   boşluk .5rem/.3rem ve kenar #2b7fc9 (etkin) / #33333c (panel alan/düğme kenarı) TASARIM-SISTEMI §3.1/§3.3/§5'teki mevcut değerlerdir.
const kodEtiket: React.CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: ".5rem", rowGap: ".3rem" };
function eylemKenari(etkin: boolean) { return `1px solid ${etkin ? "#2b7fc9" : "#33333c"}`; }
/** G32: kontrol bölümünün "ne yapar" cümlesi — tek stil, ikincil metin rengi (#b4b4bb, TASARIM-SISTEMI ikincil metin). */
const NE: React.CSSProperties = { margin: ".1rem 0 .4rem", lineHeight: 1.5, color: "#b4b4bb" };
function box(level: Level): React.CSSProperties { return { background: TONE[level].bg, border: `1px solid ${TONE[level].bd}`, borderRadius: 8, padding: "0.9rem 1.1rem", margin: "0.6rem 0" }; }

function CardBlock({ c, head }: { c: Card; head?: string }) {
  return (
    <section style={box(c.level)} aria-label={`${head ?? ""} ${c.title}`.trim()}>
      <h3 style={{ margin: "0 0 .45rem", fontSize: "1rem" }}><span style={{ fontSize: ".72rem", letterSpacing: ".08em", color: TONE[c.level].bd, marginRight: ".5rem" }}>{T.technical.levels[c.level]}</span>{c.title}</h3>
      {c.lines.map((l, i) => <p key={i} style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{l}</p>)}
    </section>
  );
}
/** KATLANIR TEKNİK AYRINTI (Tur 77, T3): sunucunun kendi cümleleri ve ölçüm ayrıntısı BURADA durur — silinmez, ana görünümden kalkar. */
function TeknikAyrinti({ satirlar, children }: { satirlar?: (string | null | undefined)[]; children?: React.ReactNode }) {
  const dolu = (satirlar ?? []).filter((x): x is string => typeof x === "string" && x.trim() !== "");
  return (<details data-teknik style={{ marginTop: ".6rem" }}><summary style={{ cursor: "pointer", color: "#9a9aa2", minHeight: DOKUN, display: "flex", alignItems: "center" }}>{T.common.technicalDetails}</summary>
    <p style={{ margin: ".3rem 0", lineHeight: 1.5, color: "#9a9aa2", fontSize: ".9rem" }}>{T.common.technicalDetailsNote}</p>
    {dolu.map((l, i) => <p key={i} style={{ margin: ".3rem 0", lineHeight: 1.55, fontSize: ".92rem" }}>{l}</p>)}{children}</details>);
}

/** KALDIRAÇ İSTEĞİ (Tur 44 · G21 kalemi i · K-11, S-8, U-4). Önizleme `GET /api/risk/leverage` (oturum) komisyon VE funding yükünü SAYI + BİRİMLE ucun cümlesinden gösterir;
 *  ölçülemeyen yük için sayı YOK, sebep var (U-3: "0" yazılmaz). İstek `POST` eylem başına kod ister. Varsayılan doldurulmuş değer YOK, otomatik gönderim YOK; yazılım kaldıraç sayısı SEÇMEZ. */
type LevOut = { refusal?: string; text?: string; cap?: number | null; load?: { funding: { sentence: string }; commission: { sentence: string } } | null; reason?: string };
function KaldiracYuzeyi({ pasif }: { pasif: boolean }) {
  const [sym, setSym] = useState(""), [lev, setLev] = useState(""), [kod, setKod] = useState(""), [out, setOut] = useState<LevOut | null>(null), [hata, setHata] = useState<string | null>(null);
  const hazir = /^[A-Z0-9]{2,20}$/.test(sym) && /^[1-9][0-9]{0,3}$/.test(lev), istek = hazir && !pasif && kod.length === 6;
  const gonder = async (post: boolean) => {
    setHata(null); setOut(null);
    try { const r = post ? await fetch("/api/risk/leverage", { method: "POST", headers: { "content-type": "application/json", "x-totp-code": kod }, body: JSON.stringify({ symbol: sym, leverage: Number(lev) }) })
        : await fetch("/api/risk/leverage?" + new URLSearchParams({ symbol: sym, leverage: lev }).toString(), { cache: "no-store" });
      const j = (await r.json()) as LevOut; if (post) setKod("");
      if (r.status === 401 || r.status === 403 || r.status === 423) setHata(T.leverage.refused);
      else setOut(j); } catch { setHata(T.leverage.unreachable); } };
  const sonucCumlesi = out?.text ? fill(T.leverage.serverNote, { note: out.text }) : T.leverage.noSentence;
  return (<details style={{ marginTop: ".6rem" }}><summary style={{ cursor: "pointer", minHeight: DOKUN, display: "flex", alignItems: "center" }}>{T.leverage.summary}</summary>
    <p style={{ margin: ".4rem 0", lineHeight: 1.5, color: "#9a9aa2" }}>{T.leverage.help}</p>
    <label style={{ ...secimEtiketi, margin: ".3rem 0" }}>{T.leverage.symbol} <input value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} autoComplete="off" style={{ ...alanStili, width: "8rem" }} /></label>
    <label style={{ ...secimEtiketi, margin: ".3rem 0" }}>{T.leverage.times} <input value={lev} onChange={(e) => setLev(e.target.value)} inputMode="numeric" autoComplete="off" style={{ ...alanStili, width: "5rem" }} /></label>
    <button onClick={() => void gonder(false)} disabled={!hazir} style={{ ...dugme(hazir), marginRight: ".5rem" }}>{T.leverage.preview}</button>
    {pasif ? <p data-kaldirac-pasif style={{ margin: ".6rem 0", lineHeight: 1.5, color: "#9a9aa2" }}>{T.leverage.passive}</p>
      : hazir && <label style={{ ...kodEtiket, margin: ".6rem 0 .3rem" }}>{T.leverage.codeLabel}
      <input value={kod} onChange={(e) => setKod(e.target.value)} inputMode="numeric" maxLength={6} autoComplete="one-time-code" style={{ ...alanStili, width: "7rem" }} /></label>}
    <button onClick={() => void gonder(true)} disabled={!istek} style={dugme(istek, true)}>{T.leverage.send}</button>
    {hata !== null && <p role="status" aria-live="polite" style={{ margin: ".5rem 0", lineHeight: 1.55 }}>{hata}</p>}
    {out !== null && <div role="status" aria-live="polite">
      <p style={{ margin: ".5rem 0", lineHeight: 1.55 }}>{sonucCumlesi}</p>
      {out.load ? <><p style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{out.load.commission.sentence}</p><p style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{out.load.funding.sentence}</p></>
        : <p style={{ margin: ".3rem 0", lineHeight: 1.55, color: "#9a9aa2" }}>{T.leverage.notMeasured}</p>}
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
    setSonuc(r === null ? { ton: "WARN", metin: T.login.unreachable }
      : r.status === 401 ? { ton: "WARN", metin: T.login.wrong }
      : r.status === 423 ? { ton: "ALARM", metin: fill(T.login.locked, { minutes: GIRIS_KILIT_DK }) }
      : r.status === 503 ? { ton: "WARN", metin: T.login.unavailable }
      : { ton: "WARN", metin: T.login.failed });
  };
  return (
    <form method="post" onSubmit={(e) => void gonder(e)} aria-label={T.login.form} style={{ marginTop: "1rem", maxWidth: 360 }}>
      <label htmlFor="giris-parola" style={{ display: "block", marginBottom: ".3rem", color: "#9a9aa2" }}>{T.login.password}</label>
      <input id="giris-parola" type="password" autoComplete="current-password" required disabled={gonderiliyor} value={parola} onChange={(e) => setParola(e.target.value)} style={{ display: "block", width: "100%", minHeight: DOKUN, boxSizing: "border-box", padding: ".7rem .8rem", fontSize: "1rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 6 }} />
      <button id="giris-gonder" type="submit" disabled={!hazir} style={{ ...dugme(hazir, true), marginTop: ".8rem" }}>{gonderiliyor ? T.login.submitting : T.login.submit}</button>
      <div id="giris-sonuc" role="alert">{sonuc !== null && <p style={{ ...box(sonuc.ton), lineHeight: 1.55 }}>{sonuc.metin}</p>}</div>
      {not !== null && <p role="status" style={{ margin: ".6rem 0", lineHeight: 1.55, color: "#9a9aa2" }}>{not}</p>}
    </form>
  );
}

/** BINANCE ANAHTARI BÖLÜMÜ (G31 · Tur 75 · güvenlik yüzeyi ANAHTAR/PARA; P-1, S-1, S-2, S-6, S-8, U-3). YALNIZ mevcut `POST /api/exchange-key` ucuna gönderir — uç davranışı DEĞİŞMEDİ
 *  (oturum + eylem başına kod; Binance'ten izin okuma; çekim ya da evrensel transfer açıksa ret; şifreleyerek kayıt). Ana görünüm yalnız "anahtar var mı" der (yapılandırılmış `present`);
 *  ucun GET'inin kurduğu durum satırları (`lines`: izinler, 30 gün sayacı) katlanır teknik ayrıntıda AYNEN durur; ekran hesap yapmaz.
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
    const kalan = { notSaved: T.key.notSaved };
    setSonuc(r === null ? { ton: "WARN", metin: T.key.unreachable }
      : r.ok && b.ok ? { ton: "OK", metin: fill(T.key.ok, { spot: b.restrictions?.enableSpotAndMarginTrading ? T.common.on : T.common.off, futures: b.restrictions?.enableFutures ? T.common.on : T.common.off }) }
      : r.status === 401 ? { ton: "WARN", metin: fill(T.key.session, kalan) }
      : r.status === 403 ? { ton: "WARN", metin: fill(T.key.code, kalan) }
      : r.status === 423 ? { ton: "ALARM", metin: fill(T.key.locked, kalan) }
      : b.reason === "P1_WITHDRAWALS" ? { ton: "ALARM", metin: fill(T.key.withdrawals, kalan) }
      : b.reason === "P1_UNIVERSAL_TRANSFER" ? { ton: "ALARM", metin: fill(T.key.transfer, kalan) }
      : b.reason === "READ_DISABLED" ? { ton: "WARN", metin: fill(T.key.readDisabled, kalan) }
      : b.reason === "PRIVATE_KEY_NOT_ED25519" || b.reason === "KEY_TYPE_NOT_ED25519" ? { ton: "WARN", metin: fill(T.key.notEd25519, kalan) }
      : b.reason === "BAD_INPUT" ? { ton: "WARN", metin: fill(T.key.badInput, kalan) }
      : r.status === 503 || r.status === 502 ? { ton: "WARN", metin: fill(T.key.binanceDown, kalan) }
      : { ton: "WARN", metin: T.key.unexpected });
    await yenile();
  };
  const alan = { display: "block", width: "100%", minHeight: DOKUN, boxSizing: "border-box", padding: ".7rem .8rem", fontSize: "1rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 6 } as const;
  const ozet = !durum?.ok ? T.key.statusUnreadable : durum.present ? T.key.statusPresent : T.key.statusAbsent;
  return (
    <section id="anahtar-bolumu" style={box(!durum?.ok ? "WARN" : durum.present ? "INFO" : "WARN")} aria-label={T.key.heading}>
      <p id="anahtar-ozet" style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{ozet}</p>
      <details data-teknik style={{ marginTop: ".6rem" }}><summary style={{ cursor: "pointer", color: "#9a9aa2", minHeight: DOKUN, display: "flex", alignItems: "center" }}>{T.common.technicalDetails}</summary>
        <p style={{ margin: ".3rem 0", lineHeight: 1.5, color: "#9a9aa2", fontSize: ".9rem" }}>{T.common.technicalDetailsNote}</p>
        <div id="anahtar-durum">{(durum?.lines ?? [T.key.statusUnreadable]).map((l, i) => <p key={i} style={{ margin: ".3rem 0", lineHeight: 1.55, fontSize: ".92rem" }}>{l}</p>)}</div>
      </details>
      <details id="anahtar-detay" style={{ marginTop: ".6rem" }}>
        <summary style={{ cursor: "pointer", minHeight: DOKUN, display: "flex", alignItems: "center" }}>{durum?.present ? T.key.replace : T.key.add}</summary>
        <div style={{ margin: ".5rem 0", lineHeight: 1.55, color: "#9a9aa2" }}>
          <p style={{ margin: ".3rem 0" }}>{T.key.howTo}</p>
          <p style={{ margin: ".3rem 0" }}>{T.key.permissions}</p>
          <p style={{ margin: ".3rem 0" }}>{T.key.ip}</p>
          <p style={{ margin: ".3rem 0" }}>{T.key.newest}</p>
        </div>
        <form method="post" onSubmit={(e) => void gonder(e)} aria-label={T.key.form} style={{ maxWidth: 520 }}>
          <label htmlFor="anahtar-ad" style={{ display: "block", margin: ".5rem 0 .3rem", color: "#9a9aa2" }}>{T.key.fieldName}</label>
          <input id="anahtar-ad" value={ad} onChange={(e) => setAd(e.target.value)} maxLength={64} autoComplete="off" spellCheck={false} disabled={gonderiliyor} style={alan} />
          <label htmlFor="anahtar-api" style={{ display: "block", margin: ".7rem 0 .3rem", color: "#9a9aa2" }}>{T.key.fieldApiKey}</label>
          <input id="anahtar-api" value={apiAnahtari} onChange={(e) => setApiAnahtari(e.target.value)} maxLength={256} autoComplete="off" spellCheck={false} disabled={gonderiliyor} style={alan} />
          <label htmlFor="anahtar-ozel" style={{ display: "block", margin: ".7rem 0 .3rem", color: "#9a9aa2" }}>{T.key.fieldPrivate}</label>
          <input id="anahtar-ozel" type="password" value={ozel} onChange={(e) => setOzel(e.target.value)} autoComplete="off" spellCheck={false} disabled={gonderiliyor} style={alan} />
          <label htmlFor="anahtar-kod" style={{ display: "block", margin: ".7rem 0 .3rem", color: "#9a9aa2" }}>{T.common.codeLabel}</label>
          <input id="anahtar-kod" value={kod} onChange={(e) => setKod(e.target.value)} inputMode="numeric" maxLength={6} autoComplete="one-time-code" disabled={gonderiliyor} style={{ ...alan, width: "8rem" }} />
          <button id="anahtar-gonder" type="submit" disabled={!hazir} style={{ ...dugme(hazir, true), marginTop: ".8rem" }}>{gonderiliyor ? T.key.submitting : T.key.submit}</button>
        </form>
        <div id="anahtar-sonuc" role="status" aria-live="polite">{sonuc !== null && <p style={{ ...box(sonuc.ton), lineHeight: 1.55 }}>{sonuc.metin}</p>}</div>
      </details>
    </section>
  );
}

// ---- G32 (Tur 76 · ek madde 3 · güvenlik yüzeyi PARA/KİMLİK; K-7, S-8, U-3, Ö-2) — MOTOR DURUM KARTI + BAŞLAT/DURDUR + ÖN KOŞUL LİSTESİ ----
// HÂL SUNUCUDAN: `view.engineState` (readPanel, izin kopyasının salt okuması). Kart başlık/cümle ayrıştırmaz, hâl TAHMİN ETMEZ; BAŞLAT/DURDUR sonrası hâl YENİDEN OKUNUR.
// BAŞLAT = mevcut `POST /api/engine/resume` (gövdesiz, oturum + `x-totp-code`); kod kutusu YALNIZ düğmeye basınca açılır. DURDUR = ayrı dosyadaki DurdurFormu (gate:stop-service durdurma ekranı kurallarıyla ölçülür) → mevcut `POST /api/engine/stop` (uç sözleşmesi:
//   `x-stop-key` + `{mode}`; oturum/kod İSTEMEZ; iki seçenekten biri varsayılan DEĞİL). `/durdur` sayfası panelden bağımsızdır ve bağlantısı kartta durur (K-7).
// ÖN KOŞUL LİSTESİ İSTEMCİDE GÜVENLİK DEĞİLDİR: BAŞLAT düğmesini gizler ve "önce şunu yap" bağlantısı verir; sunucunun reddi (409 TICK_UNSET vb.) AYNEN kalır.
type EngineState = PanelView["engineState"];
const DURUM_TONU: Record<EngineState, Level> = { RUNNING: "OK", STOPPED: "WARN", NO_PERMIT: "WARN", UNKNOWN: "ALARM" };
const durumEtiketi = (h: EngineState): { ad: string; ton: Level; cumle: string } => ({ ad: T.engine.state[h].name, ton: DURUM_TONU[h], cumle: T.engine.state[h].text });
type Kosul = { k: string; durum: "tamam" | "eksik" | "bilinmiyor" | "bilgi"; cumle: string; href?: string; bag?: string };
const yuzde = (v: string) => fmt.pct(v);
/** ÖN KOŞULLAR (ek madde 3 + GK EK). Engelleyen: anahtar · tik · tavan · altyapı · tek pay · toplam maruziyet. Bilgi: giriş şalteri · sermaye. Okunamayan satır "bilinmiyor" (var sayılmaz). */
function onKosullar(a: { anahtar: KeyView | null; settings: Settings | null; giris: EntryView | null; view: PanelView }): Kosul[] {
  const s = a.settings, cc = s?.ok ? s.costCap : undefined, tv = s?.ok ? s.tickView : undefined, rc = a.view.riskCaps, cap = a.view.capital, P = T.prereq, N = P.names;
  const oku = (k: string, ad: string, href: string): Kosul => ({ k, durum: "bilinmiyor", cumle: fill(P.unreadable, { name: ad }), href, bag: fill(P.goTo, { name: ad }) });
  const rows: Kosul[] = [];
  rows.push(!a.anahtar?.ok ? oku("anahtar", N.key, "#anahtar-bolumu")
    : a.anahtar.present ? { k: "anahtar", durum: "tamam", cumle: P.keyOk }
    : { k: "anahtar", durum: "eksik", cumle: P.keyMissing, href: "#anahtar-bolumu", bag: P.keyFix });
  rows.push(!tv ? oku("tik", N.tick, "#tik-araligi")
    : tv.tickMs !== null ? { k: "tik", durum: "tamam", cumle: fill(P.tickOk, { every: fmt.every(tv.tickMs) }) }
    : { k: "tik", durum: "eksik", cumle: P.tickMissing, href: "#tik-araligi", bag: P.tickFix });
  if (!cc) { rows.push(oku("tavan", N.cap, "#maliyet-tavani"), oku("altyapi", N.infra, "#maliyet-tavani")); }
  else { const tavanEksik = cc.totalUsd === null && cc.brainMonthlyUsd === null && cc.behavior === "BRAIN_OFF", altyapiEksik = cc.infraUsd === null && cc.brainMonthlyUsd === null && !(cc.behavior === "NO_LIMIT" && cc.totalUsd === null);
    const baskaSebep = !!s?.capEmpty && !tavanEksik && !altyapiEksik;
    rows.push(tavanEksik || baskaSebep ? { k: "tavan", durum: "eksik", cumle: P.capOffNow, href: "#maliyet-tavani", bag: P.capFix }
      : { k: "tavan", durum: "tamam", cumle: cc.totalUsd === null ? (cc.behavior === "NO_LIMIT" ? P.capOkNoLimit : P.capOkBrain) : fill(P.capOkTotal, { amount: fmt.usdMonth(cc.totalUsd) }) });
    rows.push(altyapiEksik ? { k: "altyapi", durum: "eksik", cumle: P.infraMissing, href: "#maliyet-tavani", bag: P.infraFix }
      : { k: "altyapi", durum: "tamam", cumle: cc.infraUsd === null ? P.infraNotNeeded : fill(P.infraOk, { amount: fmt.usdMonth(cc.infraUsd) }) }); }
  const pay = (k: string, ad: string, v: string | null | undefined, duzelt: string): Kosul => !rc.ok ? oku(k, ad, "#risk-paylari")
    : v !== null && v !== undefined ? { k, durum: "tamam", cumle: fill(P.shareOk, { name: ad, value: yuzde(v) }) }
    : { k, durum: "eksik", cumle: fill(P.shareMissing, { name: ad }), href: "#risk-paylari", bag: duzelt };
  rows.push(pay("tek-pay", N.single, rc.ok ? rc.singlePct : null, P.singleFix), pay("toplam-pay", N.total, rc.ok ? rc.totalPct : null, P.totalFix));
  rows.push(!a.giris?.ok ? { k: "giris", durum: "bilgi", cumle: P.entryUnreadable, href: "#giris-salteri", bag: fill(P.goTo, { name: N.entry }) }
    : a.giris.enabled ? { k: "giris", durum: "bilgi", cumle: P.entryOn, href: "#giris-salteri", bag: fill(P.goTo, { name: N.entry }) }
    : { k: "giris", durum: "bilgi", cumle: P.entryOff, href: "#giris-salteri", bag: fill(P.goTo, { name: N.entry }) });
  rows.push(!cap.ok ? { k: "sermaye", durum: "bilgi", cumle: P.capitalUnreadable }
    : cap.capital === null ? { k: "sermaye", durum: "bilgi", cumle: P.capitalNone }
    : { k: "sermaye", durum: "bilgi", cumle: fill(P.capitalSome, { amount: cap.quoteAsset === "USDT" || cap.quoteAsset === null ? fmt.usdt(cap.capital) : `${fmt.usdt(cap.capital).replace(/ USDT$/, "")} ${cap.quoteAsset}`, date: cap.periodStart ? fmt.date(cap.periodStart) : P.capitalDateUnknown }) });
  return rows;
}
const KOSUL_ISARETI: Record<Kosul["durum"], { im: string; renk: string }> = { tamam: { im: "✓", renk: "#78e0a8" }, eksik: { im: "✗", renk: "#ff8a7a" }, bilinmiyor: { im: "?", renk: "#ffd479" }, bilgi: { im: "•", renk: "#8ec9ff" } };
function MotorDurumKarti({ view, kosullar, yenile, capayaGit }: { view: PanelView; kosullar: Kosul[]; yenile: () => Promise<void>; capayaGit: (id: string) => void }) {
  const hal: EngineState = view.engineState; // hâl SUNUCUDAN (readPanel); kart başlık/cümle ayrıştırmaz
  const [baslatAcik, setBaslatAcik] = useState(false);
  const [baslatKod, setBaslatKod] = useState("");
  const [durdurAcik, setDurdurAcik] = useState(false);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [sonuc, setSonuc] = useState<{ ton: Level; metin: string } | null>(null);
  const e = durumEtiketi(hal), engel = kosullar.filter((k) => k.durum === "eksik" || k.durum === "bilinmiyor"), E = T.engine;
  const durmus = hal === "STOPPED" || hal === "NO_PERMIT", baslatilabilir = durmus && engel.length === 0, durdurulabilir = hal === "RUNNING" || hal === "UNKNOWN";
  const baslat = async () => {
    if (!/^\d{6}$/.test(baslatKod) || gonderiliyor) return;
    setGonderiliyor(true); setSonuc(null); let r: Response | null = null;
    try { r = await fetch("/api/engine/resume", { method: "POST", headers: { "x-totp-code": baslatKod }, cache: "no-store" }); } catch { r = null; }
    setBaslatKod(""); setGonderiliyor(false);
    const b = r ? ((await r.json().catch(() => ({}))) as { ok?: boolean; flag?: { permitUntil?: string | null } }) : {};
    setSonuc(r === null ? { ton: "WARN", metin: E.startUnreachable }
      : r.ok && b.ok ? { ton: "OK", metin: fill(E.started, { until: b.flag?.permitUntil ? anTr(b.flag.permitUntil) : E.startedUntilUnknown }) }
      : r.status === 409 ? { ton: "WARN", metin: E.notStartedTick }
      : r.status === 403 ? { ton: "WARN", metin: E.notStartedCode }
      : r.status === 401 ? { ton: "WARN", metin: E.notStartedSession }
      : r.status === 423 ? { ton: "ALARM", metin: E.notStartedLocked }
      : r.status === 503 ? { ton: "WARN", metin: E.notStartedStore }
      : { ton: "WARN", metin: E.startUnexpected });
    if (r?.ok && b.ok) setBaslatAcik(false);
    await yenile();
  };
  const buyuk = (bg: string, bd: string, fg: string, etkin: boolean): React.CSSProperties => ({ fontSize: "1.1rem", fontWeight: 700, padding: ".8rem 1.4rem", minWidth: "12rem", minHeight: DOKUN, borderRadius: 8, border: `1px solid ${etkin ? bd : "#33333c"}`, background: etkin ? bg : "#1a1a20", color: etkin ? fg : "#e8e8ea", cursor: etkin ? "pointer" : "not-allowed" });
  const alan: React.CSSProperties = { display: "block", width: "100%", maxWidth: 320, minHeight: DOKUN, boxSizing: "border-box", padding: ".7rem .8rem", fontSize: "1rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 6 };
  return (
    <section id="motor-durum" data-hal={hal} aria-label={E.label} style={{ ...box(e.ton), padding: "1.1rem 1.2rem", margin: "0 0 1rem" }}>
      <p style={{ margin: 0, fontSize: ".8rem", letterSpacing: ".08em", color: "#b4b4bb" }}>{E.label}</p>
      <p id="motor-durum-etiket" style={{ margin: ".15rem 0 .35rem", fontSize: "2rem", fontWeight: 700, color: TONE[e.ton].bd }}>{e.ad}</p>
      <p style={{ margin: ".3rem 0 .8rem", lineHeight: 1.55 }}>{e.cumle}</p>
      {baslatilabilir && !baslatAcik && <button id="baslat-dugme" type="button" onClick={() => { setSonuc(null); setBaslatAcik(true); }} style={buyuk("#0d2a16", "#78e0a8", "#e8e8ea", true)}>{E.start}</button>}
      {baslatAcik && baslatilabilir && (<div style={{ borderTop: "1px solid #23232a", paddingTop: ".6rem" }}><label htmlFor="baslat-kod" style={{ display: "block", margin: "0 0 .3rem", color: "#b4b4bb" }}>{E.codeLabel}</label>
        <input id="baslat-kod" value={baslatKod} onChange={(x) => setBaslatKod(x.target.value)} inputMode="numeric" maxLength={6} autoComplete="one-time-code" disabled={gonderiliyor} style={{ ...alan, width: "9rem" }} />
        <p style={{ display: "flex", flexWrap: "wrap", gap: ".6rem", margin: ".7rem 0 0" }}><button id="baslat-gonder" type="button" onClick={() => void baslat()} disabled={!/^\d{6}$/.test(baslatKod) || gonderiliyor} style={buyuk("#0d2a16", "#78e0a8", "#e8e8ea", /^\d{6}$/.test(baslatKod) && !gonderiliyor)}>{gonderiliyor ? E.starting : E.startEngine}</button>
          <button type="button" onClick={() => { setBaslatAcik(false); setBaslatKod(""); }} style={dugme(true)}>{T.common.cancel}</button></p></div>)}
      {durmus && !baslatilabilir && <div id="onkosul-eksik" style={{ margin: ".2rem 0 .4rem" }}><p style={{ margin: ".3rem 0", lineHeight: 1.55, fontWeight: 600 }}>{E.blockedTitle}</p>
        <ul style={{ margin: ".2rem 0", paddingLeft: "1.2rem", lineHeight: 1.7 }}>{engel.map((k) => <li key={k.k}><a href={k.href} onClick={() => capayaGit((k.href ?? "").slice(1))} style={{ color: "#8ec9ff", display: "inline-flex", alignItems: "center", minHeight: DOKUN }}>{k.bag}</a></li>)}</ul></div>}
      {durdurulabilir && !durdurAcik && <button id="durdur-dugme" type="button" onClick={() => { setSonuc(null); setDurdurAcik(true); }} style={buyuk("#ff8a7a", "#ff8a7a", "#1a0505", true)}>{E.stop}</button>}
      {durdurAcik && <DurdurFormu bitti={async (x, kabul) => { setSonuc(x); if (kabul) setDurdurAcik(false); await yenile(); }} vazgec={() => setDurdurAcik(false)} />}
      <div id="motor-sonuc" role="status" aria-live="polite">{sonuc !== null && <p style={{ ...box(sonuc.ton), lineHeight: 1.55 }}>{sonuc.metin}</p>}</div>
      <p style={{ margin: ".8rem 0 .2rem", lineHeight: 1.55 }}><a href="/durdur" style={{ color: "#ff8a7a", fontWeight: 700 }}>{E.stopPageLink}</a> {E.stopPageText}</p>
      <h3 style={{ fontSize: "1rem", margin: "1rem 0 .3rem" }}>{E.beforeYouStart}</h3>
      <ul id="on-kosullar" style={{ listStyle: "none", padding: 0, margin: 0 }}>{kosullar.map((k) => (
        <li key={k.k} data-kosul={k.k} data-durum={k.durum} style={{ display: "flex", gap: ".55rem", padding: ".35rem 0", borderTop: "1px solid #23232a", lineHeight: 1.5 }}>
          <span aria-hidden="true" style={{ color: KOSUL_ISARETI[k.durum].renk, fontWeight: 700, minWidth: "1rem" }}>{KOSUL_ISARETI[k.durum].im}</span>
          <span>{k.cumle}{k.href && k.durum !== "tamam" ? <> <a href={k.href} onClick={() => capayaGit((k.href ?? "").slice(1))} style={{ color: "#8ec9ff" }}>{k.bag}</a></> : null}</span></li>))}</ul>
    </section>
  );
}

// ---- SEKMELER (Tur 77, T4) — Status · Settings · History · Technical. Hâl URL'de (`?tab=`); sekmeler GİZLENİR, sökülmez (çapalar ve ölçülen öğeler DOM'da kalır). ----
const SEKMELER = ["status", "settings", "history", "technical"] as const;
type Sekme = (typeof SEKMELER)[number];
/** Bir çapanın hangi sekmede olduğu — ön koşul bağlantısı o sekmeyi açıp çapaya kaydırır. */
const CAPA_SEKMESI: Record<string, Sekme> = { "anahtar-bolumu": "settings", "tik-araligi": "settings", "maliyet-tavani": "settings", "karar-motoru": "settings", "risk-ayari": "settings", "risk-paylari": "settings", "giris-salteri": "settings", "kilit-ayari": "settings" };
function SekmeCubugu({ sekme, sec }: { sekme: Sekme; sec: (s: Sekme) => void }) {
  const tus = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => { const n = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0; if (n === 0) return; e.preventDefault();
    const hedef = SEKMELER[(i + n + SEKMELER.length) % SEKMELER.length]; sec(hedef); document.getElementById(`sekme-dugme-${hedef}`)?.focus(); };
  return (
    <div role="tablist" aria-label={T.tabs.label} style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: ".35rem", margin: "0 0 1rem" }}>
      {SEKMELER.map((s, i) => (
        <button key={s} id={`sekme-dugme-${s}`} type="button" role="tab" aria-selected={sekme === s} aria-controls={`sekme-${s}`} tabIndex={sekme === s ? 0 : -1} onClick={() => sec(s)} onKeyDown={(e) => tus(e, i)}
          style={{ minHeight: DOKUN, padding: ".4rem .3rem", borderRadius: 6, border: `1px solid ${sekme === s ? "#2b7fc9" : "#33333c"}`, background: sekme === s ? "#12354f" : "#141419", color: "#e8e8ea", cursor: "pointer", fontWeight: sekme === s ? 700 : 400, fontSize: ".95rem" }}>{T.tabs[s]}</button>))}
    </div>
  );
}
/** Uyarının sade dil metni: sebep KODUYLA sözlükten (cümle ayrıştırılmaz); sözlükte olmayan kod için genel metin + Technical sekmesi. */
function uyariMetni(c: Card): { baslik: string; metin: string } {
  const A = T.alerts as Record<string, { title: string; text: string }>, t = (c.code ? A[c.code] : undefined) ?? A.other;
  return { baslik: fill(t.title, { symbol: c.symbol ?? "" }).replace(/ — $/, ""), metin: t.text };
}
function UyariSatiri({ c }: { c: Card }) {
  const m = uyariMetni(c);
  return (<section style={box(c.level)} aria-label={m.baslik}><h3 style={{ margin: "0 0 .35rem", fontSize: "1rem" }}><span style={{ fontSize: ".72rem", letterSpacing: ".08em", color: TONE[c.level].bd, marginRight: ".5rem" }}>{T.technical.levels[c.level]}</span>{m.baslik}</h3>
    <p style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{m.metin}</p></section>);
}
/** Kayıtlı sebep kodunun sade adı (sözlük); sözlükte yoksa kod GÖSTERİLMEZ. */
const sebepAdi = (code: string | null) => (code === null ? T.reasons.none : (T.reasons as Record<string, string>)[code] ?? T.reasons.other);
/** DURUM SEKMESİ ÖZETİ ("bir bakışta"): yalnız yapılandırılmış özet alanlarından. */
function DurumOzeti({ v, simdi }: { v: PanelView; simdi: number }) {
  const s = v.summary, S = T.status, satirlar: string[] = [];
  satirlar.push(!s.tick.read ? S.lastRunUnreadable : s.tick.at === null ? S.lastRunNone : fill(S.lastRun, { at: anTr(s.tick.at), ago: fmt.ago(s.tick.at, simdi) }));
  if (s.tick.read && s.tick.late === true) satirlar.push(S.late);
  satirlar.push(s.openPositions === null ? S.positionsUnreadable : fill(S.positions, { n: s.openPositions }));
  if (s.health === null) satirlar.push(S.healthUnreadable);
  else { satirlar.push((S.health as Record<string, string>)[s.health.state] ?? S.health.UNKNOWN); satirlar.push(fill(S.feesPaid, { period: s.health.period, amount: fmt.usdt(s.health.feesUsdt) })); }
  return (<section style={box("INFO")} aria-label={S.summaryHeading}><h2 style={{ fontSize: "1.05rem", margin: "0 0 .4rem" }}>{S.summaryHeading}</h2>
    {satirlar.map((l, i) => <p key={i} style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{l}</p>)}
    <p style={{ margin: ".4rem 0 0", color: "#9a9aa2" }}>{fill(S.reloaded, { at: anTr(v.at) })}</p></section>);
}
/** GEÇMİŞ SEKMESİ: pozisyonlar ve ayar değişiklikleri sade satırlarla — MEVCUT veriden (yeni sorgu/uç YOK). */
function GecmisSekmesi({ v, settings, risk, paylar }: { v: PanelView; settings: Settings | null; risk: RiskView | null; paylar: SharesView | null }) {
  const H = T.history, simdi = Date.parse(v.at);
  const para = (x: string | null) => (x === null ? T.common.unknown : fmt.usdt(x));
  const pozisyon = (p: PositionView) => p.open
    ? fill(H.open, { symbol: p.symbol, opened: `${anTr(p.openedAt)} (${fmt.ago(p.openedAt, simdi)})`, qty: p.facts.quantity, entry: fmt.usdt(p.facts.entryPrice), notional: fmt.usdt(p.facts.notionalUsdt), fee: fmt.usdt(p.facts.feeUsdt),
        pnl: p.facts.grossUsdt === null ? H.openPnlUnknown : fill(H.openPnl, { gross: para(p.facts.grossUsdt), net: para(p.facts.netUsdt) }) })
    : fill(H.closed, { symbol: p.symbol, closed: p.closedAt === null ? H.closedUnknownTime : anTr(p.closedAt), opened: anTr(p.openedAt), gross: para(p.facts.grossUsdt), fee: fmt.usdt(p.facts.feeUsdt), net: para(p.facts.netUsdt), reason: sebepAdi(p.reasonCode) });
  const PAY_ADI = payAdi(), alanAdi: Record<string, string> = { ...(T.cap.fieldNames as Record<string, string>), ...(T.brain.fieldNames as Record<string, string>), ...riskAdi(), ...PAY_ADI, tickMs: T.prereq.names.tick };
  const degerYaz = (f: string, x: string | null) => (x === null ? T.common.nowUnset : f === "callIntervalMs" || f === "tickMs" ? fmt.every(Number(x)) : PAY_ADI[f] ? yuzde(x) : defterDegeri(f, x));
  const degisiklikler = [...(settings?.changes ?? []).map((c) => ({ ...c, grup: H.brainGroup })), ...(risk?.ok ? risk.changes ?? [] : []).map((c) => ({ ...c, grup: H.riskGroup })), ...(paylar?.ok ? paylar.changes ?? [] : []).map((c) => ({ ...c, grup: T.caps.historyGroup }))]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const ls = v.summary.lastStop, sonOlay = !ls.read ? T.common.unknown : ls.at === null ? H.lastStopNone : fill(H.lastStop, { at: anTr(ls.at), title: sebepAdi(ls.code) });
  return (<div>
    <p style={{ color: "#9a9aa2", margin: "0 0 .6rem" }}>{H.intro}</p>
    <h2 style={{ fontSize: "1.05rem", marginTop: ".6rem" }}>{H.lastStopHeading}</h2>
    <p style={{ lineHeight: 1.55 }}>{sonOlay}</p>
    <h2 style={{ fontSize: "1.05rem", marginTop: "1rem" }}>{H.positionsHeading}</h2>
    {v.summary.openPositions === null ? <p style={{ lineHeight: 1.55 }}>{H.positionsUnreadable}</p>
      : v.positions.rows.length === 0 ? <p style={{ lineHeight: 1.55 }}>{H.positionsNone}</p>
      : <ul data-gecmis-pozisyon style={{ listStyle: "none", padding: 0, margin: 0 }}>{v.positions.rows.map((p) => <li key={p.id} style={{ padding: ".45rem 0", borderTop: "1px solid #23232a", lineHeight: 1.55 }}>{pozisyon(p)}</li>)}</ul>}
    <h2 style={{ fontSize: "1.05rem", marginTop: "1rem" }}>{H.changesHeading}</h2>
    {degisiklikler.length === 0 ? <p style={{ lineHeight: 1.55 }}>{H.changesNone}</p>
      : <ul data-gecmis-ayar style={{ listStyle: "none", padding: 0, margin: 0 }}>{degisiklikler.map((c, i) => <li key={i} style={{ padding: ".45rem 0", borderTop: "1px solid #23232a", lineHeight: 1.55 }}>
        {fill(H.change, { at: anTr(c.at), by: kimAdi(c.by), what: c.grup, changes: c.changes.map((x) => `${alanAdi[x.field] ?? T.history.unknownField}: ${x.from === null ? T.common.wasUnset : degerYaz(x.field, x.from)} → ${degerYaz(x.field, x.to)}`).join(" · ") })}</li>)}</ul>}
  </div>);
}

export default function Panel() {
  useActivateLang();
  const [view, setView] = useState<PanelView | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [state, setState] = useState<"yükleniyor" | "hazır" | "oturumsuz" | "ulaşılamadı">("yükleniyor");
  const [sekme, setSekme] = useState<Sekme>("status");
  const [pick, setPick] = useState<string>("");
  const [totp, setTotp] = useState("");
  const [applied, setApplied] = useState<string | null>(null);
  // G32 (Tur 76): kod kutuları başta KAPALI; serbest uç 403 RAISES_SPEND dönerse ilgili kutu açılır (hangi yönün kod istediğine sunucu karar verir, ekran değil).
  const [kodGerek, setKodGerek] = useState<{ secenek: boolean; tavan: boolean; karar: boolean; tik: boolean }>({ secenek: false, tavan: false, karar: false, tik: false });
  const kodAc = (k: "secenek" | "tavan" | "karar" | "tik", ac: boolean) => setKodGerek((o) => ({ ...o, [k]: ac }));
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
  // Tur 78 (G33): risk payları — iki alan BOŞ başlar (kullanıcı yazmadıkça doldurulmaz), kod her kaydetmede yeniden istenir.
  const [paylar, setPaylar] = useState<SharesView | null>(null);
  const [payTek, setPayTek] = useState("");
  const [payToplam, setPayToplam] = useState("");
  const [payKod, setPayKod] = useState("");
  const [paySonuc, setPaySonuc] = useState<string | null>(null);
  const [payGonderiliyor, setPayGonderiliyor] = useState(false);
  const [kilit, setKilit] = useState<LockState | "CHECKING" | "ACIK">("CHECKING");
  const [kilitAyar, setKilitAyar] = useState<LockRead | null>(null);
  const [kilitNot, setKilitNot] = useState<string | null>(null);
  // U-3: doğrulayıcı durumu ÖLÇÜLÜR ve saklanır; ölçülmeden "var" SAYILMAZ (null = henüz ölçülmedi). Ayar yüzeyi "AÇIK" seçeneğini buna göre sunar ya da SUNMAZ.
  const [dogrulayici, setDogrulayici] = useState<boolean | null>(null);
  // G30 (Tur 74): çıkıştan sonra formun altında gösterilen tek cümle; çıkış yapılamazsa panelde kalınır ve sebebi söylenir.
  const [cikisNot, setCikisNot] = useState<string | null>(null);
  const [cikisHata, setCikisHata] = useState<string | null>(null);

  // SEKME HÂLİ URL'DE (Tur 77, T4): `?tab=` okunur/yazılır; sır taşımaz. Çapa (#…) varsa onu içeren sekme açılır.
  const sekmeSec = useCallback((s: Sekme) => { setSekme(s); const q = new URLSearchParams(window.location.search); q.set("tab", s); window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}${window.location.hash}`); }, []);
  useEffect(() => { const t = setTimeout(() => { const q = new URLSearchParams(window.location.search).get("tab"), h = window.location.hash.slice(1);
    const s = CAPA_SEKMESI[h] ?? (SEKMELER as readonly string[]).find((x) => x === q) as Sekme | undefined; if (s) setSekme(s); }, 0); return () => clearTimeout(t); }, []);
  const capayaGit = useCallback((id: string) => { sekmeSec(CAPA_SEKMESI[id] ?? "settings"); setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 0); }, [sekmeSec]);

  const load = useCallback(async () => {
    try {
      const [p, s, k, g, x] = await Promise.all([fetch("/api/panel", { cache: "no-store" }), fetch("/api/brain/settings", { cache: "no-store" }), fetch("/api/risk/settings", { cache: "no-store" }), fetch("/api/entry/settings", { cache: "no-store" }), fetch("/api/exchange-key", { cache: "no-store" })]);
      let y: Response | null; try { y = await fetch("/api/risk/shares", { cache: "no-store" }); } catch { y = null; } // Tur 78: pay defteri (değerler /api/panel'den de gelir; ön koşul onları okur)
      if (p.status === 401 || s.status === 401 || k.status === 401) { setState("oturumsuz"); return; }
      setView(p.ok ? ((await p.json()) as PanelView) : null);
      setSettings((await s.json()) as Settings);
      setRisk((await k.json().catch(() => ({ ok: false }))) as RiskView);
      setGiris((await g.json().catch(() => ({ ok: false }))) as EntryView);
      setAnahtar((await x.json().catch(() => ({ ok: false }))) as KeyView);
      setPaylar(y ? ((await y.json().catch(() => ({ ok: false }))) as SharesView) : { ok: false });
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
    if (!ok) { setCikisHata(T.panel.signOutFailed); return; }
    setCikisHata(null); setView(null); setSettings(null); setRisk(null); setGiris(null); setAnahtar(null); setPaylar(null); setCikisNot(T.panel.signedOut); setState("oturumsuz"); };
  const kilidiAc = async () => { if (await unlock()) { setKilitNot(null); setKilit("ACIK"); await load(); } else setKilitNot(T.lock.state.FAILED); };
  const tanit = async () => setKilitNot(await enroll() ? T.lock.enrolled : T.lock.state.ENROLL_FAILED);
  // Tur 79: dil değişince sunucu cümleleri (Technical) yeni dilde gelsin diye açık panelin verisi yeniden okunur; oturum/kilit hâli değişmez.
  useEffect(() => { const h = () => { if (state === "hazır") void load(); }; window.addEventListener(LANG_EVENT, h); return () => window.removeEventListener(LANG_EVENT, h); }, [state, load]);

  /** Değişen alanların okunur listesi (defter): alan adı sözlükten, aralık insan biriminde. */
  const degisenler = (liste: { field: string; from: string | null; to: string | null }[] | undefined, adlar: Record<string, string>) =>
    (liste ?? []).map((c) => `${adlar[c.field] ?? T.history.unknownField} ${c.from === null ? T.common.wasUnset : c.field === "callIntervalMs" || c.field === "tickMs" ? fmt.every(Number(c.from)) : c.from} → ${c.to === null ? T.common.nowUnset : c.field === "callIntervalMs" || c.field === "tickMs" ? fmt.every(Number(c.to)) : c.to}`).join(", ") || T.common.noFieldChanged;
  const apply = async () => {
    const [model, ms] = pick.split("|");
    const govde = secimGovdesi(model, ms);
    // Tur 66 · 1d: kod yoksa serbest uç (yalnız harcamayı azaltan yön); her fetch( doğrudan "/api/…" dizesiyle başlar (gate:binance-budget izin gerekçesi).
    const r = totp.length === 6 ? await fetch("/api/brain/settings", { method: "POST", headers: { "content-type": "application/json", "x-totp-code": totp }, body: govde })
      : await fetch("/api/brain/settings/tighten", { method: "POST", headers: { "content-type": "application/json" }, body: govde });
    const b = (await r.json()) as { ok?: boolean; reason?: string; applied?: { field: string; from: string | null; to: string | null }[]; errors?: string[] };
    const yukseltir = r.status === 403 && b.reason === "RAISES_SPEND";
    setApplied(r.ok && b.ok ? fill(T.options.applied, { changes: degisenler(b.applied, T.brain.fieldNames as Record<string, string>) })
      : yukseltir ? T.options.raises : sonucMetni(r.status, (b.errors ?? []).join(" · "), T.common.codeRejected));
    kodAc("secenek", yukseltir); setTotp(""); await load();
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
    const yukseltir = r.status === 403 && b.reason === "RAISES_SPEND";
    setCapSonuc(r.ok && b.ok ? fill(T.common.appliedLogged, { changes: degisenler(b.applied, T.cap.fieldNames as Record<string, string>), effect: T.cap.effect })
      : yukseltir ? T.common.raisesSpend : sonucMetni(r.status, (b.errors ?? []).join(" · "), T.common.codeRejected));
    kodAc("tavan", yukseltir); setCapTotp(""); setCapSecili({ tavan: false, beyin: false, davranis: false, altyapi: false }); setCapDeger(""); setCapBeyin(""); setCapAltyapi(""); setCapDavranis(""); await load();
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
    const yukseltir = r.status === 403 && b.reason === "RAISES_SPEND";
    setBSonuc(r.ok && b.ok ? fill(T.common.appliedLogged, { changes: degisenler(b.applied, T.brain.fieldNames as Record<string, string>), effect: T.brain.effect })
      : yukseltir ? T.brain.raises : sonucMetni(r.status, (b.errors ?? []).join(" · "), T.common.codeRejected));
    kodAc("karar", yukseltir); setBTotp(""); setBSecili({ model: false, siklik: false, aday: false, mum: false }); setBDeger({ model: "", siklik: "", aday: "", mum: "" }); await load();
  };

  // ---- TİK ARALIĞINI DEĞİŞTİR (Tur 67 · 1c · K3, S-8: daha seyrek kodsuz, daha sık kod ister; yön sunucuda karar verilir) ----
  const tikHazir = tikDeger !== "" && (kodGerek.tik ? tikTotp.length === 6 : tikTotp.length === 0);
  const tikEtiket = (x: string | null) => (x === null ? T.common.wasUnset : settings?.tickView?.choices.some((c) => String(c.ms) === x) ? fmt.every(Number(x)) : T.tick.outside);
  const tikUygula = async () => {
    const kodlu = tikTotp.length === 6, govde = tikGovdesi(tikDeger);
    const r = kodlu ? await fetch("/api/brain/settings", { method: "POST", headers: { "content-type": "application/json", "x-totp-code": tikTotp }, body: govde })
      : await fetch("/api/brain/settings/tighten", { method: "POST", headers: { "content-type": "application/json" }, body: govde });
    const b = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string; applied?: { field: string; from: string | null; to: string | null }[]; errors?: string[] };
    const tikKod = r.status === 403 && b.reason === "RAISES_SPEND";
    setTikSonuc(r.ok && b.ok ? ((b.applied ?? []).length === 0 ? T.tick.same : `${(b.applied ?? []).map((c) => fill(T.tick.applied, { from: tikEtiket(c.from), to: tikEtiket(c.to) })).join(" ")} ${T.tick.effect}`)
      : tikKod ? T.tick.raises : sonucMetni(r.status, (b.errors ?? []).join(" · "), T.common.codeRejected));
    kodAc("tik", tikKod); setTikTotp(""); if (!tikKod) setTikDeger(""); await load();
  };

  // ---- RİSK AYARINI DEĞİŞTİR (Tur 37 madde 5 · S-8) ----
  // Yama YALNIZ İŞARETLENMİŞ alanlardan kurulur: işaretlenmemiş alan gönderilmez (varsayılan doldurulmuş değer YOK).
  // İşaretli ama BOŞ bırakılan alan "seçimi kaldır" demektir ve null gider — bu ekranda ikisi AYNI ŞEY DEĞİLDİR.
  // Tavan yokken daha önce seçilmiş "AÇIK" değeri yamaya GİRMEZ: seçenek ekrandan kalkınca değeri de düşer (seçim "— choose —"a döner, gönderim düğmesi kapanır).
  const acikSunulur = !!risk?.ok && tavanVar(risk, riskSecili, riskDeger);
  const deger = (alan: string) => (alan === "futuresEnabled" && riskDeger[alan] === "acik" && !acikSunulur ? "" : (riskDeger[alan] ?? ""));
  const riskYamasi = (): Record<string, unknown> => {
    const y: Record<string, unknown> = {};
    for (const f of RISK_ALANLARI) { if (!riskSecili[f.alan]) continue; const x = deger(f.alan).trim();
      if (f.tip === "sayı") y[f.alan] = x === "" ? null : Number(x);
      else if (f.tip === "şalter") y[f.alan] = x === "acik";
      else if (f.tip === "kip") y[f.alan] = x;
      else y[f.alan] = x === "" ? null : x; }
    return y;
  };
  const riskHazir = RISK_ALANLARI.some((f) => riskSecili[f.alan]) && RISK_ALANLARI.every((f) => !riskSecili[f.alan] || f.tip === "sayı" || f.tip === "ondalık" || deger(f.alan) !== "") && riskTotp.length === 6;
  const riskUygula = async () => {
    const r = await fetch("/api/risk/settings", { method: "POST", headers: { "content-type": "application/json", "x-totp-code": riskTotp }, body: JSON.stringify(riskYamasi()) });
    const b = (await r.json().catch(() => ({}))) as { ok?: boolean; applied?: { field: string; from: string | null; to: string | null }[]; errors?: string[] };
    setRiskSonuc(r.ok && b.ok ? fill(T.risk.applied, { changes: (b.applied ?? []).map((c) => `${riskAdi()[c.field] ?? T.history.unknownField} ${c.from === null ? T.common.wasUnset : defterDegeri(c.field, c.from)} → ${defterDegeri(c.field, c.to)}`).join(", ") || T.common.noFieldChanged })
      : sonucMetni(r.status, (b.errors ?? []).join(" · "), T.risk.rejected403));
    setRiskTotp(""); setRiskSecili({}); setRiskDeger({}); await load();
  };

  // ---- RİSK PAYLARINI YAZ (Tur 78 · G33 · S-8, A-1/A-6) ----
  // Boş alan GÖNDERİLMEZ (mevcut değer kalır). Dönüşüm yalnız virgülü noktaya çevirir, YUVARLAMAZ: biçim dışı sayıyı sunucu 400 ile reddeder ve sebebi ekrana gelir.
  const payAlanlari = () => [["singlePositionPct", payTek], ["totalExposurePct", payToplam]] as const;
  const paySayiDegil = payAlanlari().some(([, s]) => s.trim() !== "" && !Number.isFinite(Number(s.trim().replace(",", "."))));
  const payGovde = (): Record<string, number> => Object.fromEntries(payAlanlari().filter(([, s]) => s.trim() !== "").map(([k, s]) => [k, Number(s.trim().replace(",", "."))]));
  const payHazir = payAlanlari().some(([, s]) => s.trim() !== "") && /^\d{6}$/.test(payKod) && !payGonderiliyor;
  const payUygula = async () => {
    if (paySayiDegil) { setPaySonuc(T.caps.notNumber); return; }
    setPayGonderiliyor(true); setPaySonuc(null); let r: Response | null = null;
    try { r = await fetch("/api/risk/shares", { method: "POST", headers: { "content-type": "application/json", "x-totp-code": payKod }, body: JSON.stringify(payGovde()) }); } catch { r = null; }
    const b = r ? ((await r.json().catch(() => ({}))) as { ok?: boolean; applied?: { field: string; from: string | null; to: string | null }[]; errors?: string[] }) : {};
    setPaySonuc(r === null ? T.panel.unreachable : r.ok && b.ok ? ((b.applied ?? []).length === 0 ? T.caps.same : fill(T.caps.applied, { changes: (b.applied ?? []).map((c) => `${payAdi()[c.field] ?? T.history.unknownField} ${c.from === null ? T.common.wasUnset : yuzde(c.from)} → ${c.to === null ? T.common.nowUnset : yuzde(c.to)}`).join(", ") }))
      : sonucMetni(r.status, (b.errors ?? []).join(" · "), T.caps.rejected403));
    setPayKod(""); setPayGonderiliyor(false); if (r?.ok && b.ok) { setPayTek(""); setPayToplam(""); }
    await load();
  };

  // Ayar değişince YALNIZ kilit ayarı yeniden okunur (panel verisi kilit ekranında zaten okunmaz).
  const kilitAyariniYenile = async () => { try { const r = await fetch("/api/lock/settings", { cache: "no-store" }); setKilitAyar((await r.json().catch(() => ({ ok: false }))) as LockRead); } catch { setKilitAyar({ ok: false }); } };
  if (kilit !== "ACIK") return <KilitEkrani durum={kilit} not={kilitNot} ac={() => void kilidiAc()} tanit={() => void tanit()} ayar={kilitAyar} dogrulayiciVar={dogrulayici} yenile={kilitAyariniYenile} />;
  if (state !== "hazır") return (
    <main style={{ fontFamily: "system-ui, sans-serif", background: "#0b0b0c", color: "#e8e8ea", minHeight: "100vh", padding: "2rem 1rem" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: ".5rem" }}><h1 style={{ fontSize: "1.35rem" }}>{T.panel.title}</h1><LangSelect id="dil-giris" /></div>
        <p style={{ margin: "0 0 .6rem" }}><a href="/durdur" style={{ color: "#ff8a7a", fontWeight: 700 }}>{T.panel.stopLink}</a> {T.panel.stopLinkHint}</p>
        <p style={{ lineHeight: 1.6 }}>{state === "yükleniyor" ? T.panel.loading : state === "oturumsuz" ? T.panel.needsSession : T.panel.unreachable}</p>
        {state === "oturumsuz" && <GirisFormu girdi={girdi} not={cikisNot} />}
      </div>
    </main>
  );

  const v = view as PanelView, opts = settings?.options?.rows ?? [], simdi = Date.parse(v.at), cc = settings?.ok ? settings.costCap : undefined;
  const capNedeni = settings?.capSentence && settings.capSentence !== cc?.sentence ? settings.capSentence : null;
  const sonDegisiklik = (settings?.changes ?? [])[0];
  const secenekCumlesi = (o: CostRow) => fill(T.options.rowSentence, { model: o.model, every: fmt.every(o.intervalMs), brain: fmt.usdMonth(o.brainUsd), total: o.totalUsd === null ? T.options.totalUnknown : fmt.usdMonth(o.totalUsd),
    cap: o.underCap === null ? T.options.capUnknown : fill(o.underCap ? T.options.under : T.options.over, { cap: cc?.totalUsd ? fmt.usdMonth(cc.totalUsd) : T.common.unknown }) });
  const panelGorunur = (s: Sekme): React.CSSProperties | undefined => (sekme === s ? undefined : { display: "none" });
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", background: "#0b0b0c", color: "#e8e8ea", minHeight: "100vh", padding: "1.5rem 1rem 2rem" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <h1 style={{ fontSize: "1.35rem", marginBottom: ".2rem" }}>{T.panel.title}</h1>
        <div style={{ margin: "0 0 .8rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: ".4rem 1.2rem" }}><a href="/durdur" style={{ color: "#ff8a7a", fontWeight: 700, display: "inline-flex", alignItems: "center", minHeight: DOKUN }}>{T.panel.stopLink}</a>
          <button id="cikis-yap" type="button" onClick={() => void cikis()} style={dugme(true)}>{T.panel.signOut}</button><LangSelect id="dil-panel" /></div>
        {cikisHata !== null && <p role="alert" style={{ ...box("WARN"), lineHeight: 1.55 }}>{cikisHata}</p>}
        <SekmeCubugu sekme={sekme} sec={sekmeSec} />

        {/* ---- STATUS ---- */}
        <div role="tabpanel" id="sekme-status" aria-labelledby="sekme-dugme-status" hidden={sekme !== "status"} style={panelGorunur("status")}>
          <MotorDurumKarti view={v} kosullar={onKosullar({ anahtar, settings, giris, view: v })} yenile={load} capayaGit={capayaGit} />
          {v.alerts.length > 0 && <div data-uyari><h2 style={{ fontSize: "1.05rem", marginTop: "1.2rem" }}>{T.status.alertsHeading}</h2>{v.alerts.map((c, i) => <UyariSatiri key={i} c={c} />)}</div>}
          <DurumOzeti v={v} simdi={simdi} />
        </div>

        {/* ---- SETTINGS ---- */}
        <div role="tabpanel" id="sekme-settings" aria-labelledby="sekme-dugme-settings" hidden={sekme !== "settings"} style={panelGorunur("settings")}>
          <h2 style={{ fontSize: "1.05rem", marginTop: ".4rem" }}>{T.key.heading}</h2>
          <p data-ne-yapar style={NE}>{T.key.what}</p>
          <AnahtarYuzeyi durum={anahtar} yenile={load} />

          <h2 id="tik-araligi" style={{ fontSize: "1.05rem", marginTop: "1.4rem" }}>{T.tick.heading}</h2>
          <p data-ne-yapar style={NE}>{T.tick.what}</p>
          <section style={box(settings?.ok && settings.tickView ? (settings.tickView.tickMs === null ? "WARN" : "INFO") : "WARN")} aria-label={T.tick.heading}>
            {!settings?.ok || !settings.tickView ? <p style={{ lineHeight: 1.55 }}>{T.tick.unreadable}</p> : <>
              <p data-tik-ayar style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{settings.tickView.tickMs === null ? T.tick.empty : fill(T.tick.current, { every: fmt.every(settings.tickView.tickMs) })}</p>
              <p style={{ margin: ".3rem 0", lineHeight: 1.55, color: "#9a9aa2" }}>{T.tick.effect}</p>
              <details style={{ marginTop: ".6rem" }}>
                <summary style={{ cursor: "pointer", minHeight: DOKUN, display: "flex", alignItems: "center" }}>{T.tick.change}</summary>
                <div role="radiogroup" aria-label={T.tick.choicesAria} style={{ display: "flex", flexWrap: "wrap", gap: ".5rem", margin: ".4rem 0" }}>{settings.tickView.choices.map((c) => (
                  <button key={c.ms} type="button" role="radio" aria-checked={tikDeger === String(c.ms)} data-tik-secenek={String(c.ms)} onClick={() => { setTikDeger(String(c.ms)); kodAc("tik", false); setTikTotp(""); }}
                    style={{ minHeight: DOKUN, padding: ".45rem .9rem", borderRadius: 6, border: `1px solid ${tikDeger === String(c.ms) ? "#2b7fc9" : "#33333c"}`, background: tikDeger === String(c.ms) ? "#12354f" : "#141419", color: "#e8e8ea", cursor: "pointer" }}>{c.current ? fill(T.tick.currentMark, { label: fmt.every(c.ms) }) : fmt.every(c.ms)}</button>))}</div>
                {kodGerek.tik && <label style={{ ...kodEtiket, margin: ".5rem 0 .3rem" }}>{T.tick.codeLabel}
                  <input id="tik-kod" value={tikTotp} onChange={(e) => setTikTotp(e.target.value)} inputMode="numeric" maxLength={6} autoComplete="one-time-code" style={{ ...alanStili, width: "7rem" }} />
                </label>}
                <button id="tik-uygula" onClick={() => void tikUygula()} disabled={!tikHazir} style={dugme(tikHazir, true)}>{tikTotp.length === 6 ? T.tick.applyCode : kodGerek.tik ? T.tick.applyNeedsCode : T.tick.apply}</button>
                {tikSonuc !== null && <p role="status" aria-live="polite" style={{ margin: ".5rem 0", lineHeight: 1.55 }}>{tikSonuc}</p>}
              </details>
              <TeknikAyrinti satirlar={[settings.tickView.sentence, settings.tickView.effectSentence, settings.tickView.directionSentence, ...settings.tickView.choices.map((c) => c.label)]} />
            </>}
          </section>

          <h2 id="maliyet-tavani" style={{ fontSize: "1.05rem", marginTop: "1.4rem" }}>{T.cap.heading}</h2>
          <p data-ne-yapar style={NE}>{T.cap.what}</p>
          <section style={box(settings?.ok && settings.costCap ? (settings.costCap.brainMonthlyUsd === null ? "WARN" : "INFO") : "WARN")} aria-label={T.cap.heading}>
            {!settings?.ok || !settings.costCap ? <p style={{ lineHeight: 1.55 }}>{T.cap.unreadable}</p> : <>
              <p data-tavan style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{[settings.costCap.totalUsd === null ? T.cap.totalEmpty : fill(T.cap.total, { value: fmt.usdMonth(settings.costCap.totalUsd) }),
                settings.costCap.infraUsd === null ? T.cap.infraEmpty : fill(T.cap.infra, { value: fmt.usdMonth(settings.costCap.infraUsd) }),
                settings.costCap.brainMonthlyUsd === null ? T.cap.brainDerived : fill(T.cap.brain, { value: fmt.usdMonth(settings.costCap.brainMonthlyUsd) })].join(" ")}</p>
              <p style={{ margin: ".3rem 0", lineHeight: 1.55, color: "#9a9aa2" }}>{settings.costCap.behavior === "NO_LIMIT" ? T.cap.behaviorNoLimit : T.cap.behaviorOff} {settings.capEmpty ? T.cap.notCalledNow : T.cap.calledNow}</p>
              <details style={{ marginTop: ".6rem" }}>
                <summary style={{ cursor: "pointer", minHeight: DOKUN, display: "flex", alignItems: "center" }}>{T.cap.change}</summary>
                <p style={{ margin: ".4rem 0", lineHeight: 1.55, color: "#9a9aa2" }}>{T.cap.changeHelp}</p>
                <div style={{ borderTop: "1px solid #23232a", padding: ".5rem 0" }}>
                  <label style={secimEtiketi}><input type="checkbox" checked={capSecili.tavan} onChange={(e) => setCapSecili({ ...capSecili, tavan: e.target.checked })} aria-label={T.cap.fieldTotalAria} /><span>{T.cap.fieldTotal}</span></label>
                  {capSecili.tavan && <label htmlFor="tavan-deger" style={{ display: "block", margin: ".35rem 0 .2rem", color: "#9a9aa2" }}>{T.cap.fieldTotalNew}</label>}
                  {capSecili.tavan && <span style={{ whiteSpace: "nowrap" }}><input id="tavan-deger" value={capDeger} onChange={(e) => setCapDeger(e.target.value)} inputMode="decimal" style={{ ...alanStili, width: "7rem" }} /> {T.cap.perMonthUnit}</span>}
                </div>
                <div style={{ borderTop: "1px solid #23232a", padding: ".5rem 0" }}>
                  <label style={secimEtiketi}><input type="checkbox" checked={capSecili.beyin} onChange={(e) => setCapSecili({ ...capSecili, beyin: e.target.checked })} aria-label={T.cap.fieldBrainAria} /><span>{T.cap.fieldBrain}</span></label>
                  {capSecili.beyin && <label htmlFor="tavan-beyin" style={{ display: "block", margin: ".35rem 0 .2rem", color: "#9a9aa2" }}>{T.cap.fieldBrainNew}</label>}
                  {capSecili.beyin && <span style={{ whiteSpace: "nowrap" }}><input id="tavan-beyin" value={capBeyin} onChange={(e) => setCapBeyin(e.target.value)} inputMode="decimal" style={{ ...alanStili, width: "7rem" }} /> {T.cap.perMonthUnit}</span>}
                </div>
                <div style={{ borderTop: "1px solid #23232a", padding: ".5rem 0" }}>
                  <label style={secimEtiketi}><input type="checkbox" checked={capSecili.altyapi} onChange={(e) => setCapSecili({ ...capSecili, altyapi: e.target.checked })} aria-label={T.cap.fieldInfraAria} /><span>{T.cap.fieldInfra}</span></label>
                  {capSecili.altyapi && <label htmlFor="tavan-altyapi" style={{ display: "block", margin: ".35rem 0 .2rem", color: "#9a9aa2" }}>{T.cap.fieldInfraNew}</label>}
                  {capSecili.altyapi && <span style={{ whiteSpace: "nowrap" }}><input id="tavan-altyapi" value={capAltyapi} onChange={(e) => setCapAltyapi(e.target.value)} inputMode="decimal" style={{ ...alanStili, width: "7rem" }} /> {T.cap.perMonthUnit}</span>}
                </div>
                <div style={{ borderTop: "1px solid #23232a", padding: ".5rem 0" }}>
                  <label style={secimEtiketi}><input type="checkbox" checked={capSecili.davranis} onChange={(e) => setCapSecili({ ...capSecili, davranis: e.target.checked })} aria-label={T.cap.fieldBehaviorAria} /><span>{T.cap.fieldBehavior}</span></label>
                  {capSecili.davranis && <label htmlFor="tavan-davranis" style={{ display: "block", margin: ".35rem 0 .2rem", color: "#9a9aa2" }}>{T.cap.fieldBehaviorNew}</label>}
                  {capSecili.davranis && <select id="tavan-davranis" value={capDavranis} onChange={(e) => setCapDavranis(e.target.value)} style={alanStili}>
                    <option value="">{T.common.choose}</option><option value="BRAIN_OFF">{T.cap.behaviorOptOff}</option><option value="NO_LIMIT">{T.cap.behaviorOptNoLimit}</option></select>}
                </div>
                {kodGerek.tavan && <label style={{ ...kodEtiket, margin: ".5rem 0 .3rem" }}>{T.cap.codeLabel}
                  <input id="tavan-kod" value={capTotp} onChange={(e) => setCapTotp(e.target.value)} inputMode="numeric" maxLength={6} autoComplete="one-time-code" style={{ ...alanStili, width: "7rem" }} />
                </label>}
                <button onClick={() => void capUygula()} disabled={!capHazir} style={dugme(capHazir, true)}>{capTotp.length === 6 ? T.cap.applyCode : T.cap.applyFree}</button>
                {capSonuc !== null && <p role="status" aria-live="polite" style={{ margin: ".5rem 0", lineHeight: 1.55 }}>{capSonuc}</p>}
              </details>
              <TeknikAyrinti satirlar={[settings.costCap.sentence, settings.costCap.behaviorSentence, capNedeni]} />
            </>}
          </section>

          <h2 id="karar-motoru" style={{ fontSize: "1.05rem", marginTop: "1.4rem" }}>{T.brain.heading}</h2>
          <p data-ne-yapar style={NE}>{T.brain.what}</p>
          <section style={box(settings?.ok && settings.settings ? "INFO" : "WARN")} aria-label={T.brain.heading}>
            {!settings?.ok || !settings.settings || !settings.allowed ? <p style={{ lineHeight: 1.55 }}>{T.brain.unreadable}</p> : <>
              {settings.capEmpty && <p data-tavan-bos-ayar style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{T.brain.idle}</p>}
              <p data-beyin-ayar style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{fill(settings.capEmpty ? T.brain.saved : T.brain.current, { model: settings.settings.model, every: fmt.every(settings.settings.callIntervalMs), candidates: settings.settings.candidates, candles: settings.settings.candleLimit })}</p>
              <details style={{ marginTop: ".6rem" }}>
                <summary style={{ cursor: "pointer", minHeight: DOKUN, display: "flex", alignItems: "center" }}>{T.brain.change}</summary>
                <p style={{ margin: ".4rem 0", lineHeight: 1.55, color: "#9a9aa2" }}>{T.brain.changeHelp}</p>
                <div style={{ borderTop: "1px solid #23232a", padding: ".5rem 0" }}>
                  <label style={secimEtiketi}><input type="checkbox" checked={bSecili.model} onChange={(e) => setBSecili({ ...bSecili, model: e.target.checked })} aria-label={T.brain.fieldModelAria} /><span>{T.brain.fieldModel}</span></label>
                  {bSecili.model && <select aria-label={T.brain.fieldModelNew} value={bDeger.model} onChange={(e) => setBDeger({ ...bDeger, model: e.target.value })} style={alanStili}><option value="">{T.common.choose}</option>{settings.allowed.models.map((m) => <option key={m} value={m}>{m}</option>)}</select>}
                </div>
                <div style={{ borderTop: "1px solid #23232a", padding: ".5rem 0" }}>
                  <label style={secimEtiketi}><input type="checkbox" checked={bSecili.siklik} onChange={(e) => setBSecili({ ...bSecili, siklik: e.target.checked })} aria-label={T.brain.fieldFreqAria} /><span>{T.brain.fieldFreq}</span></label>
                  {bSecili.siklik && <select aria-label={T.brain.fieldFreqNew} value={bDeger.siklik} onChange={(e) => setBDeger({ ...bDeger, siklik: e.target.value })} style={alanStili}><option value="">{T.common.choose}</option>{settings.allowed.intervalChoicesMs.map((ms) => <option key={ms} value={String(ms)}>{fmt.every(ms)}</option>)}</select>}
                </div>
                <div style={{ borderTop: "1px solid #23232a", padding: ".5rem 0" }}>
                  <label style={secimEtiketi}><input type="checkbox" checked={bSecili.aday} onChange={(e) => setBSecili({ ...bSecili, aday: e.target.checked })} aria-label={T.brain.fieldCandAria} /><span>{T.brain.fieldCand}</span></label>
                  {bSecili.aday && <span style={{ whiteSpace: "nowrap" }}><input aria-label={T.brain.fieldCandNew} value={bDeger.aday} onChange={(e) => setBDeger({ ...bDeger, aday: e.target.value })} inputMode="numeric" style={{ ...alanStili, width: "5rem" }} /> {fill(T.brain.candUnit, { min: settings.allowed.candidates.min, max: settings.allowed.candidates.max })}</span>}
                </div>
                <div style={{ borderTop: "1px solid #23232a", padding: ".5rem 0" }}>
                  <label style={secimEtiketi}><input type="checkbox" checked={bSecili.mum} onChange={(e) => setBSecili({ ...bSecili, mum: e.target.checked })} aria-label={T.brain.fieldCandlesAria} /><span>{T.brain.fieldCandles}</span></label>
                  {bSecili.mum && <span style={{ whiteSpace: "nowrap" }}><input aria-label={T.brain.fieldCandlesNew} value={bDeger.mum} onChange={(e) => setBDeger({ ...bDeger, mum: e.target.value })} inputMode="numeric" style={{ ...alanStili, width: "5rem" }} /> {fill(T.brain.candlesUnit, { min: settings.allowed.candleLimit.min, max: settings.allowed.candleLimit.max })}</span>}
                </div>
                {kodGerek.karar && <label style={{ ...kodEtiket, margin: ".5rem 0 .3rem" }}>{T.brain.codeLabel}
                  <input id="karar-kod" value={bTotp} onChange={(e) => setBTotp(e.target.value)} inputMode="numeric" maxLength={6} autoComplete="one-time-code" style={{ ...alanStili, width: "7rem" }} />
                </label>}
                <button onClick={() => void bUygula()} disabled={!bHazir} style={dugme(bHazir, true)}>{bTotp.length === 6 ? T.brain.applyCode : T.brain.applyFree}</button>
                {bSonuc !== null && <p role="status" aria-live="polite" style={{ margin: ".5rem 0", lineHeight: 1.55 }}>{bSonuc}</p>}
              </details>
            </>}
          </section>

          <h2 style={{ fontSize: "1.05rem", marginTop: "1.4rem" }}>{T.options.heading}</h2>
          <section style={box(settings?.ok ? "INFO" : "WARN")} aria-label={T.options.heading}>
            {!settings?.ok ? <p style={{ lineHeight: 1.55 }}>{T.options.unreadable}</p>
            : settings.capEmpty ? <p data-tavan-bos style={{ lineHeight: 1.55 }}>{T.options.idle}</p> : <>
              <p style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{settings.runtime ? fill(T.options.runtime, { model: settings.runtime.model, every: fmt.every(settings.runtime.callIntervalMs), candidates: settings.runtime.candidates, candles: settings.runtime.candleLimit }) : T.common.unknown}</p>
              <p style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{fill(T.options.capLine, { cap: settings.cap?.monthlyUsd == null ? T.options.capNone : fmt.usdMonth(settings.cap.monthlyUsd), calls: settings.cap?.dailyCalls ?? T.common.unknown })}</p>
              {settings.price?.stale && <p style={{ margin: ".3rem 0", lineHeight: 1.55, color: TONE.WARN.bd }}>{T.options.priceStale}</p>}
              {opts.length > 0 && <>
                {/* Tur 49 madde 1 + Tur 70 madde 7c: satır düzeni (ortak ızgara + alt ızgara); sayı + birim BÖLÜNMEZ parça (nowrap). Yeni renk/boşluk/ölçü YOK. */}
                <div role="radiogroup" aria-label={T.options.choicesAria} style={{ margin: ".7rem 0", fontSize: ".92rem", display: "grid", gridTemplateColumns: "repeat(3, minmax(min-content, max-content)) 1fr", columnGap: ".4rem" }}>
                  <p style={{ color: "#9a9aa2", margin: "0 0 .35rem", gridColumn: "1 / -1" }}>{T.options.choicesHead}</p>
                  {opts.map((o) => { const id = `${o.model}|${o.intervalMs}`; return (
                    <label key={id} data-secenek style={{ display: "grid", gridTemplateColumns: "subgrid", gridColumn: "1 / -1", columnGap: ".4rem", padding: ".25rem .4rem", minHeight: DOKUN, alignItems: "center", borderTop: "1px solid #23232a", background: o.current ? "#14231a" : undefined, cursor: "pointer", lineHeight: 1.55 }}>
                      <span style={{ gridColumn: "1 / -1" }}><input type="radio" name="ayar" value={id} checked={pick === id} onChange={() => setPick(id)} aria-label={secenekCumlesi(o)} />{" "}
                        <span data-birim style={{ whiteSpace: "nowrap" }}>{o.model}{o.current ? T.options.currentMark : ""}</span> · <span data-birim style={{ whiteSpace: "nowrap" }}>{fmt.every(o.intervalMs)}</span></span>
                      <span data-sutun="karar-motoru" style={{ justifySelf: "end", textAlign: "right" }}><span style={{ color: "#9a9aa2" }}>{T.options.brainCol}</span> <span data-birim style={{ whiteSpace: "nowrap" }}>{fmt.usdMonth(o.brainUsd)}</span></span>
                      <span data-sutun="toplam" style={{ justifySelf: "end", textAlign: "right" }}><span style={{ color: "#9a9aa2" }}>{T.options.totalCol}</span> {o.totalUsd === null ? T.options.totalUnknown : <span data-birim style={{ whiteSpace: "nowrap" }}>{fmt.usdMonth(o.totalUsd)}</span>}</span>
                      <span data-sutun="tavan">{o.underCap === null ? T.options.capUnknown : fill(o.underCap ? T.options.under : T.options.over, { cap: cc?.totalUsd ? fmt.usdMonth(cc.totalUsd) : T.common.unknown })}</span>
                    </label>); })}
                </div>
                <p style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{(() => { const o = opts.find((x) => `${x.model}|${x.intervalMs}` === pick); return o ? secenekCumlesi(o) : T.options.pick; })()}</p>
                {kodGerek.secenek && <label style={{ ...kodEtiket, margin: ".5rem 0 .3rem" }}>{T.options.codeLabel}
                  <input id="secenek-kod" value={totp} onChange={(e) => setTotp(e.target.value)} inputMode="numeric" maxLength={6} autoComplete="one-time-code" style={{ ...alanStili, width: "7rem" }} />
                </label>}
                <button onClick={() => void apply()} disabled={!pick || (totp.length !== 0 && totp.length !== 6)} style={dugme(!!pick && (totp.length === 0 || totp.length === 6), true)}>{totp.length === 6 ? T.options.applyCode : T.options.applyFree}</button>
                {applied !== null && <p role="status" aria-live="polite" style={{ margin: ".5rem 0", lineHeight: 1.55 }}>{applied}</p>}
              </>}
              {sonDegisiklik && <p style={{ margin: ".4rem 0", lineHeight: 1.55, color: "#9a9aa2" }}>{fill(T.options.lastChange, { at: anTr(sonDegisiklik.at), by: kimAdi(sonDegisiklik.by), changes: degisenler(sonDegisiklik.changes, { ...(T.brain.fieldNames as Record<string, string>), ...(T.cap.fieldNames as Record<string, string>), tickMs: T.prereq.names.tick }) })}</p>}
              <TeknikAyrinti satirlar={[settings.spend?.sentence ?? settings.spend?.detail, settings.price?.note, settings.cap ? `${kaynakAdi(settings.cap.monthlyFrom)} · ${kaynakAdi(settings.cap.dailyFrom)}` : null, opts.length === 0 ? settings.options?.note : null, ...opts.map((o) => o.sentence), ...(settings.changes ?? []).map((c) => `${anTr(c.at)} · ${kimAdi(c.by)} · ${c.changes.map((x) => `${x.field}: ${x.from ?? T.common.wasUnset} → ${x.to ?? T.common.nowUnset}`).join(" · ")}`)]} />
            </>}
          </section>

          <h2 id="risk-ayari" style={{ fontSize: "1.05rem", marginTop: "1.4rem" }}>{T.risk.heading}</h2>
          <p data-ne-yapar style={NE}>{T.risk.what}</p>
          <section style={box(risk?.ok ? (risk?.futures?.allowed ? "WARN" : "INFO") : "WARN")} aria-label={T.risk.heading}>
            {!risk?.ok ? <p style={{ lineHeight: 1.55 }}>{T.risk.unreadable}</p> : <>
              {riskOzeti(risk).map((l, i) => <p key={i} style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{l}</p>)}
              <details style={{ marginTop: ".6rem" }}>
                <summary style={{ cursor: "pointer", minHeight: DOKUN, display: "flex", alignItems: "center" }}>{T.risk.change}</summary>
                <p style={{ margin: ".4rem 0", lineHeight: 1.55, color: "#9a9aa2" }}>{T.risk.changeHelp}</p>
                {RISK_ALANLARI.map((f) => (
                  <div key={f.alan} style={{ borderTop: "1px solid #23232a", padding: ".5rem 0" }}>
                    <label style={secimEtiketi}>
                      <input type="checkbox" checked={!!riskSecili[f.alan]} onChange={(e) => setRiskSecili({ ...riskSecili, [f.alan]: e.target.checked })} aria-label={fill(T.risk.fieldAria, { name: riskAd(f.alan) })} />
                      <span>{riskAd(f.alan)}</span>
                    </label>
                    {/* Tur 38 madde 2c: değer alanının GÖRÜNÜR etiketi `htmlFor` ile bağlı (yalnız aria-label değil) — ekran okuyucu ve göz aynı adı okur. */}
                    {riskSecili[f.alan] && <label htmlFor={`risk-deger-${f.alan}`} style={{ display: "block", margin: ".35rem 0 .2rem", color: "#9a9aa2" }}>{fill(f.tip === "sayı" || f.tip === "ondalık" ? T.risk.fieldNewClearable : T.risk.fieldNew, { name: riskAd(f.alan) })}</label>}
                    {riskSecili[f.alan] && (f.tip === "kip"
                      ? <select id={`risk-deger-${f.alan}`} value={deger(f.alan)} onChange={(e) => setRiskDeger({ ...riskDeger, [f.alan]: e.target.value })} style={alanStili}>
                          <option value="">{T.common.choose}</option>
                          {(risk.allowed?.shortModes ?? []).map((m) => <option key={m} value={m}>{kipAdi(m)}</option>)}
                        </select>
                      : f.tip === "şalter"
                      ? <select id={`risk-deger-${f.alan}`} value={deger(f.alan)} onChange={(e) => setRiskDeger({ ...riskDeger, [f.alan]: e.target.value })} style={alanStili}>
                          <option value="">{T.common.choose}</option><option value="kapali">{T.common.off}</option>{acikSunulur && <option value="acik">{T.common.on}</option>}
                        </select>
                      : <input id={`risk-deger-${f.alan}`} value={deger(f.alan)} onChange={(e) => setRiskDeger({ ...riskDeger, [f.alan]: e.target.value })} inputMode="decimal"
                          style={{ ...alanStili, width: "8rem" }} />)}
                    {riskSecili[f.alan] && f.tip === "şalter" && !acikSunulur && <p style={{ margin: ".35rem 0 0", lineHeight: 1.5, color: "#9a9aa2" }}>{T.risk.noOpenOption}</p>}
                    {riskSecili[f.alan] && f.tip === "kip" && <p style={{ margin: ".35rem 0 0", lineHeight: 1.5, color: "#9a9aa2" }}>{riskDeger[f.alan] ? `${fill(T.risk.pickedMode, { label: kipAdi(riskDeger[f.alan]), meaning: kipAnlami(riskDeger[f.alan]), todaySee: T.risk.modeTodaySee })} ${risk.allowed?.shortModeToday?.[riskDeger[f.alan]] ? fill(T.risk.modeToday, { today: risk.allowed.shortModeToday[riskDeger[f.alan]] }) : T.risk.modeNoToday}` : T.risk.pickMode}</p>}
                  </div>))}
                {RISK_ALANLARI.some((f) => riskSecili[f.alan]) && <label style={{ ...kodEtiket, margin: ".6rem 0 .3rem" }}>{T.risk.codeLabel}
                  <input id="risk-kod" value={riskTotp} onChange={(e) => setRiskTotp(e.target.value)} inputMode="numeric" maxLength={6} autoComplete="one-time-code" style={{ ...alanStili, width: "7rem" }} />
                </label>}
                <button onClick={() => void riskUygula()} disabled={!riskHazir} style={dugme(riskHazir, true)}>{T.risk.apply}</button>
                {riskSonuc !== null && <p role="status" aria-live="polite" style={{ margin: ".5rem 0", lineHeight: 1.55 }}>{riskSonuc}</p>}
              </details>
              <KaldiracYuzeyi pasif={!risk.futures?.allowed} />
              <TeknikAyrinti satirlar={riskSatirlari(risk)} />
            </>}
          </section>

          <h2 id="risk-paylari" style={{ fontSize: "1.05rem", marginTop: "1.4rem" }}>{T.caps.heading}</h2>
          <p data-ne-yapar style={NE}>{T.caps.what}</p>
          <section id="risk-paylari-ayar" style={box(v.riskCaps.ok && v.riskCaps.singlePct !== null && v.riskCaps.totalPct !== null ? "INFO" : "WARN")} aria-label={T.caps.heading}>
            <p id="risk-paylari-deger" style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{!v.riskCaps.ok ? T.caps.unreadable : fill(T.caps.value, { single: v.riskCaps.singlePct === null ? T.common.notSetUpper : yuzde(v.riskCaps.singlePct), total: v.riskCaps.totalPct === null ? T.common.notSetUpper : yuzde(v.riskCaps.totalPct) })}</p>
            <p style={{ margin: ".3rem 0", lineHeight: 1.55, color: "#b4b4bb" }}>{T.caps.effect}</p>
            {!v.riskCaps.ok ? <p style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{T.caps.formUnreadable}</p> : <div style={{ borderTop: "1px solid #23232a", paddingTop: ".5rem", marginTop: ".5rem" }}>
              <p style={{ margin: ".3rem 0 .5rem", lineHeight: 1.55, color: "#b4b4bb" }}>{T.caps.help}</p>
              <label htmlFor="pay-tek" style={{ display: "block", margin: ".5rem 0 .25rem", lineHeight: 1.45 }}>{T.caps.singleLabel} <span style={{ color: "#b4b4bb" }}>{fill(T.caps.current, { value: v.riskCaps.singlePct === null ? T.common.notSet : yuzde(v.riskCaps.singlePct) })}</span></label>
              <input id="pay-tek" value={payTek} onChange={(e) => setPayTek(e.target.value)} inputMode="decimal" autoComplete="off" disabled={payGonderiliyor} style={{ ...alanStili, width: "9rem" }} />
              <label htmlFor="pay-toplam" style={{ display: "block", margin: ".6rem 0 .25rem", lineHeight: 1.45 }}>{T.caps.totalLabel} <span style={{ color: "#b4b4bb" }}>{fill(T.caps.current, { value: v.riskCaps.totalPct === null ? T.common.notSet : yuzde(v.riskCaps.totalPct) })}</span></label>
              <input id="pay-toplam" value={payToplam} onChange={(e) => setPayToplam(e.target.value)} inputMode="decimal" autoComplete="off" disabled={payGonderiliyor} style={{ ...alanStili, width: "9rem" }} />
              <label htmlFor="pay-kod" style={{ display: "block", margin: ".6rem 0 .25rem", lineHeight: 1.45 }}>{T.risk.codeLabel}</label>
              <input id="pay-kod" value={payKod} onChange={(e) => setPayKod(e.target.value)} inputMode="numeric" maxLength={6} autoComplete="one-time-code" disabled={payGonderiliyor} style={{ ...alanStili, width: "7rem" }} />
              <p style={{ margin: ".7rem 0 0" }}><button id="pay-uygula" type="button" onClick={() => void payUygula()} disabled={!payHazir} style={dugme(payHazir, true)}>{T.caps.apply}</button></p>
            </div>}
            <div id="pay-sonuc" role="status" aria-live="polite">{paySonuc !== null && <p style={{ margin: ".5rem 0", lineHeight: 1.55 }}>{paySonuc}</p>}</div>
            <TeknikAyrinti satirlar={[T.technical.sharesStorage, ...(paylar?.ok ? (paylar.changes ?? []).map((c) => fill(T.technical.sharesChange, { at: anTr(c.at), by: kimAdi(c.by), changes: c.changes.map((x) => `${x.field}: ${x.from ?? T.common.wasUnset} → ${x.to ?? T.common.nowUnset}`).join(" · ") })) : [])]} />
          </section>

          <h2 id="giris-salteri" style={{ fontSize: "1.05rem", marginTop: "1.4rem" }}>{T.entry.heading}</h2>
          <p data-ne-yapar style={NE}>{T.entry.what}</p>
          <GirisSalteriYuzeyi ayar={giris} yenile={load} />

          <h2 id="kilit-ayari" style={{ fontSize: "1.05rem", marginTop: "1.4rem" }}>{T.lock.heading}</h2>
          <KilitAyarYuzeyi ayar={kilitAyar} dogrulayiciVar={dogrulayici} yenile={kilitAyariniYenile} yer="panel" />
        </div>

        {/* ---- HISTORY ---- */}
        <div role="tabpanel" id="sekme-history" aria-labelledby="sekme-dugme-history" hidden={sekme !== "history"} style={panelGorunur("history")}>
          <GecmisSekmesi v={v} settings={settings} risk={risk} paylar={paylar} />
        </div>

        {/* ---- TECHNICAL: eski panelin BÜTÜN ölçüm ayrıntısı (sunucunun kendi cümleleri) — silinmedi, taşındı ---- */}
        <div role="tabpanel" id="sekme-technical" aria-labelledby="sekme-dugme-technical" hidden={sekme !== "technical"} style={panelGorunur("technical")}>
          <p style={{ color: "#9a9aa2", margin: "0 0 .6rem", lineHeight: 1.55 }}>{T.technical.intro}</p>
          <p style={{ color: "#9a9aa2", margin: "0 0 1rem", lineHeight: 1.55 }}>{T.panel.measuredNote}</p>
          {v.alerts.length > 0 && <div><h2 style={{ fontSize: "1.05rem", marginTop: "1.2rem" }}>{T.technical.alertsHeading}</h2>{v.alerts.map((c, i) => <CardBlock key={i} c={c} head={T.technical.alertTag} />)}</div>}
          <h2 style={{ fontSize: "1.05rem", marginTop: "1.4rem" }}>{T.technical.engineHeading}</h2>
          <CardBlock c={v.engine} /><CardBlock c={v.tick} /><CardBlock c={v.health} />
          <h2 style={{ fontSize: "1.05rem", marginTop: "1.4rem" }}>{T.technical.positionsHeading}</h2>
          <CardBlock c={v.positions.card} />
          {v.positions.rows.map((p) => <CardBlock key={p.id} c={{ level: p.level, title: p.title, lines: p.lines }} head={T.technical.positionTag} />)}
          <h2 style={{ fontSize: "1.05rem", marginTop: "1.4rem" }}>{T.technical.sourcesHeading}</h2>
          <section style={box("INFO")}>{v.sources.map((s, i) => <p key={i} style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{s}</p>)}
            <p style={{ margin: ".3rem 0", lineHeight: 1.55 }}>{fill(T.technical.filledAt, { at: anTr(v.at) })}</p>
            <button onClick={() => void load()} style={dugme(true)}>{T.technical.reload}</button>
          </section>
        </div>
      </div>
    </main>
  );
}
