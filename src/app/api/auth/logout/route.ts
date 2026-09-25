// Çıkış (G04). Sınıf: session — çerezi düşürür. Durumsuz; depoya dokunmaz.
import { logout, withAccess } from "@/lib/access";
export const dynamic = "force-dynamic";
// BÖLGE (Tur 12, G11 · S-5): bölge ABD DIŞI sabit; Edge YASAK (Edge bölgesi çağırana göre seçilir). Değer src/lib/region.ts BINANCE_REGION ile birebir aynı olmalı (kapı ölçer).
export const runtime = "nodejs";
export const preferredRegion = "hnd1";

export const POST = withAccess({ cls: "session" }, () => logout());
