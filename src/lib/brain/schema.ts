// BEYİN ŞEMASI — GİRDİ VE ÇIKTI SÖZLEŞMESİ (G15 · B-1, B-2, B-3, B-4, K-5, M-2, M-4, A-3, Ö-1). Beyin'in üretebileceği TEK şey doğrulanmış, sayısal bir KURALDIR; emir değil (K-5).
// B-2 — KATI ŞEMA: tip, aralık ve İÇ TUTARLILIK (stop < giriş < hedef; beklenen hareket hedefin ima ettiğini aşamaz; sembol girdideki evrenden). Geçmeyen çıktı ATILIR, düzeltilmez.
//   Doğrulanmış kural `ValidatedRule` MARKASINI taşır; markayı yalnız `validateBrainOutput` basar (kapı: `as ValidatedOutput` yalnız burada). Markasız kural emre dönüşemez (tip düzeyinde).
// B-3 — GİRDİ AÇIK LİSTEDİR: aşağıdaki alanlardan başkası geçmez (bilinmeyen alan DÜŞER); para tutarı, bakiye, miktar, sermaye, anahtar, bağlantı dizesi, hesap kimliği alanı YOKTUR.
//   Pozisyonlar yalnız FİYAT SEVİYESİ taşır (miktar yok); bütçe YÜZDE olarak girer (tutar değil); risk profili yüzdedir.
// B-1 — TEKNİK GİRDİDE SERBEST METİN ALANI YOKTUR: sembol düzenli ifadeyle, sayılar ondalık dizeyle sınırlıdır. Bir talimat metni girdiye ne bilinen ne bilinmeyen alandan girebilir
//   (bilinen alanda biçim reddi, bilinmeyen alanda düşme). Dış metnin girebileceği tek yol DUYARLILIK yoludur ve o yol B-4 gereği yalnız KAPATABİLİR.
// B-4 — DUYARLILIK ÇIKTISININ ŞEMASINDA GİRİŞ ALANI YOKTUR: kural, giriş, hedef, beklenen hareket, güven — hiçbiri yok. action ∈ NONE | REDUCE | CLOSE_ALL. Şema düzeyinde AÇTIRAMAZ;
//   uygulayıcı (applySentimentVeto) yalnız ELEYEBİLİR ve kapatma ÖNEREBİLİR (çıkan kural kümesi ⊆ giren kural kümesi; kapı ve kanarya ölçer). Akış bu turda BAĞLANMADI (A-3, ertelendi).
import { z } from "zod";
import { CLOSED_SHORT_MODE, type ShortMode } from "@/lib/risk-settings/modes"; // YAPRAK modül (hiçbir şey içe aktarmaz): kipin ADI. Kipin DEĞERİ ayardadır — B-3: Beyin'in çalışma zamanı grafiği veritabanına/Upstash'e uzanamaz

/** ŞEMA SINIRLARI — strateji sayısı DEĞİL, sağduyu sınırı (sicil): beklenen hareket ≤ %100 (spot'ta bir kural değil halüsinasyondur) · güven [0,1] · tutma 1 dk … 30 gün (dönem UTC ay, M-1) ·
 *  gerekçe ≤ 600 karakter · çağrı başına ≤ 10 kural (K-9 zaten portföy tavanıyla keser) · ondalık dize ≤ 8 basamak (borsa hassasiyeti). Hangi göstergeyle kaç bp hedeflendiği A-1'de AÇIKTIR, burada yok. */
export const RULE_BOUNDS = { expectedMoveBpMax: 10_000, holdMinutesMax: 30 * 24 * 60, rationaleMax: 600, rulesMax: 10, noteMax: 300 } as const;
export const SYMBOL_RE = /^[A-Z0-9]{5,20}$/, DECIMAL_RE = /^\d{1,20}(\.\d{1,8})?$/;
const dec = z.string().regex(DECIMAL_RE), sym = z.string().regex(SYMBOL_RE), price = z.number().finite().positive();

