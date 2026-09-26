// MALİYET TAVANINI DÜŞÜRME / BOŞALTMA — SERBEST (KODSUZ) UÇ (Tur 65 · 3e · bitiş listesi madde 2). Sınıf (G04): POST session — oturum ister, tek kullanımlık kod İSTEMEZ.
// NEDEN KODSUZ (türetildi, icat değil): tavanı DÜŞÜRMEK ya da (davranış "Beyin çağrılmaz" iken) BOŞALTMAK harcamayı AZALTAN yöndedir; giriş şalterini kapatmak ve motoru durdurmak gibi
//   hiçbir doğrulama onu geciktirmemelidir. YÜKSELTMEK, davranışı "sınır yok"a çevirmek ya da "sınır yok" iken boşaltmak harcamayı ARTIRIR ⇒ bu uç onları REDDEDER (403 RAISES_SPEND)
//   ve ayar DEĞİŞMEZ; o değişiklikler hassas uçtan (`POST /api/brain/settings`, oturum + TOTP + E-1) yapılır. Karar yazma yolunun İÇİNDEDİR (`writeBrainSettings`, direction "tighten"),
//   bu uçta değil: uç yalnız yönü bildirir. Tur 66 (1d): model/sıklık/aday/mum da bu uçtan AZALTAN yönde değişir (ucuz model · seyrek çağrı · daha az aday/mum); artıran ya da yönü ölçülemeyen değişiklik 403.
// Her kabul edilen değişiklik E-1 defterine ayarla AYNI işlemde yazılır (kim · ne zaman · eski → yeni). Bu uç motoru başlatmaz, durdurmaz ve emir göndermez.
import { withAccess } from "@/lib/access";
import { writeBrainSettings, type SettingsPatch } from "@/lib/brain-settings";
import { forRequest } from "@/lib/i18n/request";
// Tur 79 (G34): insan metni isteğin dilinde (`forRequest`: seçim çerezi → Accept-Language → EN); durum kodu, ret kodu ve JSON anahtarları dilden bağımsız.
export const dynamic = "force-dynamic";
// BÖLGE (Tur 12, G11 · S-5): bölge ABD DIŞI sabit; Edge YASAK (Edge bölgesi çağırana göre seçilir). Değer src/lib/region.ts BINANCE_REGION ile birebir aynı olmalı (kapı ölçer).
export const runtime = "nodejs";
export const preferredRegion = "hnd1";

const BY = "sahip · oturum (serbest yön: harcama izni artmıyor)";

export const POST = withAccess({ cls: "session" }, async (req) => {
  const { lang, T } = forRequest(req);
  let body: unknown; try { body = await req.json(); } catch { body = null; }
  const patch = (body && typeof body === "object" ? body : {}) as SettingsPatch;
  const w = await writeBrainSettings(patch, BY, { direction: "tighten", lang });
  if (!w.ok) return Response.json(w, { status: w.status });
  return Response.json({ ok: true, applied: w.changes, next: w.next, note: T.api.brainTightened }, { status: 200 });
});
