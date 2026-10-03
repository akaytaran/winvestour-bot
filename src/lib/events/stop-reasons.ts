// DURMA SEBEPLERİ SİCİLİ (G07 · K-8, K-4, K-2, K-7, M-5, S-5, S-6, S-7). Motoru durduran/duraklatan HER sebep BURADA, tek yerde, `EngineEventKind`'a derleyici düzeyinde bağlı.
// Yeni bir durma yolu bu listeye girmeden yazılamaz (kapı: scripts/gate-events.mjs — sicil dışı sebep üreten ya da sebep üretip olay yazmayan yol KIRMIZI).
// Derleyici zorlar: (1) her sebebin `kind`'ı şemadaki enum'dan, (2) enum'daki her tür en az bir sebeple üretiliyor, (3) G05 boğazının her reddedişi bir sebebe eşli.
import type { EngineEventKind } from "@/generated/prisma/enums";
import type { DenyReason } from "@/lib/binance/budget";

export type StopReasonMeta = { kind: EngineEventKind; rule: string; label: string; source: string };

export const STOP_REASONS = {
  // G05 boğazı (S-7): reddediş sebepleri DenyReason ile birebir (THROTTLE_DENY_TO_STOP)
  BUDGET_EXHAUSTED: { kind: "BUDGET_EXHAUSTED", rule: "S-7/M-1", label: "çağrı bütçesi tükendi ya da 429 askısı", source: "G05 boğaz" },
  IP_BANNED: { kind: "IP_BANNED", rule: "S-7", label: "Binance IP yasağı (418) ya da askısı", source: "G05 boğaz" },
  REGION_BLOCKED: { kind: "REGION_BLOCKED", rule: "S-5", label: "kısıtlı bölge (451)", source: "G05 boğaz" },
  THROTTLE_UNAVAILABLE: { kind: "STOPPED", rule: "S-7", label: "boğaz ön koşulu düştü (depo/tavan/taşıyıcı), çağrı çıkmadı", source: "G05 boğaz" },
  RECORD_FAILED_AFTER_SEND: { kind: "STOPPED", rule: "K-8", label: "borsa yanıtı elde, gönderim sonrası kayıt düştü; yanıt olayda korundu", source: "G05 boğaz postSend (Tur 8 madde 4) → G11" },
  // Koruma, zincir, sağlık, anahtar, durdurma, yeniden başlatma
  PROTECTION_FAILED: { kind: "PROTECTION_FAILED", rule: "K-2", label: "koruma emri yerleştirilemedi, pozisyon kapatıldı", source: "G12" },
  CHAIN_BREAK: { kind: "CHAIN_BREAK", rule: "K-4", label: "zincir koptu, nöbet devri gerçekleşmedi", source: "G16" },
  TICK_MISSED: { kind: "CHAIN_BREAK", rule: "K-4/K-8", label: "cron tiki atlandı ya da gecikti (aralık + bir cron dönemi aşıldı); koruma borsada durur", source: "G16 cron tiki (Tur 21)" },
  HEALTH_PAUSED: { kind: "HEALTH_PAUSED", rule: "M-5", label: "komisyon/brüt kâr oranı türetilmiş eşiği (1/EDGE_MULTIPLE) aştı, strateji duraklatıldı: yeni pozisyon yok, çıkış/koruma sürer", source: "G17 sağlık göstergesi (Tur 24)" },
  // G17 (Tur 24, M-5): ölçülemeyen sağlık DURMADIR ("sağlıklı" varsayılmaz, Ö-2); eşiğin altına dönüş geçiş olayıdır (kind RESUMED: giriş yeniden açık) — ikisi de yalnız GEÇİŞTE bir kez
  HEALTH_UNKNOWN: { kind: "STOPPED", rule: "M-5/Ö-2", label: "sağlık ölçülemedi (defter/kayıt okunamadı); sağlıklı varsayılmadı, yeni pozisyon yok, çıkış/koruma sürer", source: "G17 sağlık göstergesi (Tur 24)" },
  HEALTH_RECOVERED: { kind: "RESUMED", rule: "M-5/K-8", label: "komisyon/brüt kâr oranı eşiğin altına döndü; sağlık duraklaması kaldırıldı, giriş yeniden açık", source: "G17 sağlık göstergesi (Tur 24)" },
  KEY_INVALID: { kind: "KEY_INVALID", rule: "P-1/S-4", label: "anahtar borsa tarafından reddedildi ya da yetkisi düştü", source: "G11 (imzalı çağrı -2014/-2015)" },
  KEY_EXPIRING: { kind: "KEY_EXPIRING", rule: "S-6", label: "anahtar 30 gün emirsizlik silinmesine yaklaşıyor", source: "G19 (keyIdleStatus warn)" },
  STOP_BUTTON: { kind: "STOPPED", rule: "K-7", label: "sahip durdurdu (durdurma anahtarı)", source: "G08" },
  RESTART: { kind: "RESUMED", rule: "K-8", label: "motor yeniden başlatıldı", source: "G08" },
  PERMIT_REFRESH_FAILED: { kind: "STOPPED", rule: "K-7/K-8", label: "izin kopyası Neon'dan tazelenemedi; kopya uzatılmadı, TTL dolunca motor durur (yalnız RESUME başlatır)", source: "G08 tik okuyucusu (Tur 22)" },
  // Tur 23 — pozisyon durumu kopyası (K-2, K-10, Ö-2, A-9): tik yalnız kopyayı okur; kopya okunamaz/yok ve Neon'dan kurulamaz ⇒ durum BİLİNMİYOR (durma; "pozisyon yok" varsayılmaz); kopya ≠ Neon ⇒ Neon kazanır, giriş kapanır
  POSITIONS_UNKNOWN: { kind: "STOPPED", rule: "Ö-2/K-8", label: "pozisyon kopyası okunamadı ya da yok ve Neon'dan kurulamadı; durum bilinmiyor, bu tikte iş yapılmadı, giriş yok", source: "G12 pozisyon kopyası (Tur 23)" },
  POSITION_REFRESH_FAILED: { kind: "STOPPED", rule: "K-8/A-9", label: "pozisyon kopyası Neon'la karşılaştırılamadı; kopya uzatılmadı, TTL dolunca durum bilinmiyor sayılır", source: "G12 pozisyon kopyası (Tur 23)" },
  POSITION_COPY_MISMATCH: { kind: "STOPPED", rule: "Ö-2/M-1", label: "pozisyon kopyası Neon'la uyuşmadı; Neon kazandı, tutarlı tazelemeye kadar yeni pozisyon yok (çıkış/koruma sürer)", source: "G12 pozisyon kopyası (Tur 23)" },
  POSITION_COPY_STALE: { kind: "STOPPED", rule: "K-8/K-10", label: "değişim kopyaya yazılamadı; kopya silindi (bir sonraki tik Neon'dan kurar), Neon gerçek", source: "G12 pozisyon kopyası (Tur 23)" },
  // G10 icra sarmalayıcısı (K-6): kilit ya da kayıt deposu erişilemezken icra yapılmaz (kapalı arıza); "başkası çalışıyor" (HELD) durma değildir, olay üretmez
  LOCK_UNAVAILABLE: { kind: "STOPPED", rule: "K-6/S-7", label: "icra kilidi deposu erişilemez, icra yapılmadı", source: "G10 icra sarmalayıcısı" },
  RECORD_UNAVAILABLE: { kind: "STOPPED", rule: "K-6/K-8", label: "kayıt deposu okunamadı, gönderim yapılmadı", source: "G10 icra sarmalayıcısı" },
  // G09 komisyon defteri (M-1): PARA bütçesi — G05'in AĞIRLIK bütçesinden (BUDGET_EXHAUSTED) ayrı; EXIT/PROTECTION bu sebeplerle ASLA reddedilmez (K-1, K-2)
  FEE_BUDGET_EXHAUSTED: { kind: "BUDGET_EXHAUSTED", rule: "M-1", label: "komisyon bütçesi (para) tükendi, giriş reddedildi; çıkış/koruma geçer", source: "G09 defter" },
  FEE_RATE_UNAVAILABLE: { kind: "STOPPED", rule: "M-1", label: "komisyon kuru ölçülemedi, kayıt çevrilmedi; giriş kapalı, çıkış geçer", source: "G09 defter" },
  FEE_LEDGER_UNAVAILABLE: { kind: "STOPPED", rule: "M-1/K-8", label: "komisyon defteri okunamadı/yazılamadı ya da sermaye ölçülemedi; giriş yok, çıkış geçer", source: "G09 defter" },
  // G11 emir yolu (S-5, K-2, S-7): borsa kuralları ÇALIŞMA ANINDA okunur; okunamayan kural ya da kurala uymayan emir GÖNDERİLMEZ; giriş yolu G12'ye kadar kapalıdır
  ORDER_RULES_UNAVAILABLE: { kind: "STOPPED", rule: "S-7/M-2", label: "sembol emir kuralları (exchangeInfo) okunamadı, emir gönderilmedi", source: "G11 emir yolu" },
  ORDER_RULE_VIOLATION: { kind: "STOPPED", rule: "M-2/S-7", label: "emir borsanın filtre kurallarına uymuyor, gönderilmeden reddedildi", source: "G11 emir yolu" },
  ENTRY_CLOSED: { kind: "STOPPED", rule: "K-2", label: "giriş yolu kapalı: koruma emri yöneticisi (G12) olmadan pozisyon açılmaz", source: "G11 emir yolu" },
  // G12 koruma emri yöneticisi (K-1, K-2, M-4): koruma borsada durur; yerleşmezse ya da penceresi aşılırsa pozisyon KAPATILIR; kapatılamazsa motor durur ve bildirilir
  PROTECTION_WINDOW_EXCEEDED: { kind: "PROTECTION_FAILED", rule: "K-2", label: "koruma penceresi aşıldı (pozisyon korumasız kaldı), pozisyon kapatıldı", source: "G12 koruma yöneticisi" },
  PROTECTION_LOST: { kind: "PROTECTION_FAILED", rule: "K-1/K-3", label: "borsadaki koruma emri kayboldu (iptal/bulunamıyor), pozisyon kapatıldı", source: "G12 koruma denetleyicisi" },
  PROTECTION_UNVERIFIABLE: { kind: "STOPPED", rule: "K-1/K-8", label: "koruma emri borsada doğrulanamadı (sorgu düştü); korumasız sayılır, motor durur", source: "G12 koruma denetleyicisi" },
  CLOSE_FAILED: { kind: "STOPPED", rule: "K-2/K-8", label: "korumasız pozisyon KAPATILAMADI; motor durdu, bildirim gerekir", source: "G12 koruma yöneticisi" },
  POSITION_SKIPPED: { kind: "POSITION_SKIPPED", rule: "M-4/K-9", label: "pozisyon açılmadı: sermaye/kapasite/pay kuralı tutmuyor (işlem yapmamak geçerli çıktıdır)", source: "G12 boyutlandırma" },
  // G13 asgari kenar + portföy tavanı (M-2, M-4, K-9): "pozisyon açılmadı" bir DURMA DEĞİL, geçerli bir çıktıdır (POSITION_SKIPPED); "ölçemedim" ise durmadır (STOPPED)
  EDGE_BELOW_THRESHOLD: { kind: "POSITION_SKIPPED", rule: "M-2/M-4", label: "beklenen hareket, ölçülen gidiş-dönüş maliyetin üç katının altında; pozisyon açılmadı", source: "G13 asgari kenar" },
  UNIVERSE_REJECTED: { kind: "POSITION_SKIPPED", rule: "A-2/M-4", label: "çift evren ölçütlerini geçmedi (yayılma/asgari tutar/derinlik/hacim); pozisyon açılmadı", source: "G13 coin evreni" },
  EXPOSURE_CEILING: { kind: "POSITION_SKIPPED", rule: "K-9/M-4", label: "portföy ya da tek pozisyon tavanı aşılıyor veya tavan bilinmiyor; pozisyon açılmadı", source: "G13 portföy tavanı" },
  FUTURES_EDGE_BELOW_THRESHOLD: { kind: "POSITION_SKIPPED", rule: "M-2/M-3/M-4", label: "futures girişi kenar kapısını geçmedi: beklenen hareket, ölçülen futures giriş maliyetinin (komisyon + yayılma + derinlik + tutma süresince funding) M-2 futures çarpanı katının altında ya da eşik kurulamadı (çarpan boş, tutma süresi yok, futures kapalı); pozisyon açılmadı", source: "G22 futures kenarı" },
  COST_UNMEASURABLE: { kind: "STOPPED", rule: "M-2/M-1", label: "gidiş-dönüş maliyet bileşeni (komisyon/yayılma/derinlik) ölçülemedi; giriş yok, çıkış/koruma geçer", source: "G13 maliyet hesaplayıcısı" },
  // G11 emir yolu — Tur 14 düzeltmeleri (K-8 boşluğu kapatıldı): borsanın İŞ HATASIYLA reddettiği emir de olay yazar; imza damgası gönderimden önce yaşlanırsa emir çıkmaz
  ORDER_REJECTED: { kind: "STOPPED", rule: "K-8", label: "borsa emri iş hatasıyla reddetti (filtre/bakiye/damga); emir oluşmadı", source: "G11 emir yolu" },
  STAMP_STALE: { kind: "STOPPED", rule: "S-4/K-8", label: "imza damgası gönderimden önce yaşlandı (recvWindow riski); emir gönderilmedi", source: "G11 emir yolu" },
  // Saat hizalaması (Tur 13, S-4/K-8): imzalı çağrının damgası sunucu saatinden türer; sapma okunamazsa ya da tavanı aşarsa çağrı YAPILMAZ — yanlış damgayla emir göndermek yasak
  CLOCK_UNSYNCED: { kind: "STOPPED", rule: "S-4/K-8", label: "sunucu saati okunamadı ya da ölçüm güvenilmez; imzalı çağrı yapılmadı", source: "G11 saat hizalama (src/lib/binance/time.ts)" },
  CLOCK_SKEW_EXCEEDED: { kind: "STOPPED", rule: "S-4/K-8", label: "yerel saat sapması tavanı aştı (bozuk saat); imzalı çağrı yapılmadı", source: "G11 saat hizalama (src/lib/binance/time.ts)" },
  // G14 tepe takibi + kâr geri verme + yeniden giriş (K-10, M-7, M-4, K-2): soğuma/tavan reddi bir ATLAMADIR (POSITION_SKIPPED), sayılamaması DURMADIR; koruma taşınamazsa K-2 kapatma
  REENTRY_COOLDOWN: { kind: "POSITION_SKIPPED", rule: "M-7/M-4", label: "soğuma süresi dolmadan aynı sembole yeniden giriş; pozisyon açılmadı", source: "G14 yeniden giriş kapısı" },
  ROUND_TRIP_CEILING: { kind: "POSITION_SKIPPED", rule: "M-7/M-4", label: "dönem başına tur tavanı dolu; pozisyon açılmadı", source: "G14 yeniden giriş kapısı" },
  REENTRY_UNMEASURABLE: { kind: "STOPPED", rule: "M-7/Ö-2", label: "tur sayısı/soğuma ölçülemedi (pozisyon geçmişi ya da risk profili okunamadı); giriş yok", source: "G14 yeniden giriş kapısı" },
  PROTECTION_UPDATE_FAILED: { kind: "PROTECTION_FAILED", rule: "K-10/K-2", label: "koruma taşınırken ya da çıkışta yeni koruma/çıkış emri yerleşmedi; pozisyon kapatıldı", source: "G14 tepe takibi" },
  // G15 Beyin (B-1..B-4, K-5, M-4, K-8): Beyin düşerse/reddedilirse YENİ POZİSYON AÇILMAZ, mevcut kurallar geçerli (ATLAMA); girdide sır ya da kayıtsız çağrı DURMADIR (sızıntı yolu / ölçülemeyen çağrı)
  BRAIN_UNAVAILABLE: { kind: "POSITION_SKIPPED", rule: "M-4/K-8", label: "Beyin çağrısı başarısız (API/yanıt); yeni pozisyon açılmaz, mevcut kurallar geçerli", source: "G15 beyin" },
  BRAIN_OUTPUT_REJECTED: { kind: "POSITION_SKIPPED", rule: "B-2/M-4", label: "Beyin çıktısı şema/aralık/tutarlılık denetimini geçmedi; atıldı, emre dönüşmedi", source: "G15 beyin" },
  BRAIN_INPUT_SECRET: { kind: "STOPPED", rule: "B-3/S-2", label: "Beyin girdisinde sır deseni; çağrı yapılmadı (sızıntı yolu)", source: "G15 beyin" },
  BRAIN_RUN_UNRECORDED: { kind: "STOPPED", rule: "K-8/Ö-2", label: "brain_runs okunamadı/yazılamadı; çağrı yapılmadı ya da üretilen kural kullanılmadı", source: "G15 beyin" },
  // Tur 25 — BEYİN AYARI VE HARCAMA TAVANI (madde 1, 4): ayar okunamazsa ÇAĞRI YOK ve varsayılana düşülmez (Ö-2); tavan çağrıdan ÖNCE denetlenir ve aşılırsa yeni pozisyon açılmaz
  //   — çıkış ve borsadaki koruma bu yollardan geçmez, çalışmaya devam eder (M-1, K-1).
  BRAIN_SETTINGS_UNREADABLE: { kind: "STOPPED", rule: "Ö-2/A-1", label: "beyin ayarı (model/sıklık/aday/mum) okunamadı; Beyin çağrılmadı, varsayılana düşülmedi", source: "G18 beyin ayarları (Tur 25)" },
  RISK_SETTINGS_UNREADABLE: { kind: "STOPPED", rule: "Ö-2/A-1/K-11", label: "risk ayarı (kaldıraç tavanı/futures şalteri/SHORT kipi/M-2 futures çarpanı) okunamadı; futures yolu açılmadı, varsayılana düşülmedi — spot çıkış ve borsadaki koruma sürer", source: "G21 risk ayarları (Tur 36)" },
  BRAIN_SPEND_CEILING: { kind: "BUDGET_EXHAUSTED", rule: "M-1/A-9", label: "Beyin harcama tavanı (aylık $ ya da günlük çağrı) doldu; çağrı yapılmadı, yeni pozisyon yok, çıkış/koruma sürer", source: "G15 beyin (Tur 25)" },
  BRAIN_SPEND_UNKNOWN: { kind: "STOPPED", rule: "Ö-2/M-1", label: "Beyin harcaması ölçülemedi; çağrı yapılmadı, harcanmamış varsayılmadı", source: "G15 beyin (Tur 25)" },
  // G16 zincir + piyasa akışı + WS push (K-3, K-4): akış kesilirse YENİ POZİSYON AÇILMAZ (çıkış/koruma çalışır); push koparsa REST yoklamasına DÜŞÜLMEZ — kopukluk olaya yazılır, gizlenmez
  MARKET_FEED_DOWN: { kind: "STOPPED", rule: "K-3/S-7", label: "piyasa akışı okunamadı; yeni pozisyon açılmaz, çıkış ve koruma çalışır", source: "G16 piyasa akışı" },
  USER_STREAM_LOST: { kind: "STOPPED", rule: "K-4", label: "kullanıcı veri akışı (WS push) kurulamadı ya da koptu; REST yoklamasına düşülmez, dolum kaydı push gelene kadar beklemede", source: "G16 WS push" },
} as const satisfies Record<string, StopReasonMeta>;

