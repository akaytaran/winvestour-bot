// CİHAZ KAYIT UCU (Tur 28, G20 madde 4 · G04 `session`). Telefon uygulamayı her açtığında kayıt jetonunu buraya gönderir; bildirim BURADA kayıtlı adrese gider.
// SINIF `session`: kimliksiz çağrı cihaz EKLEYEMEZ (401). `sensitive` DEĞİL — her uygulama açılışında tek kullanımlık kod istemek kaydı pratikte imkânsız kılar ve
// kaydı olmayan telefon bildirim ALAMAZ (U-2'nin sözü kaydın kolaylığına bağlıdır). Jeton yanıta geri YAZILMAZ; kaç cihaz kayıtlı olduğu sayıyla döner (U-3).
import { withAccess } from "@/lib/access";
import { registerDevice } from "@/lib/notify/devices";
import { notifyState } from "@/lib/notify";
import { forRequest } from "@/lib/i18n/request";
// Tur 82 (D2): Firebase eklentisi EKLENMEMİŞSE (ya da yarımsa) not "bu cihaz bildirim alacak" DEMEZ — sahte başarı yok; durum kodu ve JSON anahtarları aynı.
// Tur 79 (G34): insan metni isteğin dilinde (`forRequest`: seçim çerezi → Accept-Language → EN); durum kodu, ret kodu ve JSON anahtarları dilden bağımsız.
export const dynamic = "force-dynamic";
// BÖLGE (Tur 12, G11 · S-5): bölge ABD DIŞI sabit; Edge YASAK (Edge bölgesi çağırana göre seçilir). Değer src/lib/region.ts BINANCE_REGION ile birebir aynı olmalı (kapı ölçer).
export const runtime = "nodejs";
export const preferredRegion = "hnd1";

export const POST = withAccess({ cls: "session" }, async (req) => {
  let body: unknown; try { body = await req.json(); } catch { body = null; }
  const r = await registerDevice(body, new Date());
  if (!r.ok) return Response.json({ ok: false, reason: r.reason }, { status: r.status });
  return Response.json({ ok: true, devices: r.devices, note: notifyState().state === "ON" ? forRequest(req).T.api.deviceRegistered : forRequest(req).T.api.deviceRegisteredOff }, { status: 200 });
});
