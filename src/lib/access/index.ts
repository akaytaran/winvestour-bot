// ERİŞİM KORUMASI (G04, S-8, K-7). Tek kullanıcı, kimlik sağlayıcı yok (MİMARİ §5). Her API ucu sınıfını `withAccess` ile BİLDİRİR (kapı zorlar):
//   public    → koruma yok (sağlık, giriş).
//   session   → imzalı çerez (httpOnly, Secure, SameSite=Strict, süreli). DURUMSUZ: Upstash'e, veritabanına, kilide dokunmaz — durdurma yolu (G08) bu sınıftır (K-7).
//   sensitive → oturum + EYLEM BAŞINA TOTP (RFC 6238, 6 hane, 30 s). Tekrar oynatma (replay) ve deneme sayacı Upstash'te; depo düşerse KAPALI ARIZA (sensitive reddedilir, session etkilenmez).
//   stop      → DURDURMA (K-7, Tur 6): kendi anahtarı (`x-stop-key`, ./stop.ts). Oturum, TOTP, kilit, Upstash, Neon, Beyin — hiçbirine bağımlı DEĞİL; aşağıdaki hiçbir yol çalışmaz.
// Parola karması scrypt (node:crypto; bağımlılık yok, bellek-sert). Sırlar yalnız ortam sözleşmesinden; hiçbir mesaj değer taşımaz; bu modülde console yoktur (S-2).
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getEnv } from "../env";
import { redisPipeline } from "../upstash";
import { SENSITIVE_ACTIONS, type SensitiveAction } from "./sensitive-actions";
import { authorizeStop, type StopDeps } from "./stop";

/** AÇIK — A-1'de yok, UYDURULDU (sicil, geri alınabilir). Tek yerde, adıyla. */
export const SESSION_TTL_SEC = 8 * 3600; // oturum süresi: bir iş günü; süre dolunca parola yeniden
export const LOCKOUT_THRESHOLD = 5; // ardışık yanlış parola/TOTP denemesi → kilit
export const LOCKOUT_SEC = 15 * 60; // kilit süresi; kilit yalnız girişi ve sensitive'i kapatır, session (durdurma) yolunu ASLA kapatmaz
export const TOTP_CONFIRM_WINDOW_SEC = 0; // onay penceresi YOK: her hassas eylem kendi kodunu ister; kullanılmış kod aynı adımda tekrar kabul edilmez
export const TOTP_STEP_SEC = 30, TOTP_DIGITS = 6, TOTP_DRIFT_STEPS = 1; // standart TOTP; ±1 adım saat kayması toleransı
export const SCRYPT_PARAMS = { log2N: 17, r: 8, p: 1 } as const; // OWASP scrypt önerisi (N=2^17, r=8, p=1 ≈ 128 MiB)
export const SESSION_COOKIE = "__Host-session", TOTP_HEADER = "x-totp-code";

export type RouteClass = "public" | "session" | "sensitive" | "stop";
export type RouteAccess = { cls: "public" } | { cls: "session" } | { cls: "sensitive"; action: SensitiveAction } | { cls: "stop" };
/** `stop` sınıfı bu karar fonksiyonundan GEÇMEZ (K-7): withAccess onu ./stop.ts'e, oturum/depo kurulmadan yönlendirir. */
export type StoreBackedAccess = Exclude<RouteAccess, { cls: "stop" }>;
export type DenyReason = "NO_SESSION" | "LOCKED" | "TOTP_REQUIRED" | "TOTP_INVALID" | "TOTP_REPLAYED" | "STORE_UNAVAILABLE" | "ACCESS_UNCONFIGURED" | "STOP_KEY_INVALID" | "STOP_UNCONFIGURED";
export type Decision = { ok: true } | { ok: false; status: number; reason: DenyReason };
export type Secrets = { sessionSecret: Buffer; passwordHash: string; totpSecret: Buffer };
export type Handler = (req: Request, ctx?: unknown) => Promise<Response> | Response;
/** Depo: üretimde Upstash; kapı/kanarya sahte depo enjekte eder (S-9). Her yöntem fırlatabilir → sensitive kapalı arızalanır. */
export interface AccessStore { get(k: string): Promise<string | null>; set(k: string, v: string, ttlSec: number): Promise<void>; setNx(k: string, v: string, ttlSec: number): Promise<boolean>; incr(k: string, ttlSec: number): Promise<number>; del(k: string): Promise<void> }
export type AccessDeps = { secrets: Secrets; store: AccessStore; now?: () => number };

