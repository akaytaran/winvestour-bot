// ZİNCİR — KAS DÖNGÜSÜ (G16 · K-3, K-4, K-6, K-7, K-8, S-7, M-4, A-4, Ö-1, Ö-2, Ö-5). Kapı: scripts/gate-chain.mjs · kanarya: scripts/canary-chain.mts · ölçüm: scripts/measure-chain.mts.
// TUR 21 — TEK TİK MANTIĞI, İKİ TETİKLEYİCİ, TEK AYAR: motorun bir tikte yaptığı iş `tickOnce` içinde TEK yerde durur (izin → kilit → akış → fiyat olayları → koruma denetimi → giriş).
//   Onu iki yol tetikler ve seçim TEK ayarla (ENGINE_MODE, ortam sözleşmesi) yapılır; tik aralığı da ayardır (ENGINE_TICK_MS), koda gömülmez:
//   · UCUZ MOD (CHEAP, varsayılan): Vercel cron dakikada bir `engineCron` → `cronTick`: izin (peek) → kira SET NX (K-6: çakışan iki tetikleme → tek icra; PX = aralık ⇒ aralık da buradan) →
//     tickOnce → kayıt. Sürekli yaşayan halka YOK, WS push YOK (dolumlar koruma denetleyicisinin imzalı okumasıyla, K-1), Neon yalnız tik anında.
//   · HIZLI MOD (FAST): Tur 19 zinciri — halka `runLink` fonksiyon ömrü boyunca tikler (kira CAS + kalp atışı), nöbetçi `ensureChain` deviri açar. Kapı: tik mantığını ikinci kez yazan yol KIRMIZI.
// HALKA = bir Vercel fonksiyonu içinde koşan döngü: her tikte ÇALIŞMA İZNİ (K-7) → kira yenileme → PİYASA AKIŞI (tek çağrı, boğazdan) → fiyat olayları (G14) →
//   koruma denetimi (G12) → (giriş yolu AÇIKSA) Beyin/plan/açılış → kalp atışı (Upstash `chain:link:<seq>`) → devir. Tik süresi ayardan (ENGINE_TICK_MS; ölçülen öneri MİMARİ §2).
// K-7 — ZİNCİR DURDURMANIN ÖNÜNE GEÇEMEZ: izin yoksa halka KENDİNİ SONLANDIRIR ve yenisini TETİKLEMEZ; nöbetçi (ensure) de izin yokken halka açmaz; cron tiki izinsiz iş yapmaz.
// K-6 — DEVİR ANINDA İKİ HALKA BİRLİKTE YAŞAR: kira (`chain:lease`, tek sahip, CAS) yalnız ardıl halkaya geçer; öncül kirayı kaybettiğini görünce durur. Emir icrası zaten
//   kimlik + kilit katmanlarından (G10) geçer — çift icra orada durur; kira yalnız iki halkanın boşa piyasa okumasını sınırlar. Ucuz modda AYNI kira anahtarı cron tiklerini tekler.
// DEVİR — HALKALAR BİRBİRİNİ ÇAĞIRMAZ (ÖLÇÜLDÜ, Tur 19 madde 2): fonksiyonun kendi dağıtımına attığı istek zinciri Vercel'de birikir (`x-vercel-id: fra1:hnd1:hnd1:hnd1:hnd1::…`) ve
//   BEŞİNCİ iç içe çağrı **HTTP 508** (INFINITE_LOOP_DETECTED) ile reddedilir — Tur 0'ın "Infinite l…" yanıtı buydu. Bu yüzden öncül, devir anında yalnız kiraya `handoffDue` yazar;
//   ardılı DIŞ tetikleyici (cron nöbetçisi `ensureChain`) tek kullanımlık jetonla açar — her ardıl 1 derinlikte başlar, zincir uzunluğu sınırsızdır.
// K-4 — ZİNCİR KOPMASI SESSİZ OLAMAZ: nöbetçi devir isteği düşerse ya da halka sessizce ölürse (platform: kira düşer) CHAIN_BREAK yazar ve — yalnız izin RUNNING ise — yeni halka açar.
//   WS push koparsa USER_STREAM_LOST (user-stream.ts); REST yoklamasına DÜŞÜLMEZ. Ucuz modda tik atlanır/gecikirse (aralık + bir cron dönemi) bir sonraki tik TICK_MISSED yazar (K-8).
// MALİYET (Tur 20 madde 2, ÖLÇÜLDÜ): halka tikinde Upstash komutu 8,83 (+1 izin) → 3 (+1 yalnız borsa sayacı saparsa): izin GET · kira CAS + kalp atışı + `last` TEK EVAL · boğaz askı+rezervasyon TEK EVAL;
//   `market:snapshot` yazımı kaldırıldı. Tavan UPSTASH_TICK_COMMAND_CEILING, kapı ölçer. Cron tiki: izin GET · izin yenileme EVAL (ufuk dolunca) · kira+önceki kayıt TEK EVAL · boğaz EVAL · (mutabakat SET) · kayıt EVAL.
// A-4 (Tur 19 madde 2) — ÖMÜR ÖLÇÜMÜ BU KODUN KENDİSİDİR: halka doğal ölümüne bırakılır; `end` yalnız izin yok / devir tamam / kira kaybı ile çağrılır, ZAMANLA ÇAĞRILMAZ.
//   Devir anı (CHAIN_HANDOFF_MS) ölçülen fonksiyon ömründen türer; ölçülene kadar `null` = devir yapılmaz (halka ölür, nöbetçi yeniden bağlar — v1 ölçüm dağıtımı). Tur 21: A-4 ERTELENDİ — yalnız hızlı mod açılırsa gerekir.
// M-4/K-2 — BEYİN YALNIZ GİRİŞ YOLU AÇIKKEN ÇAĞRILIR (giriş şalteri AYARDIR, tek okuma yolu entrySwitch — Tur 64): emre dönüşemeyecek kural için para ve ağırlık harcanmaz; adaylar ölçülen 24s hacimden (A-2).
// TUR 22 — NEON TİK YOLUNDA DEĞİL (A-9): izin yalnız Upstash kopyasından (`peekRunPermit`; kopya süreli, Neon'dan PERMIT_REFRESH_MS'te bir tazelenir — engine-control). Açık pozisyonlar Neon'dan
//   YALNIZ gerektiğinde okunur: önceki tik kaydı "0 açık pozisyon" diyorsa, giriş yolu kapalıysa (pozisyon açılamaz) ve bu tikte tazeleme olmadıysa Neon'a gidilmez; pozisyon varsa, giriş açıksa,
//   önceki kayıt yoksa/okunamadıysa/izinden eskiyse ya da Neon zaten tazeleme için uyandıysa (mutabakat) okunur. Koruma borsada (K-1); G12/G14 pozisyon varken Neon'u her tik kullanır (kapsam dışı, rapor).
// TUR 23 — POZİSYON DURUMU DA TİK YOLUNDA DEĞİL (A-9, K-2/K-10 gevşemedi): açık pozisyonlar her tik YALNIZ Upstash kopyasından okunur (`readPositions`, 1 GET; protection/copy.ts). Neon'a tik yolundan
//   DOKUNULMAZ: Neon yalnız kopyanın tazelemesinde (kopya yok / vade / izin tazeleme tikiyle hizalı — Neon zaten uyanık) ve değişim anında (açılış/koruma/kapanış, Neon önce). Kopya OKUNAMIYOR ya da
//   yok+Neon yok ⇒ durum BİLİNMİYOR ⇒ bu tikte İŞ YAPILMAZ (piyasa okunmaz, giriş yok; olay POSITIONS_UNKNOWN) — "pozisyon yok" ASLA varsayılmaz (Ö-2). Kopya BOŞ ⇒ normal. Kopya ≠ Neon ⇒ Neon kazanır,
//   olay, tutarlı tazelemeye kadar giriş planlanmaz (çıkış/koruma sürer, M-1). Tur 22'nin `PositionsHint` mekanizması kalktı (kopya onun yerini aldı). Tik deposu `positionStore(deps)` = Neon + kopya sarmalayıcısı.
import { Prisma } from "@/generated/prisma/client";
import { EXCHANGE_INFO } from "@/lib/binance";
import { callBrain, planFromRule, type BrainDeps } from "@/lib/brain";
import { readShortMode } from "@/lib/risk-settings";
import { readBrainRuntime, readTickMs, type SettingsDeps } from "@/lib/brain-settings";
import { readRoundTripCost } from "@/lib/edge/cost";
import { EDGE_MULTIPLE, screenEntry } from "@/lib/edge";
import { peekRunPermit, PERMIT_GRACE_MS, type Deps as ControlDeps, type Permit } from "@/lib/engine-control";
import { pickEnv } from "@/lib/env";
import { eventNote, stopEngine, stopEngineFor, type Deps as EventDeps, type EmitResult } from "@/lib/events";
import { requestWithEvents } from "@/lib/events/exchange";
import { periodOf, prismaLedgerStore, settleFee, type Deps as LedgerDeps } from "@/lib/fee-ledger";
import { screenHealth } from "@/lib/health";
import { readCandles, readMarket, sleep, type MarketDeps, type MarketReading, type Quote } from "@/lib/market";
import { openUserStream, type Fill, type StreamDeps, type StreamState, type UserStream } from "@/lib/market/user-stream";
import { entrySwitch, type EntrySwitchStore } from "@/lib/entry-settings";
import { auditProtection, openProtectedPosition, type Deps as ProtDeps, type OpenPosition } from "@/lib/protection";
import { positionStore, readPositions, type CopyRefresh } from "@/lib/protection/copy";
import { onPriceEvent, readTrailingState, type TrailingState } from "@/lib/protection/trailing";
import { readSizing } from "@/lib/sizing";
import { redisPipeline, upstashStats } from "@/lib/upstash";

