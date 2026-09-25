// BEYİN AYARLARI YÜZEYİ (Tur 25, madde 5 — G18'in YALNIZ bu parçası; panelin geri kalanı YOK). Sınıflar (G04): GET session · POST sensitive + BRAIN_SETTINGS_CHANGE (oturum + eylem başına TOTP, S-8).
// GET: şu anki ayar · fiyat satırı (KAYNAK URL + OKUMA TARİHİ + "eski" işareti, Ö-1) · model × sıklık seçenekleri (her biri aylık $, altyapı dâhil toplam $, 10 $ tavanına göre ✓/✗ ve BİR CÜMLE, U-3/U-4)
//   · bu dönemin harcaması, tavanı ve kalanı · son ayar değişiklikleri (E-1 izi). Jeton ölçülmemişse seçenek tablosu ÜRETİLMEZ: "ölçülmedi" denir, sayı UYDURULMAZ (Ö-1).
// POST: { model?, callIntervalMs?, candidates?, candleLimit?, monthlyCapUsd?, dailyCallCap?, totalCapUsd?, capEmptyBehavior?, infraUsd?, tickMs? } (Tur 67: tik aralığı da bu uçtan — daha SIK yön yalnız burada (kodlu), daha seyrek yön serbest uçtan da; Tur 65: A-9 toplam tavan + tavan boşken davranış AYAR; DÜŞÜRMEK serbest uçtan: /api/brain/settings/tighten) — açık liste dışı model ya da sınır dışı sayı REDDEDİLİR (400); yazma ve E-1 defteri AYNI işlemde.
import { withAccess } from "@/lib/access";
import { TICK_CHOICES_MS } from "@/lib/chain";
import { readBrainUsage } from "@/lib/brain";
import { costCapView, costOptions, tickView, readBrainRuntime, prismaSettingsStore, writeBrainSettings, ALLOWED_MODELS, CAP_EMPTY_BEHAVIORS, INTERVAL_CHOICES, CANDIDATE_BOUNDS, CANDLE_BOUNDS, INTERVAL_BOUNDS } from "@/lib/brain-settings";
export const dynamic = "force-dynamic";
// BÖLGE (Tur 12, G11 · S-5): bölge ABD DIŞI sabit; Edge YASAK (Edge bölgesi çağırana göre seçilir). Değer src/lib/region.ts BINANCE_REGION ile birebir aynı olmalı (kapı ölçer).
export const runtime = "nodejs";
export const preferredRegion = "hnd1";

const view = async () => {
  const r = await readBrainRuntime();
  // Tur 65: CAP_EMPTY bir ARIZA DEĞİLDİR (kurulumun ayarı): ayar yüzeyi AÇILIR, tavanın boş olduğu ve bunun anlamı cümleyle yazılır; harcama/seçenek tablosu üretilmez (karar motoru çağrılmıyor).
  if (!r.ok && r.refusal === "CAP_EMPTY") { const changes = await prismaSettingsStore().changes(10).catch(() => []);
    return { ok: true as const, capEmpty: true as const, settings: r.row, costCap: costCapView(r.row), tickView: tickView(r.row), capSentence: r.detail,
      allowed: { models: ALLOWED_MODELS, intervalChoicesMs: INTERVAL_CHOICES, intervalBounds: INTERVAL_BOUNDS, candidates: CANDIDATE_BOUNDS, candleLimit: CANDLE_BOUNDS, capEmptyBehaviors: CAP_EMPTY_BEHAVIORS, tickChoicesMs: TICK_CHOICES_MS },
      changes: changes.map((c) => ({ at: c.at.toISOString(), by: c.by, changes: c.changes })) }; }
  if (!r.ok) return { ok: false as const, reason: r.refusal, detail: r.detail };
  const rt = r.runtime, u = await readBrainUsage(rt), tokens = u.tokens, spend = u.spend;
  const options = tokens === null ? null : costOptions({ runtime: rt, tokens });
  const changes = await prismaSettingsStore().changes(10).catch(() => []);
  return { ok: true as const, capEmpty: false as const, settings: r.row, costCap: costCapView(r.row), tickView: tickView(r.row), runtime: { model: rt.model, callIntervalMs: rt.callIntervalMs, candidates: rt.candidates, candleLimit: rt.candleLimit, source: rt.source },
    price: { ...rt.price, note: rt.price.stale ? `FİYAT ESKİ — ${rt.price.readAt} tarihinde okundu, bu dönemden önce; doğrulanmalı (kaynak: ${rt.price.source})` : `fiyat bu dönemde okundu (${rt.price.readAt}, kaynak: ${rt.price.source})` },
    cap: { monthlyUsd: rt.cap.monthlyUsd, monthlyFrom: rt.cap.monthlyFrom, dailyCalls: rt.cap.dailyCalls, dailyFrom: rt.cap.dailyFrom, period: rt.cap.periodStart.toISOString().slice(0, 7) },
    spend: spend.ok ? spend.status : { refusal: spend.refusal, detail: spend.detail },
    options: options ?? { measured: false, note: "Beyin'in jeton sayısı henüz ÖLÇÜLMEDİ (jetonlu gerçek çağrı kaydı yok): maliyet tablosu ÜRETİLMEDİ, sayı uydurulmadı (Ö-1). İlk gerçek çağrıdan sonra görünür." },
    allowed: { models: ALLOWED_MODELS, intervalChoicesMs: INTERVAL_CHOICES, intervalBounds: INTERVAL_BOUNDS, candidates: CANDIDATE_BOUNDS, candleLimit: CANDLE_BOUNDS, capEmptyBehaviors: CAP_EMPTY_BEHAVIORS, tickChoicesMs: TICK_CHOICES_MS },
    changes: changes.map((c) => ({ at: c.at.toISOString(), by: c.by, changes: c.changes })) };
};

export const GET = withAccess({ cls: "session" }, async () => { const v = await view(); return Response.json(v, { status: v.ok ? 200 : 503 }); });

export const POST = withAccess({ cls: "sensitive", action: "BRAIN_SETTINGS_CHANGE" }, async (req) => {
  let body: unknown; try { body = await req.json(); } catch { body = null; }
  const w = await writeBrainSettings((body ?? {}) as Record<string, never>, "sahip · oturum + TOTP");
  if (!w.ok) return Response.json(w, { status: w.status });
  return Response.json({ ok: true, applied: w.changes, next: w.next, note: "değişiklik ANINDA etkilidir: motor ayarı her planlama turunda okur, yeniden dağıtım gerekmez", view: await view() }, { status: 200 });
});
