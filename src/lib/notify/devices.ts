// CİHAZ KAYDI (Tur 28, G20 madde 4 · U-1, U-2). Bildirimin GİDECEĞİ ADRES. Jetonun saklanacağı yer belgede YAZILI DEĞİLDİ ⇒ icat edilmedi, İŞ SAHİBİNE SORULDU (2026-09-17) ve Neon seçildi
// (kalıcı adres: telefon aylarca açılmasa da durur; Upstash kopyası TTL ile sönerdi ve sessiz bir "adres yok" hâli üretirdi). TİK YOLUNDA OKUNMAZ: yalnız durma anında, olay yazımıyla
// aynı uyanıklıkta okunacaktır ⇒ A-9 uyanıklığı artmaz. BUGÜN HİÇ OKUNMUYOR ve bu bir eksiklik değil ÖLÇÜLEN DURUMDUR: köprü bu tura alınmadı (madde 1) ve onu okuyacak tek yol köprüydü
// ⇒ ne tik yolu ne durma yolu `list()` çağırıyor (kapı ölçer). Adres bu turda yazılır, okuyan taraf sonraki turda gelir. Jeton bir SIR DEĞİLDİR: tek başına bildirim gönderilemez (gönderim servis hesabı imzası ister) ⇒ zarf yok (S-1 kapsamı dışı).
// KAYIT SAHİBİN OTURUMUYLA YAPILIR (G04 `session`): kimliksiz bir çağrı cihaz ekleyemez. Aynı jeton ikinci kez gelirse YENİ SATIR AÇILMAZ, `last_seen_at` tazelenir (tekil kısıt son savunma).
import { getDb } from "@/db/client";
import type { PrismaClient } from "@/generated/prisma/client";

export const PLATFORMS = ["android", "web"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const isPlatform = (v: unknown): v is Platform => (PLATFORMS as readonly string[]).includes(String(v));
/** Jetonun biçimi taşıyıcının işidir; burada yalnız "opak ve makul uzunlukta" denetlenir (DB CHECK ≥ 16 son savunma). İçeriği yorumlanmaz, kayda ya da olaya YAZILMAZ. */
export const TOKEN_MIN = 16, TOKEN_MAX = 4096;
export type DeviceRow = { id: number; token: string; platform: Platform; label: string | null };
export interface DeviceStore {
  readonly name: string;
  list(): Promise<DeviceRow[]>;
  register(input: { token: string; platform: Platform; label: string | null; at: Date }): Promise<{ id: number }>;
  markSend(ids: readonly number[], ok: boolean, at: Date): Promise<void>;
}

export const prismaDeviceStore = (client?: PrismaClient): DeviceStore => {
  const db = () => client ?? getDb();
  return {
    name: "neon",
    list: async () => (await db().deviceToken.findMany({ select: { id: true, token: true, platform: true, label: true }, orderBy: { lastSeenAt: "desc" } })).map((r) => ({ ...r, platform: r.platform as Platform })),
    register: async (i) => db().deviceToken.upsert({ where: { token: i.token }, create: { token: i.token, platform: i.platform, label: i.label, lastSeenAt: i.at }, update: { platform: i.platform, label: i.label, lastSeenAt: i.at }, select: { id: true } }),
    markSend: async (ids, ok, at) => { if (ids.length) await db().deviceToken.updateMany({ where: { id: { in: [...ids] } }, data: { lastSendAt: at, lastSendOk: ok } }); },
  };
};
/** BELLEK DEPOSU — yalnız kapı/kanarya (S-9). */
export const memoryDeviceStore = (rows: DeviceRow[] = []): DeviceStore & { readonly rows: DeviceRow[] } => ({
  name: "bellek", rows,
  list: async () => rows,
  register: async (i) => { const ex = rows.find((r) => r.token === i.token); if (ex) { ex.platform = i.platform; ex.label = i.label; return { id: ex.id }; } const row = { id: rows.length + 1, token: i.token, platform: i.platform, label: i.label }; rows.push(row); return { id: row.id }; },
  markSend: async () => {},
});

export type RegisterResult = { ok: true; id: number; devices: number } | { ok: false; status: number; reason: "BAD_TOKEN" | "BAD_PLATFORM" | "STORE_UNAVAILABLE" };
/** Kaydı yazan TEK yol. Girdi biçimi reddedilirse 400; depo düşerse 503 — sessiz "kaydedildi" YOKTUR (kaydedilmemiş cihaz bildirim alamaz ve bunu bilmek sahibin hakkıdır). */
export async function registerDevice(body: unknown, at: Date, store: DeviceStore = prismaDeviceStore()): Promise<RegisterResult> {
  const b = (body ?? {}) as { token?: unknown; platform?: unknown; label?: unknown };
  const token = typeof b.token === "string" ? b.token.trim() : "";
  if (token.length < TOKEN_MIN || token.length > TOKEN_MAX) return { ok: false, status: 400, reason: "BAD_TOKEN" };
  if (!isPlatform(b.platform)) return { ok: false, status: 400, reason: "BAD_PLATFORM" };
  const label = typeof b.label === "string" && b.label.trim().length ? b.label.trim().slice(0, 60) : null;
  try { const r = await store.register({ token, platform: b.platform, label, at }); return { ok: true, id: r.id, devices: (await store.list()).length }; }
  catch { return { ok: false, status: 503, reason: "STORE_UNAVAILABLE" }; }
}
