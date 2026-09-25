// Upstash Redis REST istemcisi (G05 sayaç, G10 kilit). URL ve token YALNIZ ortam sözleşmesinden (src/lib/env.ts); Binance'e çıkmaz.
// Her hata tek biçimde fırlar: UpstashError("unavailable") — mesaja URL, token, yanıt gövdesi girmez (S-2). Çağıran kapalı arızalanır (fail closed).
import { getEnv } from "./env";

export class UpstashError extends Error { constructor() { super("upstash[unavailable]"); this.name = "UpstashError"; } }
export type RedisCommand = (string | number)[];

/** Komut(lar)ı Upstash REST'e gönderir; sonuç dizisi komut sırasındadır. Bağlantı/HTTP/komut hatası → UpstashError. */
/** ÖLÇÜM SAYACI (Tur 19 madde 6, Tur 20 madde 1, Ö-5): bu süreçte Upstash'e giden REST isteği ve komut sayısı — altyapı maliyeti buradan ÖLÇÜLÜR, tahmin edilmez. Yalnız okunur; davranışı değiştirmez.
 *  `sites`: çağrı yeri bazında (komut adı + anahtarın ilk iki parçası, ör. `EVAL chain:lease`) — hangi modülün kaç komut harcadığı buradan okunur (halka kaydına da yazılır). */
export const upstashStats: { requests: number; commands: number; sites: Record<string, number> } = { requests: 0, commands: 0, sites: {} };
const siteOf = (c: RedisCommand) => `${c[0]} ${String(c[0] === "EVAL" ? c[3] ?? "" : c[1] ?? "").split(":").slice(0, 2).join(":")}`;
export async function redisPipeline(cmds: RedisCommand[], cfg: { url: string; token: string } = fromEnv()): Promise<unknown[]> {
  upstashStats.requests++; upstashStats.commands += cmds.length; for (const c of cmds) upstashStats.sites[siteOf(c)] = (upstashStats.sites[siteOf(c)] ?? 0) + 1;
  let res: Response;
  try { res = await fetch(`${cfg.url.replace(/\/+$/, "")}/pipeline`, { method: "POST", headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" }, body: JSON.stringify(cmds), cache: "no-store" }); }
  catch { throw new UpstashError(); }
  if (res.status !== 200) throw new UpstashError();
  let out: unknown;
  try { out = await res.json(); } catch { throw new UpstashError(); }
  if (!Array.isArray(out) || out.length !== cmds.length || out.some((r) => !r || typeof r !== "object" || "error" in r)) throw new UpstashError();
  return out.map((r) => (r as { result: unknown }).result);
}

function fromEnv() { const e = getEnv(); return { url: e.UPSTASH_REDIS_REST_URL, token: e.UPSTASH_REDIS_REST_TOKEN }; }
