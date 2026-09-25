// K-6 KANARYA PENCERESİ (Tur 50 · G21 kapanma şartı 11 · ANAYASA K-6 altındaki 2026-09-19 tarihli not · ÜRETİM KARARI `winvestor-k6-kanarya-penceresi` = [C] İKİSİ BİRDEN).
// K-6 kanaryası (`canary:execution-lock`) "kaldıraç açılmadan HEMEN ÖNCE" koşulmuş sayılır ANCAK: (1) koşum, kaldıracı açacak kodun ÇALIŞTIĞI dağıtımın commit'inde yapılmış VE
//   (2) 24 saatten eski DEĞİL. Commit şartı KODU, 24 saat ORTAMI bağlar (Tur 46/47: kapı kırmızılarının kaynağı çoğu zaman ortam). Kapalı-varsayılan: kayıt okunamıyorsa, yoksa,
//   commit tutmuyorsa, eskiyse — ya da kanarya BEKLENEN bitmemişse, kirli ağaçta koşulmuşsa, damgası okunamıyor/gelecekteyse — istek REDDEDİLİR. Saat kayması toleransı YOKTUR.
// KAYIT DEPOSU: kanarya kaydı tam gerileme koşucusunun özetine yazılır (scripts/regression/run-regression.mjs → <log>/_ozet.json, satır başına commit + temiz ağaç + zaman). Üretimin
//   OKUYABİLDİĞİ bir kanarya kaydı deposu YOKTUR (ölçüldü, Tur 50) ve bu modül depo İCAT ETMEZ: varsayılan okuyucu kapalıdır ⇒ üretimde her kabul bugün bu kodla reddedilir.
export const K6_CANARY_SCRIPT = "canary:execution-lock" as const;
/** Kararın (K-A) verdiği TEK sayı: kayıt en çok bu kadar eski olabilir (sınır dâhil). Başka eşik, tolerans ya da "yaklaşık" pencere YOKTUR. */
export const K6_CANARY_MAX_AGE_MS = 24 * 3_600_000;
export const K6_WINDOW_REFUSAL = "leverage-refused:k6-canary-outside-window" as const;

export type K6CanaryRecord = { script: string; commit: string; treeClean: boolean; at: string; verdict: string };
export type K6RecordRead = { ok: true; record: K6CanaryRecord | null } | { ok: false; detail: string };
export type K6Deps = { record?: () => Promise<K6RecordRead>; deployCommit?: () => string | null; now?: () => number };

/** Varsayılan okuyucu KAPALIDIR: üretimin okuyabildiği kanarya kaydı deposu yok (yeni depo bu turun işi değil; G21-f, sicil S50-1). */
export const noK6RecordStore = async (): Promise<K6RecordRead> => ({ ok: false, detail: "üretimin okuyabildiği K-6 kanarya kayıt deposu YOK (kayıt yalnız yerel gerileme özetinde, _ozet.json)" });
/** Varsayılan: dağıtımın commit kimliğini okuyan yol YOK (ad ortam sözleşmesinde değil, src/lib/env.ts) ⇒ commit şartı ölçülemez ⇒ ret. */
export const noDeployCommit = (): string | null => null;

const COMMIT = /^[0-9a-f]{40}$/;
/** Pencere denetimi. Fırlatmaz; ilk tutmayan şartın adını döner. */
export async function checkK6Window(deps: K6Deps = {}): Promise<{ ok: true; detail: string } | { ok: false; detail: string }> {
  let read: K6RecordRead; try { read = await (deps.record ?? noK6RecordStore)(); } catch (e) { read = { ok: false, detail: "kayıt okunamadı (" + ((e as Error)?.name ?? "hata") + ")" }; }
  if (!read.ok) return { ok: false, detail: `K-6 kanarya kaydı okunamadı: ${read.detail}` };
  const r = read.record, dep = (deps.deployCommit ?? noDeployCommit)(), now = (deps.now ?? Date.now)();
  if (r === null) return { ok: false, detail: `K-6 kanarya kaydı YOK (${K6_CANARY_SCRIPT} koşulmamış)` };
  if (r.script !== K6_CANARY_SCRIPT) return { ok: false, detail: `kayıt ${JSON.stringify(r.script)} kanaryasının, K-6 kanaryası ${K6_CANARY_SCRIPT}` };
  if (r.verdict !== "BEKLENEN") return { ok: false, detail: `K-6 kanaryası BEKLENEN bitmemiş (${JSON.stringify(r.verdict)})` };
  if (dep === null || !COMMIT.test(dep)) return { ok: false, detail: "dağıtımın commit kimliği okunamadı — commit şartı ölçülemez" };
  if (!COMMIT.test(r.commit) || r.commit !== dep) return { ok: false, detail: `kanarya ${r.commit.slice(0, 12)} commit'inde koşulmuş, çalışan dağıtım ${dep.slice(0, 12)}` };
  if (r.treeClean !== true) return { ok: false, detail: "kanarya kirli çalışma ağacında koşulmuş — koşan kod commit'le aynı değil" };
  const t = Date.parse(r.at);
  if (!Number.isFinite(t)) return { ok: false, detail: `kayıt zamanı okunamadı (${JSON.stringify(r.at)})` };
  if (t > now) return { ok: false, detail: `kayıt zamanı gelecekte (${r.at}) — saat kayması toleransı yok` };
  if (now - t > K6_CANARY_MAX_AGE_MS) return { ok: false, detail: `K-6 kanaryası ${r.at} tarihinde koşulmuş: ${K6_CANARY_MAX_AGE_MS / 3_600_000} saatten eski` };
  return { ok: true, detail: `K-6 kanaryası ${r.commit.slice(0, 12)} commit'inde ${r.at} tarihinde BEKLENEN bitti` };
}