// ---- MOD ANAHTARI (Tur 21 madde 2): mod ve tik aralığı AYARDIR, koda gömülmez; kapı/kanarya `deps.setting` ile enjekte eder ----
// TUR 67 (Üretim kararı K3 = [A], 24 Eyl 2026 · KARAR-DEFTERI 20 Eyl satır 87 "tik aralığı panelden yönetilen parametre"): MOD ortamdan (`ENGINE_MODE`), ARALIK artık ortamdan DEĞİL —
//   `brain_settings.tick_ms` ayarıdır ve İZİN KOPYASIYLA taşınır (engine-control: Neon tazelemesi 20 dakikada bir + RESUME kopyaya yazar). Ayar İKİ EVRELİDİR: giriş (`readTickSetting()`) modu okur,
//   aralık tik gövdesinde İZİN OKUNDUKTAN SONRA ve KİLİTTEN ÖNCE kopyadan yerleşir (`settleTick`) ⇒ tik başına Neon 0, ek Upstash komutu 0. Kopyada aralık yoksa/geçersizse tik KAPALI ARIZALANIR
//   (TICK_MISSED "ayar geçersiz"), varsayılan sayı icat edilmez. Durdurma aralıktan BAĞIMSIZDIR: izin reddi (STOPPED/NO_PERMIT/…) aralığa bakılmadan döner (K-7). `ENGINE_TICK_MS` ortam değişkeni OKUNMAZ.
export type EngineMode = "CHEAP" | "FAST";
/** `fromCopy`: üretim ayarı — aralık izin kopyasından yerleşir (yerleşmeden önce `tickMs` NaN'dır ve hiçbir yol onu kullanmaz: kilit, kira ve kayıt yerleşmeden sonra). Enjekte ayar (kapı/kanarya) sabit aralık taşır. */
export type TickSetting = { mode: EngineMode; tickMs: number; source: string; fromCopy?: true };
/** Vercel Cron EN SIK dakikada bir tetikler (belge `/docs/cron-jobs/usage-and-pricing` 2026-07-15: Pro "Once per minute", "Per-minute" hassasiyet) — PLATFORM SINIRI, ayar değil; vercel.json `* * * * *` (kapı ölçer). */
export const CRON_PERIOD_MS = 60_000;
/** TİK ARALIĞI SEÇENEK KÜMESİ (Tur 66 §4 ölçümü, Tur 67): TÜRETİLMİŞ — ucuz modda aralık cron döneminin katıdır (kira PX'i dönemi yuvarlar) ve aralık + bir cron dönemi tazeleme payını (PERMIT_GRACE_MS) aşamaz
 *  (izin kopyası bir sonraki tike kadar yaşamalı, K-7) ⇒ 60 · 120 · 180 s. Panelin sunduğu ve yazma yolunun kabul ettiği küme budur; sayı icat edilmedi. */
export const TICK_CHOICES_MS: readonly number[] = Array.from({ length: Math.floor((PERMIT_GRACE_MS - CRON_PERIOD_MS) / CRON_PERIOD_MS) }, (_, i) => (i + 1) * CRON_PERIOD_MS);
/** Kira ömrü = 3 tik (AÇIK — A-1'de yok, UYDURULDU, sicil, geri alınabilir; Tur 19/20 ile aynı oran): iki kaçan tik kopma sayılmaz; 3 tik kalp atışı yoksa nöbetçi halkayı ÖLÜ sayar. */
export const CHAIN_LEASE_TICKS = 3;
export const leaseMsOf = (tickMs: number) => CHAIN_LEASE_TICKS * tickMs;
/** Ucuz modda kira PX = aralık − pay: cron bir sonraki dönemde tam aralıkta tetiklendiğinde kira DÜŞMÜŞ olmalı (yoksa tik bir dönem kayar). Pay TÜRETİLMİŞ: cron dönemi hassasiyeti "per-minute" ⇒ yarım dönem. */
export const cronLeaseMsOf = (tickMs: number) => Math.max(1, tickMs - CRON_PERIOD_MS / 2);
/** ARALIK DOĞRULAYICI (tek yer): geçersiz aralık KAPALI ARIZA — tik koşmaz, sebep döner (Ö-2). Ucuz modda aralık cron döneminden kısa olamaz ve tazeleme payından (PERMIT_GRACE_MS, Tur 22) bir cron dönemi kısa olmalıdır:
 *  izin kopyası tazeleme vadesinden sonra en az bir tik daha yaşamalı (K-7: izin bir sonraki tike kadar; otomatik yeniden başlatma yok). */
export function tickSettingOf(mode: EngineMode, tickMs: unknown, source: string): TickSetting | { error: string } {
  if (typeof tickMs !== "number" || !Number.isInteger(tickMs) || tickMs <= 0) return { error: `tik aralığı pozitif tamsayı değil (${String(tickMs)})` };
  if (mode === "CHEAP" && tickMs < CRON_PERIOD_MS) return { error: `CHEAP: tik aralığı ${tickMs / 1000} saniye < cron dönemi ${CRON_PERIOD_MS / 1000} saniye (platform sınırı)` };
  if (mode === "CHEAP" && tickMs + CRON_PERIOD_MS > PERMIT_GRACE_MS) return { error: `CHEAP: tik aralığı ${tickMs / 1000} saniye + cron dönemi > PERMIT_GRACE_MS ${PERMIT_GRACE_MS / 1000} saniye (izin kopyası bir sonraki tike kadar yaşamaz, K-7)` };
  return { mode, tickMs, source };
}
/** Ayar okuyucu (giriş). Enjekte (`env`, kapı/kanarya — alan adları Tur 21'den; ORTAMDAN OKUNMAZ) ⇒ tam ayar. Üretim ⇒ MOD ortamdan, aralık izin kopyasından yerleşecek (`fromCopy`). */
export function readTickSetting(env?: { ENGINE_MODE: EngineMode; ENGINE_TICK_MS: number }): TickSetting | { error: string } {
  if (env) return tickSettingOf(env.ENGINE_MODE, env.ENGINE_TICK_MS, "enjekte (kapı/kanarya)");
  let mode: EngineMode; try { mode = pickEnv("ENGINE_MODE").ENGINE_MODE; } catch { return { error: "ENGINE_MODE eksik ya da bozuk (ortam sözleşmesi)" }; }
  return { mode, tickMs: Number.NaN, source: "mod: ortam (ENGINE_MODE) · aralık: izin kopyası (brain_settings.tick_ms; tazeleme/RESUME)", fromCopy: true };
}
/** ARALIĞI KOPYADAN YERLEŞTİR (Tur 67): yalnız izin VARKEN çağrılır (izin reddi aralığa bakmadan döner, K-7). Enjekte ayarda iş yapmaz. Hata metni döner ya da null (yerleşti). Aralık tik başına
 *  yeniden yerleşir: tazeleme yeni değeri kopyaya yazınca bir sonraki tik onu kullanır. Fırlatmaz. */
