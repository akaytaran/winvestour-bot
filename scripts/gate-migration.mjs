// VERİ SİLEN GÖÇ KAPISI (Tur 32 madde 2 · ANAYASA E-1 notu 2026-09-17, iş sahibi kararı `winvestor-otomatik-goc`). Sözleşme {ok, checked, findings}; --json. Tek komut: npm run gate:migration.
// ÜRETİM DERLEMESİNİN İLK ADIMIDIR (`vercel-build`): KIRMIZI ⇒ derleme durur ⇒ `prisma migrate deploy` KOŞMAZ. Bu yüzden yalnız Node yerleşikleri içe aktarılır (derleme ortamında tsx yok).
// EVREN: prisma.config.ts'in `migrations.path`i altındaki HER `*/migration.sql` (uygulanmış ya da bekleyen ayrımı YOK — kapı üretime bağlanmaz); `checked === 0` YEŞİL DEĞİLDİR.
// ALFABE (Tur 32 madde 0c, `node scripts/measure-migration-alphabet.mjs`: 9 göç · ham `drop|delete|truncate` adayı 6 · gerçek ihlal 0): İHLAL = `DROP TABLE` · `DROP COLUMN` (ALTER TABLE altında
//   `COLUMN` sözcüğü yazılmadan `DROP "sütun"` da) · `DELETE FROM` · `TRUNCATE`. İHLAL DEĞİL = `DROP DEFAULT` · `DROP CONSTRAINT` · `DROP INDEX` · `DROP NOT NULL` · `DROP EXPRESSION` ·
//   `DROP IDENTITY` · yabancı anahtarın `ON DELETE` kuralı · yorum · dize/tanımlayıcı içi metin. Ayrıştırma: yorum (`--`, `/* */`), dize ('…', $etiket$…$etiket$) ve "tanımlayıcı" boşlukla silinir, `;` ile ifadeye bölünür.
// KIRMIZI ayrıca: `vercel-build` yoksa, sırası kapı → `prisma migrate deploy` → `next build` değilse ya da zincir `&&` dışında bir işleç taşıyorsa (`;` `||` `|` `&` — göç başarısızken derleme SESSİZCE sürer).
// ONAY YOLU YOK: onaylanmış veri silen göçün nasıl geçeceği belgede yazılı değil (ANAYASA E-1 notu) ⇒ kapı onu da KIRMIZI sayar, iş sahibine sorulur.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const asJson = process.argv.includes("--json");
const findings = []; let checked = 0;
const out = () => { const ok = checked > 0 && findings.length === 0; if (asJson) console.log(JSON.stringify({ ok, checked, findings }, null, 1)); else { console.log(`${ok ? "YEŞİL" : "KIRMIZI"} — checked=${checked} findings=${findings.length}`); for (const f of findings) console.log(`  ✖ [${f.rule}] ${f.where} — ${f.detail}`); } process.exit(ok ? 0 : 1); };
const bad = (rule, where, detail) => findings.push({ rule, where, detail });
const expect = (rule, where, cond, detail) => { checked++; if (!cond) bad(rule, where, detail); };

/** Yorum, dize ve "tanımlayıcı" içeriğini aynı uzunlukta boşlukla değiştirir (satır sonları korunur ⇒ satır numarası doğru kalır). */
export function blankNonCode(sql) {
  let o = "", i = 0; const keep = (s) => s.replace(/[^\n]/g, " ");
  while (i < sql.length) {
    const c = sql[i], two = sql.slice(i, i + 2);
    let end = -1;
    if (two === "--") { end = sql.indexOf("\n", i); if (end < 0) end = sql.length; }
    else if (two === "/*") { end = sql.indexOf("*/", i + 2); end = end < 0 ? sql.length : end + 2; }
    else if (c === "'" || c === '"') { end = i + 1; while (end < sql.length) { if (sql[end] === c) { if (sql[end + 1] === c) { end += 2; continue; } end++; break; } end++; } }
    else if (c === "$") { const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i)); if (m) { const close = sql.indexOf(m[0], i + m[0].length); end = close < 0 ? sql.length : close + m[0].length; } }
    if (end > i) { o += c === '"' ? '"' + keep(sql.slice(i + 1, end - 1)) + '"' : keep(sql.slice(i, end)); i = end; } else { o += c; i++; }
  }
  return o;
}
const NOT_COLUMN = "(?:CONSTRAINT|DEFAULT|NOT\\s+NULL|EXPRESSION|IDENTITY)\\b";
/** Veri silen ifade kuralları. Girdi: blankNonCode'dan geçmiş TEK ifade. */
export const DATA_LOSS = [
  { rule: "drop-table", re: /\bDROP\s+TABLE\b/i },
  { rule: "drop-column", re: new RegExp(`\\bALTER\\s+TABLE\\b[\\s\\S]*\\bDROP\\s+(?!${NOT_COLUMN})(?:COLUMN\\b|(?:IF\\s+EXISTS\\s+)?(?:"|[A-Za-z_]))`, "i") },
  { rule: "delete-from", re: /\bDELETE\s+FROM\b/i },
  { rule: "truncate", re: /\bTRUNCATE\b/i },
];
/** Bir göç metninin ihlalleri: [{ rule, line, text }]. `statements` = taranan ifade sayısı. */
// Tur 81 (G35): yayın kapısının artımlı göç kuralı (gate-publish.mjs (J)) AYNI alfabeyi bu dosyadan içe aktarır — kopyası yok. Ana blok yalnız doğrudan koşulunca çalışır (vercel-build zinciri aynı).
export function scanSql(sql) {
  const code = blankNonCode(sql), hits = []; let statements = 0, start = 0;
  for (const part of code.split(";")) {
    const at = start; start += part.length + 1;
    if (!part.trim()) continue; statements++;
    for (const r of DATA_LOSS) {
      if (!r.re.test(part)) continue;
      const lead = part.search(/\S/), line = sql.slice(0, at + lead).split("\n").length;
      hits.push({ rule: r.rule, line, text: sql.slice(at + lead, at + part.length).replace(/\s+/g, " ").trim().slice(0, 120) });
    }
  }
  return { statements, hits };
}

