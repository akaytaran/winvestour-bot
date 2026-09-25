// S-2 SIR TARAYICISI (G07'den ayrıldı — Tur 31, ANAYASA B-3 genişletmesi 2026-09-17). Kurallar ve tarayıcı DEĞİŞMEDİ; yalnız DOSYASI ayrıldı.
// NEDEN AYRI DOSYA: Beyin girdisini/yanıtını bu tarayıcıyla tarar. Tarayıcı `@/lib/events` içindeyken Beyin'in içe aktarması olay yayıcısını → bildirimi → eleme deposunu →
// (çağrı anında) Upstash istemcisini Beyin'in ÇALIŞMA ZAMANI grafiğine sokuyordu (TUR-28 §7c). Bu dosya HİÇBİR ŞEY içe aktarmaz; `@/lib/events` aynı adları yeniden dışa aktarır.
/** S-2 tarama kuralları — gövdede geçemeyecek biçimler. Eşleşme değeri hiçbir yere yazılmaz, yalnız kural adı döner. */
export const SECRET_RULES: readonly { id: string; re: RegExp }[] = [
  { id: "pem-block", re: /-----BEGIN [A-Z ]*-----/ },
  { id: "long-token", re: /[A-Za-z0-9+/_-]{40,}={0,2}/ }, // API anahtarı (64), HMAC sırrı, zarf/imza/ana anahtar base64 (≥44), sha256 hex, scrypt karması, oturum/durdurma anahtarı
  { id: "bearer-or-jwt", re: /\bBearer\s+\S{16,}|\beyJ[A-Za-z0-9_-]{10,}\./ },
  { id: "credential-field", re: /"(?:apiKey|api_key|secretKey|secret_key|secret|privateKey|privateKeyPem|password|token|authorization|x-mbx-apikey|signature)"\s*:\s*"[^"]{6,}"|\b(?:apiKey|api_key|secret|signature|token|password)=[^&\s"]{6,}/i },
  { id: "url-credential", re: /\b[a-z][a-z0-9+.-]*:\/\/[^:\s/'"]+:[^@\s'"]+@/i },
  { id: "totp-secret-base32", re: /\b[A-Z2-7]{32}\b/ },
  { id: "env-secret-name", re: /\b(?:ENCRYPTION_MASTER_KEY(?:_PREVIOUS)?|SESSION_SECRET|OWNER_PASSWORD_HASH|OWNER_TOTP_SECRET|STOP_KEY_HASH|UPSTASH_REDIS_REST_TOKEN|KV_REST_API_TOKEN|ANTHROPIC_API_KEY)\s*[=:]/ },
];
/** Gövdeyi tara; ilk eşleşen kuralın adı ya da null. Değer döndürmez. */
export function scanForSecrets(body: string): string | null { return SECRET_RULES.find((r) => r.re.test(body))?.id ?? null; }
