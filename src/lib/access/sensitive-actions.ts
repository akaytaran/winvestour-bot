// HASSAS EYLEM SİCİLİ (G04, S-8) — TEK KAYNAK. İkinci doğrulama (TOTP, eylem başına) isteyen eylemler yalnız burada listelenir;
// bir uç `withAccess({ cls: "sensitive", action })` ile bu listeden bir ad bildirmek zorundadır (kapı: scripts/gate-access.mjs).
// DURDURMA BU LİSTEDE DEĞİLDİR VE OLMAYACAKTIR: S-8 "Durdurma istemez", K-7 "durdurma koşulsuzdur ve altyapıdan bağımsızdır".
// Durdurma NEVER_SENSITIVE'de adıyla durur; kapı iki kümenin kesişmediğini ve durdurma yolunun `sensitive` sınıfına alınmadığını denetler.
// G08 (durdurma servisi) NEVER_SENSITIVE'i, G06/G18 SENSITIVE_ACTIONS'ı tüketir. Ad eklemek/çıkarmak bu dosyayı değiştirir, başka yeri değil.
export const SENSITIVE_ACTIONS = [
  "EXCHANGE_KEY_WRITE", // Binance anahtarı yazma/değiştirme (G06)
  "RISK_PROFILE_CHANGE", // risk profili değiştirme (K-9, M-1 sayıları)
  "LEVERAGE_CHANGE", // kaldıraç değiştirme (K-11)
  "ENCRYPTION_KEY_ROTATION", // şifreleme anahtarı dönüşü (E-3)
  "ENGINE_RESTART", // motoru yeniden başlatma (durdurma DEĞİL)
  "MANUAL_EXIT", // elle çıkış: bir varlığın serbest bakiyesini quote'a satma (G11 exitAllFree). Para hareket ettirir → ikinci doğrulama şart
  "BRAIN_SETTINGS_CHANGE", // Beyin ayarları: model, çağrı sıklığı, aday/mum sayısı, harcama tavanı (Tur 25). Para harcatan bir ayardır → ikinci doğrulama şart
  "RISK_SETTINGS_CHANGE", // risk ayarları: kaldıraç tavanı, futures şalteri, SHORT kipi, M-2 futures çarpanı (Tur 36, K-11/A-5/M-2). Para riskini açan bir ayardır → ikinci doğrulama şart
  "LOCK_SETTINGS_CHANGE", // biyometrik kilit ayarı: kilidi aç/kapa + yeniden sorma süresi (Tur 63, G20). S-8: kilit tam da OTURUMU ELE GEÇİREN saldırgana karşı vardır; yalnız oturumla kapatılabilseydi koruduğu tek tehdide karşı işe yaramazdı → ikinci doğrulama şart
  "ENTRY_SETTINGS_CHANGE", // giriş şalteri: motorun kendi kararıyla GİRİŞ EMRİ gönderip gönderemeyeceği (Tur 64, G28 kutu 4, K-2). Şalteri AÇMAK para hareketi başlatabilen tek ayardır → ikinci doğrulama şart. KAPATMAK da bu uçtan geçer ama hiçbir arıza onu geciktiremez ve durdurma bu ayara HİÇ bağlı değildir (K-7).
  "FEE_ASSET_BUY", // komisyon varlığı (BNB) alımı — iş sahibi kararı (Tur 18 madde 3): quote'tan indirim varlığına geçiş. Para hareket ettirir → ikinci doğrulama şart
] as const;
export type SensitiveAction = (typeof SENSITIVE_ACTIONS)[number];

/** Asla ikinci doğrulama istemeyecek eylemler (S-8, K-7). Kilit, Upstash, veritabanı — hiçbiri bu yolu kapatamaz. */
export const NEVER_SENSITIVE = ["ENGINE_STOP"] as const;
export type NeverSensitiveAction = (typeof NEVER_SENSITIVE)[number];

/** Derleyici zorlaması: iki küme kesişirse bu satır derlenmez. */
export const REGISTRY_DISJOINT: Extract<SensitiveAction, NeverSensitiveAction> extends never ? true : never = true;
