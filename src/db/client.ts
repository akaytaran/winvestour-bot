// Tek Prisma istemcisi. Bağlantı dizesi ortam sözleşmesinden gelir (src/lib/env.ts), doğrudan process.env'den değil.
// Tur 9 (G08, K-7): DAR sözleşme (yalnız DATABASE_URL) — ilgisiz bir değişkenin eksikliği durdurma bayrağının Neon kopyasını engellemez; tam sözleşme açılışta doğrulanır.
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { pickEnv } from "@/lib/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function getDb(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;
  const adapter = new PrismaPg({ connectionString: pickEnv("DATABASE_URL").DATABASE_URL });
  const client = new PrismaClient({ adapter });
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = client;
  return client;
}
