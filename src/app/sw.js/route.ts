// Service worker ucu (G20 parça 1, Tur 30). Sınıf: public — kullanıcı verisine, veritabanına, dış servise dokunmaz. Kaynak TEK kurucudan (src/lib/pwa buildServiceWorker).
// Statik: içerik dağıtım başına sabittir (fonksiyon çağrısı doğmaz, A-9). `no-cache`: tarayıcı her açılışta yeni sürümü denetler, eski sürüm kilitlenmez.
import { withAccess } from "@/lib/access";
import { buildServiceWorker, offlineHtml } from "@/lib/pwa";
export const dynamic = "force-static";
// BÖLGE (S-5): borsaya çıkmaz; bölge bildirimi kapı sözleşmesi gereği (tek yer src/lib/region.ts).
export const runtime = "nodejs";
export const preferredRegion = "hnd1";

export const GET = withAccess({ cls: "public" }, () => new Response(buildServiceWorker(offlineHtml()), { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-cache", "service-worker-allowed": "/" } }));
