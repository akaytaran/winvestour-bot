-- BAŞLANGIÇ GÖÇÜ — ÜRETİLEN DOSYA, ELLE DÜZENLENMEZ.
-- 18 göçün SQL gövdelerinin dosya adı sırasıyla MEKANİK birleştirmesidir; kaynak göçlerin yorum satırları atıldı.
-- CHECK kısıtları, ayar tohumları (INSERT) ve sütun yorumları (COMMENT ON) kaynaktaki gibi korunur.

-- kaynak göç: 20260908102830_init
CREATE TYPE "Market" AS ENUM ('SPOT', 'FUTURES');

CREATE TYPE "PositionStatus" AS ENUM ('OPENING', 'OPEN', 'CLOSING', 'CLOSED', 'FAILED_UNPROTECTED_CLOSED');

CREATE TYPE "EngineEventKind" AS ENUM ('STOPPED', 'CHAIN_BREAK', 'IP_BANNED', 'KEY_INVALID', 'KEY_EXPIRING', 'REGION_BLOCKED', 'PROTECTION_FAILED', 'BUDGET_EXHAUSTED', 'HEALTH_PAUSED', 'RESUMED');

CREATE TABLE "exchange_keys" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "key_type" TEXT NOT NULL DEFAULT 'ed25519',
    "api_key_ciphertext" BYTEA NOT NULL,
    "private_key_ciphertext" BYTEA NOT NULL,
    "encryption_key_version" INTEGER NOT NULL,
    "public_key_fingerprint" TEXT NOT NULL,
    "restrictions_raw" JSONB NOT NULL,
    "ip_restrict" BOOLEAN NOT NULL,
    "enable_reading" BOOLEAN NOT NULL,
    "enable_spot_and_margin_trading" BOOLEAN NOT NULL,
    "enable_futures" BOOLEAN NOT NULL,
    "enable_withdrawals" BOOLEAN NOT NULL,
    "permits_universal_transfer" BOOLEAN NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL,
    "last_order_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "exchange_keys_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "risk_profile" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "aggressiveness" INTEGER,
    "max_total_exposure_pct" DECIMAL(6,3),
    "max_single_position_pct" DECIMAL(6,3),
    "leverage" INTEGER NOT NULL DEFAULT 1,
    "fee_budget_pct" DECIMAL(6,3),
    "fee_health_ratio_max" DECIMAL(6,3),
    "cooldown_seconds" INTEGER,
    "max_round_trips_per_period" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risk_profile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "positions" (
    "id" SERIAL NOT NULL,
    "exchange_key_id" INTEGER NOT NULL,
    "market" "Market" NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "entry_price" DECIMAL(24,10) NOT NULL,
    "quantity" DECIMAL(24,10) NOT NULL,
    "peak_price" DECIMAL(24,10),
    "protection_order_id" TEXT,
    "take_profit_order_id" TEXT,
    "status" "PositionStatus" NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orders" (
    "id" SERIAL NOT NULL,
    "position_id" INTEGER,
    "exchange_order_id" TEXT NOT NULL,
    "client_order_id" TEXT,
    "symbol" TEXT NOT NULL,
    "market" "Market" NOT NULL,
    "type" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "quantity" DECIMAL(24,10) NOT NULL,
    "price" DECIMAL(24,10),
    "fee" DECIMAL(24,10) NOT NULL DEFAULT 0,
    "fee_asset" TEXT,
    "status" TEXT NOT NULL,
    "placed_at" TIMESTAMP(3) NOT NULL,
    "raw_response" JSONB,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fee_ledger" (
    "id" SERIAL NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "fees_paid" DECIMAL(24,10) NOT NULL DEFAULT 0,
    "funding_paid" DECIMAL(24,10) NOT NULL DEFAULT 0,
    "budget" DECIMAL(24,10) NOT NULL,
    "gross_pnl" DECIMAL(24,10) NOT NULL DEFAULT 0,
    "round_trips" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_ledger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "engine_events" (
    "id" SERIAL NOT NULL,
    "kind" "EngineEventKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "exchange_response" JSONB,
    "position_id" INTEGER,
    "open_positions" INTEGER,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engine_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "brain_runs" (
    "id" SERIAL NOT NULL,
    "model" TEXT NOT NULL,
    "input_summary" TEXT NOT NULL,
    "input_hash" TEXT NOT NULL,
    "validation_ok" BOOLEAN NOT NULL,
    "validation_errors" JSONB,
    "produced_rule" JSONB,
    "latency_ms" INTEGER,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brain_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "positions_status_idx" ON "positions"("status");

CREATE INDEX "positions_symbol_status_idx" ON "positions"("symbol", "status");

CREATE UNIQUE INDEX "orders_exchange_order_id_key" ON "orders"("exchange_order_id");

CREATE UNIQUE INDEX "orders_client_order_id_key" ON "orders"("client_order_id");

CREATE INDEX "orders_symbol_placed_at_idx" ON "orders"("symbol", "placed_at");

CREATE UNIQUE INDEX "fee_ledger_period_start_period_end_key" ON "fee_ledger"("period_start", "period_end");

CREATE INDEX "engine_events_kind_at_idx" ON "engine_events"("kind", "at");

CREATE INDEX "brain_runs_at_idx" ON "brain_runs"("at");

ALTER TABLE "positions" ADD CONSTRAINT "positions_exchange_key_id_fkey" FOREIGN KEY ("exchange_key_id") REFERENCES "exchange_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "orders" ADD CONSTRAINT "orders_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "engine_events" ADD CONSTRAINT "engine_events_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "risk_profile" ADD CONSTRAINT "risk_profile_single_row" CHECK ("id" = 1);
ALTER TABLE "exchange_keys" ADD CONSTRAINT "exchange_keys_no_withdrawals" CHECK ("enable_withdrawals" = false AND "permits_universal_transfer" = false);
ALTER TABLE "exchange_keys" ADD CONSTRAINT "exchange_keys_key_type_ed25519" CHECK ("key_type" = 'ed25519');
ALTER TABLE "exchange_keys" ADD CONSTRAINT "exchange_keys_api_key_envelope" CHECK (octet_length("api_key_ciphertext") >= 30 AND get_byte("api_key_ciphertext", 0) = 1);
ALTER TABLE "exchange_keys" ADD CONSTRAINT "exchange_keys_private_key_envelope" CHECK (octet_length("private_key_ciphertext") >= 30 AND get_byte("private_key_ciphertext", 0) = 1);
ALTER TABLE "exchange_keys" ADD CONSTRAINT "exchange_keys_encryption_key_version_positive" CHECK ("encryption_key_version" >= 1);
ALTER TABLE "positions" ADD CONSTRAINT "positions_open_requires_protection" CHECK ("status" <> 'OPEN' OR "protection_order_id" IS NOT NULL);
ALTER TABLE "positions" ADD CONSTRAINT "positions_side" CHECK ("side" IN ('LONG', 'SHORT'));
ALTER TABLE "positions" ADD CONSTRAINT "positions_positive" CHECK ("quantity" > 0 AND "entry_price" > 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_side" CHECK ("side" IN ('BUY', 'SELL'));
ALTER TABLE "orders" ADD CONSTRAINT "orders_type" CHECK ("type" IN ('MARKET', 'LIMIT', 'STOP_MARKET', 'TAKE_PROFIT_MARKET'));
ALTER TABLE "orders" ADD CONSTRAINT "orders_fee_nonnegative" CHECK ("fee" >= 0);
ALTER TABLE "fee_ledger" ADD CONSTRAINT "fee_ledger_period_order" CHECK ("period_end" > "period_start");
ALTER TABLE "fee_ledger" ADD CONSTRAINT "fee_ledger_nonnegative" CHECK ("fees_paid" >= 0 AND "funding_paid" >= 0 AND "budget" >= 0 AND "round_trips" >= 0);
ALTER TABLE "engine_events" ADD CONSTRAINT "engine_events_reason_nonempty" CHECK (length(btrim("reason")) > 0);

-- kaynak göç: 20260908183000_engine_control
CREATE TABLE "engine_control" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL,
    "mode" TEXT,
    "permit_until" TIMESTAMP(3),
    "by" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engine_control_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "engine_control" ADD CONSTRAINT "engine_control_single_row" CHECK ("id" = 1);
ALTER TABLE "engine_control" ADD CONSTRAINT "engine_control_state" CHECK ("state" IN ('RUNNING', 'STOPPED'));
ALTER TABLE "engine_control" ADD CONSTRAINT "engine_control_mode" CHECK ("mode" IS NULL OR "mode" IN ('HOLD', 'CLOSE_ALL'));
ALTER TABLE "engine_control" ADD CONSTRAINT "engine_control_stopped_has_mode" CHECK ("state" <> 'STOPPED' OR "mode" IS NOT NULL);
ALTER TABLE "engine_control" ADD CONSTRAINT "engine_control_running_has_permit" CHECK ("state" <> 'RUNNING' OR "permit_until" IS NOT NULL);

-- kaynak göç: 20260909090000_fee_ledger_entries
ALTER TABLE "fee_ledger" ADD COLUMN "reserved" DECIMAL(24,10) NOT NULL DEFAULT 0,
ADD COLUMN "capital" DECIMAL(24,10),
ADD COLUMN "taker_rate" DECIMAL(12,10),
ADD COLUMN "quote_asset" TEXT NOT NULL DEFAULT 'USDT',
ADD COLUMN "opened_from" TEXT;

CREATE TABLE "fee_entries" (
    "id" SERIAL NOT NULL,
    "ledger_id" INTEGER NOT NULL,
    "ref" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "cls" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "estimated" DECIMAL(24,10) NOT NULL DEFAULT 0,
    "actual" DECIMAL(24,10),
    "paid" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "fee_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fee_entries_ref_key" ON "fee_entries"("ref");

CREATE INDEX "fee_entries_ledger_id_state_idx" ON "fee_entries"("ledger_id", "state");

ALTER TABLE "fee_entries" ADD CONSTRAINT "fee_entries_ledger_id_fkey" FOREIGN KEY ("ledger_id") REFERENCES "fee_ledger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fee_ledger" ADD CONSTRAINT "fee_ledger_reserved_nonnegative" CHECK ("reserved" >= 0 AND ("capital" IS NULL OR "capital" >= 0) AND ("taker_rate" IS NULL OR "taker_rate" >= 0));
ALTER TABLE "fee_entries" ADD CONSTRAINT "fee_entries_kind" CHECK ("kind" IN ('FEE', 'FUNDING'));
ALTER TABLE "fee_entries" ADD CONSTRAINT "fee_entries_cls" CHECK ("cls" IN ('ENTRY', 'EXIT', 'PROTECTION', 'DISCOVERY', 'FUNDING', 'UNRESERVED'));
ALTER TABLE "fee_entries" ADD CONSTRAINT "fee_entries_state" CHECK ("state" IN ('RESERVED', 'SETTLED', 'RELEASED', 'UNCONVERTED'));
ALTER TABLE "fee_entries" ADD CONSTRAINT "fee_entries_nonnegative" CHECK ("estimated" >= 0 AND ("actual" IS NULL OR "actual" >= 0));
ALTER TABLE "fee_entries" ADD CONSTRAINT "fee_entries_settled_has_actual" CHECK ("state" <> 'SETTLED' OR ("actual" IS NOT NULL AND "settled_at" IS NOT NULL));

-- kaynak göç: 20260910090000_protection_order_types
ALTER TYPE "EngineEventKind" ADD VALUE IF NOT EXISTS 'POSITION_SKIPPED';

ALTER TABLE "orders" DROP CONSTRAINT "orders_type";
ALTER TABLE "orders" ADD CONSTRAINT "orders_type" CHECK ("type" IN ('MARKET', 'LIMIT', 'STOP_LOSS', 'TAKE_PROFIT', 'STOP_LOSS_LIMIT', 'TAKE_PROFIT_LIMIT', 'STOP_MARKET', 'TAKE_PROFIT_MARKET'));

-- kaynak göç: 20260911150000_health_pause
ALTER TABLE "fee_ledger" ADD COLUMN "health_paused_at" TIMESTAMP(3);

-- kaynak göç: 20260911190000_brain_settings
CREATE TABLE "brain_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "model" TEXT NOT NULL,
    "call_interval_ms" INTEGER NOT NULL,
    "candidates" INTEGER NOT NULL,
    "candle_limit" INTEGER NOT NULL,
    "monthly_cap_usd" DECIMAL(12,4),
    "daily_call_cap" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "brain_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "brain_settings_single_row" CHECK ("id" = 1),
    CONSTRAINT "brain_settings_model_nonempty" CHECK (length("model") > 0),
    CONSTRAINT "brain_settings_bounds" CHECK ("call_interval_ms" > 0 AND "candidates" > 0 AND "candle_limit" > 1),
    CONSTRAINT "brain_settings_caps" CHECK (("monthly_cap_usd" IS NULL OR "monthly_cap_usd" > 0) AND ("daily_call_cap" IS NULL OR "daily_call_cap" > 0))
);

INSERT INTO "brain_settings" ("id","model","call_interval_ms","candidates","candle_limit","updated_at")
VALUES (1, 'claude-opus-5', 86400000, 5, 48, NOW()) ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "brain_setting_changes" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "by" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    CONSTRAINT "brain_setting_changes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "brain_setting_changes_by_nonempty" CHECK (length("by") > 0)
);
CREATE INDEX "brain_setting_changes_at_idx" ON "brain_setting_changes"("at");

ALTER TABLE "brain_runs" ADD COLUMN "input_tokens" INTEGER,
                         ADD COLUMN "output_tokens" INTEGER,
                         ADD COLUMN "cost_usd" DECIMAL(12,6);

-- kaynak göç: 20260912090000_notify_delivery
CREATE TABLE "notify_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "muted_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "dedup_window_ms" INTEGER NOT NULL,
    "dedup_undismissable" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "notify_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notify_settings_single_row" CHECK ("id" = 1),
    CONSTRAINT "notify_settings_dedup_window_nonneg" CHECK ("dedup_window_ms" >= 0)
);

INSERT INTO "notify_settings" ("id","muted_codes","dedup_window_ms","dedup_undismissable","updated_at")
VALUES (1, ARRAY[]::TEXT[], 1800000, false, NOW()) ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "device_tokens" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "label" TEXT,
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "last_send_at" TIMESTAMP(3),
    "last_send_ok" BOOLEAN,
    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "device_tokens_token_nonempty" CHECK (length("token") >= 16),
    CONSTRAINT "device_tokens_platform_known" CHECK ("platform" IN ('android','web'))
);
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens"("token");
CREATE INDEX "device_tokens_last_seen_at_idx" ON "device_tokens"("last_seen_at");

-- kaynak göç: 20260917090000_notify_dedup_class_window
ALTER TABLE "notify_settings" ADD COLUMN "dedup_window_undismissable_ms" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "notify_settings" ADD CONSTRAINT "notify_settings_dedup_undismissable_window_nonneg" CHECK ("dedup_window_undismissable_ms" >= 0);
UPDATE "notify_settings" SET "dedup_window_undismissable_ms" = 120000 WHERE "id" = 1;
ALTER TABLE "notify_settings" ALTER COLUMN "dedup_window_undismissable_ms" DROP DEFAULT;

-- kaynak göç: 20260917130000_notify_dedup_undismissable_comment
COMMENT ON COLUMN "notify_settings"."dedup_undismissable" IS 'KULLANIMDAN KALDIRILDI — 2026-09-17 (Tur 29, iş sahibi kararı K1 winvestor-eleme-muafiyet). Kod bu sütunu OKUMAZ; değeri bugünkü davranışı ANLATMAZ. Eleme penceresi iki ayardan okunur: dedup_window_undismissable_ms (kapatılamaz sınıf) ve dedup_window_ms (kapatılabilir sınıf); ikisinde de 0 = o sınıf için eleme yok. Sütun silinmedi (Tur 30, iş sahibi kararı K2 winvestor-dedup-undismissable-sutunu, 2026-09-17): silme ayrı ve geri dönülmez bir iştir, iş sahibinin yetkisindedir.';

-- kaynak göç: 20260918090000_risk_settings
CREATE TABLE "risk_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "leverage_cap" INTEGER,
    "futures_enabled" BOOLEAN NOT NULL DEFAULT false,
    "short_mode" TEXT NOT NULL DEFAULT 'NONE',
    "m2_futures_multiple" DECIMAL(12,4),
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "risk_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "risk_settings_single_row" CHECK ("id" = 1),
    CONSTRAINT "risk_settings_leverage_cap" CHECK ("leverage_cap" IS NULL OR "leverage_cap" >= 1),
    CONSTRAINT "risk_settings_short_mode" CHECK ("short_mode" IN ('NONE','CARRY_HEDGE','FREE')),
    CONSTRAINT "risk_settings_m2_futures" CHECK ("m2_futures_multiple" IS NULL OR "m2_futures_multiple" > 0),
    CONSTRAINT "risk_settings_futures_needs_cap" CHECK ("futures_enabled" = false OR "leverage_cap" IS NOT NULL)
);