// ---- GİRDİ (B-3): bilinmeyen alan DÜŞER (z.object varsayılanı), bilinen alan biçime uymazsa girdi REDDEDİLİR ----
/** Mum: [açılış zamanı ms, açılış, en yüksek, en düşük, kapanış, taban hacmi] — Binance klines biçimi; metin yok. */
const candle = z.tuple([z.number().int().nonnegative(), dec, dec, dec, dec, dec]);
export const MARKET_SNAPSHOT = z.object({ symbol: sym, mid: dec, spreadBp: dec, costBp: dec, thresholdBp: dec, dayQuoteVolume: dec, candles: z.array(candle).max(500) });
export const BRAIN_INPUT = z.object({
  at: z.string().datetime(), quoteAsset: z.string().regex(/^[A-Z]{3,6}$/),
  market: z.array(MARKET_SNAPSHOT).min(1).max(50),
  openPositions: z.array(z.object({ symbol: sym, side: z.literal("LONG"), entryPrice: dec, peakPrice: dec.nullable(), stopPrice: dec.nullable(), openedAt: z.string().datetime() })).max(50),
  risk: z.object({ maxSinglePositionPct: dec.nullable(), maxTotalExposurePct: dec.nullable(), aggressiveness: z.number().int().nullable(), cooldownSeconds: z.number().int().nullable() }),
  feeBudget: z.object({ usedPct: dec, periodEnd: z.string().datetime() }),
});
export type BrainInput = z.infer<typeof BRAIN_INPUT>;

// ---- ÇIKTI (B-2): bilinmeyen alan REDDEDİLİR (strict), aralık ve tutarlılık denetlenir ----
export const BRAIN_RULE = z.object({
  symbol: sym, side: z.literal("LONG"), // SPOT: yalnız uzun; SHORT şema dışıdır (futures A-5)
  entry: z.object({ type: z.enum(["LIMIT", "MARKET"]), price }).strict(), // giriş koşulu: LIMIT'te seviye, MARKET'te referans fiyat
  stopPrice: price, targetPrice: price,
  expectedMoveBp: z.number().finite().positive().max(RULE_BOUNDS.expectedMoveBpMax), confidence: z.number().finite().min(0).max(1),
  holdMinutes: z.number().int().min(1).max(RULE_BOUNDS.holdMinutesMax), rationale: z.string().min(1).max(RULE_BOUNDS.rationaleMax),
}).strict();
export const BRAIN_OUTPUT = z.object({ rules: z.array(BRAIN_RULE).max(RULE_BOUNDS.rulesMax), note: z.string().max(RULE_BOUNDS.noteMax) }).strict();
/** YÖN, KİPİN İŞİDİR (Tur 36, G21 kalemi d · iş sahibi kararı `winvestor-acik-satis-short`: "üç kip de yazılır, varsayılan NONE"). Kip `NONE` iken YUKARIDAKİ ŞEMANIN KENDİSİ
 *  kullanılır — türev kurulmaz, bugünkü yol bayt bayt aynı kalır (kanarya ölçer). Kip açıksa TÜREV şema yalnız `side` alanını genişletir; katılık (`.strict()`) ve bütün sınırlar AYNEN korunur.
 *  Bu dosya kipi OKUMAZ: kip PARAMETREDİR, tek okuma yolu `src/lib/risk-settings`tir. Kip genişlese bile SHORT yönünde EMİR ÜRETEN kod YOKTUR (`planFromRule` LONG olmayanı icraya geçirmez). */
export const ruleSchemaFor = (mode: ShortMode) => (mode === CLOSED_SHORT_MODE ? BRAIN_RULE : BRAIN_RULE.extend({ side: z.enum(["LONG", "SHORT"]) }).strict());
export const outputSchemaFor = (mode: ShortMode) => (mode === CLOSED_SHORT_MODE ? BRAIN_OUTPUT : z.object({ rules: z.array(ruleSchemaFor(mode)).max(RULE_BOUNDS.rulesMax), note: z.string().max(RULE_BOUNDS.noteMax) }).strict());
export type BrainRule = z.infer<typeof BRAIN_RULE>;
export type BrainOutput = z.infer<typeof BRAIN_OUTPUT>;
declare const validated: unique symbol;
export type ValidatedRule = BrainRule & { readonly [validated]: true };
export type ValidatedOutput = { rules: ValidatedRule[]; note: string };
export type Validation = { ok: true; output: ValidatedOutput } | { ok: false; errors: string[] };

