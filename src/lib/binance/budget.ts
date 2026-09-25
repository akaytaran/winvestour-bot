// BİNANCE ÇAĞRI BÜTÇESİ — sayaç ve öncelik sınıfları (G05, S-7, M-1/K-1/K-2 mantığı). Boğaz (./index.ts) her çağrıda buradan geçer.
// Tavan KODDA YOK: exchangeInfo.rateLimits'ten çalışma anında okunur (./index.ts). Yerel sayaç bir TAHMİNDİR; gerçek kaynak Binance'in
// X-MBX-USED-WEIGHT-* / X-MBX-ORDER-COUNT-* başlıklarıdır; her yanıtta yerel sayaç bu değere HİZALANIR (reconcile). Depo düşükse çağrı çıkmaz.
// ÜÇ PENCERE: `/api`, `/sapi` ve `futures` ayrı IP sayaçlarıdır (Tur 8 madde 1 ölçümü + Tur 35 madde 2 ölçümü). `/api` → x-mbx-used-weight-1m, `/sapi` → x-sapi-used-ip-weight-1m.
// FUTURES (Tur 35, ÖLÇÜLDÜ 2026-09-17, futures ön ölçüm kaydı koşum 4e1cc032 — herkese açık uçlar, imzasız):
//   (1) Ağırlık başlığının ADI spot ile AYNIDIR: `x-mbx-used-weight-1m` (VARSAYILMADI, ölçüldü). (2) SAYAÇ AYRIDIR: aynı IP'de futures çağrıları spot sayacını
//   artırmadı (spot 20→21→22→23 boyunca futures 1→3→23→46). (3) `/fapi/` (USD-M) ve `/dapi/` (COIN-M) TEK ve AYNI sayacı paylaşır (1→2→3→23→24→25→45→46 tek dizi)
//   ⇒ ikisi TEK kapsamdır (`futures`), iki pencere DEĞİL — iki pencere olsaydı her biri diğerinin harcamasını görmez ve gerçek tavan sessizce aşılırdı.
//   Aynı ADI taşıyan iki AYRI sayaç olduğu için kapsam karışması SESSİZDİR: yanlış kapsama yazılan bir futures yanıtı spot penceresinin değerini bozar (kapı: window-scope-mix).
// Her çağrı yolunun kapsamına (scope) göre yalnız kendi penceresine yazılır ve yalnız kendi başlığıyla hizalanır. /sapi tavanı exchangeInfo'da YOKTUR → SAPI_CEILING_FALLBACK (uydurma, AÇIK).
import type { EngineEventKind } from "../../generated/prisma/enums";
import { redisPipeline } from "../upstash";

export type CallClass = "PROTECTION" | "EXIT" | "ENTRY" | "DISCOVERY";
export type LimitKind = "REQUEST_WEIGHT" | "ORDERS";
export type Interval = "SECOND" | "MINUTE" | "HOUR" | "DAY";
/** Sayaç kapsamı: yol `/sapi/` ile başlıyorsa `sapi`, `/fapi/` ya da `/dapi/` ile başlıyorsa `futures`, aksi hâlde `api`.
 *  ORDERS pencereleri spot tarafında yalnız `api` kapsamındadır (spot emir uçları /api altındadır); `futures` kapsamının kendi ORDERS tavanları futures exchangeInfo'dan gelir. */
export type Scope = "api" | "sapi" | "futures";
export type CeilingSource = "exchangeInfo" | "futuresExchangeInfo" | "SAPI_CEILING_FALLBACK";
export type Ceiling = { kind: LimitKind; scope: Scope; interval: Interval; intervalNum: number; limit: number; source: CeilingSource };
/** Reddediş sebepleri G02 şemasının EngineEventKind adlarıyla BİREBİR aynıdır (G07 olay yayıcı bu adları yazar: src/lib/events/stop-reasons.ts). Derleyici zorlar. */
export type DenyReason = Extract<EngineEventKind, "BUDGET_EXHAUSTED" | "IP_BANNED" | "REGION_BLOCKED" | "STOPPED">;
export type Decision = { allowed: true; locals?: Record<string, number> } | { allowed: false; reason: DenyReason; detail: string; retryAfterMs?: number };
export type Usage = { key: string; header: string; limit: number; local: number | null; reported: number | null; aligned: boolean };

/** AÇIK — A-1'de yok, UYDURULDU (sicil): sınıfın kullanabileceği tavan payı. PROTECTION/EXIT %100; ENTRY %80; DISCOVERY %60.
 *  PROTECTION+EXIT için ayrılan pay = 1 − ENTRY = %20; tavana yaklaşınca önce DISCOVERY (%60), sonra ENTRY (%80) reddedilir. */