INSERT INTO "risk_settings" ("id","leverage_cap","futures_enabled","short_mode","m2_futures_multiple","updated_at")
VALUES (1, NULL, false, 'NONE', NULL, NOW()) ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "risk_setting_changes" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "by" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    CONSTRAINT "risk_setting_changes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "risk_setting_changes_by_nonempty" CHECK (length("by") > 0)
);
CREATE INDEX "risk_setting_changes_at_idx" ON "risk_setting_changes"("at");

COMMENT ON COLUMN "risk_profile"."leverage" IS 'ÇALIŞMA KALDIRACI (borsaya bildirilen), TAVAN DEĞİL. 2026-09-17 (Tur 36, iş sahibi kararı winvestor-a5-futures-hesabi): K-11''in TAVANI artık risk_settings.leverage_cap sütunudur (NULL = seçilmedi ⇒ futures yolu kapalı arıza). Bu sütun silinmedi, verisi değiştirilmedi (üretimde 1) ve kullanımdan kaldırılmadı; silme ayrı ve geri dönülmez bir iştir, iş sahibinin yetkisindedir. Eski yorum "K-11: tavan kodda sabit, burada ayar" BAYATTIR: tavan ne kodda sabittir ne bu sütundadır.';
COMMENT ON COLUMN "risk_settings"."leverage_cap" IS 'K-11 TAVANI. NULL = tavan SEÇİLMEDİ ⇒ futures yolu KAPALI ARIZA (futures-unavailable:leverage-cap-null). Sayı 2026-09-17 itibarıyla seçilmemiştir; seçmek hassas eylemdir (RISK_SETTINGS_CHANGE, TOTP) ve risk_setting_changes defterine yazılır.';
COMMENT ON COLUMN "risk_settings"."m2_futures_multiple" IS 'M-2 ASGARİ KENAR kuralının FUTURES terimi. BİRİM: ÇARPAN (SPOT''un EDGE_MULTIPLE = 3 değeriyle AYNI birim; baz puan DEĞİL). NULL = seçilmedi (iş sahibi kararı winvestor-m2-futures-esigi = [A], 2026-09-17: eksik terimle -- komisyon ölçülmedi -- seçilen eşik sonradan sıkılamaz). SPOT çarpanı bu tabloya TAŞINMADI.';