const STATUS: Record<DenyReason, number> = { NO_SESSION: 401, LOCKED: 423, TOTP_REQUIRED: 403, TOTP_INVALID: 403, TOTP_REPLAYED: 403, STORE_UNAVAILABLE: 503, ACCESS_UNCONFIGURED: 503, STOP_KEY_INVALID: 401, STOP_UNCONFIGURED: 503 };
type Denied = Extract<Decision, { ok: false }>;
const deny = (reason: DenyReason): Denied => ({ ok: false, status: STATUS[reason], reason });
const LOCK_KEY = "access:lock", failKey = (kind: "password" | "totp") => `access:fail:${kind}`, usedKey = (counter: number) => `access:totp:used:${counter}`;
const b64u = (b: Buffer) => b.toString("base64url");
const eq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// ---- parola (scrypt) ----
export function hashPassword(password: string, params = SCRYPT_PARAMS): string {
  const salt = randomBytes(16), key = scryptSync(password.normalize("NFKC"), salt, 32, { N: 2 ** params.log2N, r: params.r, p: params.p, maxmem: 256 * 1024 * 1024 });
  return `scrypt:${params.log2N}:${params.r}:${params.p}:${b64u(salt)}:${b64u(key)}`;
}
export function verifyPassword(password: string, stored: string): boolean {
  const m = /^scrypt:(\d{1,2}):(\d+):(\d+):([A-Za-z0-9_-]{22}):([A-Za-z0-9_-]{43})$/.exec(stored); if (!m) return false;
  const key = scryptSync(password.normalize("NFKC"), Buffer.from(m[4], "base64url"), 32, { N: 2 ** Number(m[1]), r: Number(m[2]), p: Number(m[3]), maxmem: 256 * 1024 * 1024 });
  return timingSafeEqual(key, Buffer.from(m[5], "base64url"));
}

// ---- TOTP (RFC 6238 / HOTP RFC 4226, HMAC-SHA1) ----
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const base32Encode = (buf: Buffer): string => { let bits = 0, val = 0, out = ""; for (const b of buf) { val = ((val << 8) | b) & 0xffff; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } return bits ? out + B32[(val << (5 - bits)) & 31] : out; };
export const base32Decode = (s: string): Buffer => { let bits = 0, val = 0; const out: number[] = []; for (const ch of s.toUpperCase()) { const i = B32.indexOf(ch); if (i < 0) throw new Error("access[bad-base32]"); val = ((val << 5) | i) & 0xffff; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; } } return Buffer.from(out); };
const hotp = (secret: Buffer, counter: number): string => { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(counter)); const h = createHmac("sha1", secret).update(c).digest(), o = h[h.length - 1] & 0xf; return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0"); };
/** Verilen andaki kod (kanarya/kurulum için). */
export const totpAt = (secret: Buffer, nowMs: number): string => hotp(secret, Math.floor(nowMs / 1000 / TOTP_STEP_SEC));
/** Kod ±drift adımda eşleşiyorsa eşleşen sayaç, değilse null. */
export const matchTotp = (secret: Buffer, code: string, nowMs: number): number | null => { if (!/^\d{6}$/.test(code)) return null; const c = Math.floor(nowMs / 1000 / TOTP_STEP_SEC); for (let d = -TOTP_DRIFT_STEPS; d <= TOTP_DRIFT_STEPS; d++) if (eq(hotp(secret, c + d), code)) return c + d; return null; };
export const otpauthUri = (secretB32: string, label = "Winvestour:sahip") => `otpauth://totp/${encodeURIComponent(label)}?secret=${secretB32}&issuer=Winvestour&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SEC}`;

