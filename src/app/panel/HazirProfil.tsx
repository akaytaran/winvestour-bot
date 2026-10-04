"use client";
// HAZIR PROFİL SEÇİCİ (Tur 87 · G38 · iş sahibi kararları D6/D6' · Üretim S16-4 · U-3, U-4, S-8). Settings sekmesinin başında durur; GET/POST /api/risk/preset.
// SAYI BU DOSYADA DA SÖZLÜKTE DE YOKTUR: her sayı uçtan gelir (profil payları tek kaynakta, tutarlar bakiyeden türetilmiş) ve `fmt` ile insan birimiyle yazılır (USDT, %, dakika).
// Yeni kurulumda hiçbir profil SEÇİLİ DEĞİL; seçim yalnız düğme + tek kullanımlık kodla olur (önceden işaretli seçim YOK). Açılamayacak profilin düğmesi kapalıdır ve nedeni kartta yazar.
// Uzun açıklama (i) modalındadır (BilgiModali, Tur 83 bileşeni); "yatırım tavsiyesi değildir" cümlesi README'deki onaylı metnin AYNISI (kapı: gate:risk-presets). Renkler mevcut paletten.
// Tur 88 (G37 · D3, S17-6): "ne yapar" cümlesi, profil tanımları (blurb), seçili profilin ve bakiyenin uzun cümleleri de modalda; sayfada ad + değer + tek satır durum + kontrol.
//   Kartta görünür kalan iki UYARI: önerilmeme nedeni (seçim kapalı) ve "sınırda" (Üretim S17-3) — ikisi de seçim anında okunması gereken bilgidir.
import { useCallback, useEffect, useState } from "react";
import { BilgiModali } from "./BilgiModali";
import { dict, fill } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/format";
import type { PresetView, PresetCard } from "@/lib/risk-presets";

const T = dict(), DOKUN = "2.75rem";
const kutu: React.CSSProperties = { background: "#141419", border: "1px solid #33333c", borderRadius: 8, padding: ".8rem .9rem", minWidth: 0 };
const satir: React.CSSProperties = { margin: ".3rem 0", lineHeight: 1.55, overflowWrap: "anywhere" };
const dugme = (etkin: boolean, vurgu = false): React.CSSProperties => ({ minHeight: DOKUN, padding: ".45rem .9rem", borderRadius: 6, border: `1px solid ${vurgu && etkin ? "#2b7fc9" : "#33333c"}`,
  background: vurgu && etkin ? "#12354f" : "#1a1a20", color: "#e8e8ea", cursor: etkin ? "pointer" : "not-allowed" });

function Kart({ c, v, sec, secili }: { c: PresetCard; v: Extract<PresetView, { ok: true }>; sec: (n: string) => void; secili: boolean }) {
  const P = T.preset, ad = P.names[c.name], s = c.values.settings, b = v.balance, plan = c.plan;
  const pay = c.values.shares;
  return (<article data-profil-kart={c.name} aria-label={ad} style={{ ...kutu, borderColor: secili ? "#2b7fc9" : "#33333c" }}>
    <h3 style={{ fontSize: "1rem", margin: "0 0 .3rem" }}>{ad}{v.selected === c.name ? ` — ${v.custom ? P.customTag : P.selectedTag}` : ""}</h3>
    {b.ok && plan ? <>
      <p data-profil-tek data-satir="deger" style={satir}>{fill(P.single, { usdt: plan.positionUsdt === null ? T.common.notSet : fmt.usdt(plan.positionUsdt), pct: fmt.pct(pay.singlePositionPct) })}</p>
      <p data-profil-toplam data-satir="deger" style={satir}>{fill(P.total, { usdt: fmt.usdt(plan.totalUsdt), pct: fmt.pct(pay.totalExposurePct) })}</p>
      {plan.proposable ? <p data-profil-sayi data-satir="deger" style={satir}>{fill(P.count, { n: plan.maxConcurrent })}</p>
        : <p data-profil-onerilmez data-satir="uyari" role="note" style={{ ...satir, color: "#ffd479" }}>{fill(P.notOpenable, { free: fmt.usdt(b.freeQuote), min: fmt.usdt(b.minNotional), pct: fmt.pct(pay.singlePositionPct), usdt: fmt.usdt(plan.positionUsdt ?? "0") })}</p>}
      {plan.borderline && <p data-profil-sinirda data-satir="uyari" role="note" style={{ ...satir, color: "#ffd479" }}>{fill(P.borderline, { usdt: fmt.usdt(plan.positionUsdt ?? "0"), min: fmt.usdt(b.minNotional) })}</p>}
    </> : <p data-satir="deger" style={satir}>{fill(P.sharesOnly, { single: fmt.pct(pay.singlePositionPct), total: fmt.pct(pay.totalExposurePct) })}</p>}
    <p data-profil-futures data-satir="deger" style={satir}>{s.futuresEnabled ? fill(T.brief.cardFuturesOn, { cap: s.leverageCap ?? "" }) : c.values.futuresBlocked ? T.brief.cardFuturesBlocked : T.brief.cardFuturesOff}</p>
    <p data-satir="deger" style={satir}>{T.brief.cardShortOff}</p>
    <p data-satir="deger" style={satir}>{fill(P.tick, { every: fmt.every(c.values.tickMs) })}</p>
    <button type="button" data-profil-sec={c.name} disabled={plan !== null && !plan.proposable} aria-pressed={secili} onClick={() => sec(c.name)} style={{ ...dugme(plan === null || plan.proposable, true), marginTop: ".4rem" }}>{fill(P.choose, { name: ad })}</button>
  </article>);
}

