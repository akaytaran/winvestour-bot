// BÖLGE SABİTLEME (G11 · S-5). "Binance'e dokunan hiçbir şey ABD'de koşmaz." Bölge adı TEK YERDE burada; her API ucu bunu KENDİ dosyasında sabit olarak bildirir
// (`export const preferredRegion = "hnd1"` — Next.js segment yapılandırması derleme anında STATİK okunur, içe aktarılan sabitle yazılamaz; kapı iki yerin eşitliğini ölçer)
// ve dağıtımın tamamı `vercel.json` `regions` ile aynı bölgeye sabitlenir. Edge çalışma zamanı YASAK: Edge'in bölgesi çağırana göre seçilir, bölgesi kontrol edilemeyen katman
// borsaya doğrudan çıkamaz (ANAYASA S-5, MİMARİ §2) — borsaya çıkabilen her uç `runtime = "nodejs"` bildirir (kapı: scripts/gate-order.mjs).
// ÖLÇÜM (2026-09-08, Tur 0): iad1 → HTTP 451 "Service unavailable from a restricted location"; hnd1 → 200 (p50 8,2 ms). Bölge seçimi bu ölçümden gelir, uydurma değildir.

/** Binance'e dokunan her fonksiyonun bölgesi. Tokyo (hnd1): Tur 0'da ölçülen tek çalışan bölge; Neon `ap-southeast-1` ve Upstash `hnd1` ile aynı yakada. */
export const BINANCE_REGION = "hnd1";
/** Vercel'in ABD bölgeleri — borsaya çıkan hiçbir fonksiyon burada koşamaz (S-5). Liste kapalı yönde: bilinmeyen bölge de "ABD dışı" sayılmaz, kapı yalnız BINANCE_REGION'a izin verir. */
export const US_REGIONS = ["iad1", "cle1", "pdx1", "sfo1", "dev1"] as const;
export const isUsRegion = (region: string): boolean => (US_REGIONS as readonly string[]).includes(region);
