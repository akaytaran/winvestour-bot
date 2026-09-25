// CARRY MARUZİYETİ — K-9 PORTFÖY TAVANINA SAYILIŞ (Tur 39 · G22 kalemi i · Üretim Kararı 3 `winvestor-carry-maruziyeti-brut-net` · K-9, A-1, Ö-2, Ö-3). Kapı: scripts/gate-funding.mjs (7).
// KARAR 3: carry pozisyonunun (SPOT LONG + FUTURES SHORT) maruziyeti BRÜTTÜR — iki bacağın TOPLAMI sayılır. Gerekçe K-9'un düz okumasıdır: tavan "eş zamanlı toplam maruziyet"tir,
//   netleştirme kuralın metninde YAZILI DEĞİL ve icat edilemez. Yön geri dönülmez tarafa kapalıdır: brütten nete geçiş ileride iş sahibi kararıyla mümkündür; netten brüte dönmek açılmış
//   pozisyonları tavanın üstünde bırakırdı. Bu yüzden bacaklar YÖNE GÖRE İŞARETLENMEZ, birbirinden ÇIKARILMAZ (kapı: çıkarma/işaret KIRMIZI).
// KABUL KRİTERİ K-9'DAN TÜRETİLDİ (sayı seçilmedi): K-9'un İKİ sınırı da aynı brüt tutarla denetlenir — toplam tavan (birinci) ve tek pozisyon payı (ikinci, daha dar). Carry TEK pozisyondur
//   (iki bacak birlikte açılır, birlikte kapanır); onun maruziyeti = brüt ⇒ tek pozisyon payı da brüte uygulanır. Tavanların SAYISI burada YOKTUR (A-1, iş sahibi): `risk_profile`'dan okunur.
// AÇIK MARUZİYET: `prismaExposureReader` (./index.ts) her açık pozisyonu miktar × giriş fiyatı ile TOPLAR; `positions_positive` (quantity > 0) işaretli miktarı imkânsız kılar ⇒ iki bacak
//   iki satır olarak durduğunda okuyucu ZATEN brüt sayar (Tur 39 ölçümü, kanarya adım 17). Bu dosya SPOT yolunu DEĞİŞTİRMEZ: ./index.ts, ./cost.ts bayt bayt aynıdır.
// CARRY_HEDGE İCRASI (G22 kalemi g) BURADA YOKTUR: bu modül emir kurmaz, borsaya gitmez; yalnız maruziyetin NASIL sayılacağını tanımlar. Bugün bu fonksiyonu çağıran ürün yolu 0'dır.
import { Prisma } from "@/generated/prisma/client";
import { judgeExposure, type ExposureVerdict } from "./index";

const D = Prisma.Decimal, NUM = /^\d+(\.\d+)?$/;
/** KARAR 3 (Üretim, 2026-09-18): carry maruziyeti BRÜT. Değişecekse önce karar değişir (iş sahibi); kapı bu değeri ve toplamanın kendisini ölçer. */
export const CARRY_EXPOSURE_BASIS = "GROSS" as const;
export type CarryLeg = { venue: "SPOT" | "FUTURES"; side: "LONG" | "SHORT"; notional: string };
export type CarryGross = { ok: true; gross: string; workings: string } | { ok: false; detail: string };

/** SAF. Carry = tam olarak iki bacak: SPOT LONG + FUTURES SHORT. Her bacağın büyüklüğü işaretsiz ondalıktır; brüt = bacakların TOPLAMI (yön işareti yok, çıkarma yok). */
export function carryGrossNotional(legs: CarryLeg[]): CarryGross {
  const spot = legs.filter((l) => l.venue === "SPOT" && l.side === "LONG"), fut = legs.filter((l) => l.venue === "FUTURES" && l.side === "SHORT");
  if (legs.length !== 2 || spot.length !== 1 || fut.length !== 1) return { ok: false, detail: `carry iki bacaktır (SPOT LONG + FUTURES SHORT); verilen: ${legs.map((l) => `${l.venue} ${l.side}`).join(" + ") || "hiç"}` };
  let gross = new D(0);
  for (const l of legs) { if (!NUM.test(l.notional)) return { ok: false, detail: `bacak büyüklüğü ölçülemedi (${l.venue} ${l.side} = ${l.notional})` }; const n = new D(l.notional); gross = gross.add(n); }
  return { ok: true, gross: gross.toFixed(8), workings: `carry brüt = SPOT LONG ${new D(spot[0].notional).toFixed(8)} + FUTURES SHORT ${new D(fut[0].notional).toFixed(8)} = ${gross.toFixed(8)} (Karar 3: iki bacağın toplamı; net risk SAYILMAZ)` };
}

/** SAF. Carry adayının K-9 hükmü: brüt tutar YENİ maruziyet olarak `judgeExposure`'a gider (toplam tavan + tek pozisyon payı). Bacak ölçülemezse karar verilmez (EXPOSURE_UNKNOWN, Ö-2). */
export function judgeCarryExposure(i: { capital: string; openExposure: string; legs: CarryLeg[]; totalPct: string | null; singlePct: string | null }): ExposureVerdict {
  const g = carryGrossNotional(i.legs);
  if (!g.ok) return { ok: false, refusal: "EXPOSURE_UNKNOWN", detail: g.detail, workings: [] };
  const v = judgeExposure({ capital: i.capital, openExposure: i.openExposure, newNotional: g.gross, totalPct: i.totalPct, singlePct: i.singlePct });
  return { ...v, workings: [g.workings, ...v.workings] };
}
