// RİSK AYARLARI YÜZEYİ (Tur 36, G21 kalemleri b · d · g). Sınıflar (G04): GET session · POST sensitive + RISK_SETTINGS_CHANGE (oturum + eylem başına TOTP, S-8).
// GET: şu anki ayar · futures hükmü (açık/kapalı ve SEBEBİ adıyla) · YALNIZ VERİDEN kurulmuş cümle (U-3: boş/NULL ne demek yazılı) · izinli kipler · son değişiklikler (E-1 izi).
// POST: { leverageCap?, futuresEnabled?, shortMode?, m2FuturesMultiple? } — açık liste dışı kip, sınır dışı sayı ve TAVANSIZ ŞALTER REDDEDİLİR (400); yazma ve E-1 defteri AYNI işlemde.
// BU UÇ HİÇBİR SAYI ÖNERMEZ: kaldıraç tavanı için varsayılan/öneri/örnek değer yoktur (A-1, K-11 — sayı iş sahibinindir). Ayar değişmesi tek başına hiçbir emir göndermez.
import { withAccess } from "@/lib/access";
import { readRiskRuntime, prismaRiskSettingsStore, writeRiskSettings, SHORT_MODES, SHORT_MODE_NOTES, SHORT_MODE_TODAY, FUTURES_REFUSAL_TEXT } from "@/lib/risk-settings";
export const dynamic = "force-dynamic";
// BÖLGE (Tur 12, G11 · S-5): bölge ABD DIŞI sabit; Edge YASAK (Edge bölgesi çağırana göre seçilir). Değer src/lib/region.ts BINANCE_REGION ile birebir aynı olmalı (kapı ölçer).
export const runtime = "nodejs";
export const preferredRegion = "hnd1";

const view = async () => {
  const r = await readRiskRuntime();
  if (!r.ok) return { ok: false as const, reason: r.refusal, detail: r.detail };
  const rt = r.runtime, changes = await prismaRiskSettingsStore().changes(10).catch(() => []);
  return { ok: true as const, settings: r.row, source: rt.source, sentence: rt.sentence,
    futures: rt.futures.allowed ? { allowed: true, leverageCap: rt.futures.leverageCap, note: "ayar futures'a izin veriyor; futures EMİR YOLU henüz yazılmadı (G21 kalemi f, A-5) — emir yine de çıkmaz" }
      : { allowed: false, refusal: rt.futures.refusal, detail: rt.futures.detail, note: FUTURES_REFUSAL_TEXT[rt.futures.refusal] },
    allowed: { shortModes: SHORT_MODES, shortModeNotes: SHORT_MODE_NOTES, shortModeToday: SHORT_MODE_TODAY, leverageCap: "pozitif tamsayı ya da boş (boş = seçilmedi ⇒ futures kapalı); ÜST SINIR KODDA YOK — sayı iş sahibinin kararıdır (A-1, K-11)",
      m2FuturesMultiple: "pozitif ondalık ya da boş; BİRİM: ÇARPAN (maliyetin katı), baz puan DEĞİL" },
    changes: changes.map((c) => ({ at: c.at.toISOString(), by: c.by, changes: c.changes })) };
};

export const GET = withAccess({ cls: "session" }, async () => { const v = await view(); return Response.json(v, { status: v.ok ? 200 : 503 }); });

export const POST = withAccess({ cls: "sensitive", action: "RISK_SETTINGS_CHANGE" }, async (req) => {
  let body: unknown; try { body = await req.json(); } catch { body = null; }
  const w = await writeRiskSettings((body ?? {}) as Record<string, never>, "sahip · oturum + TOTP");
  if (!w.ok) return Response.json(w, { status: w.status });
  return Response.json({ ok: true, applied: w.changes, next: w.next, note: "değişiklik ANINDA etkilidir (yeniden dağıtım gerekmez) ve hiçbir emir göndermez; futures emir yolu ayrıca yazılmadı (G21 kalemi f)", view: await view() }, { status: 200 });
});
