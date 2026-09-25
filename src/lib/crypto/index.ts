// ŞİFRELEME SERVİSİ (G03). AES-256-GCM, node:crypto. Şifreleme/çözme YALNIZ bu modülde (kapı: scripts/gate-crypto.mjs).
// Zarf (G02'de sabitlendi, DB CHECK doğrular): bayt0 = 0x01 ‖ 12 bayt nonce ‖ 16 bayt tag ‖ şifreli metin ⇒ ≥ 30 bayt.
// Anahtar sürümü zarfta DEĞİL, satırın `encryption_key_version` sütununda (E-3). AAD = alan adı: bir sütunun zarfı diğerine taşınamaz.
// Düz metin dışarı çıkmaz: çözme yalnız withDecrypted(field, stored, fn) içinde; tampon çağrı bitince sıfırlanır (S-1).
// Hiçbir hata mesajı değer taşımaz; bu modülde console yoktur (S-2).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getEnv } from "../env";

export const ENVELOPE_VERSION = 0x01, NONCE_LEN = 12, TAG_LEN = 16, MIN_ENVELOPE_LEN = 1 + NONCE_LEN + TAG_LEN + 1;
export const ENCRYPTED_FIELDS = ["exchange_keys:api_key", "exchange_keys:private_key"] as const;
export type EncryptedField = (typeof ENCRYPTED_FIELDS)[number];
export type StoredField = { ciphertext: Uint8Array; encryptionKeyVersion: number };
export type KeyEntry = { version: number; key: Buffer };
export type Keyring = { current: KeyEntry; previous?: KeyEntry };
export type CryptoErrorCode = "bad-field" | "bad-master-key" | "bad-key-version" | "bad-envelope" | "empty-plaintext" | "key-version-unknown" | "previous-key-missing" | "decrypt-failed" | "plaintext-leak-refused";

export class CryptoServiceError extends Error {
  constructor(public readonly code: CryptoErrorCode, detail: string) { super(`crypto[${code}]: ${detail}`); this.name = "CryptoServiceError"; }
}

const decodeKey = (name: string, b64: string): Buffer => {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(b64)) throw new CryptoServiceError("bad-master-key", `${name} 32 bayt base64 (44 karakter) olmalı`);
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new CryptoServiceError("bad-master-key", `${name} 32 bayt çözülmeli`);
  return key;
};

/** Anahtar halkası: geçerli sürüm + (isteğe bağlı) bir önceki sürüm. Değerler yalnız buradan geçer; mesajlar değer taşımaz. */
export function keyringFrom(src: { masterKey: string; keyVersion: number; previousKey?: string }): Keyring {
  if (!Number.isInteger(src.keyVersion) || src.keyVersion < 1) throw new CryptoServiceError("bad-key-version", "ENCRYPTION_KEY_VERSION tamsayı ≥ 1 olmalı");
  const ring: Keyring = { current: { version: src.keyVersion, key: decodeKey("ENCRYPTION_MASTER_KEY", src.masterKey) } };
  if (src.previousKey) {
    if (src.keyVersion < 2) throw new CryptoServiceError("bad-key-version", "PREVIOUS varken ENCRYPTION_KEY_VERSION ≥ 2 olmalı");
    ring.previous = { version: src.keyVersion - 1, key: decodeKey("ENCRYPTION_MASTER_KEY_PREVIOUS", src.previousKey) };
  }
  return ring;
}

/** Ortam sözleşmesinden (src/lib/env.ts) halka. Uygulama içi varsayılan. */
export function keyringFromEnv(): Keyring {
  const e = getEnv();
  return keyringFrom({ masterKey: e.ENCRYPTION_MASTER_KEY, keyVersion: e.ENCRYPTION_KEY_VERSION, previousKey: e.ENCRYPTION_MASTER_KEY_PREVIOUS });
}

const assertField = (field: string): EncryptedField => {
  if (!(ENCRYPTED_FIELDS as readonly string[]).includes(field)) throw new CryptoServiceError("bad-field", "bilinmeyen alan");
  return field as EncryptedField;
};

/** Zarf biçimi denetimi (bayt0 = 0x01, uzunluk ≥ 30). İçeriğe bakmaz; düz metin bayt0 ≠ 1 olduğundan reddedilir. */
export function assertEnvelope(buf: unknown): Buffer {
  if (!(buf instanceof Uint8Array)) throw new CryptoServiceError("bad-envelope", "zarf bayt dizisi değil");
  if (buf.length < MIN_ENVELOPE_LEN) throw new CryptoServiceError("bad-envelope", `zarf ${buf.length} bayt, en az ${MIN_ENVELOPE_LEN} olmalı`);
  if (buf[0] !== ENVELOPE_VERSION) throw new CryptoServiceError("bad-envelope", "zarf sürüm baytı 0x01 değil");
  return Buffer.from(buf.buffer, buf.byteOffset, buf.length);
}

