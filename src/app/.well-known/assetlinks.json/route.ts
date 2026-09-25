// Digital Asset Links ucu (G20 parça 1, Tur 30 · U-1). Sınıf: public. KAPALI ARIZA: paket adı ve parmak izi ortamda yoksa 404 + sebep kütüğe (src/lib/pwa assetLinksResponse).
// Dinamik: ortam her istekte okunur (derleme anına dondurulmaz). Sabit parmak izi/paket adı bu dosyaya YAZILMAZ (kapı KIRMIZI sayar).
import { withAccess } from "@/lib/access";
import { assetLinksResponse } from "@/lib/pwa";
export const dynamic = "force-dynamic";
// BÖLGE (S-5): borsaya çıkmaz; bölge bildirimi kapı sözleşmesi gereği (tek yer src/lib/region.ts).
export const runtime = "nodejs";
export const preferredRegion = "hnd1";

export const GET = withAccess({ cls: "public" }, () => assetLinksResponse());
