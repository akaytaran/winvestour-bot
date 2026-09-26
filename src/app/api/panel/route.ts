// PANEL UCU (G18 · Tur 26 madde 1–3). Sınıf: session (G04) — paneldeki her rakam hesabın durumudur, oturumsuz görünmez. YALNIZ OKUMA: hiçbir depoya yazmaz, tik yolunun kopyalarını tazelemez.
// Harcama/ayar bu uçta YOKTUR: o bilgi Tur 25'in GET /api/brain/settings ucundan gelir ve panel sayfası onu ayrıca çağırır — ikinci bir hesap yazılmadı (prompt madde 1).
import { withAccess } from "@/lib/access";
import { readPanel } from "@/lib/panel";
import { reqLang } from "@/lib/i18n/request";
// Tur 79 (G34): insan metni isteğin dilinde (`forRequest`: seçim çerezi → Accept-Language → EN); durum kodu, ret kodu ve JSON anahtarları dilden bağımsız.

export const dynamic = "force-dynamic";
// BÖLGE (Tur 12, G11 · S-5): bölge ABD DIŞI sabit; Edge YASAK (Edge bölgesi çağırana göre seçilir). Değer src/lib/region.ts BINANCE_REGION ile birebir aynı olmalı (kapı ölçer).
export const runtime = "nodejs";
export const preferredRegion = "hnd1";

export const GET = withAccess({ cls: "session" }, async (req) => Response.json(await readPanel({}, reqLang(req)), { status: 200 }));
