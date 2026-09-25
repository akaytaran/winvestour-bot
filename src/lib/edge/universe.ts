// COİN EVRENİ — ÖLÇÜYLE TÜRETİLİR (G13 · A-2, M-2, M-4, S-7, Ö-1, Ö-3). Hangi çiftte işlem yapılacağı ELLE LİSTE olarak yazılmaz; her çalışmada ÖLÇÜLEBİLİR
// eleme ölçütleriyle belirlenir (kapı: evreni elle sembol listesinden okuyan yol KIRMIZI). Ölçütler ve neden ölçülebilir oldukları:
//   1. YAYILMA ÜST SINIRI — canlı `bookTicker` yayılması (bp). Tur 14 ölçümü bu ölçütü zorunlu kıldı: USUALUSDT 8,93–17,87 bp ↔ BTCUSDT 0,0013 bp (~6900 kat).
//      Tabanı `tickSize / fiyat`tır (A-2'ye Tur 14'te eklenen ölçü) ve canlı yayılma bu tabanın altına inemez — bu yüzden ayrı bir ölçüt gerekmez, raporlanır.
//   2. `MIN_NOTIONAL` — borsadan (exchangeInfo). Planlanan pozisyon büyüklüğü asgari emir tutarını sağlamıyorsa çift bu SERMAYEDE işlem göremez (TAM TÜRETİLMİŞ, sayı yok).
//   3. DEFTER DERİNLİĞİ — planlanan büyüklük defterin tepe kademelerini aşmamalı; ölçüm `./cost.ts` `readDepthImpact` ile YAPILIR, burada yalnız tavanla karşılaştırılır.
//   4. HACİM ALT SINIRI — `ticker/24hr` `quoteVolume`; planlanan büyüklüğün katı olarak ifade edilir (sermaye büyüdükçe eşik kendiliğinden büyür).
// EŞİKLERİN KENDİSİ SABİT DEĞİLDİR: yayılma ve derinlik tavanları ÖLÇÜLEN gidiş-dönüş komisyonundan, hacim tabanı ÖLÇÜLEN pozisyon büyüklüğünden türer.
// ÇAPA = STANDART (İNDİRİMSİZ) KOMİSYON (Tur 17 madde 2, BNB paradoksu — ölçüldü: etkin komisyonu çapa alınca indirim 20 → 5 bp tavanı 10 → 2,5 bp'ye indirip evreni 264 → 62'ye
//   DARALTIYORDU; oysa toplam maliyet düşmüştü). Yayılma tavanı hesabın ÜCRET KADEMESİNİN değil PİYASA MİKROYAPISININ ölçüsüdür: aynı piyasa iki hesapta farklı evren vermemeli.
//   İndirim yalnız M-2 eşiğini (etkin maliyet × 3) düşürür; evren ölçütü `commissionRoundTripBp` alanına STANDART oranı alır (./cost.ts `standardCommissionBp`).
// Türetmenin ORANLARI (aşağıdaki `UNIVERSE_CRITERIA`) A-1/A-2'de AÇIKTIR ve UYDURULMUŞTUR — sicilde, geri alınabilir, tek yerde, gerekçesiyle.
// ÖNBELLEK YOKTUR: evren her çalışmada yeniden ölçülür (bir çiftin yayılması gün içinde değişir — Tur 14: USUALUSDT aynı gün 8,93 ↔ 17,87 bp).
import { Prisma } from "@/generated/prisma/client";
import { requestWithEvents, type ExchangeDeps } from "@/lib/events/exchange";