/** Ham metin/nesne → doğrulanmış çıktı. Hatalar yalnız YOL + KOD taşır (değer taşımaz, S-2). `symbols`: girdideki evren — dışından sembol kabul edilmez (B-1: girdi dışı sembol uydurulamaz). */
export function validateBrainOutput(raw: unknown, ctx: { symbols: string[]; mode?: ShortMode }): Validation {
  let obj: unknown = raw;
  if (typeof raw === "string") { try { obj = JSON.parse(raw); } catch { return { ok: false, errors: ["(kök): json-parse"] }; } }
  // KİP verilmezse ya da NONE ise BUGÜNKÜ YOL: `BRAIN_OUTPUT.safeParse` — türev şema kurulmaz, tek bayt değişmez (Ö-2: kapalı varsayılan).
  const mode = ctx.mode ?? CLOSED_SHORT_MODE;
  const p = mode === CLOSED_SHORT_MODE ? BRAIN_OUTPUT.safeParse(obj) : outputSchemaFor(mode).safeParse(obj);
  if (!p.success) return { ok: false, errors: p.error.issues.map((i) => `${i.path.join(".") || "(kök)"}: ${i.code}`) };
  const errors: string[] = [], seen = new Set<string>();
  p.data.rules.forEach((r, i) => {
    const at = `rules.${i}`;
    if (!ctx.symbols.includes(r.symbol)) errors.push(`${at}.symbol: not-in-input-universe`);
    if (seen.has(r.symbol)) errors.push(`${at}.symbol: duplicate`); seen.add(r.symbol);
    if (!(r.stopPrice < r.entry.price)) errors.push(`${at}.stopPrice: must-be-below-entry`);
    if (!(r.targetPrice > r.entry.price)) errors.push(`${at}.targetPrice: must-be-above-entry`);
    const implied = ((r.targetPrice - r.entry.price) / r.entry.price) * 10_000; // hedefin ima ettiği hareket (bp): beyan edilen beklenen hareket bunu AŞAMAZ
    if (r.expectedMoveBp > implied) errors.push(`${at}.expectedMoveBp: exceeds-target-implied-move`);
  });
  return errors.length ? { ok: false, errors } : { ok: true, output: p.data as ValidatedOutput };
}

// ---- DUYARLILIK (B-4): tek yönlü — yalnız devre kesici. Şemada giriş alanı YOK. Kaynak bağlı DEĞİL (A-3, Tur 17 kararı: ertelendi) ----
export const SENTIMENT_OUTPUT = z.object({ action: z.enum(["NONE", "REDUCE", "CLOSE_ALL"]), symbols: z.array(sym).max(RULE_BOUNDS.rulesMax), rationale: z.string().max(RULE_BOUNDS.rationaleMax) }).strict();
export type SentimentVeto = z.infer<typeof SENTIMENT_OUTPUT>;
export type SentimentValidation = { ok: true; veto: SentimentVeto } | { ok: false; errors: string[] };
export function validateSentimentOutput(raw: unknown): SentimentValidation {
  let obj: unknown = raw;
  if (typeof raw === "string") { try { obj = JSON.parse(raw); } catch { return { ok: false, errors: ["(kök): json-parse"] }; } }
  const p = SENTIMENT_OUTPUT.safeParse(obj);
  return p.success ? { ok: true, veto: p.data } : { ok: false, errors: p.error.issues.map((i) => `${i.path.join(".") || "(kök)"}: ${i.code}`) };
}
/** SAF ve TEK YÖNLÜ: NONE → kurallar aynen; REDUCE → adı geçen semboller ELENİR; CLOSE_ALL → hiç kural kalmaz ve açık pozisyonların TAMAMI için kapatma ÖNERİLİR (icra G16).
 *  Hiçbir dal kural EKLEMEZ: çıkan küme giren kümenin alt kümesidir (kapı: bu gövdede push/concat/yayma yok; kanarya adım 6). */
export function applySentimentVeto(rules: ValidatedRule[], veto: SentimentVeto, open: { symbol: string }[]): { rules: ValidatedRule[]; closeProposal: string[]; detail: string } {
  if (veto.action === "CLOSE_ALL") return { rules: [], closeProposal: open.map((p) => p.symbol), detail: `duyarlılık CLOSE_ALL: ${rules.length} kural elendi, ${open.length} açık pozisyon için kapatma önerildi` };
  if (veto.action === "REDUCE") { const kept = rules.filter((r) => !veto.symbols.includes(r.symbol)); return { rules: kept, closeProposal: open.filter((p) => veto.symbols.includes(p.symbol)).map((p) => p.symbol), detail: `duyarlılık REDUCE: ${rules.length - kept.length} kural elendi` }; }
  return { rules, closeProposal: [], detail: "duyarlılık NONE: kural kümesi değişmedi (duyarlılık açtıramaz, B-4)" };
}
