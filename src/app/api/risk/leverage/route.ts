// KALDIRAÇ İSTEĞİ YÜZEYİ (Tur 44, G21 kalemi i). Sınıflar (G04): GET session (önizleme: tavan hükmü + U-4 maliyeti) · POST sensitive + LEVERAGE_CHANGE (oturum + eylem başına TOTP, S-8).
// Gövde: { symbol, leverage } — GET'te sorgu dizesi. Tavanı AŞAN istek REDDEDİLİR, tavana indirilmez (karar `winvestor-kaldirac-tavan-asimi` = A). Bu uç HİÇBİR SAYI ÖNERMEZ ve bugün hiçbir kaydı
// değiştirmez: kaldıracı borsaya yazan yol G21 kalemi f ile doğar (A-5). Durdurma bu uca bağlı değildir ve ikinci doğrulama istemez (K-7).
import { withAccess } from "@/lib/access";
import { leverageResponse } from "@/lib/risk-settings/leverage";
export const dynamic = "force-dynamic";
// BÖLGE (Tur 12, G11 · S-5): bölge ABD DIŞI sabit; Edge YASAK. Değer src/lib/region.ts BINANCE_REGION ile birebir aynı olmalı (kapı ölçer).
export const runtime = "nodejs";
export const preferredRegion = "hnd1";

export const GET = withAccess({ cls: "session" }, (req) => leverageResponse(req));
export const POST = withAccess({ cls: "sensitive", action: "LEVERAGE_CHANGE" }, (req) => leverageResponse(req));