// ---- oturum: imzalı çerez, durumsuz ----
export function issueSession(secret: Buffer, nowMs: number): { token: string; expiresAt: number } {
  const expiresAt = Math.floor(nowMs / 1000) + SESSION_TTL_SEC, body = `${expiresAt}.${b64u(randomBytes(16))}`;
  return { token: `${body}.${b64u(createHmac("sha256", secret).update(body).digest())}`, expiresAt };
}
export function verifySession(secret: Buffer, token: string | null, nowMs: number): boolean {
  const m = token && /^(\d{1,12})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(token); if (!m) return false;
  return eq(m[3], b64u(createHmac("sha256", secret).update(`${m[1]}.${m[2]}`).digest())) && Number(m[1]) > Math.floor(nowMs / 1000);
}
export const sessionCookie = (token: string, maxAgeSec = SESSION_TTL_SEC) => `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSec}`;
export const readSessionCookie = (req: Request): string | null => { for (const part of (req.headers.get("cookie") ?? "").split(";")) { const [k, ...v] = part.trim().split("="); if (k === SESSION_COOKIE) return v.join("="); } return null; };

// ---- kilit ve sayaç (Upstash) ----
const recordFailure = async (store: AccessStore, kind: "password" | "totp", nowMs: number): Promise<number> => { const n = await store.incr(failKey(kind), LOCKOUT_SEC); if (n >= LOCKOUT_THRESHOLD) await store.set(LOCK_KEY, String(nowMs + LOCKOUT_SEC * 1000), LOCKOUT_SEC); return n; };
const isLocked = async (store: AccessStore): Promise<boolean> => (await store.get(LOCK_KEY)) !== null;

/** Karar: sınıfa göre. `session` yolu depoya HİÇ dokunmaz; `sensitive` yolu depo yoksa reddeder (kapalı arıza). `stop` buraya gelmez (tip zorlar). */
export async function authorize(req: Request, access: StoreBackedAccess, deps: AccessDeps): Promise<Decision> {
  if (access.cls === "public") return { ok: true };
  const now = (deps.now ?? Date.now)();
  if (!verifySession(deps.secrets.sessionSecret, readSessionCookie(req), now)) return deny("NO_SESSION");
  if (access.cls === "session") return { ok: true };
  if (!(SENSITIVE_ACTIONS as readonly string[]).includes(access.action)) return deny("ACCESS_UNCONFIGURED");
  try {
    if (await isLocked(deps.store)) return deny("LOCKED");
    const code = req.headers.get(TOTP_HEADER); if (!code) return deny("TOTP_REQUIRED");
    const counter = matchTotp(deps.secrets.totpSecret, code, now);
    if (counter === null) { await recordFailure(deps.store, "totp", now); return deny("TOTP_INVALID"); }
    if (!(await deps.store.setNx(usedKey(counter), "1", TOTP_STEP_SEC * (2 * TOTP_DRIFT_STEPS + 1)))) return deny("TOTP_REPLAYED");
    await deps.store.del(failKey("totp"));
    return { ok: true };
  } catch { return deny("STORE_UNAVAILABLE"); }
}

/** Uç sarmalayıcı: her route dosyası HTTP yöntemini bununla dışa açar; sınıf bildirmeyen uç kapıda KIRMIZI. Üretimde deps ortamdan; enjeksiyon yalnız kapı/kanaryada.
 *  `stop` sınıfı İLK dalda ve tek başına karar alır: oturum, sır kurulumu (defaultDeps), depo, kilit — hiçbiri çalışmaz (K-7; kapı bu sırayı kaynaktan ölçer). */