export type StopReasonCode = keyof typeof STOP_REASONS;
export const STOP_REASON_CODES = Object.keys(STOP_REASONS) as StopReasonCode[];

/** İSTEK TÜRLERİ (Tur 48, K-A `winvestor-kaldirac-istegi-ayrintilari`): defterde duran ama DURMA SEBEBİ OLMAYAN türler — sahibin kendi başlattığı ve sonucunu ekranda anında gördüğü istek.
 *  Durma sicilinde YOKTUR (motoru durdurmaz, panelin durma kartına girmez); bildirim sınıfı G19 sicilindedir (`REQUEST_KIND_NOTIFY`, derleyiciye bağlı: "bildirimsiz"). */
export type RequestKindMeta = { rule: string; label: string; source: string; decision: string };
export const REQUEST_KINDS = {
  LEVERAGE_REQUEST: { rule: "K-11/S-8/U-3", label: "kaldıraç isteği — sonuç kodu sebep alanında, istek ayrıntısı (kim · sembol · istenen · tavan) ayrıntı sütununda", source: "G21 kaldıraç isteği (Tur 48)", decision: "winvestor-kaldirac-istegi-ayrintilari" },
  // TUR 65 (S64-1): sahibin kendi başlattığı HASSAS eylem — durma DEĞİLDİR ama BİLDİRİMLİDİR (K1 = [C], KARAR-DEFTERI 20 Eyl satır 81). Kapatma bu türü üretmez.
  ENTRY_SWITCH_OPENED: { rule: "K-2/S-8/E-1/U-2", label: "giriş şalteri AÇILDI (panel · oturum + TOTP)", source: "G28 giriş şalteri (Tur 64) · açma bildirimi (Tur 65)", decision: "winvestor-s64-1-salter-bildirimi" },
} as const satisfies Partial<Record<EngineEventKind, RequestKindMeta>>;
export type RequestKind = keyof typeof REQUEST_KINDS;

