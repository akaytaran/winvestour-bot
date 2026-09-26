// K11 (Tur 58, `winvestor-kopya-sifreleme-anahtari-ureteci` = [A]): ŞİFRELEME ANA ANAHTARINI üret; değer YALNIZ depo dışı yedek dosyasına (encryption-master-key.txt)
// ve ENCRYPTION_MASTER_KEY olarak girilecek geçici dosyaya (girildikten sonra SİLİNİR). Ekrana/sohbete yalnız yollar ve sha256 ön eki basılır (E-2, S-2). Ağa çıkmaz.
// Kopyanın kendi env.ts şeması ile öz denetim yapar. Kullanım: npm run key:encryption-master [-- --dir <klasör>]. Tur 77 (GK EK): çıktı dosyası ve içeriği İNGİLİZCE.
// DÖNÜŞ DEĞİL: mevcut bir kurulumun anahtarını değiştirmek `rotate:encryption-key` işidir (bu betik ona DOKUNMAZ); bu betik YALNIZ yeni bir değer üretir.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { envSchema } from "../src/lib/env";

const argDir = process.argv.indexOf("--dir"), dir = resolve(argDir > 0 ? process.argv[argDir + 1] : join(homedir(), "winvestour-backup"));
if (dir.startsWith(resolve(".") + "\\") || dir.startsWith(resolve(".") + "/")) { console.error("Refused: the backup folder must be outside the repository."); process.exit(1); }
mkdirSync(dir, { recursive: true });
const keyFile = join(dir, "encryption-master-key.txt"), envFile = join(dir, "vercel-env-ENCRYPTION_MASTER_KEY.txt");
if (existsSync(keyFile)) { console.error(`${keyFile} already exists and was not overwritten. Changing the key means a rotation: npm run rotate:encryption-key`); process.exit(1); }

const key = randomBytes(32).toString("base64"); // 32 bayt = AES-256-GCM anahtarı; base64'te 44 karakter
// Öz denetim: değer kopyanın KENDİ sözleşmesinden geçmeli (tek biçim kaynağı src/lib/env.ts) ve gerçekten 32 bayta çözülmeli.
const parsed = envSchema.shape.ENCRYPTION_MASTER_KEY.safeParse(key);
if (!parsed.success || Buffer.from(key, "base64").length !== 32) { console.error("Self-check failed; nothing was written."); process.exit(1); }

writeFileSync(keyFile, [
  "WINVESTOUR — ENCRYPTION MASTER KEY. This file is outside the repository; move it into your password manager and then delete it.",
  `Generated: ${new Date().toISOString()}`, "",
  `ENCRYPTION_MASTER_KEY: ${key}`,
  "ENCRYPTION_KEY_VERSION: 1", "",
  "This key encrypts your exchange API keys (AES-256-GCM). If it is LOST, the encrypted rows can never be opened again:",
  "keep a second copy in your password manager. The value is never written to any log, error message or screen.",
  "If it is lost anyway: delete the Binance API key on Binance, generate a new master key with this command (after moving this file away), put it into ENCRYPTION_MASTER_KEY, redeploy, and add a new Binance key in the panel.",
  "To change it while you still have it (rotation): `npm run rotate:encryption-key` decrypts with the old key and re-wraps with the new one; ENCRYPTION_MASTER_KEY_PREVIOUS = old value, ENCRYPTION_KEY_VERSION goes up by one.", "",
].join("\n"), { mode: 0o600 });
writeFileSync(envFile, key + "\n", { mode: 0o600 });
const fp = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);
console.log(JSON.stringify({ keyFile, envFile, fingerprints: { ENCRYPTION_MASTER_KEY: fp(key) }, note: "The value is only in the two files; the fingerprint above is a short hash, not the value. Delete envFile after you have entered it as ENCRYPTION_MASTER_KEY." }, null, 1));