-- kaynak göç: 20260918120000_funding_received
ALTER TABLE "fee_ledger" ADD COLUMN "funding_received" DECIMAL(24,10) NOT NULL DEFAULT 0;
ALTER TABLE "fee_ledger" ADD CONSTRAINT "fee_ledger_funding_received_nonnegative" CHECK ("funding_received" >= 0);
ALTER TABLE "fee_entries" ADD COLUMN "direction" TEXT NOT NULL DEFAULT 'PAID';
ALTER TABLE "fee_entries" ADD CONSTRAINT "fee_entries_direction" CHECK ("direction" IN ('PAID', 'RECEIVED'));
ALTER TABLE "fee_entries" ADD CONSTRAINT "fee_entries_direction_fee_paid" CHECK ("kind" = 'FUNDING' OR "direction" = 'PAID');

-- kaynak göç: 20260918150000_lock_settings
CREATE TABLE "lock_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "reprompt_seconds" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lock_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lock_settings_single_row" CHECK ("id" = 1),
    CONSTRAINT "lock_settings_reprompt_positive" CHECK ("reprompt_seconds" IS NULL OR "reprompt_seconds" > 0)
);

INSERT INTO "lock_settings" ("id","enabled","reprompt_seconds","updated_at")
VALUES (1, false, NULL, NOW()) ON CONFLICT ("id") DO NOTHING;

