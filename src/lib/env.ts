// Ortam değişkeni sözleşmesi (TUR-1-EK madde 3). Uygulamanın hiçbir yeri process.env'i doğrudan okumaz; hepsi buradan geçer.
// Eksik/bozuk değişken -> açılışta gürültülü hata (src/instrumentation.ts). Sessiz `undefined` yok.
// İsimler burada tanımlanır, değerler yalnız Vercel ortam değişkeninde durur (E-2; bkz. .env.example).
import { z } from "zod";

const nonEmpty = (name: string) => z.string().min(1, `${name} boş olamaz`);
// 32 bayt base64 = 44 karakter (43 + '='). Ana anahtar biçimi; değer hiçbir hata mesajına girmez (S-2).
const masterKey = (name: string) => z.string().regex(/^[A-Za-z0-9+/]{43}=$/, `${name}: 32 bayt base64 (44 karakter) olmalı`);

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // G02 — Neon Postgres bağlantısı (havuzlu + doğrudan)
  DATABASE_URL: nonEmpty("DATABASE_URL").url(),
  DIRECT_URL: nonEmpty("DIRECT_URL").url(),
  // G03 — API anahtarlarını şifreleyen ana anahtar (S-1, E-3). AES-256-GCM, src/lib/crypto. Dönüş usulü A-1 açık.
  ENCRYPTION_MASTER_KEY: masterKey("ENCRYPTION_MASTER_KEY"),
  // G03 — geçerli anahtar sürümü (tamsayı ≥ 1). Şifrelerken satıra yazılır; zarfın içinde değildir.
  ENCRYPTION_KEY_VERSION: z.string().regex(/^[1-9]\d*$/, "ENCRYPTION_KEY_VERSION: tamsayı ≥ 1 olmalı").transform(Number),
  // G03 — bir önceki sürümün anahtarı; yalnız dönüş (yeniden sarma) sırasında dolu, sonra silinir. Boş olabilir.
  ENCRYPTION_MASTER_KEY_PREVIOUS: z.union([z.literal(""), masterKey("ENCRYPTION_MASTER_KEY_PREVIOUS")]).optional().transform((v) => v || undefined),
  // G05 — çağrı sayacı (S-7, src/lib/binance) + G10 — icra kilidi (K-6). Upstash REST; yoksa Binance'e çağrı çıkmaz.
  UPSTASH_REDIS_REST_URL: nonEmpty("UPSTASH_REDIS_REST_URL").url(),
  UPSTASH_REDIS_REST_TOKEN: nonEmpty("UPSTASH_REDIS_REST_TOKEN"),
  // G04 — sahip kimliği (S-8, MİMARİ §5): parola karması (scrypt; biçim scrypt:<log2N>:<r>:<p>:<tuz>:<karma>), TOTP sırrı (20 bayt base32), oturum imza anahtarı (32 bayt base64). Değer hiçbir mesaja girmez (S-2).
  OWNER_PASSWORD_HASH: z.string().regex(/^scrypt:\d{1,2}:\d+:\d+:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{43}$/, "OWNER_PASSWORD_HASH: scrypt karma biçiminde olmalı"),
  OWNER_TOTP_SECRET: z.string().regex(/^[A-Z2-7]{32}$/, "OWNER_TOTP_SECRET: 32 karakter base32 olmalı"),
  SESSION_SECRET: masterKey("SESSION_SECRET"),
  // Tur 6 — durdurma anahtarının sha256 karması (K-7; src/lib/access/stop.ts). Ham anahtar yalnız depo dışı yedekte. Durdurma yolu bunu DAR sözleşmeyle okur (getStopKeyHash).
  STOP_KEY_HASH: z.string().regex(/^[0-9a-f]{64}$/, "STOP_KEY_HASH: sha256 hex (64 karakter) olmalı"),
  // G15 — Beyin (Claude API)
  ANTHROPIC_API_KEY: z.string().regex(/^sk-ant-/, "ANTHROPIC_API_KEY 'sk-ant-' ile başlamalı"),
  // Tur 21 — MOD ANAHTARI (tek ayar): tik mantığını (src/lib/chain tickOnce) tetikleyen yol. CHEAP = Vercel cron dakikada bir, halka yok, Neon yalnız tik anında; FAST = zincir (kira + nöbetçi, Tur 19).
  // TUR 67 (Üretim K3 = [A]): tik ARALIĞI artık ortam değişkeni DEĞİL — panel ayarı `brain_settings.tick_ms`, izin kopyasıyla taşınır (src/lib/chain settleTick). `ENGINE_TICK_MS` sözleşmeden ÇIKTI:
  //   ortamda dursa da okunmaz (şema bilinmeyen adı atar); iki okuma yolu yan yana kalmaz.
  ENGINE_MODE: z.enum(["CHEAP", "FAST"]),
});

