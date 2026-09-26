// G06 · A1: Ed25519 çiftini YEREL üret (S-4, self-generated), yalnız DEPO DIŞI yedek klasörüne yaz (E-3: özel anahtarın yedeği ayrı yerde; Tur 0'da tek kopya kaybedildi).
// Açık anahtar (SPKI PEM) sır değildir — Binance "Self-generated" alanına yapıştırılır. Özel anahtar (PKCS8 PEM) ekrana/sohbete BASILMAZ (S-2): ekrana yalnız dosya yolları, parmak izi ve satır sayıları.
// Parmak izi = SHA-256(SPKI DER) hex; kabul akışı aynı hesabı yapar (exchange_keys.public_key_fingerprint). Ağa çıkmaz. Kullanım: npm run key:generate [-- --dir <klasör>]
// Tur 77 (K-A, karar defteri 25 Eyl "Ed25519 anahtar üretici betik YAYINA girer"): çıktı İngilizce, depo İÇİ yol REDDEDİLİR (kanarya ölçer), varsayılan klasör winvestour-backup.
import { generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fingerprintOf } from "../src/lib/exchange-key/sign";

const argDir = process.argv.indexOf("--dir"), dir = resolve(argDir > 0 ? process.argv[argDir + 1] : join(homedir(), "winvestour-backup"));
if (dir.startsWith(resolve(".") + "\\") || dir.startsWith(resolve(".") + "/")) { console.error("Refused: the backup folder must be outside the repository."); process.exit(1); }
mkdirSync(dir, { recursive: true });
const privFile = join(dir, "binance-private-key.pem"), pubFile = join(dir, "binance-public-key.pem");
if (existsSync(privFile)) { console.error(`${privFile} already exists and was not overwritten. Move it away to generate a new pair.`); process.exit(1); }

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string, pubPem = publicKey.export({ type: "spki", format: "pem" }) as string;
const fingerprint = fingerprintOf(publicKey.export({ type: "spki", format: "der" }));
const msg = randomBytes(64); // öz denetim: üretilen çiftle imza doğrulanıyor mu
if (privateKey.asymmetricKeyType !== "ed25519" || !verify(null, msg, publicKey, sign(null, msg, privateKey)) || !/^[0-9a-f]{64}$/.test(fingerprint)) { console.error("Self-check failed; nothing was written."); process.exit(1); }
writeFileSync(privFile, privPem, { mode: 0o600 });
writeFileSync(pubFile, pubPem, { mode: 0o644 });
console.log(JSON.stringify({
  publicKeyFile: pubFile, privateKeyFile: privFile, fingerprint, keyType: "ed25519", privateKeyPemLines: privPem.split("\n").filter(Boolean).length, publicKeyPemLines: pubPem.split("\n").filter(Boolean).length,
  next: `On Binance: Profile → API Management → Create API → "Self-generated" → paste the contents of ${pubFile}. Permissions: Enable Reading and Enable Spot & Margin Trading ON, withdrawals OFF. Then, in the panel's Settings tab, section "Binance API key", add the API key Binance shows and the whole contents of ${privFile}. The private key is never printed here; keep the file in your password manager.`,
}, null, 1));