-- kaynak göç: 20260919030000_leverage_request_ledger
ALTER TYPE "EngineEventKind" ADD VALUE 'LEVERAGE_REQUEST';

ALTER TABLE "engine_events" ADD COLUMN "request_details" JSONB;

ALTER TABLE "engine_events" ADD CONSTRAINT "engine_events_request_details_closed" CHECK (
  "request_details" IS NULL OR (
    jsonb_typeof("request_details") = 'object'
    AND ("request_details" - ARRAY['by', 'symbol', 'requestedLeverage', 'cap']) = '{}'::jsonb
    AND "request_details" ? 'by' AND "request_details" ? 'symbol' AND "request_details" ? 'requestedLeverage' AND "request_details" ? 'cap'
    AND "request_details"->>'by' = 'sahip · oturum + TOTP'
    AND (jsonb_typeof("request_details"->'symbol') = 'null' OR ("request_details"->>'symbol') ~ '^[A-Z0-9]{2,20}$')
    AND (jsonb_typeof("request_details"->'requestedLeverage') = 'null' OR ("request_details"->>'requestedLeverage') ~ '^[1-9][0-9]{0,3}$')
    AND (jsonb_typeof("request_details"->'cap') = 'null' OR ("request_details"->>'cap') ~ '^[1-9][0-9]{0,3}$')
  )
);