export function withAccess(access: RouteAccess, handler: Handler, deps?: AccessDeps, stopDeps?: StopDeps): (req: Request, ctx?: unknown) => Promise<Response> {
  return async (req, ctx) => {
    if (access.cls === "stop") { const s = await authorizeStop(req, stopDeps); return s.ok ? handler(req, ctx) : denied(deny(s.reason)); }
    if (access.cls !== "public") {
      let d: AccessDeps; try { d = deps ?? defaultDeps(); } catch { return denied(deny("ACCESS_UNCONFIGURED")); }
      const dec = await authorize(req, access, d); if (!dec.ok) return denied(dec);
    }
    return handler(req, ctx);
  };
}
const denied = (d: Denied) => Response.json({ ok: false, reason: d.reason }, { status: d.status });

/** Giriş (public uç): parola → imzalı çerez. Deneme sayacı ve kilit depoda; depo yoksa giriş de kapalı arızalanır (sicil). */
export async function login(req: Request, deps: AccessDeps = defaultDeps()): Promise<Response> {
  const now = (deps.now ?? Date.now)(); let password: unknown;
  try { password = (await req.json())?.password; } catch { password = undefined; }
  try {
    if (await isLocked(deps.store)) return denied(deny("LOCKED"));
    if (typeof password !== "string" || !verifyPassword(password, deps.secrets.passwordHash)) { await recordFailure(deps.store, "password", now); return Response.json({ ok: false, reason: "BAD_PASSWORD" }, { status: 401 }); }
    await deps.store.del(failKey("password"));
  } catch { return denied(deny("STORE_UNAVAILABLE")); }
  const s = issueSession(deps.secrets.sessionSecret, now);
  return Response.json({ ok: true, expiresAt: s.expiresAt }, { status: 200, headers: { "Set-Cookie": sessionCookie(s.token) } });
}
export const logout = (): Response => Response.json({ ok: true }, { status: 200, headers: { "Set-Cookie": sessionCookie("", 0) } });

// ---- üretim bağımlılıkları ----
export function secretsFromEnv(): Secrets { const e = getEnv(); return { sessionSecret: Buffer.from(e.SESSION_SECRET, "base64"), passwordHash: e.OWNER_PASSWORD_HASH, totpSecret: base32Decode(e.OWNER_TOTP_SECRET) }; }
/** `ns` (Tur 47, K-A): YALNIZ kanarya ad alanı — verilirse `access:*` anahtarları `${ns}:` altında (üretimin kilit/deneme/replay anahtarlarına dokunulmaz); verilmezse AYNEN. */
export function upstashAccessStore(cfg?: { url: string; token: string }, ns?: string): AccessStore {
  const K = (k: string) => (ns ? `${ns}:${k}` : k);
  return {
    get: async (k) => (await redisPipeline([["GET", K(k)]], cfg))[0] as string | null,
    set: async (k, v, ttl) => { await redisPipeline([["SET", K(k), v, "EX", ttl]], cfg); },
    setNx: async (k, v, ttl) => (await redisPipeline([["SET", K(k), v, "EX", ttl, "NX"]], cfg))[0] === "OK",
    incr: async (k, ttl) => Number((await redisPipeline([["INCR", K(k)], ["EXPIRE", K(k), ttl]], cfg))[0]),
    del: async (k) => { await redisPipeline([["DEL", K(k)]], cfg); },
  };
}
export function memoryAccessStore(now: () => number = Date.now): AccessStore & { data: Map<string, { v: string; exp: number }> } {
  const data = new Map<string, { v: string; exp: number }>(), live = (k: string) => { const e = data.get(k); if (e && e.exp <= now()) data.delete(k); return data.get(k); };
  return { data, get: async (k) => live(k)?.v ?? null, set: async (k, v, ttl) => { data.set(k, { v, exp: now() + ttl * 1000 }); }, setNx: async (k, v, ttl) => { if (live(k)) return false; data.set(k, { v, exp: now() + ttl * 1000 }); return true; }, incr: async (k, ttl) => { const n = Number(live(k)?.v ?? 0) + 1; data.set(k, { v: String(n), exp: now() + ttl * 1000 }); return n; }, del: async (k) => { data.delete(k); } };
}
let prod: AccessDeps | null = null;
const defaultDeps = (): AccessDeps => (prod ??= { secrets: secretsFromEnv(), store: upstashAccessStore() });
