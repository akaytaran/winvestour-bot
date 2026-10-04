// HAZIR PROFİL — UYGULAYICI + GÖRÜNÜM (Tur 87 · G38 · iş sahibi kararları D6/D6' · Üretim S16-4, S16-5 · K-9, A-6, M-2, S-8, E-1, Ö-2, U-3).
// SAYI BU DOSYADA YOKTUR: profilin sayıları tek kaynakta (`@/lib/risk-settings/presets`, kapı: gate:risk-presets). Burada yalnız okuma → türetme → doğrulama → TEK İŞLEMDE yazma.
// TEK İŞLEM (yarım yazım YOK): risk ayarı + risk payları + tik aralığı + seçili profil ve üç E-1 defter satırı aynı `$transaction`'da; biri düşerse hiçbiri yazılmaz.
//   Tablo erişimi ayarın KENDİ modülündedir (risk_settings/risk_profile → `@/lib/risk-settings` riskPresetTx · brain_settings → `@/lib/brain-settings` brainSettingsTx); bu dosya yalnız birleştirir.
// DOĞRULAMA ÜRÜNÜN KENDİ DOĞRULAYICILARIYLA: her alan, elle yazılsaydı geçeceği aynı kapıdan geçer (validatePatch · validateShares · Beyin validatePatch) — profil kabul kümesinin dışına çıkamaz.
// BAKİYE (S16-4 / D6'): tutar yazılmaz; görünüm, serbest USDT bakiyesini ve borsanın asgari emir tutarını ÇALIŞMA ANINDA mevcut okuyuculardan okur (readCapital · readSymbolRules) ve motorun
//   kendi formülüyle (planPositionSize) hesaplar. Asgari tutarın altında kalan profil ÖNERİLMEZ ve seçimi reddedilir (409); bakiye okunamazsa sayı UYDURULMAZ ("ölçülemedi").
// Futures alanları yalnız anahtarda futures yetkisi varken dolar (S16-4); yetki satırı yoksa (null) "yetki var" SAYILMAZ (Ö-2).
// Uç: src/app/api/risk/preset/route.ts — GET session · POST sensitive + RISK_PRESET_APPLY (oturum + eylem başına tek kullanımlık kod, S-8). Seçim tek başına hiçbir emir göndermez.
import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/db/client";
import { PRESET_NAMES, PRESETS, isPresetName, presetValues, type PresetName, type PresetValues } from "@/lib/risk-settings/presets";
import { prismaRiskSettingsStore, prismaRiskSharesStore, readPresetColumns, riskPresetTx, validatePatch, validateShares, type PresetApplied, type RiskSettingsRow, type RiskShares, type SettingChange, type ShareChange } from "@/lib/risk-settings";
import { brainSettingsTx, prismaSettingsStore, validatePatch as validateBrainPatch, type BrainSettingsRow, type SettingChange as BrainChange } from "@/lib/brain-settings";
import { prismaKeyFutures } from "@/lib/exchange-key";
import { EDGE_MULTIPLE } from "@/lib/edge";
import { CRON_PERIOD_MS } from "@/lib/chain";
import { planPositionSize, type SizingRefusal } from "@/lib/sizing";
import { readCapital, readRate } from "@/lib/fee-ledger/exchange";
import { QUOTE_ASSET } from "@/lib/fee-ledger";
import { readSymbolRules } from "@/lib/orders/filters";
import { EXCHANGE_INFO } from "@/lib/binance";

const D = Prisma.Decimal, errName = (e: unknown) => (e as { name?: string })?.name ?? "error";
export { PRESET_NAMES, type PresetName };

// ---- DEPO (okuma: dört kaynak; yazma: TEK işlem) ----
export type PresetSnapshot = { settings: RiskSettingsRow; shares: RiskShares; shareRow: boolean; brain: BrainSettingsRow; preset: PresetName | null; applied: PresetApplied | null };
export type PresetWrite = { name: PresetName; by: string; settings: RiskSettingsRow; settingChanges: SettingChange[]; shares: RiskShares; shareChanges: ShareChange[]; createShareRow: boolean;
  brain: BrainSettingsRow; brainChanges: BrainChange[]; from: PresetName | null; applied: PresetApplied };
