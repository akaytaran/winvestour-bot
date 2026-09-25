// Prisma CLI yapılandırması (Prisma 7). Göçler DIRECT_URL (havuzsuz) ile koşar; shadow DB ayrı Neon dalıdır.
// Not: bu dosya yalnız CLI tarafından okunur; uygulama kodu process.env'i doğrudan okumaz (src/lib/env.ts). Kabul edilen tek istisna.
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.DIRECT_URL ?? "",
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL || undefined,
  },
});
