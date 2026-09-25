// SAAT HİZALAMA (Tur 13 · S-4, S-7, K-8, M-2 ilkesi "sayı kaynağından okunur", Ö-1, Ö-3, Ö-5). İmzalı çağrıların `timestamp` alanını üreten TEK yüzey (kapı: gate:order).
// NEDEN: Binance imzalı isteği iki yönlü denetler — damga sunucu saatinden 1000 ms'den FAZLA İLERİDEYSE ya da recvWindow'dan (RECV_WINDOW_MS = 5000) fazla GERİDEYSE `-1021`.
// Tolerans asimetriktir (ileri 1 s, geri 5 s), bu yüzden düzeltme BİLEREK GERİ yönde yapılır. Tur 12 §11-3 ölçümü: yerel saat sunucudan ~1,8 s SAPMIŞ, bir koşumda -1021 alındı.
// NASIL: `GET /api/v3/time` (genel uç, ağırlık 1) G05 boğazından + G07 olay sarmalayıcısından okunur. Gönderim/alım anı boğazın ÇAĞRI BAŞINA gözlemcisinden alınır — t1−t0'ı
//   dışarıdan ölçmek Upstash turlarını da sayar ve sapmayı saniyeler mertebesinde bozardı (Ö-5, bu turda ölçüldü: dış ölçüm 2300 ms, taşıyıcı 20–290 ms).
// SAPMA ALT SINIRI: offset = serverTime − alımAnı. Gerçek sapma [serverTime−alım, serverTime−gönderim] aralığındadır; ALT sınırı seçmek damganın sunucu saatini ASLA
//   geçmemesini garanti eder (ileri 1 s tolerans yenmez), en fazla `spread` kadar geri kalır — o da recvWindow'un içindedir (aşağıdaki kapı bunu zorlar).
// KAPALI ARIZA: sapma okunamazsa ya da güvenilmezse imzalı çağrı YAPILMAZ ve olay yazılır (K-8). Yanlış zaman damgasıyla emir göndermek yasaktır.
import { stopEngine, type Deps as EventDeps, type EmitResult } from "@/lib/events";
import { requestWithEvents, type ExchangeDeps } from "@/lib/events/exchange";

/** İmzalı isteğin geçerlilik penceresi (Binance varsayılanı). Damga ile aynı yerde durur: ikisi de aynı sözleşmenin parçası. G06 bu adı buradan yeniden dışa verir
 *  (döngüsel içe aktarma olmasın diye tek yön: exchange-key → binance/time). */
export const RECV_WINDOW_MS = 5000;
export const TIME_CALL = { path: "/api/v3/time", cls: "DISCOVERY", weight: 1 } as const;
/** AÇIK — A-1'de yok, UYDURULDU (sicil, geri alınabilir): sapma bu süre boyunca önbellekte tutulur. 1 dakika: çağrı ağırlığı 1'dir (dakikalık tavanın binde 0,17'si) ve
 *  bir dakikada bir kristalin biriktirebileceği kayma (≤100 ppm ⇒ ≤6 ms) recvWindow'un binde 1,2'sidir — yeniden okumak bu ölçekte kazanç getirmez. */
export const CLOCK_OFFSET_TTL_MS = 60_000;
/** AÇIK — A-1'de yok, UYDURULDU (sicil, geri alınabilir): SAPMA TAVANI. |sapma| bunu aşarsa düzeltme yapılmaz, imzalı çağrı ÇIKMAZ. 30 s: bu büyüklükteki bir fark artık
 *  "kayma" değil BOZUK SAAT'tir (NTP kopması, askıya alınmış makine); böyle bir saat önbellek penceresi içinde SIÇRAYABİLİR ve düzeltme sessizce yanlışa döner. */
export const CLOCK_SKEW_MAX_MS = 30_000;
/** TÜRETİLMİŞ (uydurma değil): ölçümün genişliği (taşıyıcı gidiş-dönüşü) bunu aşarsa okuma güvenilmez sayılır. recvWindow'un YARISI — kalan yarısı önbellek yaşı ve
 *  imzalı çağrının kendi gecikmesi için pay bırakır; damga en fazla `spread` kadar geri kalabildiğinden bu sınır -1021'in geri yönünü kapatır. */
export const CLOCK_SPREAD_MAX_MS = RECV_WINDOW_MS / 2;

