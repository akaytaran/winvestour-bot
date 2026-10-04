-- Tur 87 (G38 · iş sahibi kararları D6/D6' · Üretim S16-4/S16-5): hazır risk profili. YALNIZ EKLEME — iki NULL'lanabilir sütun + iki CHECK.
-- Değer tohumlanmaz: var olan kurulum da yeni kurulum da NULL kalır (profil seçili DEĞİL; motor risk payları girilene kadar pozisyon açmaz).
ALTER TABLE "risk_settings" ADD COLUMN "preset" TEXT, ADD COLUMN "preset_applied" JSONB;
ALTER TABLE "risk_settings" ADD CONSTRAINT "risk_settings_preset" CHECK ("preset" IS NULL OR "preset" IN ('CAUTIOUS', 'BALANCED', 'RISKY'));
ALTER TABLE "risk_settings" ADD CONSTRAINT "risk_settings_preset_pair" CHECK (("preset" IS NULL) = ("preset_applied" IS NULL));
COMMENT ON COLUMN "risk_settings"."preset" IS 'Tur 87 (G38): seçili hazır profil; NULL = seçilmedi. Profil sayıları kodda tek dosyada (src/lib/risk-settings/presets.ts), burada yalnız ad.';
COMMENT ON COLUMN "risk_settings"."preset_applied" IS 'Tur 87 (G38): profil seçildiği anda yazılan değerler; elle değişiklik bununla karşılaştırılıp Özel olarak gösterilir.';
