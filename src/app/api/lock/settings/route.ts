// BİYOMETRİK KİLİT AYARI UCU (Tur 40 · G20 parça 2B · Tur 63 yazma yüzeyi). Sınıflar (G04): GET session · POST sensitive + LOCK_SETTINGS_CHANGE (oturum + eylem başına TOTP, S-8).
// POST NEDEN HASSAS (türetildi, icat değil): biyometrik kilit tam da OTURUMU ELE GEÇİREN saldırgana karşı vardır (açık telefon, çalınmış çerez). Yalnız oturumla kapatılabilseydi
//   koruduğu TEK tehdide karşı işe yaramazdı ⇒ S-8 "erişim korunur" gereği ikinci etken şart. Ad hassas eylem sicilinde (tek kaynak); durdurma bu listede DEĞİLDİR ve olmayacaktır (K-7).
// POST { enabled?: boolean, repromptSeconds?: number|null } — açık liste dışı alan, 0/negatif/ondalık süre ve BOŞ yama REDDEDİLİR (400); satır yoksa 409; depo düşerse 503 ve ayar DEĞİŞMEZ.
// BU UÇ HİÇBİR SAYI ÖNERMEZ: `repromptSeconds` için varsayılan/öneri değer yoktur (A-1, K-11 — sayı iş sahibinindir). Ayar değişmesi motoru ETKİLEMEZ ve hiçbir emir göndermez.
// Okunamayan ayar 503 + ok:false döner; panel bunu "kapalı" değil "bilinmiyor" sayar (Ö-2). Durdurma ucu bu ayara DOKUNMAZ (K-7).
import { withAccess } from "@/lib/access";
import { readLockSettings, writeLockSettings } from "@/lib/lock";
import { forRequest } from "@/lib/i18n/request";
// Tur 79 (G34): insan metni isteğin dilinde (`forRequest`: seçim çerezi → Accept-Language → EN); durum kodu, ret kodu ve JSON anahtarları dilden bağımsız.
export const dynamic = "force-dynamic";
// BÖLGE (Tur 12, G11 · S-5): bölge ABD DIŞI sabit; Edge YASAK (Edge bölgesi çağırana göre seçilir). Değer src/lib/region.ts BINANCE_REGION ile birebir aynı olmalı (kapı ölçer).
export const runtime = "nodejs";
export const preferredRegion = "hnd1";

export const GET = withAccess({ cls: "session" }, async (req) => { const r = await readLockSettings(undefined, forRequest(req).lang); return Response.json(r, { status: r.ok ? 200 : 503 }); });

export const POST = withAccess({ cls: "sensitive", action: "LOCK_SETTINGS_CHANGE" }, async (req) => {
  const { lang, T } = forRequest(req);
  let body: unknown; try { body = await req.json(); } catch { body = null; }
  const w = await writeLockSettings((body ?? {}) as Record<string, never>, undefined, lang);
  if (!w.ok) return Response.json(w, { status: w.status });
  return Response.json({ ok: true, applied: w.changes, next: w.next,
    note: T.api.lockApplied,
    view: await readLockSettings(undefined, lang) }, { status: 200 });
});
