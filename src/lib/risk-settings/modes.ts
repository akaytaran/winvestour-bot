// SHORT KİPİ — AÇIK LİSTE (Tur 36, G21 kalemi d · iş sahibi kararı `winvestor-acik-satis-short`: "üç kip de yazılır, varsayılan NONE").
// BU DOSYA BİR YAPRAKTIR: hiçbir şey içe aktarmaz. Sebep B-3'tür — Beyin'in şeması kipi bilmek zorundadır, ama Beyin'in ÇALIŞMA ZAMANI GRAFİĞİ veritabanına/Upstash'e/borsa istemcisine
// UZANAMAZ (Tur 31 dersi). Kipin ADI burada, kipin DEĞERİ ayardadır (`src/lib/risk-settings`, Neon `risk_settings.short_mode`) — liste tiptir, seçim ayardır.
// BURADA SAYI YOKTUR ve olmayacaktır: kaldıraç tavanı, futures eşiği ve şalter bu dosyada temsil edilmez (kapı: sabit KIRMIZI).
export const SHORT_MODES = ["NONE", "CARRY_HEDGE", "FREE"] as const;
export type ShortMode = (typeof SHORT_MODES)[number];
/** KAPALI VARSAYILAN (Ö-2): kip okunamadığında ya da verilmediğinde uygulanan EN DAR kip — bugünkü davranış (yalnız uzun yön). Bir tercih değil, kapalı arızanın yönüdür. */
export const CLOSED_SHORT_MODE: ShortMode = "NONE";
/** KİPİN İNSAN CÜMLESİ (Tur 37, G21 kalemi b'nin panel yüzeyi · U-3). Ekran kip ADINI tek başına GÖSTERMEZ: "CARRY_HEDGE" kod adıdır, iş sahibi ona bakıp karar veremez.
 *  Cümleler BURADA durur (kipin adıyla aynı yaprakta) ve uçtan geçip ekrana gider; ekran kendi sözlüğünü KURMAZ (kapı: sabit kip adı taşıyan yüzey KIRMIZI).
 *  `satisfies Record<ShortMode, string>`: listeye yeni bir kip eklenirse derleyici cümlesini de ZORLAR — sessiz boş hücre doğamaz. */
export const SHORT_MODE_NOTES = {
  NONE: "yalnız uzun yön (bugünkü davranış): açığa satış yok, karar motoru yalnız alım kuralı üretir",
  CARRY_HEDGE: "funding taşımanın korumalı biçimi: yönü açar ama korumasız açığa satış değildir",
  FREE: "serbest yön: açığa satış da üretilebilir",
} as const satisfies Record<ShortMode, string>;
/** KİPİN İCRA DURUMU (Tur 39 madde 4 · TUR-38 §5b-8 kullanıcı gözü). `LIVE` = kipin ayırt edici davranışı bugün kodda VAR; `NOT_WRITTEN` = kip SEÇİLEBİLİR, ayar yazılır, ama ayırt edici
 *  emirleri üreten kod YOK (SHORT/carry icrası G21-f/G22-g, A-5'e bağlı). Ölçüm: `planFromRule` LONG olmayan kuralı atar (SIDE_NOT_EXECUTABLE) ve src'de futures emir ucu 0.
 *  Bu iki gerçekten biri değişirse kapı (gate:funding (8)) KIRMIZI olur — etiket ve cümle yeniden yazılmadan bayatlayamaz. */
export const SHORT_MODE_EXECUTION = {
  NONE: "LIVE",
  CARRY_HEDGE: "NOT_WRITTEN",
  FREE: "NOT_WRITTEN",
} as const satisfies Record<ShortMode, "LIVE" | "NOT_WRITTEN">;
/** KİPİN BUGÜNKÜ GERÇEĞİ (Tur 39 görsel ölçümü: ilk NONE cümlesi "Bugün: bugün böyle…" diye TEKRARLIYOR ve giriş şalteri kapalıyken "alım kuralları emre dönüşür" diyordu — düzeltildi) — ekranda kip açıklamasının YANINDA tek cümle (U-3: seçilebilen ama emir üretmeyen kip bunu söylemek zorundadır). Cümle burada, uçtan ekrana gider. */
export const SHORT_MODE_TODAY = {
  NONE: "ek bir icra gerektirmez: açığa satış yoktur; alım kuralları giriş yolunun kendi kapılarından (giriş şalteri, kenar, tavan, bütçe) geçerse emre dönüşür",
  CARRY_HEDGE: "icrası henüz yazılmadı: bu kip seçilirse ayar kaydedilir ama carry'nin iki bacağı için hiçbir emir çıkmaz; alım tarafı yalnız-uzun kipteki gibi işler",
  FREE: "icrası henüz yazılmadı: bu kip seçilirse karar motoru açığa satış kuralı önerebilir ama kural atılır, açığa satış için hiçbir emir çıkmaz; alım tarafı yalnız-uzun kipteki gibi işler",
} as const satisfies Record<ShortMode, string>;
