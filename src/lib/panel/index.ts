// PANEL (G18 · Tur 26 · P-2, U-3, U-5, M-5, M-1, K-1, K-7, K-8, Ö-1, Ö-2, A-9). Kapı: scripts/gate-ui.mjs · kanarya: scripts/canary-ui.mts. YALNIZ OKUMA: bu modül hiçbir depoya yazmaz.
// Ö-2 — OKUNAMAYAN DEĞER "BİLİNMİYOR" DER: boş, sıfır ya da "sorun yok" göstermek yasaktır. Her okuma `Reading`'dir: ya `known` + değer + cümle, ya `bilinmiyor` + NEDEN + "sorun yok varsayılmadı".
// U-3 — HAM KOD EKRANA ÇIKMAZ: sebep SİCİLDEN gelir (engine_events satırının yazdığı kod → STOP_REASONS etiketi → PANEL_TEXT'in üç cümlesi: ne oldu · paraya etkisi · ne yapılacak). Yüzey sebep UYDURMAZ.
// P-2 — kâr/zarar taşıyan her satır BRÜT · KOMİSYON · NET üçünü ayrı gösterir; komisyon yalnız `fee_entries.actual` (borsadan okunan gerçek, quote'a çevrilmiş), tahmin değil.
// VERİ KAYNAĞI (rapor madde 1): motor durumu + son tik → YALNIZ Upstash (izin kopyası GET + son tik kaydı LINDEX; tazeleme YOK, yazma YOK ⇒ tik yolunun kopyaları bu yüzden ne uzar ne kısalır).
//   Pozisyon detayı, komisyon kalemi, kapanış sebebi, sağlık → Neon: kopya bu alanları TAŞIMAZ (kopyada yalnız tikin ihtiyacı var) ve panel sağlık için Neon'u zaten uyandırır ⇒ pozisyonu da
//   aynı uyanışta okumak açılış başına Neon UYANIŞINI artırmaz. Ölçüm ve günlük açılış varsayımı raporda AÇIK yazılıdır.
import { type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/db/client";
import { CHAIN_NS, CRON_PERIOD_MS, chainKeys, type TickRecord } from "@/lib/chain";
import { type ControlDoc, type PermitDenial, upstashFlagStore } from "@/lib/engine-control";
import { STOP_REASONS, type StopReasonCode } from "@/lib/events/stop-reasons";
import { readHealth, type HealthDeps, type HealthVerdict } from "@/lib/health";
import { giveBackLevel } from "@/lib/protection/trailing";
import { pickEnv } from "@/lib/env";
import { redisPipeline } from "@/lib/upstash";

export type Level = "OK" | "INFO" | "WARN" | "ALARM";
const RANK: Record<Level, number> = { ALARM: 3, WARN: 2, INFO: 1, OK: 0 };
/** Bir hâlin ekran metni (U-3): ne oldu · paraya etkisi ne · ne yapılacak. Üçü de zorunlu; ham kod ya da "HATA" sözcüğü yoktur. */
export type PanelText = { level: Level; title: string; what: string; money: string; next: string };
export type Card = { level: Level; title: string; lines: string[] };
const say = (t: PanelText): string[] => [t.what, t.money, t.next];
/** Ö-2: okunamayan değerin TEK yazılış biçimi. "Sorun yok" ya da 0 ASLA yazılmaz. */
export const unknownText = (what: string, why: string): string => `${what} BİLİNMİYOR — ${why}. Sorun olmadığı VARSAYILMADI; bu değer okunana kadar buraya rakam yazılmaz.`;

/** İZİN KOPYASININ DÖRT REDDİ (engine-control'ün kendi sözcükleri; yüzey yeni sebep icat etmez). Record TAM: yeni bir reddediş eklenirse derleyici burayı da zorlar. */
export const PERMIT_TEXT: Record<PermitDenial, PanelText> = {
  UNREADABLE: { level: "ALARM", title: "Motorun çalışma izni okunamıyor", what: "Motorun çalışma iznini tutan hızlı depo (Upstash) bu açılışta okunamadı; motorun çalışıp çalışmadığı bilinmiyor.", money: "Yeni pozisyon açılmıyor. Açık pozisyonların koruma emirleri BORSADA duruyor ve altyapıdan bağımsız tetiklenir; paran korumasız değil.", next: "Depo döndüğünde motor kaldığı yerden sürer. Dönmezse izin en geç süresi dolunca söner ve motor kendiliğinden durur; yeniden başlatmak parolanı ve tek kullanımlık kodunu ister." },
  NO_PERMIT: { level: "WARN", title: "Motorun çalışma izni yok", what: "Çalışma izni kopyası yok: ya hiç verilmedi ya da süresi dolduğu için kendiliğinden söndü.", money: "Motor çalışmıyor: yeni pozisyon açılmıyor ve fiyat hareketleri değerlendirilmiyor. Borsadaki koruma emirleri yerinde, paranın aşağı yönlü sigortası çalışıyor.", next: "Motoru yeniden başlatmak gerekiyor; başlatma parolanı ve tek kullanımlık kodunu ister." },
  STOPPED: { level: "WARN", title: "Motor durduruldu", what: "Çalışma izni DURDURULDU olarak işaretli: durdurma düğmesi kullanılmış ya da bir koruma kuralı motoru durdurmuş.", money: "Yeni pozisyon açılmıyor. Açık pozisyonların borsadaki koruma emirleri duruyor; kayıp sınırın değişmedi.", next: "Aşağıdaki son sicil kaydı durdurmanın sebebini söyler. Sebep giderildikten sonra yeniden başlatma parolanı ve tek kullanımlık kodunu ister." },
  PERMIT_EXPIRED: { level: "WARN", title: "Motorun çalışma izni süresi doldu", what: "Çalışma izni vardı ama süresi doldu ve yenilenmedi; motor bu yüzden kendini durdurdu.", money: "Yeni pozisyon açılmıyor. Borsadaki koruma emirleri duruyor; açık pozisyonların aşağı yönlü sigortası çalışmaya devam ediyor.", next: "İzin, kalıcı kayıtla buluşamadığında bilerek söner — bu bir arıza değil, sessiz çalışmaya karşı kurulmuş bir emniyet. Yeniden başlatma parolanı ve tek kullanımlık kodunu ister." },
};
/** SİCİLDEKİ SEBEBİN EKRAN KARŞILIĞI. Anahtarlar STOP_REASONS sicilinden gelir (derleyici zorlar): yüzey sebep uyduramaz, yalnız sicildeki kodu insan cümlesine çevirir. */
export const PANEL_TEXT = {
  STOP_BUTTON: { level: "WARN", title: "Motoru sen durdurdun", what: "Durdurma düğmesi kullanıldı ve motor durdu.", money: "Yeni pozisyon açılmıyor. Açık pozisyonlar ve borsadaki koruma emirleri olduğu gibi duruyor; komisyon da harcanmıyor.", next: "Hazır olduğunda yeniden başlat; başlatma parolanı ve tek kullanımlık kodunu ister." },
  POSITIONS_UNKNOWN: { level: "ALARM", title: "Açık pozisyonların durumu okunamıyor", what: "Motorun her tikte okuduğu pozisyon özeti ne hızlı depodan ne de kalıcı kayıttan okunabildi.", money: "Motor bu durumda hiçbir iş yapmıyor: yeni pozisyon açmıyor, çıkış değerlendirmiyor. \"Pozisyon yok\" VARSAYILMADI. Borsadaki koruma emirleri duruyor.", next: "Depolardan biri döndüğünde özet yeniden kurulur ve motor kaldığı yerden sürer; dönene kadar giriş kapalı kalır." },
  POSITION_COPY_MISMATCH: { level: "WARN", title: "Pozisyon özeti kalıcı kayıtla uyuşmadı", what: "Hızlı depodaki pozisyon özeti ile kalıcı kayıt farklı çıktı; kalıcı kayıt doğru kabul edildi ve özet yeniden yazıldı.", money: "Tutarlı bir okuma yapılana kadar yeni pozisyon açılmıyor. Çıkış ve borsadaki koruma çalışmaya devam ediyor.", next: "Bir sonraki karşılaştırma tutarlı çıkarsa giriş kendiliğinden yeniden açılır." },
  MARKET_FEED_DOWN: { level: "WARN", title: "Piyasa fiyat akışı kesik", what: "Borsanın fiyat akışı son tikte okunamadı.", money: "Fiyat bilinmeden yeni pozisyon açılmıyor. Borsadaki koruma emirleri bizim akışımıza bağlı değil; tetiklenmeleri gerekiyorsa tetiklenirler.", next: "Akış döndüğünde fiyat değerlendirmesi kaldığı yerden sürer." },
  BRAIN_SETTINGS_UNREADABLE: { level: "WARN", title: "Karar motorunun ayarları okunamıyor", what: "Hangi modelin, hangi sıklıkta ve ne kadar veriyle çalışacağını söyleyen ayar okunamadı.", money: "Karar motoru çağrılmadı: bunun için para harcanmadı ve yeni pozisyon açılmadı. Varsayılan bir ayara DÜŞÜLMEDİ, çünkü maliyeti bilinmeyen bir ayarla para harcanmaz.", next: "Ayar okunur okunmaz karar motoru kendiliğinden yeniden çalışır; çıkış ve koruma bu arada hiç etkilenmedi." },
  BRAIN_SPEND_CEILING: { level: "INFO", title: "Karar motorunun harcama tavanı doldu", what: "Karar motoru bu dönem için konan harcama tavanını ya da bugünkü çağrı tavanını doldurdu.", money: "Bu bir arıza değil, bilerek konmuş bir tavan: tavanın üstünde tek kuruş harcanmıyor. Yeni pozisyon açılmıyor; ÇIKIŞ ve borsadaki koruma emirleri çalışmaya devam ediyor.", next: "Tavan bir sonraki dönemde kendiliğinden sıfırlanır. Daha erken çalışmasını istiyorsan aşağıdaki ayar bölümünden daha ucuz bir model ya da daha seyrek bir sıklık seçebilirsin." },
  FEE_BUDGET_EXHAUSTED: { level: "INFO", title: "Dönemin komisyon bütçesi doldu", what: "Bu dönem ödenebilecek toplam komisyon için konan bütçe doldu.", money: "Yeni pozisyon açılmıyor; böylece komisyon erimesi duruyor. ÇIKIŞ ve borsadaki koruma emirleri bütçeye hiç bakmaz, çalışmaya devam eder.", next: "Bütçe bir sonraki dönemde yeniden ölçülen sermayeyle açılır." },
  HEALTH_PAUSED: { level: "WARN", title: "Sağlık kapısı kapandı: komisyon kârı yiyor", what: "Ödenen komisyonun brüt kâra oranı, pozisyon açarken kullanılan giriş ölçütünün altına düştü: strateji kendi kurduğu bahsi tutturamıyor.", money: "Strateji kendini duraklattı: yeni pozisyon açılmıyor. ÇIKIŞ ve borsadaki koruma emirleri sürüyor, açık pozisyonların yönetimi değişmedi.", next: "Oran eşiğin altına dönerse duraklama kendiliğinden kalkar. Aşağıdaki sağlık satırı oranı, eşiği ve kalan payı rakamla gösterir." },
  HEALTH_UNKNOWN: { level: "ALARM", title: "Sağlık göstergesi ölçülemiyor", what: "Komisyon defteri ya da kapanan pozisyon kayıtları okunamadığı için komisyon/kâr oranı hesaplanamadı.", money: "\"Sağlıklı\" VARSAYILMADI: yeni pozisyon açılmıyor. Çıkış ve borsadaki koruma sürer.", next: "Kayıtlar okunur okunmaz hüküm yeniden verilir ve giriş kendiliğinden açılır." },
  PROTECTION_LOST: { level: "ALARM", title: "KORUMA EMRİ BORSADA YOK", what: "Açık bir pozisyonun borsadaki koruma (zarar durdur) emri bulunamadı — iptal edilmiş ya da düşmüş.", money: "Bu, paranın aşağı yönlü sigortasının kalkması demektir ve panelin en ağır uyarısıdır. Motor bu durumda pozisyonu DERHAL kapatır; kapatamazsa kendini durdurur ve seni bekler.", next: "Aşağıdaki pozisyon satırına bak: kapatıldıysa iş bitti. Kapatılamadıysa pozisyonu borsadan elle kapatman gerekir." },
  PROTECTION_UNVERIFIABLE: { level: "ALARM", title: "Koruma emri borsada doğrulanamadı", what: "Koruma emrinin borsada durup durmadığı sorulamadı; sorgu düştü.", money: "Emir büyük olasılıkla yerinde ama DOĞRULANMADI, bu yüzden korumasız sayıldı: motor durdu ve yeni pozisyon açmıyor.", next: "Borsa sorgusu döndüğünde durum yeniden ölçülür. Beklemek istemiyorsan pozisyonun koruma emrini borsanın kendi ekranından doğrulayabilirsin." },
  TICK_MISSED: { level: "WARN", title: "Bir ya da daha çok tik atlandı", what: "Motorun düzenli turu beklenen aralıkta koşmadı; arada bir boşluk var.", money: "Atlanan turda çıkış ve giriş değerlendirilmedi. Borsadaki koruma emirleri bu boşlukta da yerindeydi ve tetiklenmeleri gerekiyorsa tetiklendiler.", next: "Tur kendiliğinden yeniden başlar. Boşluk büyüdükçe aşağıdaki gecikme satırı bunu rakamla gösterir." },
  CHAIN_BREAK: { level: "WARN", title: "Motorun sürekliliği koptu", what: "Motorun turunu devralması gereken halka devralmadı; zincir koptu ve nöbetçi yeniden kurdu.", money: "Kopuk geçen sürede yeni pozisyon açılmadı ve çıkış değerlendirilmedi; borsadaki koruma emirleri yerindeydi.", next: "Nöbetçi her dakika yeniden dener; tur yeniden başladığında bu uyarı kendiliğinden kalkar." },
} as const satisfies Partial<Record<StopReasonCode, PanelText>>;
/** Madde 3'ün sekiz hâli EKRAN METNİ OLMADAN kalamaz: eksikse `never`'a `true` atanamaz ve derleme düşer. */
type MissingText = Exclude<"POSITIONS_UNKNOWN" | "MARKET_FEED_DOWN" | "BRAIN_SETTINGS_UNREADABLE" | "BRAIN_SPEND_CEILING" | "HEALTH_PAUSED" | "PROTECTION_LOST" | "PROTECTION_UNVERIFIABLE" | "STOP_BUTTON", keyof typeof PANEL_TEXT>;
export const EVERY_REQUIRED_STATE_HAS_TEXT: [MissingText] extends [never] ? true : never = true;
/** Sicildeki koddan ekran metni. Kod sicilde yoksa metin UYDURULMAZ: sicilin kendi etiketi kullanılır; o da yoksa "bilinmiyor". */
export function textOf(code: string | null): PanelText | null {
  if (code === null) return null;
  const t = (PANEL_TEXT as Partial<Record<string, PanelText>>)[code]; if (t) return t;
  const m = (STOP_REASONS as Record<string, { label: string } | undefined>)[code];
  return m ? { level: "WARN", title: m.label, what: `Sicile şu kayıt düştü: ${m.label}.`, money: "Bu kaydın para etkisi bu yüzeyde ayrıca yazılmadı; yeni pozisyon açılmadığını ve borsadaki koruma emirlerinin yerinde olduğunu varsayma, aşağıdaki satırlara bak.", next: "Bu sebep için ekran metni henüz yazılmadı; sicil kaydı yukarıdaki etiketle duruyor." } : null;
}
/** Sicil satırının yazdığı kod (`KOD · etiket · ayrıntı`). Ayrıntı EKRANA ÇIKMAZ (U-3: ham metin/kod göstermeyiz), yalnız kod sicilden okunur. */
export const codeOf = (reason: string): string | null => { const c = reason.split(" · ")[0]?.trim() ?? ""; return /^[A-Z][A-Z0-9_]{2,}$/.test(c) ? c : null; };

// ---- OKUYUCULAR (hepsi SALT OKUMA; enjeksiyon yalnız kapı/kanarya için, S-9) ----
export type StopRow = { id: number; reason: string; at: Date };
export type PositionRow = { id: number; symbol: string; status: string; entry: string; qty: string; peak: string | null; pid: string | null; openedAt: Date; closedAt: Date | null; realized: string; fees: string; lastReason: string | null };
export type PanelDeps = { permit?: () => Promise<ControlDoc | null>; tick?: () => Promise<TickRecord | null>; rows?: () => Promise<PositionRow[]>; stop?: () => Promise<StopRow | null>; health?: () => Promise<HealthVerdict>; healthDeps?: HealthDeps; now?: () => number };
/** İzin kopyası: TEK `GET`. Tazeleme YOK (tazeleme Neon'u uyandırır ve tikin işidir), yazma YOK ⇒ kopyanın ömrü bu açılıştan etkilenmez. */
export const upstashPermitRead = () => upstashFlagStore().read();
/** Son tik kaydı: TEK `LINDEX` (liste başı). Tik listesine yazılmaz. */
export const upstashLastTick = async (): Promise<TickRecord | null> => { const e = pickEnv("UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"); // DAR sözleşme (K-7 dersi): ilgisiz bir değişkenin eksikliği paneli kör etmesin
  const v = (await redisPipeline([["LINDEX", chainKeys(CHAIN_NS).ticks, 0]], { url: e.UPSTASH_REDIS_REST_URL, token: e.UPSTASH_REDIS_REST_TOKEN }))[0]; return typeof v === "string" && v ? (JSON.parse(v) as TickRecord) : null; };
/** Pozisyon detayı — TEK Neon sorgusu: açık + kapanmış satırlar, pozisyon başına GERÇEK dolum toplamı ve GERÇEK komisyon (fee_entries.actual), son sicil sebebi. Tahmin yok (Ö-1, P-2). */
export const prismaPositionRows = (client?: PrismaClient) => async (): Promise<PositionRow[]> => (client ?? getDb()).$queryRaw<PositionRow[]>`
  SELECT p.id, p.symbol, p.status::text AS status, p.entry_price::text AS entry, p.quantity::text AS qty, p.peak_price::text AS peak, p.protection_order_id AS pid, p.opened_at AS "openedAt", p.closed_at AS "closedAt",
    (SELECT COALESCE(SUM(CASE WHEN o.side = 'SELL' THEN 1 ELSE -1 END * COALESCE((o.raw_response->>'cummulativeQuoteQty')::numeric, o.quantity * o.price, 0)), 0) FROM orders o WHERE o.position_id = p.id AND o.status <> 'TEST')::text AS realized,
    (SELECT COALESCE(SUM(COALESCE(fe.actual, 0)), 0) FROM orders o2 JOIN fee_entries fe ON fe.ref = o2.client_order_id WHERE o2.position_id = p.id AND o2.status <> 'TEST')::text AS fees,
    (SELECT ev.reason FROM engine_events ev WHERE ev.position_id = p.id ORDER BY ev.id DESC LIMIT 1) AS "lastReason"
  FROM positions p WHERE p.status::text = 'OPEN' OR p.closed_at IS NOT NULL ORDER BY (p.status::text = 'OPEN') DESC, COALESCE(p.closed_at, p.opened_at) DESC LIMIT 20`;
/** Son DURMA/duraklama kaydı — sebebin TEK kaynağı sicildir (K-8). */
export const prismaLastStop = (client?: PrismaClient) => async (): Promise<StopRow | null> => ((await (client ?? getDb()).$queryRaw<StopRow[]>`
  SELECT id, reason, at FROM engine_events WHERE kind::text IN ('STOPPED','HEALTH_PAUSED','BUDGET_EXHAUSTED','PROTECTION_FAILED','CHAIN_BREAK','REGION_BLOCKED','IP_BANNED','KEY_INVALID','RESUMED') ORDER BY id DESC LIMIT 1`)[0] ?? null);

// ---- CÜMLE KURUCULAR ----
const n2 = (v: string | number) => Number(v).toFixed(2), n8 = (v: string | number) => Number(v).toFixed(8);
/** Süre insan birimine çevrilir ve İŞARETSİZDİR: yön cümleyi kuran taraftadır (`when` = geçmiş, `till` = gelecek). Negatif sayı ekrana çıkamaz (U-3). */
const dk = (ms: number) => { const a = Math.abs(ms); return a < 90_000 ? `${Math.round(a / 1000)} saniye` : a < 5_400_000 ? `${Math.round(a / 60_000)} dakika` : `${(a / 3_600_000).toFixed(1)} saat`; };
const stamp = (t: number | string | Date) => `${new Date(t).toISOString().replace("T", " ").slice(0, 19)} UTC`;
const when = (t: number | string | Date, now: number) => `${stamp(t)} (${dk(now - new Date(t).getTime())} önce)`;
/** Gelecekteki an. Geçmişte kalmışsa "önce" der — "eksi 600 saniye sonra" gibi bir cümle kurulamaz. */
const till = (t: number, now: number) => (t >= now ? `${stamp(t)} (${dk(t - now)} sonra)` : `${stamp(t)} — bu an GEÇTİ (${dk(now - t)} önce)`);
/** P-2: brüt · komisyon · net AYRI AYRI. Brüt ölçülemiyorsa net de yazılmaz (Ö-2) ama ödenen komisyon yine ayrı kalem olarak görünür. */
export function pnlLine(gross: string | null, fees: string, what: string): string {
  const f = n8(fees);
  if (gross === null) return `${what}: ${unknownText("brüt kâr/zarar", "dolum ya da fiyat kaydı okunamadı")} Bu pozisyon için bugüne dek ödenen gerçek komisyon ${f} USDT; net rakam brüt bilinmeden yazılamaz.`;
  const g = Number(gross), net = g - Number(fees);
  const oran = g > 0 ? `Komisyon brüt kârın %${((Number(fees) / g) * 100).toFixed(1)}'ini aldı.` : g === 0 ? "Brüt kâr sıfır: ödenen komisyonun tamamı net zarardır." : "Pozisyon brütte zararda; ödenen komisyon bu zararın üstüne biniyor.";
  return `${what}: brüt ${n8(gross)} USDT, ödenen gerçek komisyon ${f} USDT, NET ${n8(net)} USDT. ${oran}`;
}

/** U-3 — VERİ METNE GÖMÜLMEZ: ekranda cümle, kayıtta ALAN. Okunamayan alan `null`'dır (0 değil, Ö-2); brüt/komisyon/net ayrı alanlardır (P-2). */
export type PositionFacts = { entryPrice: string; quantity: string; notionalUsdt: string; peakPrice: string | null; giveBackLevel: string | null; protectionOrderId: string | null; protectionState: string | null; protectionCheckedAt: string | null; markPrice: string | null; grossUsdt: string | null; feeUsdt: string; netUsdt: string | null };
export type PositionView = { id: number; symbol: string; open: boolean; level: Level; alarm: "PROTECTION_LOST" | "PROTECTION_UNVERIFIABLE" | null; title: string; lines: string[]; facts: PositionFacts };
/** Bir pozisyonun satırları. `quote`: son tikte ÖLÇÜLEN orta fiyat (yoksa açık pozisyonun anlık kâr/zararı BİLİNMİYOR olur, 0 yazılmaz). `audit`: son tikin borsa doğrulaması. */
export function viewPosition(r: PositionRow, quote: { mid: string; at: number } | null, audit: { state: string; status: string | null; at: number } | null, now: number): PositionView {
  const open = r.status === "OPEN", lines: string[] = [], qty = Number(r.qty), entry = Number(r.entry);
  let level: Level = open ? "OK" : "INFO", alarm: "PROTECTION_LOST" | "PROTECTION_UNVERIFIABLE" | null = null;
  lines.push(`${r.symbol} · ${n8(r.qty)} adet, giriş fiyatı ${n8(r.entry)} USDT, giriş büyüklüğü ${n2(qty * entry)} USDT. Açılış ${when(r.openedAt, now)}.`);
  const peak = r.peak === null ? null : Number(r.peak);
  lines.push(peak === null ? unknownText("Tepe fiyat", "fiyat giriş seviyesinin üstüne çıkmadığı için tepe hiç yazılmadı")
    : `Tepe fiyat ${n8(r.peak as string)} USDT — giriş fiyatının %${(((peak - entry) / entry) * 100).toFixed(2)} üstünde. Koruma bu tepeye göre ${open ? "taşınır" : "taşınmıştı"}.`);
  const gb = r.peak === null ? null : giveBackLevel(r.entry, r.peak);
  lines.push(gb === null ? "Kâr geri verme çıkış seviyesi yok: tepe ölçülmediği için geri verilecek kâr da yok."
    : open ? `Kâr geri verme çıkış seviyesi ${n8(gb)} USDT: fiyat buraya inerse pozisyon kapatılır ve tepedeki kârın yarısı korunmuş olur.`
    : `Kâr geri verme çıkış seviyesi ${n8(gb)} USDT idi: pozisyon açıkken fiyat buraya inseydi kapatılacaktı.`);
  if (open) {
    if (r.pid === null) { level = "ALARM"; alarm = "PROTECTION_LOST"; lines.push("KORUMA EMRİ KİMLİĞİ YOK: bu pozisyonun borsada zarar durdur emri kayıtlı değil. Motor bu durumda pozisyonu derhal kapatır."); }
    else if (audit === null) lines.push(`Koruma emri ${r.pid} kayıtlı. ${unknownText("Emrin borsada durup durmadığı", "son turda borsa doğrulaması yapılmadı ya da kaydı okunamadı")}`);
    else if (audit.state === "PROTECTED") lines.push(`Koruma emri ${r.pid} borsada duruyor — ${when(audit.at, now)} borsaya sorularak doğrulandı (emir durumu ${audit.status}). Altyapımız tamamen dursa bile bu emir borsada tetiklenir.`);
    else if (audit.state === "FILLED") { level = "WARN"; lines.push(`Koruma emri ${r.pid} DOLDU: zarar durdur tetiklendi ve pozisyon borsada kapandı — ${when(audit.at, now)} borsaya sorularak görüldü. Kayıt bu yüzden kapanmış olarak işaretlendi.`); }
    else if (audit.state === "UNVERIFIABLE") { level = "ALARM"; alarm = "PROTECTION_UNVERIFIABLE"; lines.push(`Koruma emri ${r.pid} DOĞRULANAMADI — ${when(audit.at, now)} borsaya soruldu ama sorgu düştü; emrin yerinde olup olmadığı BİLİNMİYOR. Yerinde olduğu VARSAYILMADI. Sayfanın en üstündeki uyarı ne yapıldığını söyler.`); }
    else { level = "ALARM"; alarm = "PROTECTION_LOST"; lines.push(`KORUMA EMRİ ${r.pid} BORSADA BULUNAMADI — ${when(audit.at, now)} borsaya soruldu, emir yerinde değil. Sayfanın en üstündeki uyarı ne yapıldığını söyler.`); }
    const g = quote === null ? null : String((Number(quote.mid) - entry) * qty);
    lines.push(quote === null ? unknownText("Anlık kâr/zarar", "son turda bu çift için fiyat ölçülmedi") + ` Bu pozisyon için bugüne dek ödenen gerçek komisyon ${n8(r.fees)} USDT.` : `Son ölçülen fiyat ${n8(quote.mid)} USDT, ${when(quote.at, now)} okundu. ` + pnlLine(g, r.fees, "Bu pozisyon şu anda kapatılsaydı"));
  } else {
    if (r.closedAt !== null && r.closedAt.getTime() < r.openedAt.getTime()) { level = "WARN"; lines.push(`KAYIT KENDİSİYLE ÇELİŞİYOR: kapanış zamanı (${stamp(r.closedAt)}) açılış zamanından (${stamp(r.openedAt)}) ÖNCE görünüyor. Bu satırın süreleri güvenilmez; tutarlar kayıttan okunduğu gibi yazıldı, düzeltilmedi.`); }
    lines.push(`Kapanış ${r.closedAt === null ? "zamanı bilinmiyor" : when(r.closedAt, now)} · kapanış sebebi: ${textOf(r.lastReason === null ? null : codeOf(r.lastReason))?.title ?? (r.status === "CLOSED" ? "koruma emri ya da çıkış kuralı pozisyonu kapattı; sicilde ayrı bir sebep kaydı yok" : "koruma yerleşmediği için pozisyon derhal kapatıldı")}.`);
    lines.push(pnlLine(r.realized, r.fees, "Kapanmış pozisyonun sonucu"));
  }
  const grossUsdt = open ? (quote === null ? null : n8(String((Number(quote.mid) - entry) * qty))) : n8(r.realized);
  const facts: PositionFacts = { entryPrice: n8(r.entry), quantity: n8(r.qty), notionalUsdt: n2(qty * entry), peakPrice: r.peak === null ? null : n8(r.peak), giveBackLevel: gb === null ? null : n8(gb),
    protectionOrderId: r.pid, protectionState: audit?.state ?? null, protectionCheckedAt: audit === null ? null : new Date(audit.at).toISOString(), markPrice: quote === null ? null : n8(quote.mid),
    grossUsdt, feeUsdt: n8(r.fees), netUsdt: grossUsdt === null ? null : n8(String(Number(grossUsdt) - Number(r.fees))) };
  return { id: r.id, symbol: r.symbol, open, level, alarm, title: `${r.symbol} — ${open ? "AÇIK" : "KAPANDI"}`, lines, facts };
}

export type PanelView = { at: string; engine: Card; tick: Card; health: Card; positions: { card: Card; rows: PositionView[] }; alerts: Card[]; sources: string[] };
const card = (level: Level, title: string, lines: string[]): Card => ({ level, title, lines });
/** PANELİN TAMAMI. Fırlatmaz: her okuma ayrı ayrı denenir, düşen okuma "bilinmiyor" olur (Ö-2) ve diğerleri yine gösterilir. */
export async function readPanel(deps: PanelDeps = {}): Promise<PanelView> {
  const now = (deps.now ?? Date.now)(), alerts: Card[] = [], sources: string[] = [];
  const tryRead = async <T>(what: string, fn: () => Promise<T>): Promise<{ ok: true; v: T } | { ok: false; why: string }> => { try { return { ok: true, v: await fn() }; } catch (e) { return { ok: false, why: `${what} okunamadı (${(e as { name?: string })?.name ?? "error"})` }; } };
  const [permit, tick, rows, stop, health] = await Promise.all([
    tryRead("çalışma izni kopyası", deps.permit ?? upstashPermitRead), tryRead("son tur kaydı", deps.tick ?? upstashLastTick),
    tryRead("pozisyon kayıtları", deps.rows ?? prismaPositionRows()), tryRead("sicil", deps.stop ?? prismaLastStop()),
    tryRead("sağlık göstergesi", deps.health ?? (() => readHealth(deps.healthDeps))),
  ]);
  sources.push("Motor durumu ve son tur: hızlı depodaki kopyalar (salt okuma; tazeleme yapılmadı, kopyaların ömrü bu açılıştan etkilenmedi).", "Pozisyon, komisyon, kapanış sebebi ve sağlık: kalıcı kayıt (tek uyanış).");
  // 1 — MOTOR: çalışıyor mu, çalışmıyorsa NEDEN (sebep sicilden, yüzeyden uydurulmaz)
  const stopText = stop.ok && stop.v !== null ? textOf(codeOf(stop.v.reason)) : null;
  let engine: Card, running: boolean | null = null; // null = izin okunamadı ⇒ motorun çalışıp çalışmadığı BİLİNMİYOR
  if (!permit.ok) engine = card(PERMIT_TEXT.UNREADABLE.level, PERMIT_TEXT.UNREADABLE.title, [...say(PERMIT_TEXT.UNREADABLE), unknownText("Motorun çalışıp çalışmadığı", permit.why)]);
  else {
    const d = permit.v, until = d?.permitUntil === null || d?.permitUntil === undefined ? 0 : Date.parse(d.permitUntil);
    const denial: PermitDenial | null = d === null ? "NO_PERMIT" : d.state === "STOPPED" ? "STOPPED" : until > now ? null : "PERMIT_EXPIRED";
    running = denial === null;
    if (denial === null) engine = card("OK", "Motor çalışıyor", [`Motor çalışıyor: çalışma izni ${till(until, now)} dolacak ve dolmadan önce kalıcı kayıttan yenilenecek.`, `İzin ${when((d as ControlDoc).at, now)} verildi.`, "Yeni pozisyon açma, çıkış ve borsadaki korumanın denetimi çalışıyor."]);
    else { const t = PERMIT_TEXT[denial]; engine = card(t.level, t.title, [...say(t), stopText === null ? "Sicilde bu durumu açıklayan bir kayıt bulunamadı." : `Sicildeki son kayıt: ${stopText.title} — ${stopText.what} (${when((stop.ok && stop.v ? stop.v.at : now), now)})`]); }
  // MOTOR kartı uyarı listesine KOPYALANMAZ: sayfa onu zaten en üstte gösterir; aynı üç cümleyi iki kez yazmak "kayıt kendisiyle çelişiyor mu" sorusunu doğuruyordu (İKİ GÖZ, Tur 26 madde 7).
  }
  // 2 — SON TUR: ne zaman atıldı, gecikme var mı (K-8), piyasa akışı açık mı
  let tickRec: TickRecord | null = null;
  const tickLines: string[] = [];
  if (!tick.ok) tickLines.push(unknownText("Motorun son turu", tick.why));
  else if (tick.v === null) tickLines.push(unknownText("Motorun son turu", "hiç tur kaydı yok: motor bu kurulumda henüz hiç çalışmamış ya da kayıtların ömrü dolmuş"));
  else { tickRec = tick.v; const gap = now - tickRec.at, budget = tickRec.tickMs + CRON_PERIOD_MS;
    tickLines.push(`Son tur ${when(tickRec.at, now)} atıldı ve ${tickRec.durationMs} milisaniye sürdü. Turlar ${dk(tickRec.tickMs)} aralıkla atılır.`);
    // Motor çalışmıyorken tur atılmaması BEKLENEN durumdur: gecikme hükmü yalnız çalışan motorda verilir, yoksa durdurma kendi kendine "gecikme" uyarısı doğururdu (kayıt kendisiyle çelişmez).
    tickLines.push(running === false ? `Motor çalışmadığı için yeni tur atılmıyor; son tur ${dk(gap)} önce atılmıştı. Bu bir gecikme değil, durmanın beklenen sonucu.`
      : running === null ? unknownText("Turun gecikip gecikmediği", "motorun çalışıp çalışmadığı okunamadı; çalışmayan motorda tur atılmaması beklenen durumdur")
      : gap > budget ? `GECİKME VAR: son turun üstünden ${dk(gap)} geçti, beklenen en geç ${dk(budget)}. Bu boşlukta çıkış ve giriş değerlendirilmedi; borsadaki koruma emirleri yerindeydi.`
      : `Gecikme yok: son turun üstünden ${dk(gap)} geçti, beklenen en geç ${dk(budget)}.`);
    tickLines.push(tickRec.market === null ? unknownText("Piyasa fiyat akışı", "son turda fiyat okuması hiç yapılmadı (motor o turda iş yapmadı)") : tickRec.market.ok ? `Piyasa fiyat akışı açık: son turda ${(tickRec.market.quotes ?? []).length} çift için fiyat ölçüldü.` : say(PANEL_TEXT.MARKET_FEED_DOWN)[0]);
    if (tickRec.market !== null && !tickRec.market.ok) alerts.push(card(PANEL_TEXT.MARKET_FEED_DOWN.level, PANEL_TEXT.MARKET_FEED_DOWN.title, say(PANEL_TEXT.MARKET_FEED_DOWN)));
    if (tickRec.late !== null && running !== false) alerts.push(card(PANEL_TEXT.TICK_MISSED.level, PANEL_TEXT.TICK_MISSED.title, [...say(PANEL_TEXT.TICK_MISSED), `Ölçülen boşluk ${dk(tickRec.late.gapMs)}.`]));
    if (tickRec.copy?.quarantined) alerts.push(card(PANEL_TEXT.POSITION_COPY_MISMATCH.level, PANEL_TEXT.POSITION_COPY_MISMATCH.title, say(PANEL_TEXT.POSITION_COPY_MISMATCH)));
    if (tickRec.positionsSource === "unknown") alerts.push(card(PANEL_TEXT.POSITIONS_UNKNOWN.level, PANEL_TEXT.POSITIONS_UNKNOWN.title, say(PANEL_TEXT.POSITIONS_UNKNOWN)));
  }
  const tickCard = card(!tick.ok || tick.v === null ? "WARN" : running !== false && tickRec !== null && now - tickRec.at > tickRec.tickMs + CRON_PERIOD_MS ? "WARN" : "OK", "Son tur", tickLines);
  // 3 — SAĞLIK (G17): oran, eşik, kalan pay — hepsi ölçülen defterden
  let healthCard: Card;
  if (!health.ok) healthCard = card("ALARM", PANEL_TEXT.HEALTH_UNKNOWN.title, [...say(PANEL_TEXT.HEALTH_UNKNOWN), unknownText("Komisyon/kâr oranı", health.why)]);
  else { const v = health.v, t = v.state === "UNHEALTHY" ? PANEL_TEXT.HEALTH_PAUSED : v.state === "UNKNOWN" ? PANEL_TEXT.HEALTH_UNKNOWN : null;
    const pay = v.ratio === null || v.state === "UNKNOWN" ? null : Number(v.threshold) - Number(v.ratio);
    healthCard = card(t === null ? "OK" : t.level, t === null ? "Sağlık göstergesi: strateji kendi ölçütünün içinde" : t.title, [
      v.sentence,
      v.state === "UNKNOWN" ? unknownText("Oranın eşiğe kalan payı", "oran hesaplanamadı") : pay === null ? `Bu dönemde henüz kapanmış kâr yok: oran hesaplanamıyor, bu yüzden hüküm verilmedi ve giriş açık. Şimdiye dek ödenen komisyon ${n2(v.fees)} USDT, hüküm için gereken en az komisyon ${n2(v.floor)} USDT.` : `Oran eşiğin ${pay >= 0 ? `${pay.toFixed(4)} kadar ALTINDA (kalan pay)` : `${Math.abs(pay).toFixed(4)} kadar ÜSTÜNDE (pay tükendi)`}.`,
      ...(t === null ? [] : say(t))]);
    // SAĞLIK kartı da kopyalanmaz (aynı gerekçe); seviyesi zaten kartın kendisinde.
  }
  // 4 — POZİSYONLAR (P-2: her kâr/zarar satırı brüt · komisyon · net)
  const quotes = (tickRec?.market?.ok ? tickRec.market.quotes : undefined) ?? [], quoteAt = tickRec?.market?.at ?? null;
  const auditOf = (id: number) => { const a = tickRec?.protection?.rows.find((x) => x.positionId === id); return a === undefined || tickRec === null ? null : { state: a.state, status: a.status, at: tickRec.at }; };
  let posCard: Card, views: PositionView[] = [];
  if (!rows.ok) posCard = card("ALARM", "Pozisyonlar", [unknownText("Açık ve kapanmış pozisyonlar", rows.why)]);
  else { views = rows.v.map((r) => { const q = quotes.find((x) => x.symbol === r.symbol); return viewPosition(r, q && quoteAt !== null ? { mid: q.mid, at: Date.parse(quoteAt) } : null, auditOf(r.id), now); });
    const openN = views.filter((v) => v.open).length, worst = views.reduce<Level>((a, v) => (RANK[v.level] > RANK[a] ? v.level : a), "OK");
    const tikKopyasiYok = tickRec?.positionsSource === "unknown";
    posCard = card(worst, "Pozisyonlar", [openN === 0 ? "Şu anda açık pozisyon yok: motorun parası borsada nakit duruyor ve piyasa riski taşımıyor." : `${openN} açık pozisyon var; her birinin borsadaki koruma emri aşağıda ayrı ayrı yazılı.`,
      ...(tikKopyasiYok ? ["Aşağıdaki satırlar KALICI KAYITTAN okundu ve doğrudur; motorun her turda kullandığı hızlı kopya okunamadığı için MOTOR son turda bu pozisyonlara dokunmadı (yukarıdaki uyarı). İkisi çelişmiyor: panel kayda, motor kopyaya bakar."] : []), views.length - openN === 0 ? "Kayıtta kapanmış pozisyon yok: bu hesapta henüz hiçbir pozisyon açılıp kapanmamış." : `Kayıtta ${views.length - openN} kapanmış pozisyon var, en yeniden eskiye (en çok 20 satır).`]);
    for (const v of views.filter((x) => x.alarm !== null)) { const t = PANEL_TEXT[v.alarm as "PROTECTION_LOST" | "PROTECTION_UNVERIFIABLE"]; alerts.push(card(t.level, `${t.title} — ${v.symbol}`, [...say(t), ...v.lines.filter((l) => /^KORUMA|^Koruma emri .* DOĞRULANAMADI/.test(l))])); }
  }
  alerts.sort((a, b) => RANK[b.level] - RANK[a.level]);
  return { at: new Date(now).toISOString(), engine, tick: tickCard, health: healthCard, positions: { card: posCard, rows: views }, alerts, sources };
}
