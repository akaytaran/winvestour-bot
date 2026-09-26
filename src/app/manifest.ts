// Web uygulama bildirimi (G20 parça 1, Tur 30 · U-1). Next bunu /manifest.webmanifest olarak sunar ve sayfalara bağlantısını kendisi ekler. Alanlar tek kaynaktan (src/lib/pwa).
// Tur 79 (G34 · D1): açıklama, `lang` ve `dir` İSTEKTEN seçilen dilde (seçim çerezi → Accept-Language → EN); istek zamanı API'si kullandığı için önbelleğe alınmaz.
import type { MetadataRoute } from "next";
import { cookies, headers } from "next/headers";
import { webManifest } from "@/lib/pwa";
import { AVAILABLE, LANG_COOKIE, pickLang } from "@/lib/i18n";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const c = await cookies(), h = await headers();
  return webManifest(pickLang(AVAILABLE, c.get(LANG_COOKIE)?.value, h.get("accept-language")));
}
