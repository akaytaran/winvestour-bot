// ELEME (Tur 28, G20 madde 6 · U-2). İŞ SAHİBİ KARARI (2026-09-12): "AYNI SEBEP İÇİN 30 DAKİKADA BİR KEZ. İlk oluş anında gider; aynı sebep 30 dakika boyunca tekrar bildirilmez.
// FARKLI bir sebep bu kısıttan ETKİLENMEZ. Kapatılamaz 31 bildirim elemeden ETKİLENMEZ. 30 sayısı DEĞİŞTİRİLEBİLİR AYAR olarak yazılır, koda gömülmez."
// NOT — KARARDAKİ "31" TUR 27'NİN SAYISIDIR: iş sahibinin 2026-09-17 kararıyla kapatılamazlık para güvenliğine dokunan dört sınıfa genişledi ⇒ bugün 38 (ölçüm: `gate:notify`).
//   Karardaki SÖZ değişmedi ("kapatılamazlar elemeden etkilenmez"); sayı sicilden türetildiği için kendiliğinden güncellendi — kodda hiçbir yerde 31 ya da 38 YAZILI DEĞİL.
// GEREKÇESİ ÖLÇÜMDÜR (Tur 27 §9.2): tik yolundaki bir sebep koşul sürdükçe HER TİKTE olay yazar; ucuz modda tik 60 s ⇒ sürekli bir arıza günde 1 440 bildirim demektir.
// ELEME BİR EMNİYET KAPISI DEĞİLDİR, GÜRÜLTÜ KAPISIDIR ⇒ deposu okunamazsa bildirim GİDER (`unreadable`): kaybolan bir bildirim, yinelenen bir bildirimden daha kötüdür (U-2'nin sözü).
// Bu yüzden buradaki yön Ö-2'nin genel "kapalı arızala" yönünün TERSİDİR ve gerekçesi budur: kapının koruduğu şey para değil, telefonun kullanılabilirliğidir.
// PENCERE SAYISI (1 800 000 ms = 30 dk) UYDURULMUŞ BİR SAYIDIR ve A-1 siciline `NOTIFY_DEDUP_WINDOW_MS` adıyla yazıldı (iş sahibi şartı, 2026-09-17); kod onu AYARDAN okur, gömmez.
// TUR 29 (K1 = [C], 2026-09-17): pencere SINIFA göredir (kapatılamaz 2 dk · diğerleri 30 dk, ikisi de AYAR) ve ANAHTAR SINIFI TAŞIR: aynı sebep iki pencerede aynı anahtarı paylaşmaz.
// PENCERE DEPOSU UPSTASH'TİR ve kendi kendine söner (PX): temizlik işi, kuyruk ve zamanlayıcı YOKTUR. TEK EVAL ⇒ bildirim başına 1 Upstash komutu (Tur 20 maliyet disiplini).
// B-3 SINIRI (Tur 28 — ÖLÇÜLDÜ, `gate:brain` KIRMIZI verdi: "grafik borsa yoluna uzanıyor: src/lib/upstash.ts"). `@/lib/upstash` kapının EXCHANGE_MODULE listesindedir ve Beyin
// `stopEngine` üzerinden bildirim yoluna bağlı olduğu için, bu dosyadaki DURAĞAN içe aktarma Beyin'in grafiğini borsa yoluna uzatıyordu. İçe aktarma ÇAĞRI ANINA alındı.
// ⚠️ Tur 28 AÇIK BEYANI (tarihli, silinmedi): bu, çalışma zamanı erişimini KALDIRMIYORDU — Beyin `stopEngine` üzerinden bu depoya çalışma zamanında gidiyordu.
// → TUR 31 (B-3 GENİŞLETMESİ, iş sahibi 2026-09-17): Beyin artık olay/bildirim yazmaz, durma İSTEĞİ döndürür; kas `stopEngineFor` ile çevirir ⇒ bu depo Beyin'in çağrı yığınında DEĞİL. Eleme ve pencereleri değişmedi (kapı: gate:brain 3b–3e).
import { withinBudget } from "./settings";

/** `first`: bu sebep pencerede İLK kez görüldü ⇒ bildirim gider. `remainingMs`: elenmişse pencerenin bitmesine kalan süre (null = ölçülemedi). `unreadable`: depo okunamadı ⇒ gider. */
export type DedupVerdict = { first: boolean; remainingMs: number | null; unreadable: boolean };
export type DedupClass = "kapatilamaz" | "kapatilabilir";
export interface DedupStore { readonly name: string; firstInWindow(cls: DedupClass, code: string, windowMs: number, nowMs: number): Promise<DedupVerdict> }

export const DEDUP_KEY = (cls: DedupClass, code: string) => `notify:dedup:${cls}:${code}`;
/** TEK KOMUT: anahtar yoksa kur (pencere = PX) ve -1 dön (ilk) · varsa kalan süreyi dön (elendi). İki ayrı komutun arasına giren bir tik yanlış karar veremez (atomik). */
export const DEDUP_LUA = "local ok = redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) if ok then return -1 end local t = redis.call('PTTL', KEYS[1]) if t < 0 then return -1 end return t";

/** ÜRETİM DEPOSU (Upstash). Hata YUTULMAZ ama bildirimi de düşürmez: `unreadable:true` döner ve çağıran gönderir; sonuç cümlesine yazılır (K-8). */
export const upstashDedupStore = (): DedupStore => ({
  name: "upstash",
  firstInWindow: async (cls, code, windowMs, nowMs) => {
    if (windowMs <= 0) return { first: true, remainingMs: null, unreadable: false }; // eleme kapalı (ayar 0): her oluş bildirilir
    try {
      // SÜREYLE SINIRLI (K-7): Upstash yanıt vermezse durdurma beklemez — eleme yapılmamış sayılır ve bildirim gider.
      const v = await withinBudget(async () => { const { redisPipeline } = await import("@/lib/upstash"); const [r] = await redisPipeline([["EVAL", DEDUP_LUA, 1, DEDUP_KEY(cls, code), String(nowMs), String(windowMs)]]); return Number(r); }, Number.NaN);
      if (!Number.isFinite(v)) return { first: true, remainingMs: null, unreadable: true };
      return v < 0 ? { first: true, remainingMs: null, unreadable: false } : { first: false, remainingMs: v, unreadable: false };
    } catch { return { first: true, remainingMs: null, unreadable: true }; }
  },
});

/** BELLEK DEPOSU — yalnız kapı/kanarya (S-9): ürün yolunda kullanılırsa kapı KIRMIZI. Aynı mantık, aynı sınır koşulları (tam eşikte pencere DOLMUŞ sayılır). */
export const memoryDedupStore = (seed: Map<string, number> = new Map()): DedupStore & { readonly keys: Map<string, number> } => ({
  name: "bellek", keys: seed,
  firstInWindow: async (cls, code, windowMs, nowMs) => {
    if (windowMs <= 0) return { first: true, remainingMs: null, unreadable: false };
    const until = seed.get(DEDUP_KEY(cls, code));
    if (until !== undefined && until > nowMs) return { first: false, remainingMs: until - nowMs, unreadable: false };
    seed.set(DEDUP_KEY(cls, code), nowMs + windowMs);
    return { first: true, remainingMs: null, unreadable: false };
  },
});

/** DEPO DÜŞTÜ SAYAN DEPO — yalnız kanarya: okunamayan pencerenin bildirimi GERÇEKTEN gönderdiği ölçülür. */
export const unreadableDedupStore = (): DedupStore => ({ name: "okunamadı", firstInWindow: async () => ({ first: true, remainingMs: null, unreadable: true }) });
