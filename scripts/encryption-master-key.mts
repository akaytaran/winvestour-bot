// K11 (Tur 58, `winvestor-kopya-sifreleme-anahtari-ureteci` = [A]): ŞİFRELEME ANA ANAHTARINI üret; değer YALNIZ depo dışı yedek dosyasına (sifreleme-ana-anahtari.txt)
// ve Vercel'e `vercel env add ENCRYPTION_MASTER_KEY production < dosya` ile gidecek geçici dosyaya (yüklendikten sonra SİLİNİR). Ekrana/sohbete yalnız yollar ve sha256 ön eki
// basılır (E-2, S-2). Ağa çıkmaz. Kopyanın kendi env.ts şeması ile öz denetim yapar. Kullanım: npm run key:encryption-master [-- --dir <klasör>]
// DÖNÜŞ DEĞİL: mevcut bir kurulumun anahtarını değiştirmek `rotate:encryption-key` işidir (bu betik ona DOKUNMAZ); bu betik YALNIZ yeni bir değer üretir.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { envSchema } from "../src/lib/env";

const argDir = process.argv.indexOf("--dir"), dir = resolve(argDir > 0 ? process.argv[argDir + 1] : join(homedir(), "winvestour-yedek"));
if (dir.startsWith(resolve(".") + "\\") || dir.startsWith(resolve(".") + "/")) { console.error("yedek klasörü depo içinde olamaz"); process.exit(1); }
mkdirSync(dir, { recursive: true });
const keyFile = join(dir, "sifreleme-ana-anahtari.txt"), envFile = join(dir, "vercel-env-ENCRYPTION_MASTER_KEY.txt");
if (existsSync(keyFile)) { console.error(`${keyFile} zaten var — üzerine yazılmadı. Yenilemek dönüş demektir: npm run rotate:encryption-key`); process.exit(1); }

const key = randomBytes(32).toString("base64"); // 32 bayt = AES-256-GCM anahtarı; base64'te 44 karakter
// Öz denetim: değer kopyanın KENDİ sözleşmesinden geçmeli (tek biçim kaynağı src/lib/env.ts) ve gerçekten 32 bayta çözülmeli.
const parsed = envSchema.shape.ENCRYPTION_MASTER_KEY.safeParse(key);
if (!parsed.success || Buffer.from(key, "base64").length !== 32) { console.error("öz denetim başarısız"); process.exit(1); }

writeFileSync(keyFile, [
  "WINVESTOUR — ŞİFRELEME ANA ANAHTARI (G03, K11). Bu dosya depo dışındadır; parola yöneticinize taşıyın ve bu dosyayı silin.",
  `Üretim: ${new Date().toISOString()}`, "",
  `ENCRYPTION_MASTER_KEY: ${key}`,
  "ENCRYPTION_KEY_VERSION: 1", "",
  "Bu anahtar borsa API anahtarlarınızı şifreler (AES-256-GCM). KAYBOLURSA şifreli satırlar bir daha AÇILAMAZ:",
  "ikinci kopyası parola yöneticinizde dursun (E-3). Değer hiçbir kütüğe, hata mesajına ve ekrana basılmaz.",
  "Değiştirmek (dönüş) bu kopyada bir araçla YAPILIR: `npm run rotate:encryption-key` (Tur 59, K13). Dönüş eski anahtarla çözüp yeni anahtarla yeniden sarar; ENCRYPTION_MASTER_KEY_PREVIOUS = eski değer, ENCRYPTION_KEY_VERSION bir artar. Yine de anahtarı KAYBETMEMEK esastır: eski anahtar yoksa dönüş de yapılamaz.", "",
].join("\n"), { mode: 0o600 });
writeFileSync(envFile, key + "\n", { mode: 0o600 });
const fp = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);
console.log(JSON.stringify({ keyFile, vercelEnvFile: envFile, fingerprints: { ENCRYPTION_MASTER_KEY: fp(key) }, note: "değer yalnız dosyalarda; vercel-env-ENCRYPTION_MASTER_KEY.txt yüklendikten sonra silinir" }, null, 1));
