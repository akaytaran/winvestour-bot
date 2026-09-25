// PWA KABUĞU (G20 parça 1 · Tur 30 · U-1, U-2, U-3, Ö-2). TWA'nın ön koşulu çalışan bir web uygulama kabuğudur; bu modül onun TEK kaynağıdır:
//   web uygulama bildirimi · service worker kaynağı · önbellek listesi · çevrimdışı ekranın metni ve HTML'i · Digital Asset Links çözücüsü. Kapı: npm run gate:pwa.
// ÖNBELLEK KURALI: yalnız çevrimdışı ekran önbelleğe alınır. Para verisi, pozisyon, bakiye, tik kaydı, panel yanıtı ÖNBELLEĞE ALINMAZ — eski veri göstermek "bilinmiyor" demekten kötüdür (Ö-2).
//   SW API isteğine HİÇ karışmaz (tarayıcı ağa gider, ağ yoksa istek düşer); yalnız sayfa açılışı ağ yoksa çevrimdışı ekrana düşer.
import { createHash } from "node:crypto";
import { readOptionalEnv } from "../env";

/** Bildirimin alanları. Ad ve açıklama mevcut site başlığından (src/app/layout.tsx) — yeni ad uydurulmadı. Ekran modu standalone: TWA bunu ister (U-1). */
export const APP = { name: "Winvestour", shortName: "Winvestour", description: "Winvestour otonom kripto işlem yazılımı", startUrl: "/", scope: "/", display: "standalone", lang: "tr" } as const;
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

export const webManifest = () => ({ name: APP.name, short_name: APP.shortName, description: APP.description, start_url: APP.startUrl, scope: APP.scope, display: APP.display, lang: APP.lang, icons: ICONS });

/** ÇEVRİMDIŞI EKRANIN METNİ. Rakam YOK (U-3), tutar/bakiye/büyüklük YOK (U-2). Bilinmeyen ile durmuş aynı cümleye düşmez (Tur 26 dersi 3). Tur 33: çevrimiçi durdurma
 *  ekranı VAR (/durdur, x-stop-key, K-7) ama bu ekrandan gönderilemez — metin bağlantı gelince oraya gidileceğini söyler, başka araca yönlendirmez. */
export const OFFLINE_TEXT = {
  title: "Bağlantı yok",
  lines: [
    "Bu cihaz şu anda Winvestour sunucusuna ulaşamıyor. Bu ekran cihazın içinde saklanan tek sayfadır; sunucudan okunmuş hiçbir bilgi göstermez.",
    "Motorun durumu BİLİNMİYOR. Bu ekran motoru göremez: burada bir şey görmemen motorun durduğu anlamına gelmez, çalıştığı anlamına da gelmez.",
    "Durdurma bu ekrandan YAPILAMAZ. Durdurma isteğinin sunucuya ulaşması gerekir; bağlantı gelince durdurma ekranından gönderilebilir.",
    "Açık pozisyon varsa koruma emri borsada durur ve bu cihazın bağlantısı kesilince silinmez. Bu ekran pozisyonların ve koruma emirlerinin şu anki hâlini bilmez.",
    "Ne yapmalı: cihazın internet bağlantısını kontrol et; bağlantı gelince aşağıdaki düğmeyle sayfayı yenile.",
  ],
  button: "Yeniden dene",
} as const;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Kendi başına açılan tek dosya: dış stil/betik/ağ yok (önbellekte tek başına durur). color-scheme: sistem renkleri — açık ve koyu temada okunur kontrast. */
export const offlineHtml = (): string => `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(OFFLINE_TEXT.title)}</title>`
  + `<style>:root{color-scheme:light dark}body{font-family:system-ui,sans-serif;max-width:40rem;margin:0 auto;padding:1.5rem 1rem;line-height:1.6}strong{font-weight:700}button{font:inherit;padding:.6rem 1.2rem;margin-top:.5rem}</style></head>`
  + `<body><main><h1>${esc(OFFLINE_TEXT.title)}</h1>${OFFLINE_TEXT.lines.map((l) => `<p>${esc(l)}</p>`).join("")}`
  + `<button type="button" onclick="location.reload()">${esc(OFFLINE_TEXT.button)}</button></main></body></html>`;

/** SERVICE WORKER. Sürüm (önbellek adı) İÇERİKTEN türer: çevrimdışı ekran ya da SW gövdesi değişince ad değişir → yeni sürüm kurulur, beklemeden etkinleşir (skipWaiting + clients.claim),
 *  eski adlı önbellekler silinir ⇒ eski sürüm kilitlenip kalmaz (kanarya adım 3 ölçer). Tarayıcı sw.js'yi her açılışta yeniden denetler (uç `no-cache`). */
export function buildServiceWorker(offline: string): string {
  const body = `const PRECACHE = ${JSON.stringify(PRECACHE)};
const OFFLINE = ${JSON.stringify(OFFLINE_PATH)};
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
// Yalnız SAYFA açılışı: önce ağ; ağ HİÇ yoksa çevrimdışı ekran. Sunucunun hata yanıtı olduğu gibi geçer (çevrimdışı sayılmaz). API ve varlık isteklerine DOKUNULMAZ, önbelleğe YAZILMAZ.
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => caches.open(CACHE).then((c) => c.match(OFFLINE)).then((r) => r || new Response("Bağlantı yok.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }))));
});
`;
  const version = createHash("sha256").update(offline).update(body).digest("hex").slice(0, 12);
  return `// Winvestour çevrimdışı kabuğu — üretildi: src/lib/pwa buildServiceWorker\nconst CACHE = "winvestour-kabuk-${version}";\n${body}`;
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