const isMain = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // ---- EVREN: prisma.config.ts'in göç yolu (migrate deploy'un uyguladığı yer) ----
  const cfg = existsSync("prisma.config.ts") ? readFileSync("prisma.config.ts", "utf8") : "";
  const dir = /migrations:\s*\{\s*path:\s*"([^"]+)"/.exec(cfg)?.[1] ?? null;
  expect("universe-unknown", "prisma.config.ts", dir !== null && existsSync(dir), `göç yolu okunamadı ya da yok (${dir}) — evren bilinmeden kapı yeşil olamaz`);
  const files = dir && existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(dir, d.name, "migration.sql").split("\\").join("/")).filter((f) => existsSync(f)).sort() : [];
  expect("no-migrations", dir ?? "(göç yolu)", files.length > 0, "taranacak göç dosyası yok — checked=0 yeşil değildir");
  let statements = 0;
  for (const f of files) {
    const r = scanSql(readFileSync(f, "utf8")); statements += r.statements; checked++;
    for (const h of r.hits) bad(`data-loss-${h.rule}`, `${f}:${h.line}`, `veri/sütun/tablo SİLEN ifade — göç otomatik UYGULANMAZ, derleme durur, iş sahibine sorulur (ANAYASA E-1, 2026-09-17): ${h.text}`);
  }
  // ---- ALFABE ÖZ DENETİMİ: kuralın kendisi bozulursa (yanlış pozitif ya da kaçırma) kapı KIRMIZI ----
  const SELF = [
    ['ALTER TABLE "t" ALTER COLUMN "c" DROP DEFAULT;', 0], ['ALTER TABLE "t" DROP CONSTRAINT "k";', 0], ['DROP INDEX "i";', 0], ['ALTER TABLE "t" ALTER COLUMN "c" DROP NOT NULL;', 0],
    ['ALTER TABLE "a" ADD CONSTRAINT "f" FOREIGN KEY ("x") REFERENCES "b"("id") ON DELETE CASCADE;', 0], ["-- DROP TABLE \"t\";\nCOMMENT ON TABLE \"t\" IS 'DELETE FROM t; TRUNCATE t';", 0],
    ['DROP TABLE "t";', 1], ['DROP TABLE IF EXISTS "t";', 1], ['ALTER TABLE "t" DROP COLUMN "c";', 1], ['ALTER TABLE "t" DROP "c";', 1], ['ALTER TABLE "t" DROP IF EXISTS "c";', 1],
    ['ALTER TABLE "t" ALTER COLUMN "a" SET DEFAULT 0, DROP COLUMN "b";', 1], ['DELETE FROM "t" WHERE id = 1;', 1], ['TRUNCATE "t";', 1],
  ];
  for (const [sql, n] of SELF) expect("alphabet-selftest", "scripts/gate-migration.mjs", scanSql(sql).hits.length === n, `kural alfabesi bozuk: ${JSON.stringify(sql)} → ${scanSql(sql).hits.length} ihlal (beklenen ${n})`);
  // ---- DERLEME ZİNCİRİ: kapı → göç → derleme, yalnız && ----
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {}, vb = scripts["vercel-build"];
  expect("build-not-migrating", "package.json", typeof vb === "string", "`vercel-build` betiği yok — üretim derlemesi göçü uygulamaz (ANAYASA E-1, 2026-09-17)");
  if (typeof vb === "string") {
    const steps = vb.split("&&").map((s) => s.trim());
    expect("build-silent-pass", "package.json", !/;|\|\||(?<!&)&(?!&)|(?<!\|)\|(?!\|)/.test(vb), `\`vercel-build\` zinciri && dışında işleç taşıyor — göç ya da kapı başarısızken derleme sessizce sürer: ${vb}`);
    expect("build-order", "package.json", JSON.stringify(steps) === JSON.stringify(["node scripts/gate-migration.mjs", "prisma migrate deploy", "next build"]), `\`vercel-build\` sırası kapı → prisma migrate deploy → next build değil: ${JSON.stringify(steps)}`);
  }
  if (!asJson) console.log(`evren: ${files.length} göç dosyası (${dir}) · ${statements} ifade · alfabe öz denetimi ${SELF.length}`);
  out();
}
