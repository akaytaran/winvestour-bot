// Cron ucu (G16, K-4 · Tur 21 mod anahtarı). Vercel Cron her dakika çağırır (vercel.json). Sınıf: public (G04). TEK AYARLA (ENGINE_MODE) seçilir: UCUZ modda bir tik koşar (izin → kira NX → iş → kayıt;
// izin yokken 1 Upstash GET, Neon'a dokunmaz), HIZLI modda nöbetçidir (izin RUNNING iken kira yoksa CHAIN_BREAK yazıp halka açar; halka yaşarken hiçbir şey yapmaz). İdempotent: dışarıdan çağrılması
// aralık içinde ikinci bir tik ÜRETMEZ (kira NX → HELD). Tik yanıtta biter (after yok): fonksiyon yalnız tik süresince yaşar — maliyet ölçümü (Tur 21 madde 4) kaydın `durationMs` alanından.
import { withAccess } from "@/lib/access";
import { engineCron } from "@/lib/chain";
export const dynamic = "force-dynamic";
// BÖLGE (Tur 12, G11 · S-5): bölge ABD DIŞI sabit; Edge YASAK (Edge bölgesi çağırana göre seçilir). Değer src/lib/region.ts BINANCE_REGION ile birebir aynı olmalı (kapı ölçer).
export const runtime = "nodejs";
export const preferredRegion = "hnd1";

export const GET = withAccess({ cls: "public" }, async (req) => Response.json(await engineCron(new URL(req.url).origin)));
