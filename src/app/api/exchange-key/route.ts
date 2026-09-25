// Anahtar kabul ucu (G06). Sınıf: sensitive, eylem EXCHANGE_KEY_WRITE (S-8: oturum + eylem başına TOTP). Gövde: { label, keyType, apiKey, privateKeyPem }.
// Yanıt yalnız kabul kimliği/parmak izi/ham yetki ya da {ok:false, reason, permission?} taşır; anahtarın hiçbir parçası yanıta ve loga girmez (S-2).
import { withAccess } from "@/lib/access";
import { acceptExchangeKey, REJECT_STATUS } from "@/lib/exchange-key";
export const dynamic = "force-dynamic";
// BÖLGE (Tur 12, G11 · S-5): bölge ABD DIŞI sabit; Edge YASAK (Edge bölgesi çağırana göre seçilir). Değer src/lib/region.ts BINANCE_REGION ile birebir aynı olmalı (kapı ölçer).
export const runtime = "nodejs";
export const preferredRegion = "hnd1";

export const POST = withAccess({ cls: "sensitive", action: "EXCHANGE_KEY_WRITE" }, async (req) => {
  let body: unknown; try { body = await req.json(); } catch { body = null; }
  const r = await acceptExchangeKey(body);
  return Response.json(r, { status: r.ok ? 201 : REJECT_STATUS[r.reason] });
});