-- kaynak göç: 20260923150000_entry_settings
CREATE TABLE "entry_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "entry_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "entry_setting_changes" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "by" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    CONSTRAINT "entry_setting_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "entry_setting_changes_at_idx" ON "entry_setting_changes"("at");

COMMENT ON TABLE "entry_settings" IS 'Giris salteri (Tur 64, G28). Tek satir (id=1). Yeni kurulumda ACIK dogar; var olan kurulumun bugunku etkin degeri (KAPALI) gocle DEGISMEZ.';
COMMENT ON COLUMN "entry_settings"."enabled" IS 'true = motor giris emri gonderebilir. false = hicbir giris emri cikmaz; cikis, koruma ve durdurma ETKILENMEZ.';

INSERT INTO "entry_settings" ("id", "enabled", "updated_at")
SELECT 1,
       NOT (EXISTS (SELECT 1 FROM "orders")
         OR EXISTS (SELECT 1 FROM "engine_events")
         OR EXISTS (SELECT 1 FROM "exchange_keys")),
       CURRENT_TIMESTAMP;

-- kaynak göç: 20260924090000_entry_switch_opened_event
ALTER TYPE "EngineEventKind" ADD VALUE IF NOT EXISTS 'ENTRY_SWITCH_OPENED';

-- kaynak göç: 20260924100000_cost_cap_settings
CREATE TYPE "BrainCapEmptyBehavior" AS ENUM ('BRAIN_OFF', 'NO_LIMIT');

