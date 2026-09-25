// Tur 6 madde 1/5: DURDURMA ANAHTARINI üret; ham değer YALNIZ depo dışı yedek dosyasına (durdurma-anahtari.txt), sha256 karması Vercel'e `vercel env add STOP_KEY_HASH production < dosya`
// ile gidecek geçici dosyaya (yüklendikten sonra SİLİNİR). Ekrana/sohbete yalnız yollar ve sha256 ön ekleri basılır (E-2, S-2). Ağa çıkmaz. Kullanım: npm run stop:credential [-- --dir <klasör>]
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { STOP_BACKOFF, STOP_HEADER, authorizeStop, stopKeyHash } from "../src/lib/access/stop";

const argDir = process.argv.indexOf("--dir"), dir = resolve(argDir > 0 ? process.argv[argDir + 1] : join(homedir(), "winvestour-yedek"));
if (dir.startsWith(resolve(".") + "\\") || dir.startsWith(resolve(".") + "/")) { console.error("yedek klasörü depo içinde olamaz"); process.exit(1); }
mkdirSync(dir, { recursive: true });
const keyFile = join(dir, "durdurma-anahtari.txt"), hashFile = join(dir, "vercel-env-STOP_KEY_HASH.txt");
if (existsSync(keyFile)) { console.error(`${keyFile} zaten var — üzerine yazılmadı. Yenilemek için dosyayı taşıyın.`); process.exit(1); }

const key = randomBytes(32).toString("base64url"), hash = stopKeyHash(key); // 256 bit; karma sha256 hex (64)
const okDec = await authorizeStop(new Request("http://x", { headers: { [STOP_HEADER]: key } }), { keyHash: hash, sleep: async () => {} }), badDec = await authorizeStop(new Request("http://x", { headers: { [STOP_HEADER]: key + "x" } }), { keyHash: hash, sleep: async () => {} });
if (!okDec.ok || badDec.ok || !/^[0-9a-f]{64}$/.test(hash)) { console.error("öz denetim başarısız"); process.exit(1); }

writeFileSync(keyFile, [
  "WINVESTOUR — DURDURMA ANAHTARI (Tur 6, K-7). Bu dosya depo dışındadır; parola yöneticinize taşıyın.",
  `Üretim: ${new Date().toISOString()}`, "",
  `DURDURMA ANAHTARI: ${key}`, "",
  `Kullanım: durdurma ucuna \`${STOP_HEADER}: <anahtar>\` başlığıyla istek. Oturum, TOTP, kilit gerekmez; Upstash/Neon düşükken de çalışır.`,
  `Yalnız durdurmayı açar; hassas eylemleri (anahtar yazma, risk, kaldıraç, dönüş, yeniden başlatma) AÇMAZ.`,
  `Sınır (sicil, A-1 açık): yanlış denemede ${STOP_BACKOFF.baseMs} ms'den başlayıp ikiye katlanan, en çok ${STOP_BACKOFF.maxMs} ms gecikme; ${STOP_BACKOFF.decayMs / 60000} dk sonra sıfırlanır. Kilit YOK.`,
  "Yenilemek: bu dosyayı taşıyın, `npm run stop:credential` yeniden, karmayı Vercel'e `vercel env add STOP_KEY_HASH production --force < vercel-env-STOP_KEY_HASH.txt`.", "",
].join("\n"), { mode: 0o600 });
writeFileSync(hashFile, hash + "\n", { mode: 0o600 });
const fp = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);
console.log(JSON.stringify({ keyFile, hashFile, fingerprints: { STOP_KEY: fp(key), STOP_KEY_HASH: fp(hash) }, note: "ham anahtar yalnız keyFile'da; hashFile Vercel'e yüklendikten sonra silinir" }, null, 1));
