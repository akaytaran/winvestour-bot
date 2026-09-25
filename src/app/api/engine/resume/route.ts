// Yeniden başlatma ucu (G08). HASSAS: sensitive + ENGINE_RESTART (S-8: durdurmak serbest, başlatmak değil) — oturum + eylem başına TOTP. İki kopya da yazılmadan izin verilmez.
import { withAccess } from "@/lib/access";
import { requestResume } from "@/lib/engine-control";
import { engineCron } from "@/lib/chain";
import { readTickMs } from "@/lib/brain-settings";
export const dynamic = "force-dynamic";
// BÖLGE (Tur 12, G11 · S-5): bölge ABD DIŞI sabit; Edge YASAK (Edge bölgesi çağırana göre seçilir). Değer src/lib/region.ts BINANCE_REGION ile birebir aynı olmalı (kapı ölçer).
export const runtime = "nodejs";
export const preferredRegion = "hnd1";

// G16/Tur 21: izin verildikten sonra cron girişi çağrılır — ucuz modda İLK TİK hemen koşar, hızlı modda nöbetçi ilk halkayı açar; yanıt sonucu taşır.
// Tur 67 (K3): tik aralığı izin kopyasına RESUME'da yazılır (okuyucu readTickMs); aralık yoksa 409 TICK_UNSET, bayrak yazılmaz.
export const POST = withAccess({ cls: "sensitive", action: "ENGINE_RESTART" }, async (req) => { const r = await requestResume("sahip · oturum + TOTP", { tickSource: () => readTickMs() }); const chain = r.ok ? await engineCron(new URL(req.url).origin) : null; return Response.json({ ...r, chain }, { status: r.status }); });
