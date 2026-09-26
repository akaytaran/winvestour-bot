// BİYOMETRİK KİLİT — İSTEMCİ YÜZÜ (Tur 40 · G20 parça 2B · U-1, K-7, S-1, U-3, Ö-2). Kapı: scripts/gate-pwa.mjs (7) · kanarya: scripts/canary-lock.mts.
// BELGE KİLİDİN DAVRANIŞINI YAZMAZ (ölçüldü, TUR-40-TAHMIN.json): üç sınır var olan kurallardan TÜRETİLDİ, sessiz noktalar AYARDIR (`lock_settings`, tohum KAPALI/NULL):
//   K-7 — kilit yalnız PANEL ekranını kilitler; /durdur'un ve onu saran layout'un önüne ASLA konmaz, kilit ekranında durdurma bağlantısı durur.
//   S-1 — kilit hiçbir sır/anahtar/kimlik SAKLAMAZ: tarayıcı deposuna yazmaz, sunucuya kimlik göndermez; doğrulama platform doğrulayıcısının KENDİ kimlik bilgisiyle cihazda yapılır.
//   U-3 — cihazda platform doğrulayıcı yoksa ekran "açık" gibi davranmaz ve olmayan bir yeteneğe yönlendirmez; durumu adıyla söyler.
// SINIR (açık beyan): bu bir EKRAN kilididir. Sunucu onay imzasını doğrulamaz; API uçlarının erişim koruması değişmedi (oturum + hassas eylemde TOTP, S-8).
// Kilit açıldığı bilgi YALNIZ açık sayfanın belleğinde durur: sayfa her açıldığında yeniden sorar. Yeniden sorma süresi ayardan gelir; NULL ise açık sayfa yeniden kilitlenmez.
import { EN } from "@/lib/i18n/en";

export type LockRead = { ok: true; enabled: boolean; repromptSeconds: number | null; updatedAt?: string | null } | { ok: false; detail?: string };
export type LockState = "OFF" | "UNREADABLE" | "NO_PLATFORM" | "LOCKED";

/** Ekranın cümleleri (U-3: ne oldu · ne demek · ne yapılabilir). Hiçbiri olmayan bir araca yönlendirmez. Tur 77 (K-C): metnin kaynağı TEK sözlüktür (`EN.lock.state`). */
export const LOCK_TEXT: Record<LockState | "FAILED" | "ENROLL_FAILED", string> = EN.lock.state;

/** SAF KARAR. Kilit kapalıysa doğrulayıcı SORULMAZ (bugünkü davranış); okunamayan ayar KAPALI sayılmaz (Ö-2); sonda düşerse doğrulayıcı YOK sayılır (açık davranılmaz). */
export async function lockGate(read: LockRead, probe: () => Promise<boolean>): Promise<LockState> {
  if (!read.ok) return "UNREADABLE";
  if (!read.enabled) return "OFF";
  let has = false; try { has = await probe(); } catch { has = false; }
  return has ? "LOCKED" : "NO_PLATFORM";
}

/** Cihazda kullanıcı doğrulamalı PLATFORM doğrulayıcısı var mı (parmak izi/yüz/cihaz kilidi). Tarayıcı bilmiyorsa YOK sayılır. */
export const platformAvailable = async (): Promise<boolean> =>
  typeof PublicKeyCredential !== "undefined" && typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function" && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());

const nonce = () => crypto.getRandomValues(new Uint8Array(32));
/** Bu cihazı kilide TANIT: platform doğrulayıcısında keşfedilebilir kimlik oluşturulur. Hiçbir şey saklanmaz ya da gönderilmez; kimliği doğrulayıcının kendisi tutar. */
export async function enroll(): Promise<boolean> {
  try {
    const c = await navigator.credentials.create({ publicKey: { challenge: nonce(), rp: { name: "Winvestour" }, user: { id: nonce().slice(0, 16), name: "owner", displayName: "Winvestour owner" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }], // COSE algoritma kimlikleri: ES256 · RS256 (WebAuthn standardı)
      authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", userVerification: "required" } } });
    return c !== null;
  } catch { return false; }
}
/** Kilidi AÇ: platform doğrulayıcısı kullanıcıyı doğrular (parmak izi/yüz). Başarı yalnız bu sayfanın belleğinde tutulur. */
export async function unlock(): Promise<boolean> {
  try { return (await navigator.credentials.get({ publicKey: { challenge: nonce(), userVerification: "required" } })) !== null; } catch { return false; }
}
