// HAZIR PROFİL YÜZEYİ (Tur 87 · G38 · D6/D6' · S-8, E-1, U-3). Sınıflar (G04): GET session · POST sensitive + RISK_PRESET_APPLY (oturum + EYLEM BAŞINA tek kullanımlık kod).
// GET: üç profil — her biri yazacağı değerler (pay, futures alanları, tik), serbest bakiyeye göre TÜRETİLMİŞ tutarlar ve öneri hükmü · seçili profil · 'Özel' · anahtarın futures yetkisi.
// POST: { preset: "CAUTIOUS" | "BALANCED" | "RISKY" } — kodsuz istek erişim katmanında REDDEDİLİR (403); bakiyede açılamayacak profil 409 NOT_OPENABLE; tüm ayarlar TEK işlemde (src/lib/risk-presets).
// BU UÇ SAYI ÜRETMEZ: profil sayıları tek kaynaktadır (src/lib/risk-settings/presets.ts); tutarlar bakiyeden türetilir. Seçim tek başına hiçbir emir göndermez; durdurma bu uca bağlı değildir (K-7).
import { withAccess } from "@/lib/access";
import { applyPreset, presetView } from "@/lib/risk-presets";
import { forRequest } from "@/lib/i18n/request";
// Tur 79 (G34): insan metni isteğin dilinde; durum kodu, ret kodu ve JSON anahtarları dilden bağımsız.
export const dynamic = "force-dynamic";
// BÖLGE (Tur 12, G11 · S-5): bölge ABD DIŞI sabit; Edge YASAK. Değer src/lib/region.ts BINANCE_REGION ile birebir aynı olmalı (kapı ölçer).
export const runtime = "nodejs";
export const preferredRegion = "hnd1";

export const GET = withAccess({ cls: "session" }, async () => { const v = await presetView(); return Response.json(v, { status: v.ok ? 200 : 503 }); });

export const POST = withAccess({ cls: "sensitive", action: "RISK_PRESET_APPLY" }, async (req) => {
  const { lang } = forRequest(req);
  let body: unknown; try { body = await req.json(); } catch { body = null; }
  const w = await applyPreset((body as { preset?: unknown } | null)?.preset, "sahip · oturum + TOTP · hazır profil", { lang });
  if (!w.ok) return Response.json(w, { status: w.status });
  return Response.json({ ok: true, applied: w.changes, name: w.name, view: await presetView({ lang }) }, { status: 200 });
});
