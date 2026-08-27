import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The database client must be importable without a database.
 *
 * `next build` collects page data by importing every server module, so a client
 * that reads `DATABASE_URL` at module load makes the application unbuildable
 * wherever secrets are injected at runtime rather than at build time. That is
 * the normal deployment arrangement, and it broke a clean clone outright.
 *
 * These tests pin both halves of the fix: importing is free, and the first real
 * use still fails loudly with a message naming the file that fixes it.
 */
describe('database client', () => {
  const globalForPrisma = globalThis as unknown as { prisma?: unknown };
  let savedUrl: string | undefined;
  let savedClient: unknown;

  beforeEach(() => {
    savedUrl = process.env.DATABASE_URL;
    savedClient = globalForPrisma.prisma;
    delete process.env.DATABASE_URL;
    // A client cached by an earlier test would satisfy the lazy getter and hide
    // exactly the behaviour under test.
    delete globalForPrisma.prisma;
    vi.resetModules();
  });

  afterEach(() => {
    if (savedUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedUrl;
    if (savedClient === undefined) delete globalForPrisma.prisma;
    else globalForPrisma.prisma = savedClient;
    vi.resetModules();
  });

  it('imports without DATABASE_URL, so a build never needs a database', async () => {
    await expect(import('@server/db/client')).resolves.toHaveProperty('prisma');
  });

  it('fails on first use, naming the file that fixes it', async () => {
    const { prisma } = await import('@server/db/client');
    expect(() => prisma.customer).toThrowError(/DATABASE_URL is not set/);
    expect(() => prisma.customer).toThrowError(/docs\/setup\/database\.md/);
  });

  it('builds one client per process and reuses it', async () => {
    process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/none';
    const { prisma } = await import('@server/db/client');

    // Touching any property materialises the client; a second touch must not
    // build a second pool, or a hot-reloading dev server exhausts Postgres.
    void prisma.customer;
    const first = globalForPrisma.prisma;
    void prisma.project;
    expect(globalForPrisma.prisma).toBe(first);
    expect(first).toBeDefined();
  });
});
