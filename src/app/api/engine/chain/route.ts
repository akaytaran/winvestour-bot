// Zincir halkası ucu (G16). Sınıf: public (G04) — ama halka YALNIZ tek kullanımlık devir jetonuyla açılır (`x-chain-token`, Upstash GETDEL; consumeToken): jeton öncül halka
// ya da nöbetçi/yeniden başlatma tarafından yazılır; dışarıdan üretilemez. Yanıt hemen döner (202), halka `after` içinde fonksiyon ömrü boyunca koşar (A-4 ölçümü).
import { after } from "next/server";
import { withAccess } from "@/lib/access";
import { consumeToken, newLinkCtx, runLink } from "@/lib/chain";
export const dynamic = "force-dynamic";
// BÖLGE (Tur 12, G11 · S-5): bölge ABD DIŞI sabit; Edge YASAK (Edge bölgesi çağırana göre seçilir). Değer src/lib/region.ts BINANCE_REGION ile birebir aynı olmalı (kapı ölçer).
export const runtime = "nodejs";
export const preferredRegion = "hnd1";
/** Fonksiyon ömrü tavanı: Vercel Pro (ölçüldü: takım planı `pro`, Tur 19) en fazla 800 s'ye izin verir. Bu bir İSTEKTİR; gerçek ömür ölçülür (chain:link kayıtları). */
export const maxDuration = 800;

export const POST = withAccess({ cls: "public" }, async (req) => {
  const url = new URL(req.url), seq = Number(url.searchParams.get("seq"));
  if (!(await consumeToken(seq, req.headers.get("x-chain-token")))) return Response.json({ ok: false, reason: "CHAIN_TOKEN_INVALID" }, { status: 401 });
  const ctx = newLinkCtx(seq, url.origin);
  after(() => runLink(ctx));
  return Response.json({ ok: true, ...ctx, maxDuration }, { status: 202 });
});