ALTER TABLE "brain_settings" ADD COLUMN "total_cap_usd" DECIMAL(12,4);
ALTER TABLE "brain_settings" ADD COLUMN "cap_empty_behavior" "BrainCapEmptyBehavior" NOT NULL DEFAULT 'BRAIN_OFF';
ALTER TABLE "brain_settings" ALTER COLUMN "cap_empty_behavior" DROP DEFAULT;
ALTER TABLE "brain_settings" ADD CONSTRAINT "brain_settings_total_cap_positive" CHECK ("total_cap_usd" IS NULL OR "total_cap_usd" > 0);

COMMENT ON COLUMN "brain_settings"."total_cap_usd" IS 'A-9 aylik TOPLAM maliyet tavani ($/ay, Tur 65). NULL = girilmedi: Beyin aylik tavani turetilemez; davranis cap_empty_behavior ile belirlenir.';
COMMENT ON COLUMN "brain_settings"."cap_empty_behavior" IS 'Tavan bosken davranis (Tur 65, 20 Eyl satir 87). BRAIN_OFF = Beyin cagrilmaz, motor tikler ve korur (varsayilan). NO_LIMIT = aylik $ siniri yok.';

UPDATE "brain_settings" SET "total_cap_usd" = 10
WHERE EXISTS (SELECT 1 FROM "orders")
   OR EXISTS (SELECT 1 FROM "engine_events")
   OR EXISTS (SELECT 1 FROM "exchange_keys");