export type ClockDeps = { exchange?: ExchangeDeps; events?: EventDeps; now?: () => number };
export type ClockReading = { ok: true; offsetMs: number; spreadMs: number; readAt: number; source: string } | { ok: false; detail: string };
export type StampRefusal = "CLOCK_UNSYNCED" | "CLOCK_SKEW_EXCEEDED";
export type StampOutcome =
  | { ok: true; timestamp: string; offsetMs: number; spreadMs: number; ageMs: number; source: string }
  | { ok: false; refusal: StampRefusal; detail: string; event: EmitResult | null };

let cached: Extract<ClockReading, { ok: true }> | null = null;
/** Kapı/kanarya ve dönem sınırı için: önbelleği boşalt. Ürün kodu çağırmaz (kapı ölçer). */
export const resetClockOffset = (): void => { cached = null; };
/** Yalnız okuma: son ölçüm (varsa). Karar vermez. */
export const clockOffsetSnapshot = (): Extract<ClockReading, { ok: true }> | null => cached;

/** Sunucu saatini oku ve sapmanın ALT sınırını hesapla. Gönderim/alım anı boğazın çağrı başına gözlemcisinden gelir; alınamazsa ölçü dış zamanlamaya düşer (spread büyür, kapı yakalar). */
export async function readServerClock(deps: ClockDeps = {}): Promise<ClockReading> {
  const now = deps.now ?? Date.now;
  let recvAt = 0, spread = -1;
  const t0 = now();
  const r = await requestWithEvents<{ serverTime?: number }>({ ...TIME_CALL, observe: (o) => { recvAt = now(); spread = o.ms; } }, deps.exchange);
  if (!r.result.ok) return { ok: false, detail: `time:${r.result.reason ?? ""}:${r.result.detail}` };
  const serverTime = r.result.data?.serverTime;
  if (typeof serverTime !== "number" || !Number.isFinite(serverTime)) return { ok: false, detail: "time:bad-serverTime" };
  if (recvAt === 0 || spread < 0) { recvAt = now(); spread = recvAt - t0; } // gözlemci çalışmadı (sahte taşıyıcı): dış zamanlamaya düş, genişliği OLDUĞU GİBİ bildir
  return { ok: true, offsetMs: Math.round(serverTime - recvAt), spreadMs: Math.round(spread), readAt: recvAt, source: `${TIME_CALL.path} serverTime=${serverTime} alım=${recvAt} genişlik=${Math.round(spread)}ms` };
}

/** İmzalanacak `timestamp`. Önbellek taze değilse yeniden ölçülür. Okunamaz / genişlik güvenilmez / sapma tavanı aşılmış ⇒ ok:false + OLAY: imzalı çağrı yapılmaz (K-8). */
export async function signedTimestamp(deps: ClockDeps = {}): Promise<StampOutcome> {
  const now = deps.now ?? Date.now;
  const no = async (refusal: StampRefusal, detail: string): Promise<StampOutcome> => ({ ok: false, refusal, detail, event: await stopEngine(refusal, `imzalı çağrı yapılmadı · ${detail}`, {}, deps.events) });
  let r: Extract<ClockReading, { ok: true }> | null = cached && now() - cached.readAt < CLOCK_OFFSET_TTL_MS ? cached : null;
  if (!r) {
    const fresh = await readServerClock(deps);
    if (!fresh.ok) return no("CLOCK_UNSYNCED", `sunucu saati okunamadı: ${fresh.detail}`);
    if (fresh.spreadMs > CLOCK_SPREAD_MAX_MS) return no("CLOCK_UNSYNCED", `ölçüm genişliği ${fresh.spreadMs} ms > CLOCK_SPREAD_MAX_MS ${CLOCK_SPREAD_MAX_MS} ms; sapma güvenilmez`);
    if (Math.abs(fresh.offsetMs) > CLOCK_SKEW_MAX_MS) return no("CLOCK_SKEW_EXCEEDED", `sapma ${fresh.offsetMs} ms, tavan ±${CLOCK_SKEW_MAX_MS} ms (${fresh.source})`);
    cached = fresh; r = fresh;
  }
  const ageMs = now() - r.readAt;
  return { ok: true, timestamp: String(now() + r.offsetMs), offsetMs: r.offsetMs, spreadMs: r.spreadMs, ageMs, source: `${r.source} · yaş=${ageMs}ms` };
}