export function settleTick(setting: TickSetting, permit: Permit): string | null {
  if (!setting.fromCopy) return null;
  if (!permit.run) return `izin yok (${permit.reason})`;
  if (permit.tickMs === undefined) return "izin kopyasında tik aralığı alanı YOK (okuyucu verilmedi ya da bu sürümden önce yazılmış kopya): en geç bir sonraki tazelemede ya da RESUME'da gelir";
  if (permit.tickMs === null) return `izin kopyasında tik aralığı yok: ${permit.tickNote ?? "okunamadı"}`;
  const s = tickSettingOf(setting.mode, permit.tickMs, "izin kopyası (brain_settings.tick_ms)"); if ("error" in s) return s.error;
  setting.tickMs = s.tickMs; setting.source = s.source; return null;
}
/** Tazelemenin tik aralığı okuyucusu (Tur 67): engine-control ayar modülünü içe aktaramaz (K-7 grafiği) ⇒ okuyucu zincirden verilir. Kapı/kanarya kendi okuyucusunu verirse o kullanılır. */
const withTickReader = (deps: ChainDeps): ChainDeps => ({ ...deps, control: { tickSource: () => readTickMs({ store: deps.settings?.store }), ...deps.control } });
/** UPSTASH KOMUT TAVANI, halka tiki başına (Tur 20 madde 2/8, kapı `gate:chain` ölçer, KIRMIZI verir): ÖLÇÜLDÜ eski 8,83 (+1 izin) → Tur 20: izin GET 1 + kira/kalp atışı EVAL 1 + boğaz askı+rezervasyon EVAL 1
 *  = 3; yalnız borsa sayacı yerel tahminden saparsa mutabakat SET +1 ⇒ 4. TUR 23 (ÖLÇÜLDÜ, kapı dinamik 8): + pozisyon kopyası GET 1 her tikte ⇒ hizalı 4, sapmalı 5 (tepe yükselen tikte + kopya CAS EVAL 1).
 *  Bu sayının üstü maliyet GERİLEMESİDİR. (Varsayım, AÇIK: Upstash bir EVAL'i tek komut sayar — belge bunu yazmıyor.) */
export const UPSTASH_TICK_COMMAND_CEILING = 5;
/** UPSTASH KOMUT TAVANI, CRON tiki başına (Tur 21 madde 6, kapı ölçer): ÖLÇÜLDÜ izin GET 1 + kira NX + önceki kayıt TEK EVAL 1 + pozisyon kopyası GET 1 (Tur 23) + boğaz EVAL 1 + kayıt EVAL 1 = 5 taban;
 *  + mutabakat SET ≤ 1 (sayaç sapınca) + tazeleme tikinde izin kopyası CAS EVAL 1 ve pozisyon kopyası CAS EVAL 1 (+ tepe yükselen tikte kopya GET+CAS 2) ⇒ en çok 8 pozisyon yokken (Tur 22: 4–6; kapı dinamik 9 ölçer).
 *  AÇIK POZİSYON BAŞINA +2 (ÖLÇÜLDÜ, kapı dinamik 11): koruma denetimi ve tepe durumu birer imzalı emir okuması ⇒ birer boğaz EVAL; ilk tik (kopya kurulumu SET, boğaz tavan önbelleği MGET+SET, tepe CAS) ve tazeleme tiki ≤ tavan + 6. */
export const UPSTASH_CRON_TICK_COMMAND_CEILING = 8;
/** Cron tik kaydı geçmişi: son N tik (Upstash liste; UYDURULDU, sicil: 1 gün × dakikalık tik; ölçüm penceresi). */
export const CRON_TICK_HISTORY = 1440;
/** Giriş planlama dönemi (Beyin adayları): en sık dakikada bir (UYDURULDU, sicil; `callBrain` kendi aralığını ayrıca tutar, TOO_SOON). Tik aralığı dakikadan uzunsa her tik. */
export const PLAN_PERIOD_MS = 60_000;
/** DEVİR ANI — ÖLÇÜLEN fonksiyon ömründen türer. ÖLÇÜLDÜ (Tur 19 madde 2, üretim hnd1, `maxDuration = 800` bildiren sonda, kendi zamanlayıcısı yok): fonksiyonun son kalp atışı
 *  **791,4 / 791,5 / 791,x s** (n=3, ardından kayıt yok = platform kapattı; kalp atışı 10 s ⇒ ölüm 791–801 s aralığında); `after()` fonksiyonu tavana kadar yaşatıyor; ölüm ANİDİR (soket onclose bile gelmez).
 *  Devir 700 s'de tetiklenince öncül ile ardıl **90,1 s** birlikte yaşadı (n=2) ve ardıl her seferinde YENİ örnekte başladı. 700 s = ölçülen ömrün (791 s) altında, devir isteğinin gidip
 *  ardılın kirayı devralması için ≥ 3 tik + ağ payı bırakır; daha geç devir pencereyi daraltır, daha erken ardılın ömrünü boşa harcar. `null` yapılırsa devir YAPILMAZ (nöbetçi yeniden bağlar; v1 ölçüm dağıtımı böyleydi). */
export const CHAIN_HANDOFF_MS: number | null = 700_000;
/** Halka kaydı 7 gün tutulur (UYDURULDU, sicil: ölçüm/rapor penceresi). */
export const CHAIN_HISTORY_TTL_SEC = 7 * 86_400;
export const CHAIN_HEADER = "x-chain-token", CHAIN_NS = "chain";
/** Anahtar ad alanı: üretimde `chain:*`; kanarya kendi ad alanını verir (üretim kirasına dokunmaz, S-9). `ticks`: cron tik kayıtları (liste). */
export const chainKeys = (ns: string) => ({ lease: `${ns}:lease`, last: `${ns}:last`, ticks: `${ns}:ticks`, token: (seq: number) => `${ns}:handoff:${seq}`, link: (seq: number) => `${ns}:link:${seq}` });
/** TUR 25 (madde 1): aday sayısı ve mum sayısı KODDA DEĞİL, AYARDA (`brain_settings.candidates` / `candle_limit`; src/lib/brain-settings). Mum ARALIĞI kodda kalır: girdi biçiminin
 *  parçasıdır (1 saatlik seri), maliyet parametresi değildir. Eski sabitler `BRAIN_CANDIDATES = POSITION_COUNT_CEILING` ve `CANDLE_LIMIT = 48` başlangıç değeri olarak göçe yazıldı. */
export const CANDLE_INTERVAL = "1h";

const D = Prisma.Decimal;
export type LeaseDoc = { linkId: string; seq: number; startedAt: number; at: number; handoffDue?: number | null };
export type LinkCtx = { linkId: string; seq: number; origin: string; startedAt: number };
export type EndReason = "NOT_PERMITTED" | "HANDED_OFF" | "LEASE_LOST" | "LEASE_HELD" | "NOT_FAST_MODE";
type MarketRec = { ok: boolean; at: string | null; refusal?: string; quotes?: Quote[] } | null;
/** Tur 26 (G18): tikin KORUMA DENETİMİ özeti — panel "koruma emri borsada duruyor mu" sorusunu bu ÖLÇÜLEN kayıttan yanıtlar, kendi borsa çağrısını yapmaz (S-7 ağırlık, K-1 doğrulama tikin işi). */
export type ProtectionRec = { rows: { positionId: number; symbol: string; state: string; status: string | null }[] } | null;
type MemRec = { rssMb: number; heapMb: number; peakRssMb: number } | null;
/** `market.quotes`: son anlık görüntü (Tur 20: ayrı `market:snapshot` yerine kalp atışında) · `mem`: fonksiyonun GERÇEK bellek kullanımı (Tur 20 madde 4) · `upstash.sites`: komutların çağrı yeri dökümü (madde 1). */
export type LinkRecord = LinkCtx & { at: number; ticks: number; permit: Permit | null; market: MarketRec; positions: number; ws: StreamState | null; wsOpen: { ok: boolean; detail: string } | null; fills: number; weight1m: number | null; upstash: { requests: number; commands: number; sites?: Record<string, number> }; mem: MemRec; handoff: { at: number; seq: number; detail: string } | null; end: { at: number; reason: EndReason } | null; planning: string | null };
/** Açık pozisyon listesinin kaynağı (Tur 23): `copy` Upstash kopyası (Neon'a dokunulmadı) · `neon` bu tikte tazeleme (kopya yok/vade/izin tazelemesiyle hizalı) · `unknown` kopya okunamadı ya da yok ve Neon'dan kurulamadı — iş yapılmadı (Ö-2). */
export type PositionsSource = "copy" | "neon" | "unknown";
/** Tik kaydına düşen kopya özeti (ölçüm): kaynak, `syncedAt`, tazeleme sonucu, uyuşmazlık (karantina). */
export type PositionsCopyRec = { source: PositionsSource; syncedAt: string | null; refresh: CopyRefresh | null; quarantined: string | null; reason?: string };
/** CRON TİK KAYDI (ucuz mod, Tur 21): tik başına süre (`permitMs`: izin okuma — Tur 22'de yalnız Upstash, tazeleme tikinde Neon dâhil), Upstash komut/çağrı yeri, GERÇEK bellek, gecikme tespiti,
 *  pozisyon kaynağı (`positionsSource`, Tur 22: Neon'a dokunuldu mu) — maliyet BURADAN ölçülür (madde 4). */
