// ANAHTAR DÖNÜŞÜ — YENİDEN SARMA (G03, E-3). Eski sürümle çöz → yeni sürümle sar → encryption_key_version yükselt; satır satır, her satır kendi işleminde.
// Varsayılan KURU KOŞUM (hiçbir şey yazılmaz; çözülebilirlik yine de ölçülür). Yazmak için --write.
// Ortam (betik istisnası, prisma.config.ts gibi): DATABASE_URL · ENCRYPTION_MASTER_KEY (YENİ) · ENCRYPTION_KEY_VERSION (YENİ = eski+1) · ENCRYPTION_MASTER_KEY_PREVIOUS (ESKİ).
// Düz metin yalnız rewrapField içinde bellekte; bu betik hiçbir değeri yazdırmaz (S-2). Kullanım: npm run rotate:encryption-key [-- --write] [--json]
import pg from "pg";
import { keyringFrom, rewrapField, withDecrypted, CryptoServiceError } from "../src/lib/crypto/index.ts";

const write = process.argv.includes("--write"), asJson = process.argv.includes("--json");
const need = ["DATABASE_URL", "ENCRYPTION_MASTER_KEY", "ENCRYPTION_KEY_VERSION", "ENCRYPTION_MASTER_KEY_PREVIOUS"].filter((k) => !process.env[k]);
if (need.length) { console.error(`DÖNÜŞ DURDU — eksik ortam değişkeni: ${need.join(", ")}`); process.exit(2); }
let ring;
try { ring = keyringFrom({ masterKey: process.env.ENCRYPTION_MASTER_KEY, keyVersion: Number(process.env.ENCRYPTION_KEY_VERSION), previousKey: process.env.ENCRYPTION_MASTER_KEY_PREVIOUS }); }
catch (e) { console.error(`DÖNÜŞ DURDU — ${e instanceof CryptoServiceError ? e.message : "halka kurulamadı"}`); process.exit(2); }
if (!ring.previous) { console.error("DÖNÜŞ DURDU — PREVIOUS anahtar halkada yok"); process.exit(2); }
const toV = ring.current.version, fromV = ring.previous.version;
const FIELDS = [["api_key_ciphertext", "exchange_keys:api_key"], ["private_key_ciphertext", "exchange_keys:private_key"]];

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const report = { mode: write ? "write" : "dry-run", fromVersion: fromV, toVersion: toV, versionsFound: {}, candidates: 0, rewrapped: 0, skipped: 0, failed: [], remainingOldVersionRows: null, previousKeyRemovable: false };
try {
  for (const r of (await c.query("SELECT encryption_key_version AS v, count(*)::int AS n FROM exchange_keys GROUP BY 1 ORDER BY 1")).rows) report.versionsFound[r.v] = r.n;
  const strange = Object.keys(report.versionsFound).map(Number).filter((v) => v !== fromV && v !== toV);
  if (strange.length) throw new Error(`DÖNÜŞ DURDU — halkada olmayan sürümde satır var: ${strange.join(", ")} (sessiz geçiş yok)`);
  const ids = (await c.query("SELECT id FROM exchange_keys WHERE encryption_key_version = $1 ORDER BY id", [fromV])).rows.map((r) => r.id);
  report.candidates = ids.length;
  for (const id of ids) {
    await c.query("BEGIN");
    try {
      const row = (await c.query("SELECT id, api_key_ciphertext, private_key_ciphertext, encryption_key_version FROM exchange_keys WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!row || row.encryption_key_version !== fromV) { await c.query("ROLLBACK"); report.skipped++; continue; }
      const fresh = {};
      for (const [col, field] of FIELDS) {
        fresh[col] = rewrapField(field, { ciphertext: row[col], encryptionKeyVersion: fromV }, ring);
        withDecrypted(field, fresh[col], () => true, ring); // yeni zarf yeni anahtarla açılıyor mu — yazmadan önce ölçülür
      }
      if (write) {
        const u = await c.query("UPDATE exchange_keys SET api_key_ciphertext = $1, private_key_ciphertext = $2, encryption_key_version = $3 WHERE id = $4 AND encryption_key_version = $5",
          [fresh.api_key_ciphertext.ciphertext, fresh.private_key_ciphertext.ciphertext, toV, id, fromV]);
        if (u.rowCount !== 1) throw new Error(`satır ${id}: güncelleme ${u.rowCount} satır etkiledi`);
        await c.query("COMMIT");
      } else await c.query("ROLLBACK");
      report.rewrapped++;
    } catch (e) { await c.query("ROLLBACK"); report.failed.push({ id, code: e instanceof CryptoServiceError ? e.code : "db", message: String(e.message).slice(0, 120) }); }
  }
  report.remainingOldVersionRows = (await c.query("SELECT count(*)::int AS n FROM exchange_keys WHERE encryption_key_version <> $1", [toV])).rows[0].n;
  report.previousKeyRemovable = write && report.remainingOldVersionRows === 0 && report.failed.length === 0;
} finally { await c.end(); }

if (asJson) console.log(JSON.stringify(report, null, 1));
else {
  console.log(`DÖNÜŞ ${report.mode} — v${fromV} → v${toV}: aday=${report.candidates} yeniden sarıldı=${report.rewrapped} atlandı=${report.skipped} başarısız=${report.failed.length} eski sürümde kalan=${report.remainingOldVersionRows}`);
  for (const f of report.failed) console.log(`  ✖ satır ${f.id} [${f.code}] ${f.message}`);
  if (report.previousKeyRemovable) console.log(`ESKİ SÜRÜMDE SATIR KALMADI — ENCRYPTION_MASTER_KEY_PREVIOUS artık Vercel'den SİLİNEBİLİR (E-3: silmeden önce yeni anahtarın ikinci kopyası parola yöneticisinde olmalı).`);
  else if (!write) console.log(`Kuru koşum: hiçbir şey yazılmadı. Yazmak için: npm run rotate:encryption-key -- --write`);
}
process.exit(report.failed.length === 0 && (write ? report.remainingOldVersionRows === 0 : true) ? 0 : 1);