export const CLASS_SHARE: Record<CallClass, number> = { PROTECTION: 1, EXIT: 1, ENTRY: 0.8, DISCOVERY: 0.6 };
export const RESERVED_SHARE_FOR_PROTECTION_EXIT = 1 - CLASS_SHARE.ENTRY;
export const HOLD_REASONS = ["IP_BANNED", "BUDGET_EXHAUSTED"] as const satisfies readonly DenyReason[];
/** AÇIK — UYDURMA (Tur 8 madde 1, sicil, geri alınabilir): `/sapi` tavanı exchangeInfo'da yok; Binance belgesi 12000/dk der, ÖLÇÜLMEDİ. Kapalı yönde varsayılan:
 *  `/api` REQUEST_WEIGHT 1 dakika tavanının bu payı (1 = eşit; belgedekinin yarısı, aşma yönünde değil). `/api` 1M tavanı yoksa `/sapi` tavanı da yok → sapi çağrısı ÇIKMAZ. */
export const SAPI_CEILING_FALLBACK = { name: "SAPI_CEILING_FALLBACK", shareOfApi1m: 1 } as const;

const MS: Record<Interval, number> = { SECOND: 1e3, MINUTE: 6e4, HOUR: 36e5, DAY: 864e5 };
const LETTER: Record<Interval, string> = { SECOND: "S", MINUTE: "M", HOUR: "H", DAY: "D" };
/** Pencere anahtarının TTL'si (pencere + 5 s). G16 WS API mutabakatı da aynı pencereye yazar (kapsam api). */
export const ttlOf = (c: Ceiling) => Math.ceil((c.intervalNum * MS[c.interval]) / 1000) + 5;
export const scopeOf = (path: string): Scope => (path.startsWith("/sapi/") ? "sapi" : path.startsWith("/fapi/") || path.startsWith("/dapi/") ? "futures" : "api");
export const windowKey = (c: Ceiling, now: number) => `binance:budget:${c.scope}:${c.kind}:${c.intervalNum}${LETTER[c.interval]}:${Math.floor(now / (c.intervalNum * MS[c.interval]))}`;
/** Gerçek kaynak başlık: `/api` → x-mbx-used-weight-1m / x-mbx-order-count-10s (Tur 0/Tur 12 ölçümü); `/sapi` → x-sapi-used-ip-weight-1m (Tur 7 §13 B1 ölçümü);
 *  `futures` → x-mbx-used-weight-1m — spot ile AYNI AD, AYRI SAYAÇ (Tur 35 ölçümü). Bu yüzden kapsam yanlışsa hata SESSİZDİR: başlık gelir, ama başka sayacın değeridir.
 *  AÇIK — ÖLÇÜLEMEDİ: futures ORDERS başlığının adı imzalı futures emri gerektirir; futures hesabı yok (A-5) ⇒ ad spot kalıbından TÜRETİLİYOR (`x-mbx-order-count-…`).
 *  Yanlışsa başlık hiç gelmez ve yerel tahmin kalır (`aligned:false`) — kapalı yön: sayaç eksik değil FAZLA sayar. Spot `order/test` yanıtında da bu başlık gelmemişti (Tur 12). */
export const headerOf = (c: Ceiling) => (c.scope === "sapi" ? `x-sapi-used-ip-weight-${c.intervalNum}${LETTER[c.interval]}` : `x-mbx-${c.kind === "ORDERS" ? "order-count" : "used-weight"}-${c.intervalNum}${LETTER[c.interval]}`).toLowerCase();
const holdKey = (r: string) => `binance:hold:${r}`;
/** exchangeInfo'dan okunan `/api` tavanlarına `/sapi` penceresini ekler (SAPI_CEILING_FALLBACK). `/api` 1M yoksa eklenmez (kapalı arıza: reserve sapi'yi reddeder). */
export function withSapiFallback(api: Ceiling[]): Ceiling[] {
  const a1m = api.find((c) => c.scope === "api" && c.kind === "REQUEST_WEIGHT" && c.interval === "MINUTE" && c.intervalNum === 1);
  if (!a1m || api.some((c) => c.scope === "sapi")) return api;
  return [...api, { kind: "REQUEST_WEIGHT", scope: "sapi", interval: "MINUTE", intervalNum: 1, limit: Math.floor(a1m.limit * SAPI_CEILING_FALLBACK.shareOfApi1m), source: SAPI_CEILING_FALLBACK.name }];
}