export type TickRecord = { mode: "CHEAP"; id: string; at: number; startedAt: number; durationMs: number; permitMs: number; tickMs: number; permit: Permit | null; market: MarketRec; positions: number; positionsSource?: PositionsSource; copy?: PositionsCopyRec | null; weight1m: number | null; protection?: ProtectionRec; planning: string | null; upstash: { requests: number; commands: number; sites?: Record<string, number> }; mem: MemRec; late: { gapMs: number; event: EmitResult | null } | null };
/** `renew(prev, next, px, rec?)`: kira CAS yenilemesi; `rec` verilirse halka kaydı (kalp atışı) ve `last` AYNI atomik komutta yazılır (Tur 20: eski yol EVAL + SET + SET = 3 komut/tik, yeni 1).
 *  `beginTick` (Tur 21): kira SET NX + önceki tik kaydı TEK EVAL · `endTick`: kayıt listeye (LPUSH + LTRIM) TEK EVAL. */
export interface ChainStore { acquire(doc: LeaseDoc, pxMs: number): Promise<boolean>; lease(): Promise<LeaseDoc | null>; renew(prev: LeaseDoc, next: LeaseDoc, pxMs: number, rec?: LinkRecord): Promise<boolean>; release(prev: LeaseDoc): Promise<boolean>; putToken(seq: number, token: string, pxMs: number): Promise<void>; takeToken(seq: number): Promise<string | null>; putRecord(r: LinkRecord): Promise<void>; getRecord(seq: number): Promise<LinkRecord | null>; last(): Promise<number>; beginTick(doc: LeaseDoc, pxMs: number): Promise<{ got: boolean; prev: TickRecord | null }>; endTick(r: TickRecord): Promise<void>; ticks(n: number): Promise<TickRecord[]> }
const CAS_LUA = "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3]) if ARGV[4] ~= '' then redis.call('SET', KEYS[2], ARGV[4], 'EX', ARGV[5]) redis.call('SET', KEYS[3], ARGV[6]) end return 1 end return 0", DEL_LUA = "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]) return 1 end return 0";
const BEGIN_TICK_LUA = "if redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX') then return {1, redis.call('LINDEX', KEYS[2], 0) or ''} end return {0, ''}", END_TICK_LUA = "redis.call('LPUSH', KEYS[1], ARGV[1]) redis.call('LTRIM', KEYS[1], 0, ARGV[2]) return 1";
export const upstashChainStore = (cfg?: { url: string; token: string }, ns: string = CHAIN_NS): ChainStore => { const K = chainKeys(ns), c = () => { if (cfg) return cfg; const e = pickEnv("UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"); return { url: e.UPSTASH_REDIS_REST_URL, token: e.UPSTASH_REDIS_REST_TOKEN }; }; const J = (s: unknown) => (typeof s === "string" && s !== "" ? JSON.parse(s) : null); return {
  acquire: async (d, px) => (await redisPipeline([["SET", K.lease, JSON.stringify(d), "PX", px, "NX"]], c()))[0] === "OK", lease: async () => J((await redisPipeline([["GET", K.lease]], c()))[0]),
  renew: async (p, n, px, rec) => (await redisPipeline([["EVAL", CAS_LUA, 3, K.lease, K.link(rec?.seq ?? n.seq), K.last, JSON.stringify(p), JSON.stringify(n), px, rec ? JSON.stringify(rec) : "", CHAIN_HISTORY_TTL_SEC, rec?.seq ?? n.seq]], c()))[0] === 1, release: async (p) => (await redisPipeline([["EVAL", DEL_LUA, 1, K.lease, JSON.stringify(p)]], c()))[0] === 1,
  putToken: async (s, t, px) => { await redisPipeline([["SET", K.token(s), t, "PX", px]], c()); }, takeToken: async (s) => (await redisPipeline([["GETDEL", K.token(s)]], c()))[0] as string | null,
  putRecord: async (r) => { await redisPipeline([["SET", K.link(r.seq), JSON.stringify(r), "EX", CHAIN_HISTORY_TTL_SEC], ["SET", K.last, String(r.seq)]], c()); }, getRecord: async (s) => J((await redisPipeline([["GET", K.link(s)]], c()))[0]), last: async () => Number((await redisPipeline([["GET", K.last]], c()))[0] ?? 0),
  beginTick: async (d, px) => { const r = (await redisPipeline([["EVAL", BEGIN_TICK_LUA, 2, K.lease, K.ticks, JSON.stringify(d), px]], c()))[0] as [number, string]; return { got: r[0] === 1, prev: J(r[1]) }; },
  endTick: async (r) => { await redisPipeline([["EVAL", END_TICK_LUA, 1, K.ticks, JSON.stringify(r), CRON_TICK_HISTORY - 1]], c()); }, ticks: async (n) => (((await redisPipeline([["LRANGE", K.ticks, 0, n - 1]], c()))[0] as string[]) ?? []).map((s) => J(s) as TickRecord),
}; };
export function memoryChainStore(now: () => number = Date.now): ChainStore & { lease_: { v: LeaseDoc; exp: number } | null; tokens: Map<number, { v: string; exp: number }>; records: Map<number, LinkRecord>; tickList: TickRecord[]; fail: boolean } {
  const s = { lease_: null as { v: LeaseDoc; exp: number } | null, tokens: new Map<number, { v: string; exp: number }>(), records: new Map<number, LinkRecord>(), tickList: [] as TickRecord[], fail: false }, g = () => { if (s.fail) throw new Error("chain-store-down"); }, live = () => (s.lease_ && s.lease_.exp > now() ? s.lease_.v : null), eq = (a: LeaseDoc, b: LeaseDoc | null) => b !== null && JSON.stringify(a) === JSON.stringify(b);
  return Object.assign(s, { acquire: async (d: LeaseDoc, px: number) => { g(); if (live()) return false; s.lease_ = { v: d, exp: now() + px }; return true; }, lease: async () => { g(); return live(); }, renew: async (p: LeaseDoc, n: LeaseDoc, px: number, rec?: LinkRecord) => { g(); if (!eq(p, live())) return false; s.lease_ = { v: n, exp: now() + px }; if (rec) s.records.set(rec.seq, JSON.parse(JSON.stringify(rec)) as LinkRecord); return true; }, release: async (p: LeaseDoc) => { g(); if (!eq(p, live())) return false; s.lease_ = null; return true; },
    putToken: async (q: number, t: string, px: number) => { g(); s.tokens.set(q, { v: t, exp: now() + px }); }, takeToken: async (q: number) => { g(); const t = s.tokens.get(q); s.tokens.delete(q); return t && t.exp > now() ? t.v : null; }, putRecord: async (r: LinkRecord) => { g(); s.records.set(r.seq, r); }, getRecord: async (q: number) => { g(); return s.records.get(q) ?? null; }, last: async () => { g(); return Math.max(0, ...s.records.keys()); },
    beginTick: async (d: LeaseDoc, px: number) => { g(); if (live()) return { got: false, prev: null }; s.lease_ = { v: d, exp: now() + px }; return { got: true, prev: s.tickList[0] ?? null }; }, endTick: async (r: TickRecord) => { g(); s.tickList.unshift(JSON.parse(JSON.stringify(r)) as TickRecord); s.tickList.length = Math.min(s.tickList.length, CRON_TICK_HISTORY); }, ticks: async (n: number) => { g(); return s.tickList.slice(0, n); } });
}
let prodStore: ChainStore | null = null;
const defaultStore = () => (prodStore ??= upstashChainStore());
export type ChainDeps = ProtDeps & { chain?: ChainStore; stream?: Omit<StreamDeps, "onFill" | "onClose">; ledger?: LedgerDeps; brain?: Omit<BrainDeps, "runtime">; settings?: SettingsDeps; entrySettings?: EntrySwitchStore; control?: ControlDeps; events?: EventDeps; market?: MarketDeps; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number; handoffMs?: number | null; setting?: TickSetting };

