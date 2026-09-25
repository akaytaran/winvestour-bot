// GİRİŞ ŞALTERİ UCU (Tur 64 · G28 kutu 4 · K-2, S-8, Ö-2, E-1). Sınıflar (G04): GET session · POST sensitive + ENTRY_SETTINGS_CHANGE (oturum + eylem başına TOTP).
// POST NEDEN HASSAS (türetildi, icat değil): bu şalter, motorun KENDİ KARARIYLA gerçek parayla giriş emri göndermesine izin veren TEK ayardır. Oturumu ele geçiren biri
//   onu açabilseydi, para hareketi tek bir çerezin arkasında kalırdı ⇒ S-8 gereği ikinci etken şart. Ad hassas eylem sicilinde (tek kaynak, `sensitive-actions.ts`).
// KAPATMA DA AYNI UÇTAN GEÇER ama hiçbir şeyi bekletmez: kapatma para hareketini DURDURAN yöndedir. Yine de `/durdur` ekranı bu uca ve bu ayara HİÇ bağlı değildir (K-7) —
//   ayar deposu tamamen düşse bile motor durdurulabilir. Bu uç motoru başlatmaz, durdurmaz ve HİÇBİR EMİR GÖNDERMEZ; yalnız "giriş emri gönderilebilir mi" sorusunu ayarlar.
// POST { enabled: boolean } — açık liste dışı alan, mantıksal olmayan değer ve BOŞ yama REDDEDİLİR (400); satır yoksa 409; depo ya da E-1 defteri düşerse 503 ve ayar DEĞİŞMEZ.
// Okunamayan ayar GET'te 503 + ok:false döner; panel bunu "kapalı" değil "bilinmiyor" sayar ve giriş yine AÇILMAZ (Ö-2, kapalı arıza).
import { withAccess } from "@/lib/access";
import { entrySentence, readEntrySettings, writeEntrySettings } from "@/lib/entry-settings";
import { eventNote } from "@/lib/events";
export const dynamic = "force-dynamic";
// BÖLGE (Tur 12, G11 · S-5): bölge ABD DIŞI sabit; Edge YASAK (Edge bölgesi çağırana göre seçilir). Değer src/lib/region.ts BINANCE_REGION ile birebir aynı olmalı (kapı ölçer).
export const runtime = "nodejs";
export const preferredRegion = "hnd1";

export const GET = withAccess({ cls: "session" }, async () => {
  const r = await readEntrySettings();
  return Response.json({ ...r, sentence: entrySentence(r) }, { status: r.ok ? 200 : 503 });
});

export const POST = withAccess({ cls: "sensitive", action: "ENTRY_SETTINGS_CHANGE" }, async (req) => {
  let body: unknown; try { body = await req.json(); } catch { body = null; }
  const w = await writeEntrySettings((body ?? {}) as Record<string, never>, "panel");
  if (!w.ok) return Response.json(w, { status: w.status });
  const view = await readEntrySettings();
  // Tur 65 (K1): açmada olay + bildirim sonucu yanıtta görünür (kod: "yazıldı#<id>" ya da "YAZILAMADI:<kod>"); kapatmada "yok".
  return Response.json({ ok: true, applied: w.changes, next: w.next, event: eventNote(w.event),
    note: "giriş şalteri değişti; değişiklik ANINDA etkilidir (yeniden dağıtım gerekmez). Şalter AÇIK olsa bile emir çıkması için Binance anahtarı, sermaye, risk ayarları ve motorun çalışma izni de gerekir. Koruma, çıkış ve durdurma bu ayardan ETKİLENMEZ (K-1/K-2/K-7).",
    sentence: entrySentence(view), view }, { status: 200 });
});
