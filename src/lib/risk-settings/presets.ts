// HAZIR AYAR PROFİLLERİ — SAYILARIN TEK KAYNAĞI (Tur 87 · G38 · iş sahibi kararları D6/D6' · Üretim S16-4, S16-5 · K-9, A-6, M-2, K-11, A-9).
// Kapı: scripts/gate-risk-presets.mjs (profil sayısının başka dosyada kopyası KIRMIZI · ANAYASA sınırı dışındaki sayı KIRMIZI · üretilen her alan ürünün kendi doğrulayıcısından geçer).
// Kanarya: scripts/canary-risk-presets.mts. Uygulayan: src/lib/risk-presets (tek işlem, kodla). Bu dosya YALNIZ veri + saf türetmedir: okuma/yazma yoktur.
// TUTAR YOKTUR: profil yalnız PAY (serbest bakiyenin yüzdesi) taşır. USDT tutarı çalışma anında bakiyeden türer (motorun kendi formülü `planPositionSize`); sabit USDT tutarı yazılmaz.
// SINIRLAR (ANAYASA, aşılamaz — kapı ölçer): tek pay ≤ toplam (K-9: tek pozisyon payı "ikinci ve daha dar" sınır) · tek pay ≤ 50 (A-6, iş sahibi kararı 2026-09-10) ·
//   toplam ≤ 100 (K-9, iş sahibi kararı 2026-09-10: açık toplam sermayeyi geçemez) · her pay > 0 ve sütunun biçiminde (DECIMAL(6,3)).
// GEREKÇE (rapor tablosunda sayı · gerekçe · kaynak · ölçüm komutu):
//   RISKY    = iş sahibinin kendi kurulumundaki iki sayı (tek 50 · toplam 100): belgedeki EN GENİŞ sınırın kendisi; hiçbir profil bunu aşmaz.
//   BALANCED = toplam 100 (aynı K-9 sınırı) ÷ eş zamanlı pozisyon tavanı (sizing POSITION_COUNT_CEILING = 5, borsanın ölçülen sembol başına algo emir tavanı) = tek 20:
//              toplam sınır ancak beş ayrı pozisyonla dolar.
//   CAUTIOUS = toplam 50 (= iş sahibinin TEK pozisyon sınırı: portföyün tamamı, Riskli'nin tek bir pozisyonunun sınırını geçmez) ÷ 5 = tek 10.
// FUTURES / SHORT / KALDIRAÇ / TİK SAYI DEĞİL TÜRETMEDİR (`presetValues`), profilde sabit olarak durmaz:
//   kaldıraç tavanı = ⌈toplam ÷ 100⌉ — K-9 toplamı NOMİNAL sayar (Σ miktar × giriş fiyatı); toplam ≤ 100 iken 1× yeter, daha yükseği izin verilen maruziyeti artırmaz, yalnız tasfiye
//     mesafesini kısaltır · M-2 futures çarpanı = SPOT `EDGE_MULTIPLE` (M-2 "en az üç katı" her pazarda geçerli; daha düşüğü kuralı gevşetir, Ö-3) · short = kapalı (SHORT/carry icrası
//     yazılmadı: emir üretmeyen kipi önermek ekranda tutulmayan söz olur, U-3) · tik = cron dönemi (seçenek kümesinin ilki; üretim bu aralıkla ölçüldü, A-9).
//   Futures alanları YALNIZ kayıtlı anahtarda futures yetkisi (`exchange_keys.enable_futures`) varken dolar (S16-4); yoksa kapalı/boş kalır ve ekran nedenini söyler (D1).
// MALİYET TAVANI (`brain_settings.total_cap_usd`) PROFİLDE YOKTUR: "her kurulum kendi değerini girer" (KARAR-DEFTERI 20 Eyl satır 85) — rapor SORULAR.
import { CLOSED_SHORT_MODE, type ShortMode } from "./modes";

export const PRESET_NAMES = ["CAUTIOUS", "BALANCED", "RISKY"] as const;
export type PresetName = (typeof PRESET_NAMES)[number];
export type PresetNumbers = { presetSinglePct: string; presetTotalPct: string; presetFutures: boolean };
export const PRESETS = {
  CAUTIOUS: { presetSinglePct: "10", presetTotalPct: "50", presetFutures: false },
  BALANCED: { presetSinglePct: "20", presetTotalPct: "100", presetFutures: true },
  RISKY: { presetSinglePct: "50", presetTotalPct: "100", presetFutures: true },
} as const satisfies Record<PresetName, PresetNumbers>;
export const isPresetName = (v: unknown): v is PresetName => typeof v === "string" && (PRESET_NAMES as readonly string[]).includes(v);

/** Türetmenin dışarıdan gelen girdileri — hepsi ürünün mevcut sabiti ya da ölçümüdür (çağıran verir; bu dosya modül içe aktarmaz, döngü yok). */
export type PresetContext = { keyFutures: boolean; edgeMultiple: number; tickMs: number };
export type PresetValues = {
  shares: { singlePositionPct: string; totalExposurePct: string };
  settings: { leverageCap: number | null; futuresEnabled: boolean; shortMode: ShortMode; m2FuturesMultiple: string | null };
  tickMs: number;
  /** profil futures kullanır ama anahtarda futures yetkisi yok ⇒ futures alanları kapalı/boş bırakıldı (ekran nedenini söyler) */
  futuresBlocked: boolean;
};
/** SAF. Profilin yazacağı değerlerin TAMAMI. Aynı girdi ⇒ aynı çıktı; bakiye burada YOKTUR (tutar yazılmaz, yalnız pay). */
export function presetValues(name: PresetName, c: PresetContext): PresetValues {
  const p: PresetNumbers = PRESETS[name], fut = p.presetFutures && c.keyFutures;
  return {
    shares: { singlePositionPct: p.presetSinglePct, totalExposurePct: p.presetTotalPct },
    settings: { leverageCap: fut ? Math.ceil(Number(p.presetTotalPct) / 100) : null, futuresEnabled: fut, shortMode: CLOSED_SHORT_MODE, m2FuturesMultiple: fut ? String(c.edgeMultiple) : null },
    tickMs: c.tickMs,
    futuresBlocked: p.presetFutures && !c.keyFutures,
  };
}
