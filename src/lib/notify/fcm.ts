// FIREBASE BİLDİRİM TAŞIYICISI — İSTEĞE BAĞLI EKLENTİ (Tur 82 · G20 FCM kalemi · iş sahibi kararı KARAR-DEFTERI 1 Eki 2026 D2: "bizim kurulumumuzda Firebase YOK; public kopyada
//   bildirim SİLİNMEZ, isteğe bağlı eklenti noktası olur: varsayılan KAPALI, değişkenler boşken uygulama hatasız çalışır"). Tek yüzey kuralı değişmedi: bu dosya `NotifyTransport`un
//   BİR UYGULAMASIDIR ve yalnız `./index.ts` `defaultTransport` içinden kurulur (gate:notify (10)); gönderen tek yol yine `deliverNotification`.
// DEĞİŞKENLER (ad sözleşmesi src/lib/env.ts `FIREBASE_ENV_NAMES`): üçü DOLU ve biçimi doğruysa açık · üçü BOŞSA kapalı (hata yok, sahte başarı yok) · YARIM/BOZUKSA kapalı arıza
//   (gönderim yok, ad söylenir, DEĞER hiçbir mesaja/kayda girmez — S-2). Ortamı bu dosya OKUMAZ (gate:notify (9)); yapılandırma çağırandan gelir.
// AKIŞ (Google'ın belgelenmiş HTTP v1 yolu): servis hesabının özel anahtarıyla RS256 imzalı kısa ömürlü onay (JWT) → OAuth jeton ucu → erişim jetonu → kayıtlı HER cihaz için
//   `projects/<id>/messages:send`. Yük kilit ekranı listesinin AYNISIDIR (U-2: başlık + kilit notu + yönlendirme alanları; tutar/bakiye YOK). Kuyruk ve yeniden deneme YOK (U-2).
// SÜRE (K-7, gate:notify (21)): bütün gönderim TEK bütçe içinde biter (`timeoutMs`, çağıran durdurma deposu bütçesini verir); aşılırsa gönderilmedi sayılır.
// UÇLAR enjekte edilebilir YALNIZ kanarya içindir (yerel sahte FCM ucu, S-9); ürün yolu sabit Google adreslerini kullanır. JWT `aud` alanı DAİMA gerçek jeton adresidir.
import type { DeviceStore } from "./devices";
import type { NotifyTransport, PushPayload, SendResult } from "./index";

export type FirebaseConfig = { readonly projectId: string; readonly clientEmail: string; readonly privateKeyPem: string };
export const FCM_ENDPOINTS = { token: "https://oauth2.googleapis.com/token", send: "https://fcm.googleapis.com" } as const;
export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
export type FcmDeps = { devices: DeviceStore; timeoutMs: number; endpoints?: { token: string; send: string }; fetchImpl?: typeof fetch; now?: () => number };

const b64u = (b: ArrayBuffer | Uint8Array | string) => Buffer.from(typeof b === "string" ? Buffer.from(b, "utf8") : b instanceof Uint8Array ? b : new Uint8Array(b)).toString("base64url");
const pemBody = (pem: string) => Buffer.from(pem.replace(/-----(?:BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, ""), "base64");

/** Servis hesabı onayı (JWT, RS256). Anahtar yalnız imzada kullanılır; dönen dize sır taşımaz ama yine de kayda yazılmaz. */
export async function serviceAssertion(cfg: FirebaseConfig, nowMs: number): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey("pkcs8", pemBody(cfg.privateKeyPem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const iat = Math.floor(nowMs / 1000), head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64u(JSON.stringify({ iss: cfg.clientEmail, scope: FCM_SCOPE, aud: FCM_ENDPOINTS.token, iat, exp: iat + 3600 }));
  const sig = await globalThis.crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(sig)}`;
}

/** FCM ileti gövdesi — kilit ekranı yükünün AYNISI (veri alanları dize olmak zorunda: FCM `data` yalnız dize taşır). */
export const fcmMessage = (token: string, p: PushPayload) => ({ message: { token, notification: { title: p.display.title, body: p.display.body },
  data: { code: p.route.code, level: p.route.level, at: p.route.at, producedAt: p.route.producedAt, undismissable: String(p.route.undismissable) } } });

export const fcmTransport = (cfg: FirebaseConfig, deps: FcmDeps): NotifyTransport => ({
  name: "FIREBASE",
  send: async (payload): Promise<SendResult> => {
    const ep = deps.endpoints ?? FCM_ENDPOINTS, f = deps.fetchImpl ?? fetch, signal = AbortSignal.timeout(deps.timeoutMs), at = new Date((deps.now ?? Date.now)());
    try {
      const devices = await Promise.race([deps.devices.list(), new Promise<never>((_, no) => signal.addEventListener("abort", () => no(signal.reason), { once: true }))]);
      if (devices.length === 0) return { ok: false, error: "kayıtlı cihaz yok: bildirim hiçbir cihaza gönderilmedi" };
      const tr = await f(ep.token, { method: "POST", signal, headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: await serviceAssertion(cfg, at.getTime()) }).toString() });
      const tok = tr.ok ? ((await tr.json()) as { access_token?: unknown }).access_token : undefined;
      if (typeof tok !== "string" || tok.length === 0) return { ok: false, error: `Firebase erişim jetonu alınamadı (yanıt durumu ${tr.status})` };
      const ok: number[] = [], fail: number[] = []; let id: string | null = null, lastStatus = 0;
      for (const d of devices) {
        const r = await f(`${ep.send}/v1/projects/${encodeURIComponent(cfg.projectId)}/messages:send`, { method: "POST", signal, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify(fcmMessage(d.token, payload)) });
        lastStatus = r.status;
        if (r.ok) { ok.push(d.id); let n: unknown = null; try { n = ((await r.json()) as { name?: unknown }).name; } catch { n = "yanıt gövdesi okunamadı (ileti kabul edildi)"; } if (id === null && typeof n === "string") id = n; } else fail.push(d.id);
      }
      // Cihaz satırlarının son gönderim izi yazılamazsa gönderim SONUCU değişmez ama cümle bunu söyler (sessiz yutma yok — K-8).
      let iz = ""; try { await deps.devices.markSend(ok, true, at); await deps.devices.markSend(fail, false, at); } catch { iz = " · cihaz gönderim izi yazılamadı"; }
      return ok.length > 0 ? { ok: true, id: `${id ?? `${ok.length}/${devices.length} cihaz`}${iz}` } : { ok: false, error: `Firebase iletiyi kabul etmedi (${devices.length} cihazın hiçbiri; son yanıt durumu ${lastStatus})${iz}` };
    } catch (e) {
      return { ok: false, error: (e as { name?: string })?.name === "TimeoutError" || (e as { name?: string })?.name === "AbortError" ? `Firebase gönderimi süre bütçesini (${deps.timeoutMs} ms) aştı` : "Firebase gönderimi düştü (ağ ya da yanıt okunamadı)" };
    }
  },
});
