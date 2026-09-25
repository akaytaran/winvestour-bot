// KULLANICI VERİ AKIŞI — WS API PUSH (G16 · K-4, S-4, S-7, S-2, S-9, Ö-1, Ö-5). Emir dolumları REST yoklamasıyla DEĞİL, Binance WS API'den PUSH ile gelir:
// `session.logon` (Ed25519, damga sunucu saatine hizalı) → `userDataStream.subscribe` → `executionReport` olayları. REST `listenKey` ucu 410 Gone (Tur 0 madde 6b, ölçüldü);
// `openOrders`/`allOrders` yoklaması YOKTUR ve yazılmayacaktır (kapı: gate:chain — push koptuğunda REST'e düşen yol KIRMIZI).
// K-4 — KOPUKLUK GİZLENMEZ: bağlantı karşı taraf/ağ tarafından kapanırsa kapanış kodu ve sebebi HAM kaydedilir, USER_STREAM_LOST olayı yazılır; bu modül bağlantıyı KENDİ
//   zamanlayıcısıyla ASLA kapatmaz (Tur 0 dersi, Ö-5: ömrü ölçülen şeyi öldüren zamanlayıcı kurulmaz). `close` yalnız halka SONLANIRKEN (izin yok / devir) çağrılır.
// S-4/S-1 — anahtar ve imza yalnız `withSignedCall`/`signQuery` içinde (G06 sign.ts); logon yanıtındaki anahtar alanı callback DIŞINA ÇIKARILMAZ (G03 sızıntı koruyucusu).
// S-7 — WS API isteklerinin ağırlığı VARDIR: yanıttaki `rateLimits.count` boğazın kendi dakika penceresine YAZILIR (aynı anahtar, `windowKey`) — REST ile WS aynı IP sayacını paylaşır.
import { ttlOf, windowKey, type BudgetStore, type Ceiling } from "@/lib/binance/budget";
import { signedTimestamp, type ClockDeps } from "@/lib/binance/time";
import type { Keyring } from "@/lib/crypto";
import { prismaKeySource, type StoredKeyPair } from "@/lib/exchange-key";
import { API_KEY_HEADER, signQuery, withSignedCall } from "@/lib/exchange-key/sign";
import { stopEngine, type Deps as EventDeps, type EmitResult } from "@/lib/events";

export const WS_API_URL = "wss://ws-api.binance.com:443/ws-api/v3";
/** WS isteğine yanıt tavanı — Binance'in imzalı istek penceresiyle aynı sözleşme (recvWindow 5000 ms, TÜRETİLMİŞ). Bağlantıyı KAPATMAZ; yalnız o isteği sonuçsuz sayar. */
export const WS_REQUEST_TIMEOUT_MS = 5000;
export type Fill = { clientId: string; orderId: string; symbol: string; side: string; status: string; execType: string; lastQty: string; lastPrice: string; commission: string; commissionAsset: string; at: number };
export type StreamState = { openedAt: number | null; closedAt: number | null; code: number | null; reason: string | null; wasClean: boolean | null; error: string | null; events: number; fills: number; lastEventAt: number | null; lifetimeMs: number | null; closedBy: "AÇIK" | "KARŞI TARAF/AĞ" | "HALKA SONLANDI" };
export type WsLike = { readyState: number; send(data: string): void; close(code?: number, reason?: string): void; onopen: ((e: unknown) => void) | null; onmessage: ((e: { data: unknown }) => void) | null; onclose: ((e: { code: number; reason: string; wasClean: boolean }) => void) | null; onerror: ((e: unknown) => void) | null };
/** Üretimde global WebSocket (Node ≥ 22); kapı/kanarya sahte soket enjekte eder (S-9). */
export type WsFactory = (url: string) => WsLike;
export type StreamDeps = { key?: () => Promise<StoredKeyPair | null>; ring?: Keyring; clock?: ClockDeps; events?: EventDeps; budget?: { store: BudgetStore; ceilings: Ceiling[] }; ws?: WsFactory; now?: () => number; onFill?: (f: Fill) => Promise<void>; onClose?: (s: StreamState) => Promise<void> };
export type UserStream = { state(): StreamState; close(reason: string): void };
export type StreamRefusal = "NO_KEY" | "CLOCK_UNSYNCED" | "CONNECT_FAILED" | "LOGON_FAILED" | "SUBSCRIBE_FAILED";
export type OpenStreamOutcome = { ok: true; stream: UserStream; logonMs: number; subscribeMs: number; usageCount: number | null } | { ok: false; refusal: StreamRefusal; detail: string; event: EmitResult | null };
type WsReply = { id?: string; status?: number; error?: { code?: number; msg?: string }; rateLimits?: { rateLimitType?: string; interval?: string; intervalNum?: number; count?: number }[]; event?: Record<string, unknown> };
type Report = { e?: string; s?: string; c?: string; S?: string; x?: string; X?: string; i?: number; l?: string; L?: string; n?: string; N?: string; E?: number };

/** WS API `rateLimits.count` → boğazın dakika penceresi (kapsam api). Başlık yok; yanıtın kendi sayacı gerçek kaynaktır (S-7). Yazılamazsa sessizce geçilmez: `null` döner. */
async function alignUsage(reply: WsReply, budget: StreamDeps["budget"], now: number): Promise<number | null> {
  const rl = (reply.rateLimits ?? []).find((x) => x.rateLimitType === "REQUEST_WEIGHT" && typeof x.count === "number"), c = budget?.ceilings.find((x) => x.scope === "api" && x.kind === "REQUEST_WEIGHT" && x.interval === rl?.interval && x.intervalNum === rl?.intervalNum);
  if (!rl || !c || !budget) return null;
  try { await budget.store.set(windowKey(c, now), String(rl.count), ttlOf(c)); return rl.count as number; } catch { return null; }
}