const selectKey = (ring: Keyring, version: number): Buffer => {
  if (version === ring.current.version) return ring.current.key;
  if (version === ring.current.version - 1) {
    if (!ring.previous) throw new CryptoServiceError("previous-key-missing", `satır sürümü ${version}, ENCRYPTION_MASTER_KEY_PREVIOUS yok`);
    return ring.previous.key;
  }
  throw new CryptoServiceError("key-version-unknown", `satır sürümü ${version}, halka ${ring.current.version}${ring.previous ? "/" + ring.previous.version : ""} — sessiz geçiş yok`);
};

/** Şifrele. Sonuç zarf + halkanın geçerli sürümü (satıra birlikte yazılır). Girdi tamponu kopyalanır ve sıfırlanır. */
export function encryptField(field: EncryptedField, plaintext: Uint8Array | string, ring: Keyring = keyringFromEnv()): { ciphertext: Buffer; encryptionKeyVersion: number } {
  assertField(field);
  const plain = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : Buffer.from(plaintext);
  try {
    if (plain.length === 0) throw new CryptoServiceError("empty-plaintext", "boş düz metin şifrelenmez");
    const nonce = randomBytes(NONCE_LEN);
    const cipher = createCipheriv("aes-256-gcm", ring.current.key, nonce, { authTagLength: TAG_LEN });
    cipher.setAAD(Buffer.from(field, "utf8"));
    const envelope = Buffer.concat([Buffer.from([ENVELOPE_VERSION]), nonce, Buffer.alloc(TAG_LEN), cipher.update(plain), cipher.final()]);
    cipher.getAuthTag().copy(envelope, 1 + NONCE_LEN);
    return { ciphertext: assertEnvelope(envelope), encryptionKeyVersion: ring.current.version };
  } finally { plain.fill(0); }
}

const containsPlain = (v: unknown, plain: Buffer, depth = 0): boolean => {
  if (v instanceof Uint8Array) return v === plain || Buffer.from(v.buffer, v.byteOffset, v.length).includes(plain);
  if (typeof v === "string") return Buffer.from(v, "utf8").includes(plain) || Buffer.from(v, "latin1").includes(plain);
  if (v && typeof v === "object" && depth < 2) return Object.values(v).some((x) => containsPlain(x, plain, depth + 1));
  return false;
};

/** Çöz ve fn'e ver. Düz metin geri dönüş değeri olamaz: fn'in sonucu düz metni içeriyorsa reddedilir. Tampon her yolda sıfırlanır. */
export function withDecrypted<T>(field: EncryptedField, stored: StoredField, fn: (plain: Buffer) => T, ring: Keyring = keyringFromEnv()): T {
  assertField(field);
  const env = assertEnvelope(stored.ciphertext);
  const key = selectKey(ring, stored.encryptionKeyVersion);
  const nonce = env.subarray(1, 1 + NONCE_LEN), tag = env.subarray(1 + NONCE_LEN, 1 + NONCE_LEN + TAG_LEN), body = env.subarray(1 + NONCE_LEN + TAG_LEN);
  let plain: Buffer;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_LEN });
    decipher.setAAD(Buffer.from(field, "utf8"));
    decipher.setAuthTag(tag);
    const head = decipher.update(body), tail = decipher.final(); // final() tag/AAD/anahtar uyuşmazlığında fırlatır
    plain = Buffer.concat([head, tail]); head.fill(0); tail.fill(0);
  } catch (e) {
    if (e instanceof CryptoServiceError) throw e;
    throw new CryptoServiceError("decrypt-failed", "kimlik doğrulama başarısız (tag/AAD/anahtar)"); // özgün mesaj taşınmaz
  }
  let deferred = false;
  try {
    const out = fn(plain);
    if (out && typeof (out as { then?: unknown }).then === "function") {
      deferred = true;
      return (out as unknown as Promise<unknown>).then((v) => { if (containsPlain(v, plain)) throw new CryptoServiceError("plaintext-leak-refused", "geri dönüş değeri düz metin taşıyor"); return v; }).finally(() => plain.fill(0)) as T;
    }
    if (containsPlain(out, plain)) throw new CryptoServiceError("plaintext-leak-refused", "geri dönüş değeri düz metin taşıyor");
    return out;
  } finally { if (!deferred) plain.fill(0); }
}

/** Yeniden sar (dönüş): eski sürümle çöz, geçerli sürümle şifrele. Düz metin bu çağrının dışına çıkmaz. */
export function rewrapField(field: EncryptedField, stored: StoredField, ring: Keyring = keyringFromEnv()): { ciphertext: Buffer; encryptionKeyVersion: number } {
  return withDecrypted(field, stored, (plain) => encryptField(field, plain, ring), ring);
}
