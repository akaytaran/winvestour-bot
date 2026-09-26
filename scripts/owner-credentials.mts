// G04 madde 10: sahip kimlik bilgilerini ÜRET ve yalnız DEPO DIŞI yedek klasörüne yaz (E-2, E-3). Ekrana/sohbete hiçbir değer basılmaz; yalnız dosya yolları ve karma özetleri.
// Üretilen: parola (rastgele), parola karması (scrypt), TOTP sırrı (20 bayt, base32) + otpauth URI (telefona elle giriş), oturum imza sırrı (32 bayt base64).
// Tur 77 (GK EK, kullanılabilirlik): çıktı dosyaları ve içerikleri İNGİLİZCE; ortam değerleri düz `NAME=value` satırlarıyla (README elle girer) — eski Vercel REST gövdesi (JSON) yerine.
//   <yedek>/owner-credentials.txt (sahip okur: parola + TOTP kurulum anahtarı) · <yedek>/vercel-env-owner.txt (üç `NAME=value` satırı; girildikten sonra silinir).
// Betik ağa çıkmaz. Kullanım: npm run owner:credentials [-- --dir <klasör>] (varsayılan: ev klasöründe winvestour-backup; depo içi yol REDDEDİLİR).
import { randomBytes, createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { base32Encode, hashPassword, otpauthUri, totpAt, verifyPassword, matchTotp, base32Decode, SESSION_TTL_SEC, LOCKOUT_THRESHOLD, LOCKOUT_SEC } from "../src/lib/access/index";

const argDir = process.argv.indexOf("--dir"), dir = resolve(argDir > 0 ? process.argv[argDir + 1] : join(homedir(), "winvestour-backup"));
if (dir.startsWith(resolve(".") + "\\") || dir.startsWith(resolve(".") + "/")) { console.error("Refused: the backup folder must be outside the repository."); process.exit(1); }
mkdirSync(dir, { recursive: true });
const credFile = join(dir, "owner-credentials.txt"), envFile = join(dir, "vercel-env-owner.txt");
if (existsSync(credFile)) { console.error(`${credFile} already exists and was not overwritten. Move it away to generate new values.`); process.exit(1); }

const password = randomBytes(18).toString("base64url"); // 24 karakter, ~144 bit
const hash = hashPassword(password), totpSecret = randomBytes(20), totpB32 = base32Encode(totpSecret), sessionSecret = randomBytes(32).toString("base64");
if (!verifyPassword(password, hash) || !base32Decode(totpB32).equals(totpSecret) || matchTotp(totpSecret, totpAt(totpSecret, Date.now()), Date.now()) === null) { console.error("Self-check failed; nothing was written."); process.exit(1); }

writeFileSync(credFile, [
  "WINVESTOUR — OWNER CREDENTIALS. This file is outside the repository; move it into your password manager and then delete it.",
  `Generated: ${new Date().toISOString()}`, "",
  `PASSWORD: ${password}`, "",
  "TOTP (Google Authenticator / Aegis / 1Password → 'enter a setup key', SHA1, 6 digits, 30 s):",
  `  Setup key (base32): ${totpB32}`,
  `  otpauth URI:        ${otpauthUri(totpB32)}`, "",
  `Rules: a session lasts ${SESSION_TTL_SEC / 3600} hours · ${LOCKOUT_THRESHOLD} wrong attempts → ${LOCKOUT_SEC / 60}-minute lock · every sensitive action asks for its own one-time code · a code is not accepted twice in the same window.`,
  "No recovery code is generated: this file is the recovery path (the TOTP setup key can be added again). If it is lost, run this command again (after moving this file away) and replace the three values in your hosting's environment variables.", "",
].join("\n"), { mode: 0o600 });
writeFileSync(envFile, [`OWNER_PASSWORD_HASH=${hash}`, `OWNER_TOTP_SECRET=${totpB32}`, `SESSION_SECRET=${sessionSecret}`, ""].join("\n"), { mode: 0o600 });
const fp = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);
console.log(JSON.stringify({ credentialsFile: credFile, envFile, fingerprints: { OWNER_PASSWORD_HASH: fp(hash), OWNER_TOTP_SECRET: fp(totpB32), SESSION_SECRET: fp(sessionSecret) },
  note: "Values are written only to the two files; the fingerprints above are short hashes, not the values. Delete vercel-env-owner.txt after you have entered its three lines." }, null, 1));