/** Bağlan → logon → subscribe. Başarısızlık olayla döner (K-8); bağlantı kurulduysa yaşamı KENDİ HALİNE bırakılır; kapanış ham kaydedilir ve `onClose` çağrılır. */
export async function openUserStream(deps: StreamDeps = {}): Promise<OpenStreamOutcome> {
  const now = deps.now ?? Date.now, k = await (deps.key ?? prismaKeySource)();
  const no = async (refusal: StreamRefusal, detail: string): Promise<OpenStreamOutcome> => ({ ok: false, refusal, detail, event: await stopEngine("USER_STREAM_LOST", `${refusal} · ${detail} · REST yoklamasına düşülmedi`, {}, deps.events) });
  if (!k) return no("NO_KEY", "geçerli borsa anahtarı yok");
  const ts = await signedTimestamp({ ...(deps.clock ?? {}), events: deps.clock?.events ?? deps.events, now });
  if (!ts.ok) return no("CLOCK_UNSYNCED", `${ts.refusal}: ${ts.detail}`);
  const st: StreamState = { openedAt: null, closedAt: null, code: null, reason: null, wasClean: null, error: null, events: 0, fills: 0, lastEventAt: null, lifetimeMs: null, closedBy: "AÇIK" };
  const pending = new Map<string, (r: WsReply) => void>(); let ws: WsLike;
  try { ws = (deps.ws ?? ((u) => new WebSocket(u) as unknown as WsLike))(WS_API_URL); } catch (e) { return no("CONNECT_FAILED", (e as { name?: string })?.name ?? "error"); }
  const call = (method: string, params: Record<string, string>): Promise<WsReply> => new Promise((resolve) => { const id = crypto.randomUUID(); pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.delete(id)) resolve({ id, status: 0, error: { code: -1, msg: `timeout ${method}` } }); }, WS_REQUEST_TIMEOUT_MS); });
  ws.onmessage = (m) => { let j: WsReply; try { j = JSON.parse(String(m.data)) as WsReply; } catch { return; }
    if (typeof j.id === "string" && pending.has(j.id)) { const r = pending.get(j.id)!; pending.delete(j.id); r(j); return; }
    st.events++; st.lastEventAt = now(); const ev = (j.event ?? j) as Report;
    if (ev.e === "executionReport" && ev.x === "TRADE" && typeof ev.c === "string") { st.fills++; const f: Fill = { clientId: ev.c, orderId: String(ev.i ?? ""), symbol: String(ev.s ?? ""), side: String(ev.S ?? ""), status: String(ev.X ?? ""), execType: ev.x, lastQty: String(ev.l ?? "0"), lastPrice: String(ev.L ?? "0"), commission: String(ev.n ?? "0"), commissionAsset: String(ev.N ?? ""), at: typeof ev.E === "number" ? ev.E : now() };
      if (deps.onFill) deps.onFill(f).catch((e: unknown) => { st.error = `onFill:${(e as { name?: string })?.name ?? "error"}`; }); } };
  ws.onerror = (e) => { st.error = String((e as { message?: string })?.message ?? (e as { type?: string })?.type ?? "error"); };
  ws.onclose = (e) => { if (st.closedAt !== null) return; st.closedAt = now(); st.code = e.code; st.reason = e.reason; st.wasClean = e.wasClean; st.lifetimeMs = st.openedAt === null ? null : st.closedAt - st.openedAt; if (st.closedBy === "AÇIK") st.closedBy = "KARŞI TARAF/AĞ";
    if (deps.onClose) deps.onClose({ ...st }).catch((x: unknown) => { st.error = `onClose:${(x as { name?: string })?.name ?? "error"}`; }); };
  const opened = await new Promise<boolean>((r) => { ws.onopen = () => { st.openedAt = now(); r(true); }; const prev = ws.onclose; ws.onclose = (e) => { prev?.(e); r(false); }; });
  if (!opened) return no("CONNECT_FAILED", `soket açılmadı (code=${st.code ?? "?"} ${st.error ?? ""})`);
  const t0 = now();
  // Logon: imza `apiKey=…&timestamp=…` üzerinde (WS API sözleşmesi, Tur 0 madde 6b ile aynı biçim). Anahtar callback içinde kalır; dönüş değeri yalnız statü + sayaç taşır (G03).
  const logon = await withSignedCall(k.api, k.priv, {}, async (h) => { const r = await call("session.logon", signQuery(k.priv, { apiKey: h[API_KEY_HEADER], timestamp: ts.timestamp }, deps.ring)); return { status: r.status ?? 0, code: r.error?.code ?? null, msg: r.error?.msg ?? null, rateLimits: r.rateLimits }; }, deps.ring);
  const logonMs = now() - t0;
  if (logon.status !== 200) return no("LOGON_FAILED", `session.logon status=${logon.status} code=${logon.code ?? "?"}`);
  const t1 = now(), sub = await call("userDataStream.subscribe", {}), subscribeMs = now() - t1;
  if (sub.status !== 200) return no("SUBSCRIBE_FAILED", `userDataStream.subscribe status=${sub.status ?? 0} code=${sub.error?.code ?? "?"}`);
  const usageCount = await alignUsage(sub, deps.budget, now());
  return { ok: true, logonMs, subscribeMs, usageCount, stream: { state: () => ({ ...st }), close: (reason) => { if (st.closedAt !== null) return; if (st.closedBy === "AÇIK") st.closedBy = "HALKA SONLANDI"; try { ws.close(1000, reason.slice(0, 120)); } catch (e) { st.error = `close:${(e as { name?: string })?.name ?? "error"}`; } } } };
}