export interface PresetStore { read(): Promise<PresetSnapshot | null>; write(w: PresetWrite): Promise<void> }
export const prismaPresetStore = (): PresetStore => ({
  read: async () => { const [s, sh, b, p] = await Promise.all([prismaRiskSettingsStore().read(), prismaRiskSharesStore().read(), prismaSettingsStore().read(), readPresetColumns()]);
    if (s === null || b === null || p === null) return null;
    return { settings: s, shares: sh ?? { singlePositionPct: null, totalExposurePct: null }, shareRow: sh !== null, brain: b, preset: isPresetName(p.preset) ? p.preset : null, applied: p.applied }; },
  write: async (w) => { const db = getDb(); await db.$transaction([...riskPresetTx(db, w), ...brainSettingsTx(db, w.brain, w.by, w.brainChanges)]); },
});
/** Kapı/kanarya deposu (S-9): `fail` okuma/yazmayı düşürür — yazma düşerse HİÇBİR alan değişmez (işlem taklidi). */
export function memoryPresetStore(snap: PresetSnapshot | null): PresetStore & { snap: PresetSnapshot | null; writes: PresetWrite[]; fail: boolean } {
  const s = { snap, writes: [] as PresetWrite[], fail: false };
  return Object.assign(s, {
    read: async () => { if (s.fail) throw new Error("preset-store-down"); return s.snap === null ? null : structuredClone(s.snap); },
    write: async (w: PresetWrite) => { if (s.fail) throw new Error("preset-store-down"); s.writes.push(w);
      s.snap = { settings: w.settings, shares: w.shares, shareRow: true, brain: w.brain, preset: w.name, applied: w.applied }; },
  });
}

// ---- BAKİYE (mevcut okuyucular; yeni uç YOK) ----
/** Tur 88 (Üretim S17-3): `lotStepQuote` = borsanın LOT_SIZE adımının quote karşılığı (adım × ürünün mevcut kur okuyucusunun fiyatı); okunamazsa null — sayı UYDURULMAZ. */
export type Balance = { ok: true; freeQuote: string; quoteAsset: string; minNotional: string; symbol: string; lotStepQuote?: string | null } | { ok: false; why: "NO_KEY" | "CAPITAL_UNREADABLE" | "RULES_UNREADABLE"; detail: string };
export type BalanceSource = () => Promise<Balance>;
/** Serbest quote bakiyesi (imzalı hesap okuması, motorun boyutlandırmasıyla AYNI alan) + borsanın asgari emir tutarı (ürünün tavan okumasının da kullandığı başvuru sembolünün exchangeInfo filtresi). */
export const exchangeBalance: BalanceSource = async () => {
  const cap = await readCapital(QUOTE_ASSET);
  if (!cap.ok || cap.freeQuote === null || cap.freeQuote === undefined) return { ok: false, why: !cap.ok && cap.detail === "no-exchange-key" ? "NO_KEY" : "CAPITAL_UNREADABLE", detail: cap.ok ? "free-quote-missing" : cap.detail };
  const symbol = EXCHANGE_INFO.query.symbol, r = await readSymbolRules(symbol);
  if (!r.ok) return { ok: false, why: "RULES_UNREADABLE", detail: r.detail };
  let px: Awaited<ReturnType<typeof readRate>> | null = null;
  try { px = await readRate(r.rules.baseAsset, QUOTE_ASSET); } catch { px = null; /* fiyat okunamadı: adımın karşılığı bilinmez, sınırda koşulu yalnız "tutar = asgari"ye düşer (sayı uydurulmaz) */ }
  return { ok: true, freeQuote: cap.freeQuote, quoteAsset: QUOTE_ASSET, minNotional: r.rules.minNotional, symbol, lotStepQuote: px?.ok ? new D(r.rules.lot.step).mul(px.rate).toFixed(8) : null };
};