/** Bir sonraki halkayı TETİKLE: tek kullanımlık jeton depoya, istek kendi dağıtım URL'sine (Binance değil). 202 ≠ dönerse başarısız — çağıran olay yazar (K-4). */
export async function startLink(origin: string, seq: number, deps: ChainDeps = {}): Promise<{ ok: boolean; status: number; detail: string; body: unknown }> {
  const store = deps.chain ?? defaultStore(), token = crypto.randomUUID(), setting = deps.setting ?? readTickSetting();
  if ("error" in setting) return { ok: false, status: 0, detail: `ayar: ${setting.error}`, body: null };
  if (!Number.isFinite(setting.tickMs)) return { ok: false, status: 0, detail: "ayar: tik aralığı izin kopyasından yerleşmedi", body: null };
  try { await store.putToken(seq, token, leaseMsOf(setting.tickMs)); } catch (e) { return { ok: false, status: 0, detail: `jeton yazılamadı: ${(e as { name?: string })?.name ?? "error"}`, body: null }; }
  try { const r = await (deps.fetch ?? fetch)(`${origin}/api/engine/chain?seq=${seq}`, { method: "POST", headers: { [CHAIN_HEADER]: token }, cache: "no-store" }); let body: unknown = null; try { body = await r.json(); } catch { body = null; } return { ok: r.status === 202, status: r.status, detail: r.status === 202 ? "halka başladı" : `http-${r.status}`, body }; }
  catch (e) { return { ok: false, status: 0, detail: `devir isteği düştü: ${(e as { cause?: { code?: string } })?.cause?.code ?? (e as { name?: string })?.name ?? "error"}`, body: null }; }
}
/** Uç tarafı: jeton bir kez tüketilir (GETDEL); yoksa/uyuşmuyorsa halka AÇILMAZ. */
export async function consumeToken(seq: number, token: string | null, deps: ChainDeps = {}): Promise<boolean> {
  if (!Number.isInteger(seq) || seq < 1 || !token) return false;
  try { return (await (deps.chain ?? defaultStore()).takeToken(seq)) === token; } catch { return false; }
}

