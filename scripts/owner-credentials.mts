// G04 madde 10: sahip kimlik bilgilerini ÜRET ve yalnız DEPO DIŞI yedek klasörüne yaz (E-2, E-3). Ekrana/sohbete hiçbir değer basılmaz; yalnız dosya yolları ve karma özetleri.
// Üretilen: parola (rastgele), parola karması (scrypt), TOTP sırrı (20 bayt, base32) + otpauth URI (telefona elle giriş), oturum imza sırrı (32 bayt base64).
// Çıktı dosyaları: <yedek>/sahip-kimlik.txt (iş sahibi okur: parola + TOTP kurulum anahtarı) ve <yedek>/vercel-env-g04.json (Vercel REST gövdesi; yüklendikten sonra SİLİNİR).
// Vercel'e yazma bu betikte DEĞİL (betikler ağa çıkmaz; kapı kuralı) — `vercel api … --input <json>` ile ayrıca yapılır. Kullanım: npm run owner:credentials [-- --dir <klasör>]
import { randomBytes, createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { base32Encode, hashPassword, otpauthUri, totpAt, verifyPassword, matchTotp, base32Decode, SESSION_TTL_SEC, LOCKOUT_THRESHOLD, LOCKOUT_SEC } from "../src/lib/access/index";

const argDir = process.argv.indexOf("--dir"), dir = resolve(argDir > 0 ? process.argv[argDir + 1] : join(homedir(), "winvestour-yedek"));
if (dir.startsWith(resolve(".") + "\\") || dir.startsWith(resolve(".") + "/")) { console.error("yedek klasörü depo içinde olamaz"); process.exit(1); }
mkdirSync(dir, { recursive: true });
const credFile = join(dir, "sahip-kimlik.txt"), envFile = join(dir, "vercel-env-g04.json");
if (existsSync(credFile)) { console.error(`${credFile} zaten var — üzerine yazılmadı. Yenilemek için dosyayı taşıyın.`); process.exit(1); }

const password = randomBytes(18).toString("base64url"); // 24 karakter, ~144 bit
const hash = hashPassword(password), totpSecret = randomBytes(20), totpB32 = base32Encode(totpSecret), sessionSecret = randomBytes(32).toString("base64");
if (!verifyPassword(password, hash) || !base32Decode(totpB32).equals(totpSecret) || matchTotp(totpSecret, totpAt(totpSecret, Date.now()), Date.now()) === null) { console.error("öz denetim başarısız"); process.exit(1); }

writeFileSync(credFile, [
  "WINVESTOUR — SAHİP KİMLİK BİLGİLERİ (G04). Bu dosya depo dışındadır; parola yöneticinize taşıyın ve bu dosyayı silin.",
  `Üretim: ${new Date().toISOString()}`, "",
  `PAROLA: ${password}`, "",
  "TOTP (Google Authenticator / Aegis / 1Password → 'elle gir', SHA1, 6 hane, 30 s):",
  `  Anahtar (base32): ${totpB32}`,
  `  otpauth URI:      ${otpauthUri(totpB32)}`, "",
  `Kurallar (sicil, A-1 açık): oturum ${SESSION_TTL_SEC / 3600} saat · ${LOCKOUT_THRESHOLD} yanlış deneme → ${LOCKOUT_SEC / 60} dk kilit · her hassas eylem kendi TOTP kodunu ister · kod aynı pencerede ikinci kez geçmez.`,
  "Kurtarma kodu ÜRETİLMEDİ: kurtarma yolu bu dosyadır (TOTP anahtarı yeniden eklenebilir). Kaybolursa Vercel'de OWNER_* değerleri yeniden üretilir.", "",
].join("\n"), { mode: 0o600 });
writeFileSync(envFile, JSON.stringify([
  { key: "OWNER_PASSWORD_HASH", value: hash, type: "encrypted", target: ["production"] },
  { key: "OWNER_TOTP_SECRET", value: totpB32, type: "encrypted", target: ["production"] },
  { key: "SESSION_SECRET", value: sessionSecret, type: "encrypted", target: ["production"] },
]), { mode: 0o600 });
const fp = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);
console.log(JSON.stringify({ credentialsFile: credFile, vercelEnvBody: envFile, fingerprints: { OWNER_PASSWORD_HASH: fp(hash), OWNER_TOTP_SECRET: fp(totpB32), SESSION_SECRET: fp(sessionSecret) }, note: "değerler yalnız dosyada; vercel-env-g04.json yüklendikten sonra silinir" }, null, 1));
