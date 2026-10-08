import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { applyMigrations } from "./apply-migrations.js";

const databaseUrl = process.env.DATABASE_URL || "file:./prisma/dev.db";
applyMigrations(databaseUrl);

const adapter = new PrismaBetterSqlite3({
  url: databaseUrl,
});

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