export function HazirProfil({ yenile }: { yenile: () => Promise<void> }) {
  const P = T.preset;
  const [v, setV] = useState<PresetView | null>(null), [okunamadi, setOkunamadi] = useState(false);
  const [secim, setSecim] = useState<string>(""), [totp, setTotp] = useState(""), [sonuc, setSonuc] = useState<string | null>(null), [gonder, setGonder] = useState(false);
  const oku = useCallback(async () => { try { const r = await fetch("/api/risk/preset", { cache: "no-store" }); const j = (await r.json()) as PresetView; setV(j); setOkunamadi(!j.ok); } catch { setOkunamadi(true); } }, []);
  useEffect(() => { void oku(); }, [oku]);
  const uygula = async () => {
    setGonder(true); setSonuc(null); let r: Response | null; try { r = await fetch("/api/risk/preset", { method: "POST", headers: { "content-type": "application/json", "x-totp-code": totp }, body: JSON.stringify({ preset: secim }) }); } catch { r = null; }
    setSonuc(!r ? P.failed : r.ok ? P.applied : r.status === 401 || r.status === 403 ? P.rejected403 : r.status === 409 ? P.rejected409 : P.failed);
    setTotp(""); setGonder(false); if (r?.ok) { setSecim(""); await oku(); await yenile(); }
  };
  // Tur 88 (G37): modal = "ne yapar" + profil tanımları + seçili profilin / bakiyenin uzun cümlesi + kartın futures/short uzun cümleleri + Tur 87 anlatımı (anlam aynı, yer değişti).
  const uzunDurum = !v?.ok ? null : v.selected === null ? P.selectedNone : fill(v.custom ? P.custom : P.selected, { name: P.names[v.selected] });
  const uzunBakiye = !v?.ok ? null : v.balance.ok ? fill(P.balance, { free: fmt.usdt(v.balance.freeQuote), min: fmt.usdt(v.balance.minNotional), symbol: v.balance.symbol }) : P.balanceUnknown[v.balance.why];
  const ornek = v?.ok ? v.cards.find((c) => c.values.settings.futuresEnabled) : undefined;
  const bilgi = { baslik: P.heading, acEtiketi: fill(T.info.open, { name: P.heading }), kapatEtiketi: T.info.close, satirlar: [P.what, ...(["CAUTIOUS", "BALANCED", "RISKY"] as const).map((n) => `${P.names[n]}: ${P.blurb[n]}`),
    uzunDurum, uzunBakiye, ornek ? fill(P.futuresOn, { cap: ornek.values.settings.leverageCap ?? "", m2: ornek.values.settings.m2FuturesMultiple ?? "" }) : null, P.futuresOff, P.futuresBlocked, P.shortOff,
    P.infoWhat, P.infoScale, P.infoNew, P.infoCustom, P.infoFutures, P.infoCost, P.infoAdvice].filter((x): x is string => typeof x === "string" && x !== "") };
  return (<section id="hazir-profil" aria-label={P.heading} style={{ margin: ".6rem 0 1.2rem" }}>
    <div style={{ display: "flex", alignItems: "center", gap: ".5rem", justifyContent: "space-between" }}>
      <h2 style={{ fontSize: "1.05rem", margin: ".4rem 0" }}>{P.heading}</h2>
      <BilgiModali kimlik="preset" data-ne-yapar metin={bilgi} />
    </div>
    {okunamadi || !v ? <p role="status" style={satir}>{okunamadi ? P.unreadable : P.loading}</p> : !v.ok ? <p data-satir="uyari" style={satir}>{P.unreadable}</p> : <>
      <p data-profil-durum data-satir="durum" style={satir}>{v.selected === null ? T.brief.presetNone : v.custom ? fill(T.brief.presetCustom, { name: P.names[v.selected] }) : fill(P.selected, { name: P.names[v.selected] })}</p>
      {v.balance.ok ? <div data-profil-bakiye><p data-satir="deger" style={satir}>{fill(T.brief.freeBalance, { free: fmt.usdt(v.balance.freeQuote) })}</p>
        <p data-satir="deger" style={satir}>{fill(T.brief.minOrder, { min: fmt.usdt(v.balance.minNotional), symbol: v.balance.symbol })}</p></div>
        : <p data-profil-bakiye data-satir="durum" style={satir}>{T.brief.balance[v.balance.why]}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(15rem, 1fr))", gap: ".7rem", margin: ".6rem 0" }}>
        {v.cards.map((c) => <Kart key={c.name} c={c} v={v} sec={setSecim} secili={secim === c.name} />)}
      </div>
      {secim && <div data-profil-onay style={{ ...kutu, marginTop: ".4rem" }}>
        <p data-satir="geri" style={satir}>{fill(P.confirm, { name: P.names[secim as keyof typeof P.names] })}</p>
        <label style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: ".5rem" }}>{P.codeLabel}
          <input value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" aria-label={P.codeLabel}
            style={{ minHeight: DOKUN, boxSizing: "border-box", padding: ".3rem .5rem", background: "#141419", color: "#e8e8ea", border: "1px solid #33333c", borderRadius: 5, width: "8rem" }} /></label>
        <p style={{ display: "flex", flexWrap: "wrap", gap: ".5rem", margin: ".5rem 0 0" }}>
          <button type="button" data-profil-uygula disabled={gonder || totp.length !== 6} onClick={() => void uygula()} style={dugme(!gonder && totp.length === 6, true)}>{P.apply}</button>
          <button type="button" onClick={() => { setSecim(""); setTotp(""); }} style={dugme(true)}>{P.cancel}</button></p>
      </div>}
      {sonuc && <p data-profil-sonuc role="status" style={satir}>{sonuc}</p>}
    </>}
  </section>);
}
