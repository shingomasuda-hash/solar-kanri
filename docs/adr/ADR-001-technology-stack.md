# ADR-001: Technology stack

**Status:** Accepted · 2026-08-26

## Context

Greenfield repository — no existing code to preserve. The system spans an
interactive map UI, a geometry engine, deterministic numeric engines, a CRM, a
document generator and an LLM integration, and must be operable by
non-engineers.

## Decision

| Concern                 | Choice                                 | Version |
| ----------------------- | -------------------------------------- | ------- |
| Framework               | Next.js App Router                     | 16.3.3  |
| UI                      | React                                  | 19.2    |
| Language                | TypeScript                             | 5.9.3   |
| Styling                 | Tailwind CSS                           | 4.3     |
| Database                | PostgreSQL                             | 16      |
| ORM                     | Prisma                                 | 7.10    |
| Geometry                | JSTS (setup ops) + own code (hot path) | 2.12.1  |
| Map drawing             | Terra Draw + Google Maps adapter       | 1.32    |
| Validation              | Zod                                    | 4.4     |
| Unit / regression tests | Vitest                                 | 4.1     |
| Browser tests           | Playwright                             | 1.62    |

## Rationale

**Modular monolith, not microservices.** Project brief rule 43. One deployable,
one database, clear internal module boundaries (`src/core/*` is pure domain
logic with no I/O, enforced by lint rules). Nothing about this workload suggests
independent scaling or independent release cadence.

**TypeScript 5.9 rather than 7.x.** TypeScript 7 (the native port) is released,
but the Next.js and ESLint toolchains around it are not uniformly ready. 5.9 is
the last 5.x and is what every dependency here is tested against. Revisit once
`eslint-config-next` and `typescript-eslint` support 7 as a first-class target.
The cost of being wrong is one dependency bump; the cost of a broken toolchain
mid-project is days.

**Prisma over raw SQL or Drizzle.** Migrations, a generated type-safe client and
a usable studio for non-engineers to inspect data. The schema here is
conventional relational modelling with no exotic requirements. One caveat is
recorded as OI-102.

**PostgreSQL over Supabase-hosted-everything.** Supabase is an excellent hosted
Postgres, and nothing here prevents deploying onto it. But binding the
application to Supabase-specific auth and RLS APIs would be lock-in bought for
convenience we do not need: the RBAC model is simple and better expressed in
application code we can test. We use plain PostgreSQL and can host it anywhere.

**Own auth rather than NextAuth.** NextAuth v5 is still beta. For an internal
B2B tool with credential login and four roles, a signed-cookie session using
`jose` plus `bcryptjs` is roughly 150 lines, fully testable, and has no beta
dependency in the security-critical path. Revisit if SSO becomes a requirement —
that is exactly where NextAuth earns its keep and this does not.

## Consequences

- One `npm run build` produces the deployable; no orchestration required.
- `src/core` is framework-free and can be extracted into a package later without
  touching its callers.
- We own the auth code, including its bugs. Mitigated by tests and by keeping
  the surface deliberately small.
