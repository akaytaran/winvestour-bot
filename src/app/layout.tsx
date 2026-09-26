// KÖK DÜZEN (Tur 79 · G34): sayfanın dili İSTEKTEN seçilir — seçim çerezi (yalnız dil kodu) → Accept-Language → EN — ve `<html lang dir>` ile istemci sağlayıcısına verilir:
//   sunucuda işlenen ilk boyama doğru dilde gelir (yanlış dil yanıp sönmez), AR sağdan sola açılır. Dil çerezi erişim kararına girmez (kimlik/oturum bu dosyada okunmaz).
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { SwRegister } from "./sw-register";
import { AVAILABLE, LANG_COOKIE, dictFor, dirOf, pickLang } from "@/lib/i18n";
import { LangProvider } from "@/lib/i18n/client";

const requestLang = async () => { const c = await cookies(), h = await headers(); return pickLang(AVAILABLE, c.get(LANG_COOKIE)?.value, h.get("accept-language")); };

export async function generateMetadata(): Promise<Metadata> {
  const T = dictFor(await requestLang());
  return { title: "Winvestour", description: T.meta.description };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const lang = await requestLang();
  return (
    <html lang={lang} dir={dirOf(lang)}>
      <body style={{ margin: 0 }}>
        <LangProvider lang={lang}>{children}</LangProvider>
        <SwRegister />
      </body>
    </html>
  );
}