/** Sayaç deposu. Üretimde Upstash; kapı/kanarya sahte depo enjekte eder (S-9). Her yöntem hata fırlatabilir → boğaz kapalı arızalanır.
 *  TUR 20 (maliyet, madde 2): askı denetimi + rezervasyon TEK ATOMİK adımdır (`reserve`; Upstash'te tek EVAL — ÖLÇÜLDÜ: eski yol tik başına MGET + INCRBY + EXPIRE = 3 komut, yeni yol 1).
 *  Sıra script içinde de aynıdır: önce askı (varsa hiçbir sayaç artmaz), sonra pencere pencere INCRBY (yeni pencereye EXPIRE), pay aşılırsa alınanlar geri verilir. Koruma gevşemedi. */
export type ReserveWindow = { key: string; n: number; ttl: number; cap: number };
export type ReserveResult = { hold: { i: number; until: number } | null; exhausted: { i: number; total: number } | null; totals: number[] };
export interface BudgetStore {
  reserve(holds: string[], windows: ReserveWindow[], now: number): Promise<ReserveResult>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  mget(keys: string[]): Promise<(string | null)[]>;
}
export const RESERVE_LUA = "local nh = tonumber(ARGV[1]) local now = tonumber(ARGV[2]) for i = 1, nh do local v = redis.call('GET', KEYS[i]) if v and tonumber(v) > now then return {'HOLD', i, v} end end local t = {} local a = 3 for j = nh + 1, #KEYS do local n = tonumber(ARGV[a]) local ttl = tonumber(ARGV[a + 1]) local cap = tonumber(ARGV[a + 2]) a = a + 3 local x = redis.call('INCRBY', KEYS[j], n) if x == n then redis.call('EXPIRE', KEYS[j], ttl) end t[#t + 1] = x if x > cap then for k = 1, #t do redis.call('DECRBY', KEYS[nh + k], tonumber(ARGV[3 * k])) end return {'EXHAUSTED', j - nh, x} end end return {'OK', unpack(t)}";
const parseReserve = (r: unknown): ReserveResult => { const a = Array.isArray(r) ? r : []; const tag = String(a[0]); if (tag === "HOLD") return { hold: { i: Number(a[1]) - 1, until: Number(a[2]) }, exhausted: null, totals: [] }; if (tag === "EXHAUSTED") return { hold: null, exhausted: { i: Number(a[1]) - 1, total: Number(a[2]) }, totals: [] }; if (tag !== "OK") throw new Error("reserve[bad-reply]"); return { hold: null, exhausted: null, totals: a.slice(1).map(Number) }; };
/** `ns` (Tur 47, Üretim kararı K-A `winvestor-kanarya-bogaz-sayaclari`): YALNIZ kanarya/ölçüm için ad alanı — verilirse depo HER anahtarı `${ns}:` altına yazar/okur
 *  (pencere, askı, tavan önbelleği; `upstashChainStore(cfg, ns)` deseni). Verilmezse bugünkü üretim anahtarı AYNEN (geriye uyumlu varsayılan; üretim yolu `getBinance()` ns vermez).
 *  Anahtar adları (`windowKey`, askı, tavan önbelleği) DEĞİŞMEZ — ad alanı yalnız Upstash sınırında eklenir; mantıksal ad (`Usage.key`) aynı kalır. */
export function upstashStore(cfg?: { url: string; token: string }, ns?: string): BudgetStore {
  const K = (k: string) => (ns ? `${ns}:${k}` : k);
  return {
    reserve: async (holds, ws, now) => parseReserve((await redisPipeline([["EVAL", RESERVE_LUA, holds.length + ws.length, ...holds.map(K), ...ws.map((w) => K(w.key)), holds.length, now, ...ws.flatMap((w) => [w.n, w.ttl, w.cap])]], cfg))[0]),
    set: async (k, v, ttl) => { await redisPipeline([["SET", K(k), v, "EX", ttl]], cfg); },
    mget: async (ks) => (await redisPipeline([["MGET", ...ks.map(K)]], cfg))[0] as (string | null)[],
  };
}
/** Bellek deposu (kapı/kanarya): `reserve` senkron ve atomik — script ile aynı sıra: askı → INCRBY → pay aşımında geri alma. */
export function memoryStore(): BudgetStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, set: async (k, v) => { data.set(k, v); }, mget: async (ks) => ks.map((k) => data.get(k) ?? null),
    reserve: async (holds, ws, now) => { for (let i = 0; i < holds.length; i++) { const v = data.get(holds[i]); if (v !== undefined && Number(v) > now) return { hold: { i, until: Number(v) }, exhausted: null, totals: [] }; }
      const totals: number[] = []; for (let j = 0; j < ws.length; j++) { const x = Number(data.get(ws[j].key) ?? 0) + ws[j].n; data.set(ws[j].key, String(x)); totals.push(x); if (x > ws[j].cap) { for (let k = 0; k <= j; k++) data.set(ws[k].key, String(Number(data.get(ws[k].key)) - ws[k].n)); return { hold: null, exhausted: { i: j, total: x }, totals: [] }; } } return { hold: null, exhausted: null, totals }; } };
}