/** UYDURULDU (A-1/A-2, sicil, geri alınabilir) — SAYININ KENDİSİ DEĞİL, TÜRETME ORANI. Tavanlar ölçülen komisyondan/büyüklükten hesaplanır, koda bp yazılmaz.
 *  · `spreadRatio` — yayılma, gidiş-dönüş komisyonun yarısını aşmasın. Gerekçe ölçümdür (Tur 14): USUALUSDT'de yayılma komisyonun %45–89'u kadardı ve M-2'nin
 *    maliyet tanımında HİÇ yoktu; yarım komisyon, "yayılma ikinci bir komisyon kalemi hâline gelmeden" sınırını çizer.
 *  · `depthRatio` — derinlik etkisi için aynı sınır (aynı gerekçe; iki terim de dolum fiyatının içinde kaybolur, borsaya ödenen ücret değildir).
 *  · `volumeMultiple` — 24 saatlik quote hacmi, planlanan pozisyonun en az bu katı olsun. Mutlak bir USDT tabanı YAZILMAZ: sermaye büyüdükçe eşik de büyümeli.
 *  Bu üç oran ANAYASA'dan gelmez; iş sahibi kararı da değildir. Değişecekse önce ANAYASA A-2 değişir (Ö-3). */
export const UNIVERSE_CRITERIA = { spreadRatio: "0.5", depthRatio: "0.5", volumeMultiple: "10000" } as const;
/** ELLE DIŞLAMA LİSTESİ — BOŞ BAŞLAR (A-2). Buraya bir sembol eklemek onu evrenden çıkarır; hiçbir sembolü evrene SOKMAZ (liste tek yönlüdür: eleme). */
export const MANUAL_EXCLUSIONS: readonly string[] = [];
/** Ağırlık 2 (Binance: tek sembol). Sembolsüz çağrı 80'dir ve ürün yolunda kullanılmaz — evren SEMBOL BAŞINA ölçülür. */
export const DAY_TICKER_CALL = { path: "/api/v3/ticker/24hr", cls: "DISCOVERY", weight: 2 } as const;

const D = Prisma.Decimal, NUM = /^\d+(\.\d+)?$/;
const dec = (s: unknown): Prisma.Decimal | null => (typeof s === "string" && NUM.test(s) ? new D(s) : null);

export type UniverseRefusal = "MANUALLY_EXCLUDED" | "NOT_TRADING" | "QUOTE_MISMATCH" | "SPREAD_TOO_WIDE" | "BELOW_MIN_NOTIONAL" | "VOLUME_TOO_LOW" | "DEPTH_TOO_THIN" | "UNMEASURED";
export type UniverseInput = {
  symbol: string; status: string; quoteAsset: string; spotAllowed?: boolean; minNotional: string; tickSize: string | null; midPrice: string | null;
  spreadBp: string; depthBp: string | null; quoteVolume: string | null; positionSize: string; commissionRoundTripBp: string; // STANDART (indirimsiz) gidiş-dönüş — çapa, maliyet değil
};
export type UniverseVerdict = { ok: true; workings: string[]; tickBp: string | null } | { ok: false; refusal: UniverseRefusal; detail: string; workings: string[]; tickBp: string | null };

