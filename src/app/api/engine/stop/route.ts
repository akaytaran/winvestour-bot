// Durdurma ucu (G08). Sınıf: stop (K-7, Tur 6) — yalnız x-stop-key; oturum, TOTP, kilit, Upstash, Neon, Beyin ön koşul değil. Gövde: { mode: "HOLD" | "CLOSE_ALL" } — varsayılan YOK.
// Yanıt: kaydedilen seçenek, bayrağın hangi kopyalara yazıldığı, olay sonucu. Kopyalar alınmadıysa 202 ve yanıttan sonra yeniden deneme (after). İkinci doğrulama YOK (S-8).
import { after } from "next/server";
import { withAccess } from "@/lib/access";
import { requestStop } from "@/lib/engine-control";
export const dynamic = "force-dynamic";
// BÖLGE (Tur 12, G11 · S-5): bölge ABD DIŞI sabit; Edge YASAK (Edge bölgesi çağırana göre seçilir). Değer src/lib/region.ts BINANCE_REGION ile birebir aynı olmalı (kapı ölçer).
export const runtime = "nodejs";
export const preferredRegion = "hnd1";

export const POST = withAccess({ cls: "stop" }, async (req) => {
  let body: unknown; try { body = await req.json(); } catch { body = null; }
  const r = await requestStop(body, "sahip · durdurma anahtarı", { defer: (task) => after(task) });
  return Response.json(r, { status: r.status });
});
