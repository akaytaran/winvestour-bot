// RİSK AYARLARI YÜZEYİ (Tur 36, G21 kalemleri b · d · g). Sınıflar (G04): GET session · POST sensitive + RISK_SETTINGS_CHANGE (oturum + eylem başına TOTP, S-8).
// GET: şu anki ayar · futures hükmü (açık/kapalı ve SEBEBİ adıyla) · YALNIZ VERİDEN kurulmuş cümle (U-3: boş/NULL ne demek yazılı) · izinli kipler · son değişiklikler (E-1 izi).
// POST: { leverageCap?, futuresEnabled?, shortMode?, m2FuturesMultiple? } — açık liste dışı kip, sınır dışı sayı ve TAVANSIZ ŞALTER REDDEDİLİR (400); yazma ve E-1 defteri AYNI işlemde.
// BU UÇ HİÇBİR SAYI ÖNERMEZ: kaldıraç tavanı için varsayılan/öneri/örnek değer yoktur (A-1, K-11 — sayı iş sahibinindir). Ayar değişmesi tek başına hiçbir emir göndermez.
import { withAccess } from "@/lib/access";
import { readRiskRuntime, prismaRiskSettingsStore, writeRiskSettings, SHORT_MODES, shortModeNotes, shortModeToday, futuresRefusalText } from "@/lib/risk-settings";
import { type Dict } from "@/lib/i18n";
import { forRequest } from "@/lib/i18n/request";
// Tur 79 (G34): insan metni isteğin dilinde (`forRequest`: seçim çerezi → Accept-Language → EN); durum kodu, ret kodu ve JSON anahtarları dilden bağımsız.
export const dynamic = "force-dynamic";
// BÖLGE (Tur 12, G11 · S-5): bölge ABD DIŞI sabit; Edge YASAK (Edge bölgesi çağırana göre seçilir). Değer src/lib/region.ts BINANCE_REGION ile birebir aynı olmalı (kapı ölçer).
export const runtime = "nodejs";
export const preferredRegion = "hnd1";

const view = async (lang: string, T: Dict) => {
  const r = await readRiskRuntime({ lang });
  if (!r.ok) return { ok: false as const, reason: r.refusal, detail: r.detail };
  const rt = r.runtime, changes = await prismaRiskSettingsStore().changes(10).catch(() => []);
  return { ok: true as const, settings: r.row, source: rt.source, sentence: rt.sentence,
    futures: rt.futures.allowed ? { allowed: true, leverageCap: rt.futures.leverageCap, note: T.api.riskFuturesAllowed }
      : { allowed: false, refusal: rt.futures.refusal, detail: rt.futures.detail, note: futuresRefusalText(lang)[rt.futures.refusal] },
    allowed: { shortModes: SHORT_MODES, shortModeNotes: shortModeNotes(lang), shortModeToday: shortModeToday(lang), leverageCap: T.api.riskLeverageCapHint,
      m2FuturesMultiple: T.api.riskM2Hint },
    changes: changes.map((c) => ({ at: c.at.toISOString(), by: c.by, changes: c.changes })) };
};

export const GET = withAccess({ cls: "session" }, async (req) => { const { lang, T } = forRequest(req), v = await view(lang, T); return Response.json(v, { status: v.ok ? 200 : 503 }); });

export const POST = withAccess({ cls: "sensitive", action: "RISK_SETTINGS_CHANGE" }, async (req) => {
  const { lang, T } = forRequest(req);
  let body: unknown; try { body = await req.json(); } catch { body = null; }
  const w = await writeRiskSettings((body ?? {}) as Record<string, never>, "sahip · oturum + TOTP", { lang });
  if (!w.ok) return Response.json(w, { status: w.status });
  return Response.json({ ok: true, applied: w.changes, next: w.next, note: T.api.riskApplied, view: await view(lang, T) }, { status: 200 });
});
