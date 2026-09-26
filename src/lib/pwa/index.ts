// PWA KABUĞU (G20 parça 1 · Tur 30 · U-1, U-2, U-3, Ö-2). TWA'nın ön koşulu çalışan bir web uygulama kabuğudur; bu modül onun TEK kaynağıdır:
//   web uygulama bildirimi · service worker kaynağı · önbellek listesi · çevrimdışı ekranın metni ve HTML'i · Digital Asset Links çözücüsü. Kapı: npm run gate:pwa.
// ÖNBELLEK KURALI: yalnız çevrimdışı ekran önbelleğe alınır. Para verisi, pozisyon, bakiye, tik kaydı, panel yanıtı ÖNBELLEĞE ALINMAZ — eski veri göstermek "bilinmiyor" demekten kötüdür (Ö-2).
//   SW API isteğine HİÇ karışmaz (tarayıcı ağa gider, ağ yoksa istek düşer); yalnız sayfa açılışı ağ yoksa çevrimdışı ekrana düşer.
import { createHash } from "node:crypto";
import { readOptionalEnv } from "../env";
import { dictFor, LANG_COOKIE, dirOf, type Lang } from "../i18n";
import { srvFor, SRV_AVAILABLE, RECORD_LANG } from "../i18n/srv";
// TUR 79 (G34 · D1): bildirimin açıklaması ve dili İSTEKTEN seçilen dilde (manifest.ts seçer); çevrimdışı ekran HER mevcut dilin metnini taşır, betiksiz açılışta EN görünür,
//   küçük satır içi betik dili seçim çerezinden (yalnız dil kodu) ya da tarayıcının dilinden seçer — ağa çıkmaz, dış kaynak yüklemez (önbellekte tek dosya). Metin sunucu sözlüğünden (offline).

/** Bildirimin alanları. Ad ve açıklama mevcut site başlığından (src/app/layout.tsx) — yeni ad uydurulmadı. Ekran modu standalone: TWA bunu ister (U-1). */
export const APP = { name: "Winvestour", shortName: "Winvestour", startUrl: "/", scope: "/", display: "standalone" } as const;
export const OFFLINE_PATH = "/cevrimdisi";
/** AÇIK LİSTE (kapı dizinin kendisini okur): önbelleğe alınan TEK şey çevrimdışı ekrandır. */
export const PRECACHE = [OFFLINE_PATH] as const;

/** SİMGE (Tur 32, Üretim kararları S2/S2b): marka/logo.svg'den TÜRETİLDİ (`node scripts/icons-generate.mjs`) — viewBox 0 0 40 40 olduğu gibi ölçeklendi (kenar boşluğu logonun kendisi),
 *  renk kaynaktaki tek renk #e2a03f, zemin ŞEFFAF (logo `fill="none"`, zemin rengi yok ⇒ uydurulmadı) ⇒ purpose "any". Dolu zeminli `maskable` simge YOK (zemin rengi gerekir; G20 parça 2B). */
export const ICONS: { src: string; sizes: string; type: string; purpose?: "any" | "maskable" | "monochrome" }[] = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
];
export const MISSING_ICONS = [] as const;

/** Bildirim — açıklama ve `lang`/`dir` seçilen dilde (açıklama istemci sözlüğünün meta.description'ı; TR metni Tur 30'daki bildirimin aynısı). Ad marka adıdır, çevrilmez. */
export const webManifest = (lang: Lang = "en") => ({ name: APP.name, short_name: APP.shortName, description: dictFor(lang).meta.description, start_url: APP.startUrl, scope: APP.scope, display: APP.display, lang, dir: dirOf(lang), icons: ICONS });

/** ÇEVRİMDIŞI EKRANIN METNİ. Rakam YOK (U-3), tutar/bakiye/büyüklük YOK (U-2). Bilinmeyen ile durmuş aynı cümleye düşmez (Tur 26 dersi 3). Tur 33: çevrimiçi durdurma
 *  ekranı VAR (/durdur, x-stop-key, K-7) ama bu ekrandan gönderilemez — metin bağlantı gelince oraya gidileceğini söyler, başka araca yönlendirmez. */
export const OFFLINE_TEXT = srvFor(RECORD_LANG).offline;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Kendi başına açılan tek dosya: dış stil/betik/ağ yok (önbellekte tek başına durur). color-scheme: sistem renkleri — açık ve koyu temada okunur kontrast. */
/** Kendi başına açılan tek dosya: dış stil/betik/ağ yok (önbellekte tek başına durur). color-scheme: sistem renkleri — açık ve koyu temada okunur kontrast.
 *  Her mevcut dil ayrı `<main data-lang>` bloğudur; betiksiz açılışta yalnız EN görünür. Satır içi betik: seçim çerezi (`${LANG_COOKIE}`) → `navigator.languages` → EN; seçilen blok açılır, `<html lang dir>` ve başlık güncellenir. */
