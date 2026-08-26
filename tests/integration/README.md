# Integration tests

Tests that exercise the server layer against a real PostgreSQL database.

They cover the three things neither a unit test nor the browser suite can
prove on its own:

- **Transaction boundaries** — that a failed insert rolls back everything it
  started, including records created for it earlier in the same transaction.
- **Authorization at the query level** — the services are called directly, the
  way a mistaken or compromised caller would, so a passing test means the rule
  is enforced in the data layer and not merely hidden in the UI.
- **Audit and immutability** — both are database state, and a UI assertion is
  only evidence about the screen.

They need `DATABASE_URL` and a migrated, seeded database. Without one they
**skip** rather than fail, so the suite still runs on a machine with no
Postgres — check the reported skip count if you expected them to run.

```bash
npm run db:migrate && npm run db:seed
npx vitest run tests/integration
```

Everything a test creates is prefixed and removed in `afterAll`, so the suite
can run against the same database as the browser tests without disturbing the
seed data. Keep it that way: a test that mutates seeded records will surface as
an unrelated E2E failure hours later.

`src/server/db/client` builds its connection pool at module load, so import the
services **inside** `beforeAll`, not at the top of the file — a static import
would throw before the skip could take effect.
