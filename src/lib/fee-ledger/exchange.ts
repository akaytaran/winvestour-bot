// DEFTERİN BORSA OKUYUCULARI (G09 · M-1, M-2 ilkesi "maliyet hesabın kademesinden okunur", S-1, S-2, S-7, S-9). İkisi de DISCOVERY sınıfıdır, G05 boğazı + G07 olay sarmalayıcısıyla çıkar;
// EMİR YOLU YOKTUR (kapı: burada emir sınıfı/ucu KIRMIZI). (1) readCapital: imzalı GET /api/v3/account (bakiyeler + commissionRates.taker) + GET /api/v3/ticker/price (tüm çiftler) →
// hesap değeri quote cinsinden (CAPITAL_BASIS). (2) readRate: GET /api/v3/ticker/price?symbol=<varlık><quote> → komisyon varlığının kuru ÖLÇÜLEREK (sabit yok). Anahtar ve imza yalnız
// withSignedCall (G06 sign.ts, G03 withDecrypted) içinde; bu modül anahtar görmez, loglamaz; başlık olaya girmez. Sayı elle yazılmaz: kaynak ve zaman `source`'ta döner (Ö-1).
import type { Keyring, StoredField } from "@/lib/crypto";
import { Prisma } from "@/generated/prisma/client";
import { signedTimestamp } from "@/lib/binance/time";
import { prismaKeySource, RECV_WINDOW_MS } from "@/lib/exchange-key";
import { withSignedCall } from "@/lib/exchange-key/sign";
import { requestWithEvents, type ExchangeDeps, type GuardedResult } from "@/lib/events/exchange";
import { IDENTITY_RATE, type CapitalReading, type RateReading } from "./index";

/** Ağırlıklar: account 20 (Tur 7 B, başlık deltasıyla ölçüldü); ticker/price sembolsüz 4 ve tek sembol 2 (Binance belgesi; Tur 4'te 10 sembol → 4 ölçüldü). Sapmayı G05 başlık mutabakatı düzeltir. */
export const ACCOUNT_CALL = { path: "/api/v3/account", cls: "DISCOVERY", weight: 20 } as const;
export const ALL_PRICES_CALL = { path: "/api/v3/ticker/price", cls: "DISCOVERY", weight: 4 } as const;
export const ONE_PRICE_CALL = { path: "/api/v3/ticker/price", cls: "DISCOVERY", weight: 2 } as const;
export type KeySource = () => Promise<{ api: StoredField; priv: StoredField } | null>;
export type ReaderDeps = { exchange?: ExchangeDeps; key?: KeySource; ring?: Keyring; now?: () => number };
type Account = { balances?: { asset: string; free: string; locked: string }[]; commissionRates?: { taker?: string } };
type Price = { symbol: string; price: string };
const D = Prisma.Decimal, NUM = /^\d+(\.\d+)?$/, errName = (e: unknown) => (e as { name?: string })?.name ?? "error";
/** Üretim anahtar kaynağı TEK YERDE (G06 modülü, Tur 12): `exchange_keys`'i okuyan tek yol orası. Kanarya sahte zarf + test halkası verir (S-9). */
const prismaKey: KeySource = prismaKeySource;