export const offlineHtml = (): string => {
  const langs = SRV_AVAILABLE.includes("en") ? ["en", ...SRV_AVAILABLE.filter((l) => l !== "en")] : [...SRV_AVAILABLE];
  const block = (l: string) => { const o = srvFor(l).offline;
    return `<main data-lang="${l}" lang="${l}" dir="${dirOf(l as Lang)}"${l === "en" ? "" : " hidden"}><h1>${esc(o.title)}</h1>${o.lines.map((x) => `<p>${esc(x)}</p>`).join("")}<button type="button" onclick="location.reload()">${esc(o.button)}</button></main>`; };
  const titles = JSON.stringify(Object.fromEntries(langs.map((l) => [l, srvFor(l).offline.title])));
  const pick = `(function(){var A=${JSON.stringify(langs)},T=${titles},c=(document.cookie.match(/(?:^|; )${LANG_COOKIE}=([a-z]{2})/)||[])[1],n=(navigator.languages||[navigator.language||""]).map(function(x){return String(x).slice(0,2).toLowerCase()}),l=A.indexOf(c)>=0?c:(n.filter(function(x){return A.indexOf(x)>=0})[0]||"en");if(l==="en")return;var m=document.querySelectorAll("main[data-lang]");for(var i=0;i<m.length;i++)m[i].hidden=m[i].getAttribute("data-lang")!==l;document.documentElement.lang=l;document.documentElement.dir=${JSON.stringify(["ar"])}.indexOf(l)>=0?"rtl":"ltr";document.title=T[l]})();`;
  return `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(srvFor("en").offline.title)}</title>`
    + `<style>:root{color-scheme:light dark}body{font-family:system-ui,sans-serif;max-width:40rem;margin:0 auto;padding:1.5rem 1rem;line-height:1.6}strong{font-weight:700}button{font:inherit;padding:.6rem 1.2rem;margin-top:.5rem;min-height:2.75rem}main[hidden]{display:none}</style></head>`
    + `<body>${langs.map(block).join("")}<script>${pick}</script></body></html>`;
};

/** SERVICE WORKER. Sürüm (önbellek adı) İÇERİKTEN türer: çevrimdışı ekran ya da SW gövdesi değişince ad değişir → yeni sürüm kurulur, beklemeden etkinleşir (skipWaiting + clients.claim),
 *  eski adlı önbellekler silinir ⇒ eski sürüm kilitlenip kalmaz (kanarya adım 3 ölçer). Tarayıcı sw.js'yi her açılışta yeniden denetler (uç `no-cache`). */
export function buildServiceWorker(offline: string): string {
  const body = `const PRECACHE = ${JSON.stringify(PRECACHE)};
const OFFLINE = ${JSON.stringify(OFFLINE_PATH)};
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
// Page navigations only: network first; if there is NO network at all, the offline screen. A server error response passes through as is (not treated as offline). API and asset requests are NOT touched and nothing is written to the cache.
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => caches.open(CACHE).then((c) => c.match(OFFLINE)).then((r) => r || new Response(${JSON.stringify(srvFor("en").offline.fallback)}, { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }))));
});
`;
  const version = createHash("sha256").update(offline).update(body).digest("hex").slice(0, 12);
  return `// Winvestour offline shell — generated by src/lib/pwa buildServiceWorker\nconst CACHE = "winvestour-kabuk-${version}";\n${body}`;
}

/** DIGITAL ASSET LINKS (U-1). Paket adı ve SHA-256 imza parmak izi ORTAMDAN okunur; ikisi de gerekir. KAPALI ARIZA: biri yoksa ya da biçimi bozuksa 404 + sebep kütüğe (değer YAZILMAZ, S-2).
 *  ORTAM ADI BAĞLI DEĞİL (Tur 30 madde 3 ölçümü: `vercel env ls` 16 ad, hiçbiri paket adı/parmak izi değil; paket adı belgelerde YAZILI DEĞİL) ⇒ ad UYDURULMADI, DUR VE SOR. Ad sözleşmeye
 *  (.env.example + src/lib/env.ts) iş sahibi kararıyla girdiğinde buraya yazılır; kapı sözleşmede olmayan adı KIRMIZI sayar. */
export const ASSET_LINKS_ENV: { packageName: string; fingerprint: string } | null = null;
export type AssetLinksReason = "ASSET_LINKS_UNCONFIGURED" | "ASSET_LINKS_MISSING" | "ASSET_LINKS_MISSING_PACKAGE" | "ASSET_LINKS_MISSING_FINGERPRINT" | "ASSET_LINKS_INVALID_PACKAGE" | "ASSET_LINKS_INVALID_FINGERPRINT";
const PACKAGE_FORMAT = /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/, FINGERPRINT_FORMAT = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export function assetLinksResponse(names = ASSET_LINKS_ENV, read: (name: string) => string | undefined = readOptionalEnv, log: (line: string) => void = (l) => console.warn(l)): Response {
  const pkg = names ? read(names.packageName) : undefined, fp = names ? read(names.fingerprint) : undefined;
  const reason: AssetLinksReason | null = !names ? "ASSET_LINKS_UNCONFIGURED" : !pkg && !fp ? "ASSET_LINKS_MISSING" : !pkg ? "ASSET_LINKS_MISSING_PACKAGE" : !fp ? "ASSET_LINKS_MISSING_FINGERPRINT"
    : !PACKAGE_FORMAT.test(pkg) ? "ASSET_LINKS_INVALID_PACKAGE" : !FINGERPRINT_FORMAT.test(fp) ? "ASSET_LINKS_INVALID_FINGERPRINT" : null;
  if (reason) {
    log(`assetlinks 404 · ${reason} · ortam adları: ${names ? `${names.packageName}, ${names.fingerprint}` : "sözleşmede yok (iş sahibi kararı bekliyor)"} · değer yazılmadı`);
    return new Response(null, { status: 404, headers: { "x-assetlinks-reason": reason, "cache-control": "no-store" } });
  }
  return Response.json([{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: [fp] } }], { headers: { "cache-control": "no-store" } });
}