/** Askı yazımı (429 geri çekilme, 418 yasak). Askı DENETİMİ `reserve` içindedir (aynı atomik adım): süresi dolmamış askı → hiçbir sayaç artmaz, çağrı çıkmaz. */
export async function placeHold(store: BudgetStore, reason: (typeof HOLD_REASONS)[number], retryAfterMs: number, now: number): Promise<void> {
  await store.set(holdKey(reason), String(now + retryAfterMs), Math.ceil(retryAfterMs / 1000) + 5);
}

/** Askı + rezervasyon (TEK atomik depo adımı) — yalnız çağrının KAPSAMINDAKİ pencerelere. Sınıfın payı aşılırsa rezervasyon geri alınır ve reddedilir. Kapsamda REQUEST_WEIGHT yoksa kapalı arıza.
 *  Dönen `locals`: bu çağrının pencerelerdeki yerel sayaç değeri (mutabakat yalnız başlık bundan FARKLIYSA yazar — Tur 20 madde 2, "yalnız değiştiğinde yazılır"). */
export async function reserve(store: BudgetStore, ceilings: Ceiling[], call: { path: string; cls: CallClass; weight: number; orders?: number }, now: number): Promise<Decision> {
  const scope = scopeOf(call.path), mine = ceilings.filter((c) => c.scope === scope);
  if (mine.length === 0 || !mine.some((c) => c.kind === "REQUEST_WEIGHT")) return { allowed: false, reason: "STOPPED", detail: `ceiling-unavailable:${scope}` };
  if (!Number.isInteger(call.weight) || call.weight < 1) return { allowed: false, reason: "STOPPED", detail: "weight-undeclared" };
  const ws = mine.map((c) => ({ c, n: c.kind === "ORDERS" ? call.orders ?? 0 : call.weight })).filter((w) => w.n > 0).map((w) => ({ c: w.c, key: windowKey(w.c, now), n: w.n, ttl: ttlOf(w.c), cap: w.c.limit * CLASS_SHARE[call.cls] }));
  const r = await store.reserve(HOLD_REASONS.map(holdKey), ws, now);
  if (r.hold) return { allowed: false, reason: HOLD_REASONS[r.hold.i], detail: "hold", retryAfterMs: r.hold.until - now };
  if (r.exhausted) { const c = ws[r.exhausted.i].c; return { allowed: false, reason: "BUDGET_EXHAUSTED", detail: `${call.cls}:${scope}:${c.kind}:${c.intervalNum}${LETTER[c.interval]}:${r.exhausted.total}/${c.limit}` }; }
  return { allowed: true, locals: Object.fromEntries(ws.map((w, i) => [w.key, r.totals[i]])) };
}

/** Mutabakat: yanıtın KAPSAMINDAKİ her pencere için Binance'in bildirdiği kullanım yerel sayacın ÜZERİNE yazılır — YALNIZ yerel değerden farklıysa (aynı değeri yeniden yazmak komut harcar, Tur 20).
 *  Başlık yoksa yerel tahmin kalır (aligned=false). Diğer kapsamın penceresine dokunulmaz. `locals` rezervasyonun döndürdüğü yerel sayaçlardır (ek okuma yok). */
export async function reconcile(store: BudgetStore, ceilings: Ceiling[], headers: { get(name: string): string | null }, now: number, scope: Scope, locals: Record<string, number> = {}): Promise<Usage[]> {
  const mine = ceilings.filter((c) => c.scope === scope), out: Usage[] = [];
  for (const c of mine) {
    const key = windowKey(c, now), raw = headers.get(headerOf(c)), reported = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null, local = key in locals ? locals[key] : null;
    if (reported !== null && reported !== local) await store.set(key, String(reported), ttlOf(c));
    out.push({ key, header: headerOf(c), limit: c.limit, local, reported, aligned: reported !== null });
  }
  return out;
}
