// Çevrimdışı ekran ucu (G20 parça 1, Tur 30). Sınıf: public. React sayfası DEĞİL, kendi başına açılan tek HTML: önbellekte yalnız bu dosya durur, JS/CSS parçası gerekmez.
// Metin tek kaynaktan (src/lib/pwa OFFLINE_TEXT); veri okumaz — gösterdiği hiçbir şey sunucudan gelmez.
import { withAccess } from "@/lib/access";
import { offlineHtml } from "@/lib/pwa";
export const dynamic = "force-static";
// BÖLGE (S-5): borsaya çıkmaz; bölge bildirimi kapı sözleşmesi gereği (tek yer src/lib/region.ts).
export const runtime = "nodejs";
export const preferredRegion = "hnd1";

export const GET = withAccess({ cls: "public" }, () => new Response(offlineHtml(), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } }));
