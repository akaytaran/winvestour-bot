// İMZALAMA (G06 · A3, S-1, S-2, S-4). Ed25519 imzası ve X-MBX-APIKEY başlığı YALNIZ G03'ün withDecrypted çağrısı İÇİNDE üretilir: özel anahtar (PEM) callback
// dışına çıkmaz, tampon callback bitince sıfırlanır (G03); callback'in dönüş değeri düz metni içeriyorsa G03 reddeder (plaintext-leak-refused).
// createPrivateKey / sign uygulamada yalnız bu dosyada bulunur (kapı: scripts/gate-exchange-key.mjs). İmza girdisi Binance'in istediği sorgu dizesidir
// (URLSearchParams sırası), çıktı base64 — Tur 0'da aynı biçimle 200 alındı (Tur 0 raporu madde 0). Bu modülde console YOKTUR (S-2).
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { withDecrypted, type Keyring, type StoredField } from "@/lib/crypto";

const PRIV = "exchange_keys:private_key", API = "exchange_keys:api_key";
export const API_KEY_HEADER = "X-MBX-APIKEY";
/** SHA-256(açık anahtar SPKI DER) hex — sır değildir; `exchange_keys.public_key_fingerprint` ve `npm run key:generate` aynı hesabı yapar. */
export const fingerprintOf = (spkiDer: Uint8Array): string => createHash("sha256").update(spkiDer).digest("hex");

/** Zarftaki özel anahtarın türü ve parmak izi. Çözme yalnız callback içinde; PEM ayrıştırılamıyorsa ya da türü Ed25519 değilse ok:false (S-4). Mesaj/değer taşımaz. */
export function inspectPrivateKey(stored: StoredField, ring?: Keyring): { ok: true; fingerprint: string } | { ok: false } {
  try {
    return withDecrypted(PRIV, stored, (pem) => {
      const k = createPrivateKey({ key: pem, format: "pem" });
      if (k.asymmetricKeyType !== "ed25519") return { ok: false as const };
      return { ok: true as const, fingerprint: fingerprintOf(createPublicKey(k).export({ type: "spki", format: "der" })) };
    }, ring);
  } catch { return { ok: false }; }
}

/** Sorgu dizesini imzala: verilen anahtar sırası korunur, `signature` (base64) sona eklenir. Binance imzayı bu diziyle doğrular. */
export function signQuery(stored: StoredField, query: Record<string, string>, ring?: Keyring): Record<string, string> {
  const payload = Buffer.from(new URLSearchParams(query).toString(), "utf8");
  const signature = withDecrypted(PRIV, stored, (pem) => sign(null, payload, createPrivateKey({ key: pem, format: "pem" })).toString("base64"), ring);
  return { ...query, signature };
}

/** İmzalı çağrı: API anahtarı başlığa, imza sorguya — ikisi de withDecrypted içinde. fn'in dönüşü anahtar taşıyamaz (G03 sızıntı koruyucusu, async dâhil). */
export function withSignedCall<T>(api: StoredField, priv: StoredField, query: Record<string, string>, fn: (headers: Record<string, string>, signedQuery: Record<string, string>) => Promise<T>, ring?: Keyring): Promise<T> {
  return withDecrypted(API, api, (key) => fn({ [API_KEY_HEADER]: key.toString("utf8") }, signQuery(priv, query, ring)), ring);
}
