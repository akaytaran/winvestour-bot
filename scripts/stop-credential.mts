// Tur 6 madde 1/5: DURDURMA ANAHTARINI üret; ham değer YALNIZ depo dışı yedek dosyasına (stop-key.txt), sha256 karması ortam değişkeni STOP_KEY_HASH olarak girilecek geçici dosyaya
// (girildikten sonra SİLİNİR). Ekrana/sohbete yalnız yollar ve sha256 ön ekleri basılır (E-2, S-2). Ağa çıkmaz. Kullanım: npm run stop:credential [-- --dir <klasör>]
// Tur 77 (GK EK): çıktı dosyası ve içeriği İNGİLİZCE; dosya /durdur ekranıyla uyumlu kullanım anlatır (ekranın adı + alanın adı sözlükten değil, ekranın bugünkü İngilizce adı).
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { STOP_BACKOFF, STOP_HEADER, authorizeStop, stopKeyHash } from "../src/lib/access/stop";

const argDir = process.argv.indexOf("--dir"), dir = resolve(argDir > 0 ? process.argv[argDir + 1] : join(homedir(), "winvestour-backup"));
if (dir.startsWith(resolve(".") + "\\") || dir.startsWith(resolve(".") + "/")) { console.error("Refused: the backup folder must be outside the repository."); process.exit(1); }
mkdirSync(dir, { recursive: true });
const keyFile = join(dir, "stop-key.txt"), hashFile = join(dir, "vercel-env-STOP_KEY_HASH.txt");
if (existsSync(keyFile)) { console.error(`${keyFile} already exists and was not overwritten. Move it away to generate a new key.`); process.exit(1); }

const key = randomBytes(32).toString("base64url"), hash = stopKeyHash(key); // 256 bit; karma sha256 hex (64)
const okDec = await authorizeStop(new Request("http://x", { headers: { [STOP_HEADER]: key } }), { keyHash: hash, sleep: async () => {} }), badDec = await authorizeStop(new Request("http://x", { headers: { [STOP_HEADER]: key + "x" } }), { keyHash: hash, sleep: async () => {} });
if (!okDec.ok || badDec.ok || !/^[0-9a-f]{64}$/.test(hash)) { console.error("Self-check failed; nothing was written."); process.exit(1); }

writeFileSync(keyFile, [
  "WINVESTOUR — STOP KEY. This file is outside the repository; move it into your password manager.",
  `Generated: ${new Date().toISOString()}`, "",
  `STOP KEY: ${key}`, "",
  "How to use it: open /durdur on your deployment (the screen \"Winvestour · stop the engine\"), choose what should happen, type this key into the \"Stop key\" field and press Stop.",
  "The panel's STOP button asks for the same key. No session, no one-time code and no lock is needed; stopping works even when the database or the cache is slow.",
  "This key only stops. It does not start the engine and does not open any sensitive action (adding a key, risk settings, leverage, key rotation).",
  `Limit: after a wrong attempt the server waits ${STOP_BACKOFF.baseMs} ms, doubling up to ${STOP_BACKOFF.maxMs} ms; this resets after ${STOP_BACKOFF.decayMs / 60000} minutes. There is no lock.`,
  "To replace it: move this file away, run `npm run stop:credential` again and put the new hash (vercel-env-STOP_KEY_HASH.txt) into the STOP_KEY_HASH environment variable, then redeploy.", "",
].join("\n"), { mode: 0o600 });
writeFileSync(hashFile, hash + "\n", { mode: 0o600 });
const fp = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);
console.log(JSON.stringify({ keyFile, hashFile, fingerprints: { STOP_KEY: fp(key), STOP_KEY_HASH: fp(hash) }, note: "The raw key is only in keyFile; the fingerprints above are short hashes, not the values. Delete hashFile after you have entered it as STOP_KEY_HASH." }, null, 1));
