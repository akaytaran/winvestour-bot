// Web uygulama bildirimi (G20 parça 1, Tur 30 · U-1). Next bunu /manifest.webmanifest olarak sunar ve sayfalara bağlantısını kendisi ekler. Alanlar tek kaynaktan (src/lib/pwa).
import type { MetadataRoute } from "next";
import { webManifest } from "@/lib/pwa";

export default function manifest(): MetadataRoute.Manifest {
  return webManifest();
}
