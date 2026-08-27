import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';

/**
 * Single Prisma client for the process, created on first use.
 *
 * **Lazy on purpose.** Building the client eagerly meant `next build` failed
 * outright without `DATABASE_URL`, because collecting page data imports every
 * server module. A build does not open connections, and a deployment that
 * injects secrets at runtime — which is the arrangement the deployment rules
 * ask for — could therefore never produce an artifact. The connection string is
 * now read at the first query, where it is actually needed, and the missing-URL
 * error still names the file that fixes it.
 *
 * Cached on `globalThis` because Next.js dev-mode hot reload re-evaluates
 * modules, which would otherwise open a new pool on every edit until Postgres
 * refuses connections. This is the documented workaround.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and fill it in — see docs/setup/database.md',
    );
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

function getClient(): PrismaClient {
  const existing = globalForPrisma.prisma;
  if (existing) return existing;

  const client = createClient();
  // Cached in every environment, not only development: the point is one pool
  // per process. Production simply never re-evaluates the module.
  globalForPrisma.prisma = client;
  return client;
}

/**
 * Behaves exactly like a `PrismaClient`; the real one is built on first access.
 * Methods are bound to the underlying client so `prisma.$transaction` and the
 * tagged-template raw helpers work through the proxy.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getClient();
    const value = Reflect.get(client, property, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
  has(_target, property) {
    return property in getClient();
  },
  set(_target, property, value) {
    return Reflect.set(getClient(), property, value);
  },
});

export type { PrismaClient };
