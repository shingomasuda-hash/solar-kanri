import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 moved the connection URL out of schema.prisma. Migrate reads it from
 * here; the runtime client gets it via the pg driver adapter in
 * src/server/db/client.ts.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { seed: 'tsx prisma/seed.ts' },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
