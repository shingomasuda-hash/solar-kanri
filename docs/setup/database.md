# Database setup

PostgreSQL 16 or later.

## Local development

```bash
sudo -u postgres psql -c "CREATE USER solar WITH PASSWORD 'change-me';"
sudo -u postgres psql -c "CREATE DATABASE solar_kanri OWNER solar;"
```

```bash
DATABASE_URL="postgresql://solar:change-me@localhost:5432/solar_kanri?schema=public"
```

```bash
npm run db:migrate   # create and apply migrations
npm run db:seed      # reference data
```

## Production

```bash
npm run db:deploy    # prisma migrate deploy — applies, never generates
```

Never run `migrate dev` against production: it can reset the database.

Prisma 7 no longer reads the connection URL from `schema.prisma`. Migrate takes
it from `prisma.config.ts`; the runtime client takes it from the `pg` driver
adapter in `src/server/db/client.ts`. Both read `DATABASE_URL`.

## The generated client

`generated/` holds the Prisma client and is **not** committed — generated code
in version control goes stale silently. `npm install` regenerates it through a
`postinstall` script, and `npm run build` regenerates it again, so a clean clone
builds without anyone having to remember the step.

Neither generation nor the build needs a reachable database, or even
`DATABASE_URL`. The client is constructed on its first query, not when the
module is imported, so an image can be built where secrets only exist at
runtime. The missing-URL error then surfaces on the first request instead of
during the build.

## After seeding

The seed deliberately marks **every coefficient and tariff as unverified**, and
the calculation engines refuse to run on unverified values. A fresh install
therefore cannot produce a customer-facing figure until an administrator has
entered real values with citations.

That is intended behaviour, not a defect. See
`docs/adr/ADR-005-solar-calculation.md` and `docs/open-issues.md` (OI-002,
OI-003).

Seeded accounts — all share `SEED_ADMIN_PASSWORD`. **Change them at first
login.**

| Email               | Role    |
| ------------------- | ------- |
| admin@example.com   | ADMIN   |
| manager@example.com | MANAGER |
| sales@example.com   | SALES   |
| viewer@example.com  | VIEWER  |

## Backups

`pg_dump` on a schedule, restore-tested. Simulations and quotations are the
company's contractual record; the audit log is its accountability record.
