import { z } from 'zod';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Gedeelde Prisma-client (singleton).
 *
 * Prisma 7 verbindt via een **driver adapter** i.p.v. een `url` in het schema. Dev/test
 * draaien op SQLite (`better-sqlite3`); productie krijgt hier later een PostgreSQL-adapter
 * (ADR-0003). De verbinding komt uit `DATABASE_URL` — hier apart en minimaal gevalideerd
 * (grens-validatie, CLAUDE.md §7), zonder de rest van de env (met secrets) te vereisen,
 * zodat de db-laag los te gebruiken is in tests en tooling.
 *
 * De singleton wordt op `globalThis` bewaard zodat `tsx watch` bij hot-reload niet telkens
 * een nieuwe verbinding opent.
 */
const databaseUrl = z
  .string()
  .min(1)
  .default('file:./prisma/dev.db')
  .parse(process.env.DATABASE_URL);

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