export type Env = z.infer<typeof envSchema>;

/** TAKMA AD (Tur 6, ölçüldü 2026-09-08): Vercel Marketplace Upstash kaynağı değişkenleri KV_REST_API_URL / KV_REST_API_TOKEN adıyla düşürür. Sözleşme adı UPSTASH_REDIS_REST_*
 *  değişmez; sözleşme adı yoksa takma addan okunur. Yeniden adlandırma seçilmedi: entegrasyonun yönettiği ad değiştirilemez, elle kopya açmak döndürmede iki kopya demektir. */
export const UPSTASH_ALIAS = { UPSTASH_REDIS_REST_URL: "KV_REST_API_URL", UPSTASH_REDIS_REST_TOKEN: "KV_REST_API_TOKEN" } as const;
export function withAliases(src: NodeJS.ProcessEnv): NodeJS.ProcessEnv { const out = { ...src }; for (const [k, a] of Object.entries(UPSTASH_ALIAS)) if (!out[k] && src[a]) out[k] = src[a]; return out; }

let cached: Env | null = null;

/** Şemadan geçmiş ortam. İlk çağrıda doğrular; hata mesajı hangi değişkenin neden reddedildiğini söyler, değeri söylemez (S-2). */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(withAliases(process.env));
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(kök)"}: ${i.message}`);
    throw new Error(`ORTAM DEĞİŞKENİ SÖZLEŞMESİ İHLALİ — uygulama açılmıyor:\n${lines.join("\n")}`);
  }
  cached = parsed.data;
  return cached;
}

/** Durdurma yolu için DAR sözleşme (K-7, Tur 6): yalnız STOP_KEY_HASH doğrulanır. Başka bir değişken (Upstash, Neon, oturum sırrı…) eksik ya da bozuk
 *  olsa da durdurma açılır; tam sözleşme (getEnv) çağrılmaz, önbelleğe dokunulmaz. Hata mesajı değer taşımaz (S-2). */
export function getStopKeyHash(): string {
  const r = envSchema.pick({ STOP_KEY_HASH: true }).safeParse(process.env);
  if (!r.success) throw new Error("ORTAM DEĞİŞKENİ SÖZLEŞMESİ İHLALİ — STOP_KEY_HASH eksik ya da bozuk");
  return r.data.STOP_KEY_HASH;
}

/** DAR sözleşme, genel (G08, K-7): yalnız verilen adlar doğrulanır (takma adlar dâhil); tam sözleşme ve önbellek çağrılmaz. Veritabanı istemcisi ve kontrol bayrağının Upstash kopyası
 *  bununla açılır: ilgisiz bir değişkenin eksikliği (ör. ANTHROPIC_API_KEY) bayrağı yazmayı engellemez. Tam sözleşme açılışta yine doğrulanır (instrumentation). Mesaj değer taşımaz (S-2). */
export function pickEnv<K extends keyof Env>(...keys: K[]): Pick<Env, K> {
  const r = envSchema.pick(Object.fromEntries(keys.map((k) => [k, true])) as Record<keyof Env, true>).safeParse(withAliases(process.env));
  if (!r.success) throw new Error(`ORTAM DEĞİŞKENİ SÖZLEŞMESİ İHLALİ — ${keys.join(", ")}: eksik ya da bozuk`);
  return r.data as unknown as Pick<Env, K>;
}

/** SÖZLEŞME DIŞI, İSTEĞE BAĞLI tek ad okuması (Tur 30, assetlinks): yalnız çağıranın VERDİĞİ adı okur, doğrulamayı çağıran yapar; boş = yok. Üretimde bağlı ad yoktur
 *  (src/lib/pwa ASSET_LINKS_ENV = null) — ad sözleşmeye girmeden hiçbir şey okunmaz. Değer hiçbir mesaja girmez (S-2). */
export const readOptionalEnv = (name: string): string | undefined => { const v = process.env[name]; return v && v.length > 0 ? v : undefined; };

/** Sözleşmedeki isimler (.env.example ve kapı için). Değer içermez. */
export const envNames = Object.keys(envSchema.shape) as (keyof Env)[];