// ---- PLAN (motorun formülü; bakiye × pay) ----
export type PresetPlan = { positionUsdt: string | null; totalUsdt: string; maxConcurrent: number; proposable: true; borderline: boolean } | { positionUsdt: string | null; totalUsdt: string; maxConcurrent: number; proposable: false; refusal: SizingRefusal; borderline: false };
/** SAF. Tek pozisyon tutarı ve eş zamanlı sayı `planPositionSize`'dan (motorun kendisi); toplam = bakiye × toplam pay. Asgari tutarın altındaysa ÖNERİLMEZ (pay yukarı çekilmez, Ö-3).
 *  SINIRDA (Tur 88 · Üretim S17-3): motorun ve önizlemenin formülü DEĞİŞMEZ (`lt(min)` aynen); yalnız ekrana uyarı. Koşul OKUNAN kurallardan türer, yeni sayı/eşik YOK:
 *  önerilen tutar bir lot adımı (quote karşılığı) aşağı yuvarlanınca asgarinin altına düşebiliyorsa (tutar − adım < asgari) "sınırda"; adımın karşılığı okunamazsa yalnız tutar = asgari hâli sınırdadır. */
export function planPreset(name: PresetName, b: { freeQuote: string; minNotional: string; lotStepQuote?: string | null }): PresetPlan {
  const p = PRESETS[name], plan = planPositionSize({ freeCapital: b.freeQuote, minNotional: b.minNotional, sharePct: p.presetSinglePct });
  const totalUsdt = new D(b.freeQuote).mul(p.presetTotalPct).div(100).toFixed(8, D.ROUND_DOWN), byShare = new D(p.presetTotalPct).div(p.presetSinglePct).floor().toNumber();
  const maxConcurrent = plan.ok ? Math.min(plan.maxPositions, byShare) : 0;
  if (!plan.ok) return { positionUsdt: plan.positionSize, totalUsdt, maxConcurrent, proposable: false, refusal: plan.refusal, borderline: false };
  const pos = new D(plan.positionSize), min = new D(b.minNotional), adim = b.lotStepQuote === null || b.lotStepQuote === undefined ? null : new D(b.lotStepQuote);
  return { positionUsdt: plan.positionSize, totalUsdt, maxConcurrent, proposable: true, borderline: adim === null ? pos.lte(min) : pos.sub(adim).lt(min) };
}

// ---- ÖZEL ('Özel'): seçimden sonra profilin yazdığı alanlardan biri değiştiyse ----
const same = (a: string | null, b: string | null) => (a === null || b === null ? a === b : new D(a).eq(new D(b)));
/** SAF. Uygulanan anlık görüntü ile bugünkü değerler alan alan karşılaştırılır; profil seçili değilse 'Özel' de değildir. */
export function isCustom(s: PresetSnapshot): boolean {
  if (s.preset === null || s.applied === null) return false;
  const a = s.applied, now: PresetApplied = { singlePositionPct: s.shares.singlePositionPct, totalExposurePct: s.shares.totalExposurePct, leverageCap: s.settings.leverageCap,
    futuresEnabled: s.settings.futuresEnabled, shortMode: s.settings.shortMode, m2FuturesMultiple: s.settings.m2FuturesMultiple, tickMs: s.brain.tickMs };
  return !same(a.singlePositionPct, now.singlePositionPct) || !same(a.totalExposurePct, now.totalExposurePct) || a.leverageCap !== now.leverageCap || a.futuresEnabled !== now.futuresEnabled
    || a.shortMode !== now.shortMode || !same(a.m2FuturesMultiple, now.m2FuturesMultiple) || a.tickMs !== now.tickMs;
}

export type PresetDeps = { store?: PresetStore; keyFutures?: () => Promise<boolean | null>; balance?: BalanceSource; lang?: string };
const ctxOf = (keyFutures: boolean) => ({ keyFutures, edgeMultiple: EDGE_MULTIPLE, tickMs: CRON_PERIOD_MS });
const readKeyFutures = async (d: PresetDeps): Promise<boolean | null> => { try { return await (d.keyFutures ?? prismaKeyFutures)(); } catch { return null; } };
const readBalance = async (d: PresetDeps): Promise<Balance> => { try { return await (d.balance ?? exchangeBalance)(); } catch (e) { return { ok: false, why: "CAPITAL_UNREADABLE", detail: errName(e) }; } };