-- kaynak göç: 20260924120000_infra_usd_setting
ALTER TABLE "brain_settings" ADD COLUMN "infra_usd" DECIMAL(12,4);
ALTER TABLE "brain_settings" ADD CONSTRAINT "brain_settings_infra_nonnegative" CHECK ("infra_usd" IS NULL OR "infra_usd" >= 0);

COMMENT ON COLUMN "brain_settings"."infra_usd" IS 'Aylik ALTYAPI maliyeti ($/ay, Tur 66, kurulum ayari). NULL = girilmedi: Beyin payi (toplam tavan eksi altyapi) TURETILMEZ.';

UPDATE "brain_settings" SET "infra_usd" = 7.1
WHERE EXISTS (SELECT 1 FROM "orders")
   OR EXISTS (SELECT 1 FROM "engine_events")
   OR EXISTS (SELECT 1 FROM "exchange_keys");

-- kaynak göç: 20260924140000_tick_setting
ALTER TABLE "brain_settings" ADD COLUMN "tick_ms" INTEGER;
ALTER TABLE "brain_settings" ADD CONSTRAINT "brain_settings_tick_positive" CHECK ("tick_ms" IS NULL OR "tick_ms" > 0);

COMMENT ON COLUMN "brain_settings"."tick_ms" IS 'Motorun tik araligi (ms, Tur 67, kurulum ayari). NULL = girilmedi: RESUME izin vermez, motor tiklemez. Izin kopyasiyla tasinir.';

UPDATE "brain_settings" SET "tick_ms" = 60000
WHERE EXISTS (SELECT 1 FROM "orders")
   OR EXISTS (SELECT 1 FROM "engine_events")
   OR EXISTS (SELECT 1 FROM "exchange_keys");
