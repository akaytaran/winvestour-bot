// RİSK PAYLARI YÜZEYİ (Tur 78 · G33 · K-9, A-1/A-6, S-8, E-1, Ö-3, U-3). Sınıflar (G04): GET session · POST sensitive + RISK_PROFILE_CHANGE (oturum + EYLEM BAŞINA TOTP).
// Eylem adı sicildeki `RISK_PROFILE_CHANGE`tir ("risk profili değiştirme (K-9, M-1 sayıları)") — bu tabloyu adlandıran ve G04'ten beri hiçbir uçta kullanılmayan ad; ikinci ad AÇILMADI.
// GET: iki pay (NULL ise "not set") · satır var mı · son değişiklikler (E-1 izi). POST: { singlePositionPct?, totalExposurePct? } — HER yazım kod ister (NULL'dan ilk değer de yükseltmedir);
//   açık liste dışı alan, sayı olmayan değer ve yazılı sınırın dışı REDDEDİLİR (400), kırpılmaz/yuvarlanmaz; pay ve E-1 defteri AYNI işlemde (src/lib/risk-settings).
// BU UÇ HİÇBİR SAYI ÖNERMEZ: varsayılan/örnek/tohum yok (A-1/A-6 — sayı iş sahibinindir). Pay değişmesi tek başına hiçbir emir göndermez; durdurma bu uca bağlı değildir (K-7).
import { withAccess } from "@/lib/access";
import { readRiskShares, prismaRiskSharesStore, writeRiskShares } from "@/lib/risk-settings";
import { type Dict } from "@/lib/i18n";
import { forRequest } from "@/lib/i18n/request";
// Tur 79 (G34): insan metni isteğin dilinde (`forRequest`: seçim çerezi → Accept-Language → EN); durum kodu, ret kodu ve JSON anahtarları dilden bağımsız.
export const dynamic = "force-dynamic";
// BÖLGE (Tur 12, G11 · S-5): bölge ABD DIŞI sabit; Edge YASAK. Değer src/lib/region.ts BINANCE_REGION ile birebir aynı olmalı (kapı ölçer).
export const runtime = "nodejs";
export const preferredRegion = "hnd1";

const view = async (lang: string, T: Dict) => {
  const r = await readRiskShares({ lang });
  if (!r.ok) return { ok: false as const, reason: "RISK_SHARES_UNREADABLE", detail: r.detail, note: T.api.riskSharesUnreadable };
  // Defter okunamazsa changes = null ("boş" SAYILMAZ, ekran bunu ayırır). Tur 78 gerilemesi: .catch(() => null) biçimi gate:events silent-catch kuralına takıldı — hata açıkça dala çevrildi.
  let changes: Awaited<ReturnType<ReturnType<typeof prismaRiskSharesStore>["changes"]>> | null; try { changes = await prismaRiskSharesStore().changes(10); } catch { changes = null; }
  const shown = (v: string | null) => v ?? T.common.notSet;
  return { ok: true as const, shares: r.shares, text: { singlePositionPct: shown(r.shares.singlePositionPct), totalExposurePct: shown(r.shares.totalExposurePct) }, rowExists: r.rowExists,
    note: T.api.riskSharesNote, changes: changes === null ? null : changes.map((c) => ({ at: c.at.toISOString(), by: c.by, changes: c.changes })) };
};

export const GET = withAccess({ cls: "session" }, async (req) => { const { lang, T } = forRequest(req), v = await view(lang, T); return Response.json(v, { status: v.ok ? 200 : 503 }); });

export const POST = withAccess({ cls: "sensitive", action: "RISK_PROFILE_CHANGE" }, async (req) => {
  const { lang, T } = forRequest(req);
  let body: unknown; try { body = await req.json(); } catch { body = null; }
  const w = await writeRiskShares(body, "sahip · oturum + TOTP", { lang });
  if (!w.ok) return Response.json(w, { status: w.status });
  return Response.json({ ok: true, applied: w.changes, next: w.next, note: w.changes.length === 0 ? T.api.riskSharesSame : T.api.riskSharesApplied, view: await view(lang, T) }, { status: 200 });
});