// ---- Beyin girdisi ve giriş planı (yalnız giriş yolu AÇIKKEN; şalter AYARDIR, okuma PLAN TİKİNDE) ----
type Ticker = { symbol?: string; quoteVolume?: string; count?: number };
const DAY_ALL_CALL = { path: "/api/v3/ticker/24hr", cls: "DISCOVERY", weight: 80 } as const;
/** Adaylar ÖLÇÜLEN 24 saatlik quote hacminden (A-2 ölçüt 4): tavan kadar en likit çift; elle liste YOK. Her aday için maliyet/eşik G13 hesaplayıcısından, mumlar boğazdan. */
async function planEntries(quote: string, source: string, seq: number, exchangeKeyId: number, open: OpenPosition[], deps: ChainDeps): Promise<string> {
  const now = deps.now ?? Date.now, md: MarketDeps = { exchange: deps.exchange, events: deps.events, now };
  // SAĞLIK (G17, M-5) — Beyin'den ve piyasa okumasından ÖNCE: strateji duraklatılmışsa ya da sağlık bilinmiyorsa aday ölçülmez, Beyin çağrılmaz — para ve ağırlık harcanmaz (M-4). Çıkış/koruma bu yola uğramaz (tickOnce'ta onlardan sonra, yalnız giriş dalında).
  // AYAR (Tur 25, madde 1) — TEK OKUMA YOLU, en başta: model/sıklık/aday/mum ayardan gelir. Okunamazsa Beyin ÇAĞRILMAZ ve VARSAYILANA DÜŞÜLMEZ (Ö-2); olayı modül yazar.
  const set = await readBrainRuntime({ ...(deps.settings ?? {}), events: deps.events, now }); if (!set.ok) return `beyin ayarı: ${set.refusal} · ${set.detail}`;
  const rt = set.runtime;
  // SHORT KİPİ (Tur 36, G21 kalemi d) — TEK OKUMA YOLU, Beyin çağrısından ÖNCE ve YALNIZ giriş dalında (çıkış/koruma bu yola uğramaz, M-1/K-1).
  // Okunamazsa KAPALI VARSAYILAN uygulanır (`NONE` = bugünkü davranış, yalnız LONG): kip "serbest" varsayılmaz (Ö-2). Tohum NONE olduğu için bugün ikisi de aynı davranıştır.
  const shortMode = (await readShortMode({ events: deps.events })).mode;
  const health = await screenHealth({ ledger: deps.ledger?.store, gross: deps.gross, limit: deps.ratioLimit, events: deps.events, now }); if (!health.ok) return `sağlık: ${health.refusal} · ${health.verdict.sentence}`;
  const all = await requestWithEvents<Ticker[]>({ ...DAY_ALL_CALL }, deps.exchange);
  if (!all.result.ok) return `adaylar okunamadı: ${all.result.detail}`;
  const cands = (Array.isArray(all.result.data) ? all.result.data : []).filter((t) => typeof t.symbol === "string" && t.symbol.endsWith(quote) && /^[A-Z0-9]{5,20}$/.test(t.symbol) && typeof t.quoteVolume === "string").sort((a, b) => new D(b.quoteVolume as string).cmp(a.quoteVolume as string)).slice(0, rt.candidates).map((t) => ({ symbol: t.symbol as string, vol: t.quoteVolume as string }));
  const sz = await readSizing(cands[0]?.symbol ?? EXCHANGE_INFO.query.symbol, { exchange: deps.exchange, events: deps.events, ring: deps.ring, key: deps.key, now });
  if (!sz.ok) return `boyutlandırma: ${sz.refusal}`; if (!sz.plan.ok) return `boyutlandırma: ${sz.plan.refusal}`;
  const market = [], thresholds = new Map<string, string>();
  for (const c of cands) { const cost = await readRoundTripCost({ symbol: c.symbol, side: "BUY", notional: sz.plan.positionSize }, { exchange: deps.exchange, key: deps.key, ring: deps.ring, now }); if (!cost.ok) continue;
    const kl = await readCandles(c.symbol, CANDLE_INTERVAL, rt.candleLimit, md); if (!kl.ok || kl.candles.length === 0) continue; const thr = new D(cost.totalBp).mul(EDGE_MULTIPLE).toFixed(6); thresholds.set(c.symbol, thr);
    market.push({ symbol: c.symbol, mid: kl.candles[kl.candles.length - 1][4], spreadBp: cost.spreadBp, costBp: cost.totalBp, thresholdBp: thr, dayQuoteVolume: new D(c.vol).toFixed(8), candles: kl.candles }); }
  if (market.length === 0) return "hiçbir aday ölçülemedi; Beyin çağrılmadı";
  const p = periodOf(now()), input = { at: new Date(now()).toISOString(), quoteAsset: quote, market, openPositions: open.map((x) => ({ symbol: x.symbol, side: "LONG" as const, entryPrice: new D(x.entryPrice).toFixed(8), peakPrice: x.peakPrice === null ? null : new D(x.peakPrice).toFixed(8), stopPrice: null, openedAt: new Date(now()).toISOString() })), risk: { maxSinglePositionPct: sz.sharePct, maxTotalExposurePct: null, aggressiveness: null, cooldownSeconds: null }, feeBudget: { usedPct: "0", periodEnd: p.end.toISOString() } };
  // B-3 (Tur 31): Beyin olay yazmaz; ret dalının durma İSTEĞİNİ kas burada olaya çevirir (bildirim + eleme Beyin'in çağrı yığınının dışında, K-8 kasta).
  const b = await callBrain(input, { ...(deps.brain ?? {}), runtime: rt, shortMode, now });
  if (!b.ok) return `beyin: ${b.refusal} · ${b.detail} · olay=${eventNote(await stopEngineFor(b.stop, deps.events))}`;
  const out: string[] = [];
  for (const rule of b.output.rules) {
    const screen = await screenEntry({ symbol: rule.symbol, side: "BUY", notional: sz.plan.positionSize, expectedMoveBp: rule.expectedMoveBp.toFixed(6), capital: sz.freeCapital }, { exchange: deps.exchange, events: deps.events, ring: deps.ring, key: deps.key, now });
    if (!screen.ok) { out.push(`${rule.symbol}:${screen.refusal}`); continue; }
    const plan = await planFromRule(rule, { source, seq, exchangeKeyId, capital: sz.freeCapital, singleCeiling: sz.plan.positionSize, minNotional: sz.minNotional, screen });
    if (!plan.ok) { out.push(`${rule.symbol}:${plan.refusal}:olay=${eventNote(await stopEngineFor(plan.stop, deps.events))}`); continue; }
    const o = await openProtectedPosition(plan.plan, deps); out.push(`${rule.symbol}:${o.ok ? `AÇILDI#${o.positionId}` : o.refusal}`);
  }
  return `beyin ${b.output.rules.length} kural → ${out.join(" ") || "kural yok"}`;
}

// ---- TEK TİK MANTIĞI (Tur 21 madde 2) — her iki tetikleyicinin ortak gövdesi; kapı burada ikinci bir kopyayı KIRMIZI sayar ----
export type TickCtx = { source: string; seq: number; tick: number };
export type TickWork = { permit: Permit; held: boolean; market: MarketRec; positions: number; positionsSource: PositionsSource; copy: PositionsCopyRec | null; weight1m: number | null; protection: ProtectionRec; planning: string | null; tickError?: string };
const memNow = (peak: { rss: number }): MemRec => { const m = process.memoryUsage(); peak.rss = Math.max(peak.rss, m.rss); return { rssMb: +(m.rss / 1048576).toFixed(1), heapMb: +(m.heapUsed / 1048576).toFixed(1), peakRssMb: +(peak.rss / 1048576).toFixed(1) }; };
const sitesSince = (u0: { sites: Record<string, number> }) => Object.fromEntries(Object.entries(upstashStats.sites).map(([k, v]) => [k, v - (u0.sites[k] ?? 0)]).filter(([, v]) => (v as number) > 0));
/** SIRA (madde 3, gevşetme yok): ÇALIŞMA İZNİ önce (K-7; Tur 22: YALNIZ Upstash kopyası, `peekRunPermit`; Neon yalnız kopyanın tazeleme vadesinde) → `hold` (tetikleyiciye özgü kilit; K-6:
 *  halka kirası CAS / cron kirası SET NX) → açık pozisyonlar YALNIZ KOPYADAN (Tur 23 `readPositions`; Neon yalnız tazelemede — izin tazeleme tikiyle hizalı; kopya okunamıyor/yok ⇒ durum BİLİNMİYOR ⇒ iş yok, Ö-2)
 *  → PİYASA (tek çağrı, boğazdan; kesikse MARKET_FEED_DOWN, K-3) → fiyat olayları (G14) → koruma denetimi (G12, açık liste kopyadan) → giriş yalnız akış taze + kopya tutarlı + giriş şalteri AÇIK (ayar, plan tikinde okunur).
 *  İzin yoksa `hold` ÇAĞRILMAZ (kilit alınmaz, iş yapılmaz); kilit alınamazsa iş yapılmaz. Fırlatmaz. */
export async function tickOnce(ctx: TickCtx, hold: () => Promise<boolean>, trailing: Map<number, TrailingState>, setting: TickSetting, deps: ChainDeps): Promise<TickWork> {
  const now = deps.now ?? Date.now; deps = withTickReader(deps);
  const permit = await peekRunPermit(deps.control); if (!permit.run) return { permit, held: false, market: null, positions: 0, positionsSource: "unknown", copy: null, weight1m: null, protection: null, planning: null };
  // TUR 67: aralık İZİNDEN SONRA, KİLİTTEN ÖNCE kopyadan yerleşir; geçersizse kilit ALINMAZ, iş YAPILMAZ (kapalı arıza; olayı tetikleyici yazar).
  const tickError = settleTick(setting, permit); if (tickError !== null) return { permit, held: false, market: null, positions: 0, positionsSource: "unknown", copy: null, weight1m: null, protection: null, planning: `tik aralığı geçersiz: ${tickError}`, tickError };
  const held = await hold(); if (!held) return { permit, held: false, market: null, positions: 0, positionsSource: "unknown", copy: null, weight1m: null, protection: null, planning: null };
  const d: ChainDeps = { ...deps, positions: positionStore(deps) }; // tik deposu: Neon (kalıcı gerçek, değişimde önce) + Upstash kopyası (tik okuması); Neon'a tik yolundan dokunulmaz
  const pos = await readPositions(deps, permit.refresh?.ok === true); // HAM depolarla (Neon + kopya): tazeleme Neon'u okur ve tepeyi Neon'a yazar — sarmalanmış depo verilirse tepe kopyaya döner (Ö-5, shadow ölçümü tik 9)
  if (!pos.ok) return { permit, held: true, market: null, positions: 0, positionsSource: "unknown", copy: { source: "unknown", syncedAt: null, refresh: null, quarantined: null, reason: pos.reason }, weight1m: null, protection: null, planning: `pozisyon durumu BİLİNMİYOR (${pos.reason}: ${pos.detail}): bu tikte iş yapılmadı, "pozisyon yok" varsayılmadı (Ö-2); koruma borsada (K-1)` };
  const open: OpenPosition[] = pos.positions, positionsSource: PositionsSource = pos.source, copy: PositionsCopyRec = { source: pos.source, syncedAt: pos.syncedAt, refresh: pos.refresh, quarantined: pos.quarantined };
  const m: MarketReading = await readMarket(open.map((p) => p.symbol), { exchange: d.exchange, events: d.events, now });
  const market: MarketRec = m.ok ? { ok: true, at: m.snapshot.at, quotes: m.snapshot.quotes } : { ok: false, at: null, refusal: m.refusal }; let weight1m: number | null = null;
  if (m.ok) { weight1m = m.usage.find((u) => /used-weight-1m/.test(u.header))?.reported ?? null;
    for (const p of open) { const q = m.snapshot.quotes.find((x) => x.symbol === p.symbol); if (!q) continue; let s = trailing.get(p.id) ?? null;
      if (!s) { const r = await readTrailingState(p, null, d); if (r.ok) { s = r.state; trailing.set(p.id, s); } } if (!s) continue;
      const r = await onPriceEvent(s, { price: q.mid, seq: ctx.tick, source: ctx.source }, d); if (r.action === "EXITED" || r.action === "ALREADY_EXITED" || r.action === "CLOSED_UNPROTECTED" || r.action === "ENGINE_STOPPED") trailing.delete(p.id); else trailing.set(p.id, r.state); } }
  const audit = open.length ? await auditProtection({ ...d, source: ctx.source }, open) : null; // açık liste KOPYADAN; koruma emri borsada doğrulanır (K-1), Neon okunmaz
  const protection: ProtectionRec = audit === null ? null : { rows: audit.rows.map((a) => ({ positionId: a.positionId, symbol: a.symbol, state: a.state, status: a.status })) }; // G18: panelin okuduğu ÖLÇÜLEN doğrulama
  // GİRİŞ (K-3): yalnız akış TAZE, kopya Neon'la TUTARLI (Tur 23: uyuşmazlıkta giriş yok, çıkış/koruma sürer — M-1) ve giriş yolu AÇIKKEN; Beyin aralığını callBrain (TOO_SOON) tutar. Kapalıyken sebep kaydedilir, para/ağırlık harcanmaz (M-4).
  let planning: string | null;
  if (!m.ok) planning = `akış kesik (${m.refusal}): giriş planlanmadı (K-3)`;
  else if (pos.quarantined !== null) planning = `pozisyon kopyası Neon'la uyuşmadı (${pos.quarantined}): tutarlı tazelemeye kadar giriş planlanmadı; çıkış/koruma sürdü (M-1)`;
  // GİRİŞ ŞALTERİ (Tur 64): karar KODDA DEĞİL AYARDA. OKUMA YALNIZ PLAN TİKİNDE YAPILIR — tik başına Neon 0
  // kazanımı (Tur 22/23) korunur; A-9'un 10 $ tavanı bu yüzden bozulmaz. Şalter kapalıysa ya da ayar okunamıyorsa
  // Beyin ÇAĞRILMAZ (M-4: emre dönüşemeyecek kural için para ve ağırlık harcanmaz) ve sebep AYNEN kaydedilir.
  else if ((ctx.tick - 1) % Math.max(1, Math.floor(PLAN_PERIOD_MS / setting.tickMs)) === 0) {
    const e = await entrySwitch({ store: d.entrySettings });
    planning = e.allowed ? await planEntries("USDT", ctx.source, ctx.seq, 1, open, d) : `${e.refusal} (K-2): Beyin çağrılmadı, giriş planlanmadı — ${e.detail}`;
  }
  else planning = null;
  return { permit, held: true, market, positions: open.length, positionsSource, copy, weight1m, protection, planning };
}

// ---- halka (HIZLI MOD) ----
export const newLinkCtx = (seq: number, origin: string, now: () => number = Date.now): LinkCtx => ({ linkId: crypto.randomUUID(), seq, origin, startedAt: now() });
/** HALKA DÖNGÜSÜ. Fırlatmaz; `end` yalnız üç sebeple: izin yok (K-7), devir tamam (ardıl kirayı aldı), kira kaybı. ZAMANLA SONLANMAZ (A-4 ölçümü: doğal ölüm kaydedilir). Tik gövdesi `tickOnce`. */
export async function runLink(ctx: LinkCtx, deps: ChainDeps = {}): Promise<LinkRecord> {
  const now = deps.now ?? Date.now, store = deps.chain ?? defaultStore(), zz = deps.sleep ?? sleep, handoffMs = deps.handoffMs === undefined ? CHAIN_HANDOFF_MS : deps.handoffMs, u0 = { ...upstashStats, sites: { ...upstashStats.sites } }, peak = { rss: 0 };
  const rec: LinkRecord = { ...ctx, at: now(), ticks: 0, permit: null, market: null, positions: 0, ws: null, wsOpen: null, fills: 0, weight1m: null, upstash: { requests: 0, commands: 0 }, mem: null, handoff: null, end: null, planning: null };
  // Kalp atışı alanları: Upstash sayacı (çağrı yeri dökümüyle) + GERÇEK bellek (Tur 20 madde 4). Kayıt, kira yenilemesiyle AYNI komutta yazılır; `save` yalnız halka sonunda.
  const stamp = () => { rec.at = now(); rec.upstash = { requests: upstashStats.requests - u0.requests, commands: upstashStats.commands - u0.commands, sites: sitesSince(u0) }; rec.mem = memNow(peak); };
  const save = async () => { stamp(); try { await store.putRecord(rec); } catch (e) { rec.planning = `kayıt yazılamadı: ${(e as { name?: string })?.name ?? "error"}`; } };
  let lease: LeaseDoc = { linkId: ctx.linkId, seq: ctx.seq, startedAt: ctx.startedAt, at: now(), handoffDue: null }, stream: UserStream | null = null;
  const end = async (reason: EndReason): Promise<LinkRecord> => { rec.end = { at: now(), reason }; if (stream) { stream.close(`halka ${ctx.seq} sonlandı: ${reason}`); rec.ws = stream.state(); } if (reason !== "HANDED_OFF" && reason !== "LEASE_HELD" && reason !== "NOT_FAST_MODE") { try { await store.release(lease); } catch { rec.planning = "kira bırakılamadı"; } } await save(); return rec; };
  // MOD: halka yalnız HIZLI modda koşar; ayar ucuz ya da geçersizse halka açılmaz (cron tiki iş yapar). Kira ömrü ayardaki tikten türer.
  const setting = deps.setting ?? readTickSetting(); if ("error" in setting || setting.mode !== "FAST") { rec.planning = "error" in setting ? `ayar: ${setting.error}` : "ENGINE_MODE=CHEAP: halka koşmaz, tik cron'dan"; return end("NOT_FAST_MODE"); }
  // TUR 67: hızlı modda aralık halka BAŞINDA kopyadan yerleşir (kira ömrü ve uyku bundan); yeni aralık bir sonraki halkada etkili olur. İzin yoksa halka açılmaz (K-7), aralık geçersizse TICK_MISSED.
  if (setting.fromCopy) { const p0 = await peekRunPermit(withTickReader(deps).control); const e0 = settleTick(setting, p0); if (e0 !== null) { rec.permit = p0; rec.planning = `halka açılmadı: ${e0}`;
    if (p0.run) await stopEngine("TICK_MISSED", `ayar geçersiz, halka ${ctx.seq} açılmadı: ${e0}`, {}, deps.events); return end("NOT_PERMITTED"); } }
  const tickMs = setting.tickMs, leaseMs = leaseMsOf(tickMs);
  // KİRA: ilk halka NX ile alır; ardıl, öncülün kirasını CAS ile devralır (öncül bir sonraki tikte kaybettiğini görür ve durur). Yabancı kira → bu halka açılmaz.
  let got = false; try { got = await store.acquire(lease, leaseMs); if (!got) { const cur = await store.lease(); if (cur && cur.seq === ctx.seq - 1) got = await store.renew(cur, lease, leaseMs); } } catch { got = false; }
  if (!got) return end("LEASE_HELD");
  const ledgerStore = deps.ledger?.store ?? prismaLedgerStore();
  const onFill = async (f: Fill) => { rec.fills++; let e: Awaited<ReturnType<typeof ledgerStore.findEntry>> = null; try { e = await ledgerStore.findEntry(f.clientId); } catch { e = null; }
    if (e?.state === "RESERVED" && f.commissionAsset) await settleFee({ ref: f.clientId, fees: [{ asset: f.commissionAsset, amount: f.commission }] }, { ...(deps.ledger ?? {}), events: deps.events, now }); };
  const onClose = async (s: StreamState) => { rec.ws = s; if (s.closedBy === "KARŞI TARAF/AĞ") await stopEngine("USER_STREAM_LOST", `halka ${ctx.seq} · code=${s.code ?? "?"} reason=${JSON.stringify(s.reason ?? "")} clean=${s.wasClean} ömür=${s.lifetimeMs ?? "?"} ms · olay=${s.events} dolum=${s.fills} · REST yoklamasına düşülmedi`, {}, deps.events); };
  const ws = await openUserStream({ ...(deps.stream ?? {}), key: deps.stream?.key ?? deps.key, ring: deps.stream?.ring ?? deps.ring, events: deps.events, clock: deps.stream?.clock ?? { exchange: deps.exchange, events: deps.events }, now, onFill, onClose });
  rec.wsOpen = ws.ok ? { ok: true, detail: `logon ${ws.logonMs} ms · subscribe ${ws.subscribeMs} ms · sayaç ${ws.usageCount ?? "hizalanmadı"}` } : { ok: false, detail: `${ws.refusal}: ${ws.detail}` };
  if (ws.ok) stream = ws.stream;
  const trailing = new Map<number, TrailingState>();
  for (;;) {
    rec.ticks++; const t = now();
    // DEVİR ANI: öncül ardılı ÇAĞIRMAZ (508, yukarıda); kiraya `handoffDue` yazar, nöbetçi açar. Kira yenileme CAS'lı: ardıl kirayı aldıysa yenileme düşer → HANDED_OFF.
    const due = handoffMs !== null && lease.handoffDue == null && t - ctx.startedAt >= handoffMs; let kept = false;
    const hold = async () => { try { const next = { ...lease, at: t, handoffDue: due ? ctx.seq + 1 : lease.handoffDue ?? null }; stamp(); kept = await store.renew(lease, next, leaseMs, rec); if (kept) lease = next; } catch { kept = false; } return kept; };
    const w = await tickOnce({ source: `chain:${ctx.linkId}`, seq: ctx.seq, tick: rec.ticks }, hold, trailing, setting, deps); rec.permit = w.permit;
    if (!w.permit.run) return end("NOT_PERMITTED");
    if (w.tickError !== undefined) { await stopEngine("TICK_MISSED", `ayar geçersiz, halka ${ctx.seq} durdu: ${w.tickError}`, {}, deps.events); return end("NOT_PERMITTED"); }
    if (kept && due) rec.handoff = { at: t, seq: ctx.seq + 1, detail: "devir istendi (kira.handoffDue); ardılı nöbetçi açar — halkalar birbirini çağırmaz (508 ölçümü)" };
    if (!kept) { let cur: LeaseDoc | null = null; try { cur = await store.lease(); } catch { cur = null; } return end(cur && cur.seq > ctx.seq ? "HANDED_OFF" : "LEASE_LOST"); }
    rec.market = w.market ?? rec.market; rec.positions = w.positions; rec.weight1m = w.weight1m ?? rec.weight1m; rec.planning = w.planning ?? rec.planning;
    if (stream) rec.ws = stream.state();
    await zz(tickMs); // kayıt bir sonraki tikin kira yenilemesiyle yazılır (aynı komut); halka sonu `end` → `save`
  }
}
/** NÖBETÇİ (cron + yeniden başlatma, HIZLI MOD) — DIŞ TETİKLEYİCİ. İzin RUNNING iken: (a) kira `handoffDue` taşıyorsa ardılı açar (DEVİR; öncül kirayı kaybedince durur); (b) kira yoksa halka açar —
 *  son halka izinsizlikle (STOP) bitmiş ya da hiç halka yoksa BAŞLANGIÇ, aksi hâlde (kayıtsız ölüm = platform, ardıl ölmüş, kira kaybı) zincir KOPMUŞTUR → CHAIN_BREAK (K-4).
 *  Devir isteği düşerse de CHAIN_BREAK (öncül yaşadıkça bir sonraki dakikada yeniden denenir). İzin yoksa hiçbir şey açılmaz (K-7). */
export async function ensureChain(origin: string, deps: ChainDeps = {}): Promise<{ permit: Permit; lease: LeaseDoc | null; action: "NONE" | "STARTED" | "RELAYED" | "RELAY_FAILED" | "RELINKED" | "RELINK_FAILED" | "SETTING_INVALID"; event: EmitResult | null; started?: Awaited<ReturnType<typeof startLink>> }> {
  // İzin: önce Upstash kopyası (peek); RUNNING değilse Neon'a dokunulmaz ve kira da okunmaz (Tur 20: durmuş motorda dakikalık cron Neon'u 7/24 uyandırıyordu). K-7 aynen: izin yoksa hiçbir şey açılmaz.
  deps = withTickReader(deps); const store = deps.chain ?? defaultStore(), permit = await peekRunPermit(deps.control);
  if (!permit.run) return { permit, lease: null, action: "NONE", event: null };
  // TUR 67: açılacak halkanın aralığı bu iznin kopyasından yerleşir (jeton ömrü ondan); geçersizse halka açılmaz, TICK_MISSED (sessiz durma yok, K-8).
  if (!deps.setting) { const s = readTickSetting(), e0 = "error" in s ? s.error : settleTick(s, permit); if (e0 !== null) return { permit, lease: null, action: "SETTING_INVALID", event: await stopEngine("TICK_MISSED", `ayar geçersiz, halka açılmadı: ${e0}`, {}, deps.events) }; deps = { ...deps, setting: s as TickSetting }; }
  let lease: LeaseDoc | null = null; try { lease = await store.lease(); } catch { lease = null; }
  if (lease !== null) {
    if (lease.handoffDue == null || lease.handoffDue <= lease.seq) return { permit, lease, action: "NONE", event: null };
    const started = await startLink(origin, lease.handoffDue, deps);
    const event = started.ok ? null : await stopEngine("CHAIN_BREAK", `nöbetçi: halka ${lease.seq} → ${lease.handoffDue} devir isteği başarısız: ${started.detail}; öncül yaşadıkça bir sonraki dakikada yeniden denenir`, {}, deps.events);
    return { permit, lease, action: started.ok ? "RELAYED" : "RELAY_FAILED", event, started };
  }
  let last = 0, lastRec: LinkRecord | null = null; try { last = await store.last(); lastRec = last > 0 ? await store.getRecord(last) : null; } catch { last = 0; lastRec = null; }
  const broke = lastRec !== null && lastRec.end?.reason !== "NOT_PERMITTED", started = await startLink(origin, last + 1, deps);
  const event = broke ? await stopEngine("CHAIN_BREAK", `nöbetçi: izin RUNNING (kalan ${permit.msLeft} ms) ama kira yok · son halka ${last} son kalp atışı ${new Date(lastRec!.at).toISOString()} tik=${lastRec!.ticks} son=${lastRec!.end?.reason ?? "KAYITSIZ ÖLÜM (platform)"} · yeni halka ${last + 1}: ${started.detail}`, {}, deps.events) : null;
  return { permit, lease, action: started.ok ? (broke ? "RELINKED" : "STARTED") : "RELINK_FAILED", event, started };
}

// ---- CRON TİKİ (UCUZ MOD, Tur 21) ----
export type CronTickOutcome = { mode: "CHEAP"; action: "NONE" | "SETTING_INVALID" | "HELD" | "TICKED"; permit: Permit; record: TickRecord | null; late: TickRecord["late"]; event?: EmitResult };
/** Cron her dönemde çağırır. İzin yoksa (K-7) hiçbir kilit alınmaz, hiçbir kayıt yazılmaz (durmuş motorun bedeli 1 GET). Kira SET NX, PX = aralık − pay: aralık içindeki ikinci tetikleme (çakışma ya da
 *  daha sık cron) `HELD` — TEK icra (K-6); hızlı moddan kalan canlı halka kirası da tiki teker. Gecikme tespiti (K-8): önceki kayıt izinden (RESUME anından) sonraysa ve boşluk > aralık + cron dönemi ⇒ TICK_MISSED. */
export async function cronTick(setting: TickSetting, deps: ChainDeps = {}): Promise<CronTickOutcome> {
  const now = deps.now ?? Date.now, store = deps.chain ?? defaultStore(), t0 = now(), u0 = { ...upstashStats, sites: { ...upstashStats.sites } }, peak = { rss: 0 }, id = crypto.randomUUID();
  let prev: TickRecord | null = null, permitMs = 0; const tp = now();
  // önceki tik kaydı kira EVAL'iyle birlikte gelir (ek komut yok): gecikme tespiti için (Tur 23: pozisyon ipucu kalktı — açık liste kopyadan)
  const hold = async () => { permitMs = now() - tp; try { const b = await store.beginTick({ linkId: `cron:${id}`, seq: 0, startedAt: t0, at: t0, handoffDue: null }, cronLeaseMsOf(setting.tickMs)); prev = b.prev; return b.got; } catch { return false; } };
  const w = await tickOnce({ source: `cron:${id}`, seq: 0, tick: 1 }, hold, new Map<number, TrailingState>(), setting, deps);
  if (!w.permit.run) return { mode: "CHEAP", action: "NONE", permit: w.permit, record: null, late: null };
  if (w.tickError !== undefined) return { mode: "CHEAP", action: "SETTING_INVALID", permit: w.permit, record: null, late: null, event: await stopEngine("TICK_MISSED", `ayar geçersiz, tik koşmadı: ${w.tickError}`, {}, deps.events) };
  if (!w.held) return { mode: "CHEAP", action: "HELD", permit: w.permit, record: null, late: null };
  const p = prev as TickRecord | null, gap = p ? t0 - p.at : null, since = Date.parse(w.permit.since);
  const late = p !== null && gap !== null && p.at > since && gap > setting.tickMs + CRON_PERIOD_MS ? { gapMs: gap, event: await stopEngine("TICK_MISSED", `cron tiki: önceki tik ${new Date(p.at).toISOString()}, boşluk ${gap} ms > aralık ${setting.tickMs} + cron dönemi ${CRON_PERIOD_MS} ms; koruma borsada (K-1), atlanan tikte çıkış/giriş değerlendirilmedi`, {}, deps.events) } : null;
  const rec: TickRecord = { mode: "CHEAP", id, at: now(), startedAt: t0, durationMs: now() - t0, permitMs, tickMs: setting.tickMs, permit: w.permit, market: w.market, positions: w.positions, positionsSource: w.positionsSource, copy: w.copy, weight1m: w.weight1m, protection: w.protection, planning: w.planning, upstash: { requests: upstashStats.requests - u0.requests, commands: upstashStats.commands - u0.commands, sites: sitesSince(u0) }, mem: memNow(peak), late };
  try { await store.endTick(rec); } catch { rec.planning = `${rec.planning ?? ""} · kayıt yazılamadı`.trim(); }
  return { mode: "CHEAP", action: "TICKED", permit: w.permit, record: rec, late };
}
/** CRON GİRİŞİ — TEK AYARLA SEÇİM: ucuz modda tik, hızlı modda nöbetçi. Ayar geçersizse KAPALI ARIZA (hiçbir şey koşmaz) ve TICK_MISSED olayı (K-8: sessiz durma yok). Yeniden başlatma ucu da bunu çağırır. */
export async function engineCron(origin: string, deps: ChainDeps = {}): Promise<{ setting: TickSetting | { error: string }; outcome: CronTickOutcome | Awaited<ReturnType<typeof ensureChain>> | { action: "SETTING_INVALID"; event: EmitResult } }> {
  const setting = deps.setting ?? readTickSetting();
  if ("error" in setting) return { setting, outcome: { action: "SETTING_INVALID", event: await stopEngine("TICK_MISSED", `ayar geçersiz, tik koşmadı: ${setting.error}`, {}, deps.events) } };
  return { setting, outcome: setting.mode === "CHEAP" ? await cronTick(setting, deps) : await ensureChain(origin, deps) };
}
