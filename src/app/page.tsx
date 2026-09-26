// KÖK SAYFA (/) — Tur 79 (G34): bugüne dek sözlük dışında iki Türkçe cümleydi; artık isteğin dilinde sözlükten (sunucu bileşeni, dil kökün seçtiği sırayla).
import { cookies, headers } from "next/headers";
import { AVAILABLE, LANG_COOKIE, dictFor, pickLang } from "@/lib/i18n";

export default async function Home() {
  const c = await cookies(), h = await headers(), T = dictFor(pickLang(AVAILABLE, c.get(LANG_COOKIE)?.value, h.get("accept-language")));
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem 1.5rem" }}>
      <h1>{T.home.title}</h1>
      <p>{T.home.intro} <a href="/panel">{T.home.panelLink}</a></p>
      <p>{T.home.stopIntro} <a href="/durdur">{T.home.stopLink}</a></p>
    </main>
  );
}