// ---- GÖRÜNÜM (GET) ----
export type PresetCard = { name: PresetName; values: PresetValues; plan: PresetPlan | null };
export type PresetView = { ok: true; selected: PresetName | null; custom: boolean; keyFutures: boolean | null; balance: Balance; cards: PresetCard[] } | { ok: false; reason: "PRESET_UNREADABLE"; detail: string };
export async function presetView(deps: PresetDeps = {}): Promise<PresetView> {
  let s: PresetSnapshot | null; try { s = await (deps.store ?? prismaPresetStore()).read(); } catch (e) { return { ok: false, reason: "PRESET_UNREADABLE", detail: errName(e) }; }
  if (s === null) return { ok: false, reason: "PRESET_UNREADABLE", detail: "no-row" };
  const [kf, bal] = await Promise.all([readKeyFutures(deps), readBalance(deps)]);
  const cards = PRESET_NAMES.map((name) => ({ name, values: presetValues(name, ctxOf(kf === true)), plan: bal.ok ? planPreset(name, bal) : null }));
  return { ok: true, selected: s.preset, custom: isCustom(s), keyFutures: kf, balance: bal, cards };
}

// ---- UYGULAMA (POST, kodla) ----
export type ApplyOutcome = { ok: true; name: PresetName; values: PresetValues; changes: { settings: SettingChange[]; shares: ShareChange[]; brain: BrainChange[] }; balanceChecked: boolean }
  | { ok: false; status: 400 | 409 | 503; reason: "INVALID" | "NO_ROW" | "NOT_OPENABLE" | "STORE_UNAVAILABLE"; errors: string[]; plan?: PresetPlan; balance?: Balance };
/** Doğrula → bakiyeyi ölç → değerleri ürünün kendi doğrulayıcılarından geçir → TEK işlemde yaz. Fırlatmaz. */
export async function applyPreset(name: unknown, by: string, deps: PresetDeps = {}): Promise<ApplyOutcome> {
  if (!isPresetName(name)) return { ok: false, status: 400, reason: "INVALID", errors: [`preset: ${String(name)} ∉ {${PRESET_NAMES.join(", ")}}`] };
  const store = deps.store ?? prismaPresetStore(), lang = deps.lang;
  let s: PresetSnapshot | null; try { s = await store.read(); } catch (e) { return { ok: false, status: 503, reason: "STORE_UNAVAILABLE", errors: [errName(e)] }; }
  if (s === null) return { ok: false, status: 409, reason: "NO_ROW", errors: ["risk_settings / brain_settings"] };
  const bal = await readBalance(deps);
  if (bal.ok) { const plan = planPreset(name, bal); if (!plan.proposable) return { ok: false, status: 409, reason: "NOT_OPENABLE", errors: [plan.refusal], plan, balance: bal }; }
  const v = presetValues(name, ctxOf((await readKeyFutures(deps)) === true));
  const rs = validatePatch(s.settings, v.settings, lang), sh = validateShares(s.shares, { singlePositionPct: Number(v.shares.singlePositionPct), totalExposurePct: Number(v.shares.totalExposurePct) }, lang),
    br = validateBrainPatch(s.brain, { tickMs: v.tickMs }, lang);
  const errors = [...(rs.ok ? [] : rs.errors), ...(sh.ok ? [] : sh.errors), ...(br.ok ? [] : br.errors)];
  if (!rs.ok || !sh.ok || !br.ok) return { ok: false, status: 400, reason: "INVALID", errors };
  const applied: PresetApplied = { ...v.shares, ...v.settings, tickMs: v.tickMs };
  try { await store.write({ name, by, settings: rs.next, settingChanges: rs.changes, shares: sh.next, shareChanges: sh.changes, createShareRow: !s.shareRow, brain: br.next, brainChanges: br.changes, from: s.preset, applied }); }
  catch (e) { return { ok: false, status: 503, reason: "STORE_UNAVAILABLE", errors: [errName(e)] }; }
  return { ok: true, name, values: v, changes: { settings: rs.changes, shares: sh.changes, brain: br.changes }, balanceChecked: bal.ok };
}