/** Hesap değeri = Σ (free+locked) × fiyat(varlık→quote); quote varlığı 1:1. Fiyatı olmayan varlık ATLANIR ve kaynakta LİSTELENİR (sessiz değil). Anahtar yoksa/okuma reddedilirse ok:false. */
export async function readCapital(quote: string, deps: ReaderDeps = {}): Promise<CapitalReading> {
  const now = deps.now ?? Date.now, k = await (deps.key ?? prismaKey)(); if (!k) return { ok: false, detail: "no-exchange-key" };
  const signed = (h: Record<string, string>, q: Record<string, string>) => ({ ...ACCOUNT_CALL, query: q, headers: h });
  // Damga SUNUCU SAATİNE hizalanır (Tur 13, src/lib/binance/time.ts): hizalanamazsa imzalı okuma YAPILMAZ — sermaye ölçülemez, bütçe kapısı kapalı arızalanır (M-1).
  // `events` AÇIKÇA verilir (Tur 14 bulgusu, Ö-5): verilmezse saat hizalamasının olayı ÜRETİM Prisma deposuna düşer — ölçüm/kanarya koşumları üretim defterini kirletirdi.
  const ts = await signedTimestamp({ exchange: deps.exchange, events: deps.exchange?.events, now });
  if (!ts.ok) return { ok: false, detail: `clock:${ts.refusal}:${ts.detail}` };
  let acc: GuardedResult<Account>;
  try { acc = await withSignedCall(k.api, k.priv, { omitZeroBalances: "true", timestamp: ts.timestamp, recvWindow: String(RECV_WINDOW_MS) }, (h, q) => requestWithEvents<Account>(signed(h, q), deps.exchange), deps.ring); }
  catch (e) { return { ok: false, detail: `account:${errName(e)}` }; }
  if (!acc.result.ok) return { ok: false, detail: `account:${acc.result.reason ?? ""}:${acc.result.detail}` };
  const raw = acc.result.data.balances ?? [];
  const bal = raw.map((b) => ({ asset: b.asset, amount: new D(NUM.test(b.free) ? b.free : 0).add(NUM.test(b.locked) ? b.locked : 0) })).filter((b) => b.amount.gt(0));
  // SERBEST quote bakiyesi (G12 boyutlandırması): kilitli bakiye emir açamaz. Aynı yanıttan okunur; varlık listede yoksa 0 (ölçüldü, varsayılmadı).
  const fq = raw.find((b) => b.asset === quote)?.free, freeQuote = fq !== undefined && NUM.test(fq) ? fq : "0";
  const taker = acc.result.data.commissionRates?.taker, takerRate = taker !== undefined && NUM.test(taker) ? taker : null;
  let prices = new Map<string, string>();
  if (bal.some((b) => b.asset !== quote)) { const p = await requestWithEvents<Price[]>({ ...ALL_PRICES_CALL }, deps.exchange); if (!p.result.ok) return { ok: false, detail: `prices:${p.result.reason ?? ""}:${p.result.detail}` }; prices = new Map((Array.isArray(p.result.data) ? p.result.data : []).map((x) => [x.symbol, x.price])); }
  let capital = new D(0); const priced: string[] = [], unpriced: string[] = [];
  for (const b of bal) { const px = b.asset === quote ? IDENTITY_RATE : prices.get(b.asset + quote); if (px === undefined || !NUM.test(px)) { unpriced.push(b.asset); continue; } capital = capital.add(b.amount.mul(px)); priced.push(b.asset); }
  return { ok: true, capital: capital.toFixed(10), quoteAsset: quote, takerRate, freeQuote, source: `account(${priced.length} varlık fiyatlı: ${priced.join(",")}${unpriced.length ? `; ${unpriced.length} FİYATSIZ ATLANDI: ${unpriced.join(",")}` : ""}; taker=${takerRate ?? "yok"}) + ticker/price @${new Date(now()).toISOString()}` };
}
/** Bir varlığın SERBEST (free) bakiyesi — imzalı hesap okuması, DISCOVERY. Kilitli bakiye emir açamaz/kapatamaz, bu yüzden `free` okunur.
 *  Elle çıkış (G11 `exitAllFree`) miktarı BURADAN alır: miktar koda yazılmaz, çağrı anında borsadan ölçülür (Ö-1). Okunamazsa ok:false → emir gönderilmez. */
export async function readFreeAsset(asset: string, deps: ReaderDeps = {}): Promise<{ ok: true; free: string; source: string } | { ok: false; detail: string }> {
  const now = deps.now ?? Date.now, k = await (deps.key ?? prismaKey)(); if (!k) return { ok: false, detail: "no-exchange-key" };
  const ts = await signedTimestamp({ exchange: deps.exchange, events: deps.exchange?.events, now });
  if (!ts.ok) return { ok: false, detail: `clock:${ts.refusal}:${ts.detail}` };
  let acc: GuardedResult<Account>;
  try { acc = await withSignedCall(k.api, k.priv, { omitZeroBalances: "true", timestamp: ts.timestamp, recvWindow: String(RECV_WINDOW_MS) }, (h, q) => requestWithEvents<Account>({ ...ACCOUNT_CALL, query: q, headers: h }, deps.exchange), deps.ring); }
  catch (e) { return { ok: false, detail: `account:${errName(e)}` }; }
  if (!acc.result.ok) return { ok: false, detail: `account:${acc.result.reason ?? ""}:${acc.result.detail}` };
  const free = (acc.result.data.balances ?? []).find((b) => b.asset === asset)?.free;
  if (typeof free !== "string" || !NUM.test(free)) return { ok: false, detail: `${asset}:no-free-balance` };
  return { ok: true, free, source: `account.free ${asset} @${new Date(now()).toISOString()}` };
}

/** Komisyon varlığının kuru — ÖLÇÜLÜR: ticker/price <asset><quote>. Çift yoksa/okunamazsa ok:false → defter kaydı UNCONVERTED, giriş kapalı, çıkış geçer. */
export async function readRate(asset: string, quote: string, deps: ReaderDeps = {}): Promise<RateReading> {
  if (asset === quote) return { ok: true, rate: IDENTITY_RATE, source: "identity" };
  const symbol = asset + quote, r = await requestWithEvents<Price>({ ...ONE_PRICE_CALL, query: { symbol } }, deps.exchange);
  if (!r.result.ok) return { ok: false, detail: `${symbol}:${r.result.reason ?? ""}:${r.result.detail}` };
  const px = r.result.data?.price; if (typeof px !== "string" || !NUM.test(px)) return { ok: false, detail: `${symbol}:bad-price` };
  return { ok: true, rate: px, source: `ticker/price ${symbol} @${new Date((deps.now ?? Date.now)()).toISOString()}` };
}
