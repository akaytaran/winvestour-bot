// DURDURMA KİMLİK BİLGİSİ (Tur 6, K-7 düzeltmesi). Durdurma sınıfı yol (`withAccess({ cls: "stop" })`) kararını YALNIZ bu modül verir.
// BAĞIMLILIK LİSTESİ (kapı kaynak üzerinden ölçer, yorumdan değil): node:crypto + ../env (yalnız STOP_KEY_HASH, dar sözleşme). Oturum çerezi, TOTP,
// deneme kilidi, Upstash, Neon, Beyin — HİÇBİRİ yok ve olamaz. Bu bir "ikinci kullanıcı" değil, tek sahibin ikinci anahtarıdır; yalnız durdurmayı açar.
// Anahtar: 32 bayt rastgele (base64url, 43 karakter) `x-stop-key` başlığında; ortamda yalnız sha256 karması (hex). Doğrulama sabit zamanlı.
// Sınır: STOP_BACKOFF — süreç belleğinde artan gecikme. Kilit YOK, sayaç deposu YOK; Upstash/Neon düşükken durdurma yine çalışır.
import { createHash, timingSafeEqual } from "node:crypto";
import { getStopKeyHash } from "../env";

export const STOP_HEADER = "x-stop-key";
/** AÇIK — A-1'de yok, UYDURULDU (sicil, geri alınabilir). Biçim: üstel gecikme, tavanlı, süreyle sönen.
 *  Gerekçe: anahtar 256 bit rastgele olduğundan kaba kuvvet zaten imkânsızdır; gecikme yalnız aynı sıcak örnekte art arda denemeyi yavaşlatır.
 *  Kilit yoktur: yanlış deneme sayısı ne olursa olsun doğru anahtar en çok maxMs bekler ve KABUL EDİLİR (K-7). Durum süreç belleğindedir
 *  (örnek başına; soğuk başlangıçta sıfırlanır) — dış servis olmadığı için depo düşükken de çalışır. decayMs: son yanlıştan bu kadar sonra sıfırlanır. */
export const STOP_BACKOFF = { baseMs: 200, maxMs: 4000, decayMs: 10 * 60 * 1000 } as const;
export type StopReason = "STOP_KEY_INVALID" | "STOP_UNCONFIGURED";
export type StopDecision = { ok: true; delayedMs: number } | { ok: false; status: 401 | 503; reason: StopReason; delayedMs: number };
export type StopState = { fails: number; lastFailAt: number };
/** Enjeksiyon yalnız kapı/kanarya için (S-9); üretimde karma dar sözleşmeden, durum modül belleğinden, uyku gerçek. */
export type StopDeps = { keyHash?: string; now?: () => number; sleep?: (ms: number) => Promise<void>; state?: StopState };

const HEX64 = /^[0-9a-f]{64}$/;
export const stopKeyHash = (key: string): string => createHash("sha256").update(key, "utf8").digest("hex");
export const backoffDelayMs = (s: StopState, now: number): number => (s.fails === 0 || now - s.lastFailAt > STOP_BACKOFF.decayMs ? 0 : Math.min(STOP_BACKOFF.baseMs * 2 ** (s.fails - 1), STOP_BACKOFF.maxMs));
const moduleState: StopState = { fails: 0, lastFailAt: 0 };
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Karar: başlıktaki anahtarın sha256'sı ortamdaki karmayla sabit zamanlı karşılaştırılır. Yanlışta gecikme artar; kilit OLUŞMAZ; hiçbir depoya dokunulmaz. */
export async function authorizeStop(req: Request, deps: StopDeps = {}): Promise<StopDecision> {
  const clock = deps.now ?? Date.now, state = deps.state ?? moduleState, sleep = deps.sleep ?? realSleep;
  let hash: string; try { hash = deps.keyHash ?? getStopKeyHash(); } catch { return { ok: false, status: 503, reason: "STOP_UNCONFIGURED", delayedMs: 0 }; }
  if (!HEX64.test(hash)) return { ok: false, status: 503, reason: "STOP_UNCONFIGURED", delayedMs: 0 };
  const delayedMs = backoffDelayMs(state, clock()); if (delayedMs === 0) state.fails = 0; else await sleep(delayedMs);
  const key = req.headers.get(STOP_HEADER) ?? "";
  if (key.length > 0 && timingSafeEqual(Buffer.from(stopKeyHash(key), "hex"), Buffer.from(hash, "hex"))) { state.fails = 0; return { ok: true, delayedMs }; }
  state.fails += 1; state.lastFailAt = clock();
  return { ok: false, status: 401, reason: "STOP_KEY_INVALID", delayedMs };
}