/** SAF YARGI — hiçbir ağ çağrısı yapmaz; girdilerin hepsi ÇALIŞMA ANINDA ölçülmüş değerlerdir. Ölçüm betiği de bu fonksiyonu kullanır (tek kaynak, Ö-5). */
export function judgeSymbol(i: UniverseInput): UniverseVerdict {
  const workings: string[] = [], tick = dec(i.tickSize), mid = dec(i.midPrice);
  const tickBp = tick !== null && mid !== null && mid.gt(0) ? tick.div(mid).mul(10_000).toFixed(6) : null;
  if (tickBp !== null) workings.push(`taban yayılma (tickSize ${tick?.toFixed(8)} ÷ fiyat ${mid?.toFixed(8)}) = ${tickBp} bp`);
  const no = (refusal: UniverseRefusal, detail: string): UniverseVerdict => ({ ok: false, refusal, detail, workings, tickBp });
  if (MANUAL_EXCLUSIONS.includes(i.symbol)) return no("MANUALLY_EXCLUDED", `${i.symbol} elle dışlama listesinde`);
  if (i.status !== "TRADING" || i.spotAllowed === false) return no("NOT_TRADING", `${i.symbol} durum=${i.status} spot=${i.spotAllowed ?? "?"}`);
  const size = dec(i.positionSize), min = dec(i.minNotional), comm = dec(i.commissionRoundTripBp), spread = dec(i.spreadBp);
  if (size === null || min === null || comm === null || spread === null) return no("UNMEASURED", `ölçülemeyen girdi: büyüklük=${i.positionSize} minNotional=${i.minNotional} komisyon=${i.commissionRoundTripBp} yayılma=${i.spreadBp}`);
  if (i.quoteAsset !== "" && i.symbol.endsWith(i.quoteAsset) === false) return no("QUOTE_MISMATCH", `${i.symbol} quote=${i.quoteAsset} değil`);
  const spreadCeiling = comm.mul(UNIVERSE_CRITERIA.spreadRatio), depthCeiling = comm.mul(UNIVERSE_CRITERIA.depthRatio);
  workings.push(`yayılma tavanı = ölçülen komisyon ${comm.toFixed(4)} bp × ${UNIVERSE_CRITERIA.spreadRatio} = ${spreadCeiling.toFixed(4)} bp`);
  if (spread.gt(spreadCeiling)) return no("SPREAD_TOO_WIDE", `yayılma ${spread.toFixed(4)} bp > tavan ${spreadCeiling.toFixed(4)} bp`);
  workings.push(`planlanan büyüklük ${size.toFixed(8)} ↔ asgari emir tutarı ${min.toFixed(8)}`);
  if (size.lt(min)) return no("BELOW_MIN_NOTIONAL", `planlanan büyüklük ${size.toFixed(8)} < minNotional ${min.toFixed(8)} — bu sermayede bu çift işlem göremez (M-4)`);
  const vol = dec(i.quoteVolume), volFloor = size.mul(UNIVERSE_CRITERIA.volumeMultiple);
  workings.push(`hacim alt sınırı = büyüklük ${size.toFixed(8)} × ${UNIVERSE_CRITERIA.volumeMultiple} = ${volFloor.toFixed(2)}`);
  if (vol === null) return no("UNMEASURED", `${i.symbol} 24 saatlik hacim ölçülemedi (quoteVolume=${i.quoteVolume ?? "yok"})`);
  if (vol.lt(volFloor)) return no("VOLUME_TOO_LOW", `24s hacim ${vol.toFixed(2)} < ${volFloor.toFixed(2)}`);
  const depth = dec(i.depthBp);
  workings.push(`derinlik tavanı = ölçülen komisyon ${comm.toFixed(4)} bp × ${UNIVERSE_CRITERIA.depthRatio} = ${depthCeiling.toFixed(4)} bp`);
  if (depth === null) return no("UNMEASURED", `${i.symbol} derinlik etkisi ölçülmedi — ölçülmeden çift alınmaz (A-2)`);
  if (depth.gt(depthCeiling)) return no("DEPTH_TOO_THIN", `derinlik etkisi ${depth.toFixed(4)} bp > tavan ${depthCeiling.toFixed(4)} bp`);
  return { ok: true, workings, tickBp };
}

export type VolumeReading = { ok: true; quoteVolume: string; lastPrice: string | null; source: string } | { ok: false; detail: string };
/** 24 saatlik quote hacmi — ÇALIŞMA ANINDA okunur. Okunamazsa evren yargısı `UNMEASURED` verir ve giriş olmaz (kapalı arıza). */
export async function readDayVolume(symbol: string, deps: { exchange?: ExchangeDeps; now?: () => number } = {}): Promise<VolumeReading> {
  const r = await requestWithEvents<{ quoteVolume?: string; lastPrice?: string }>({ ...DAY_TICKER_CALL, query: { symbol } }, deps.exchange);
  if (!r.result.ok) return { ok: false, detail: `ticker/24hr:${r.result.reason ?? ""}:${r.result.detail}` };
  const v = dec(r.result.data?.quoteVolume);
  if (v === null) return { ok: false, detail: `ticker/24hr:${symbol}:quoteVolume okunamadı` };
  return { ok: true, quoteVolume: v.toFixed(8), lastPrice: dec(r.result.data?.lastPrice)?.toFixed(8) ?? null, source: `ticker/24hr ${symbol} @${new Date((deps.now ?? Date.now)()).toISOString()}` };
}