// (2) Enum'daki her tür en az bir sebeple üretiliyor mu? Boşta kalan tür varsa `never`'a `true` atanamaz → derleme düşer.
type CoveredKind = (typeof STOP_REASONS)[StopReasonCode]["kind"];
type UncoveredKind = Exclude<EngineEventKind, CoveredKind | RequestKind>; // Tur 48: durma sicili YA DA istek türleri — her tür TAM BİR sicilde
type Overlap = Extract<CoveredKind, RequestKind>; // bir tür iki sicilde birden olamaz (istek türü bir durma sebebi olarak yazılamaz)
export const KIND_CLASSES_DISJOINT: [Overlap] extends [never] ? true : never = true;
export const EVERY_KIND_HAS_REASON: [UncoveredKind] extends [never] ? true : never = true;

// (3) G05 reddedişleri → sebep. DenyReason'a eklenen her ad burada eşlenmek ZORUNDA (Record tam olmalı).
export const THROTTLE_DENY_TO_STOP: Record<DenyReason, StopReasonCode> = { BUDGET_EXHAUSTED: "BUDGET_EXHAUSTED", IP_BANNED: "IP_BANNED", REGION_BLOCKED: "REGION_BLOCKED", STOPPED: "THROTTLE_UNAVAILABLE" };
