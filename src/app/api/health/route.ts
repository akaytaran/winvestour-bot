// Tek sağlık ucu. Sınıf: public (G04). Kullanıcı verisine, veritabanına, dış servise veya ortam değişkenine dokunmaz.
import { withAccess } from "@/lib/access";
export const dynamic = "force-dynamic";
// BÖLGE (Tur 12, G11 · S-5): bölge ABD DIŞI sabit; Edge YASAK (Edge bölgesi çağırana göre seçilir). Değer src/lib/region.ts BINANCE_REGION ile birebir aynı olmalı (kapı ölçer).
export const runtime = "nodejs";
export const preferredRegion = "hnd1";

// Tur 68 (yayım ilkesi, karar 20 Eyl): `service` bizim Vercel proje adımızı taşıyordu (yayın kopyasına giriyordu, gate:publish our-vercel-project); artık kurulumdan bağımsız nötr ad.
export const GET = withAccess({ cls: "public" }, () => Response.json({ ok: true, service: "engine", at: new Date().toISOString() }));
