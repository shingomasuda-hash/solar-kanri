# Security review

**Reviewed:** 2026-08-26 · commit on `claude/solar-sales-platform-q9qmpz`
**Scope:** whole codebase — auth, authorisation, input handling, secrets, the AI
surface, and the audit trail.

This is a first-pass review by the team that wrote the code. It is not a
substitute for an independent assessment before handling real customer data.

---

## Findings

### Fixed in this review

**S-1 · Write during a GET render — medium**
`/projects/[id]/design` created a `Property` row while rendering. It was
permission-checked, so not a privilege issue, but a page that writes can be
triggered by a link prefetch and produces records nobody deliberately created,
with no audit entry. Property creation moved into `createProject`, inside the
same transaction. The design page is now a pure read.

**S-2 · No rate limiting on authentication — medium**
Login accepted unlimited attempts. Now limited to 10 per account and 30 per
source address per 15 minutes, checked _before_ the database is touched so a
flood costs a map lookup rather than a query and a bcrypt comparison. A
successful login clears the account bucket. Throttling is audited.

Found while fixing it: module-level state is not reliable in Next.js, which can
include a module in more than one server bundle — the counter reset and the
limit silently became per-bundle. Now held on `globalThis`, the same pattern the
Prisma client uses. The unit tests could not have caught this (they import the
module once); the browser test did.

### Accepted, with reasons

**S-3 · Rate limit state is per instance — low, documented**
In-process counters mean N application instances allow N × the limit. For a
small internal tool on one or two instances this is an acceptable trade against
adding Redis. The store interface is deliberately narrow so swapping it is a
small change. Tracked as OI-106.

**S-4 · `x-forwarded-for` is client-controllable — low**
Recorded in the audit trail and used as a rate-limit key. It is spoofable unless
a trusted proxy rewrites it, so it is **never** used for an authorisation
decision — only for forensics and as a coarse throttle. An attacker who spoofs
it still faces the per-account limit.

**S-5 · Prisma CLI depends on a vulnerable `deepmerge-ts` — low**
GHSA-ggr8-5vv4-36mx, a devDependency of the CLI only, not in the runtime bundle,
and the only input it merges is our own `prisma.config.ts`. The offered fix is a
downgrade to Prisma 6, which is a larger risk. Re-checked each release. OI-102.

**S-6 · Diagnostic detail on the health page — informational**
`/admin/health` surfaces raw error text from failed probes. It is gated on
`health:read` (admin and manager), and being able to read the actual failure is
the entire point of the page.

---

## Verified

### Authentication

- Passwords: bcrypt at cost 12, rehashed on login when the stored cost is lower.
- Policy follows NIST SP 800-63B — length over forced character mixing — and
  rejects input past bcrypt's 72-byte truncation rather than silently ignoring
  it.
- Failure is indistinguishable between "no such user" and "wrong password",
  including in timing: the missing-user path runs a dummy bcrypt comparison.
  Asserted by an E2E test that compares the two messages byte for byte.
- Sessions are opaque and database-backed; only the SHA-256 of the token is
  stored, so a database leak cannot be replayed. Logout and revoke-all take
  effect immediately.
- Cookies: `httpOnly`, `sameSite=lax`, `secure` in production. Lax rather than
  Strict is deliberate — Strict drops the session on any inbound link, breaking
  emailed project links for no real gain here.
- Role change or deactivation revokes every existing session for that user.

### Authorisation

- Every server action and route handler resolves the session before acting;
  `login/actions.ts` is the only exception, correctly.
- Every mutating service function calls `requirePermission`.
- SALES users are scoped to their own records by a Prisma `where` fragment, so
  scoping happens in the query rather than in a post-filter.
- Routes match the navigation. Two mismatches were found and fixed during
  development: the admin console was reachable by a VIEWER whose navigation hid
  it, and an issued quotation's edit route was reachable after its link was
  removed. Both now refuse at the route, and both have tests — hiding a control
  is not access control.
- The scoping rule is tested by calling the services directly against a real
  database (`tests/integration/service-layer.test.ts`), not only through the
  UI: one salesperson cannot read another's project by id, by listing, or
  through the dashboard counts. A browser test can only show that a screen does
  not offer the link.

### Input handling

- Every trust boundary validates with Zod, server-side.
- Optional fields normalise `''`, `null` and `undefined` through one
  preprocessor. This started as a UX bug and is also a robustness property: the
  three shapes reaching different branches is how validation gaps appear.
- Panel temperature coefficient is bounded to catch a %/°C value stored without
  dividing by 100 — a silent 100× error.
- Irradiance entry rejects physically impossible values, catching an MJ/m²/day
  paste (3.6× too large).
- GeoJSON is structurally validated before storage; self-intersecting polygons
  are repaired and the repair is reported, never applied silently.

### Secrets

- Only `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`
  reach the browser, both intended to be public and both restricted by referrer
  in the setup guide.
- No client component reads `process.env`.
- Geocoding uses a separate server-side key so quota does not sit on a key
  anyone can read out of the page.
- The audit log redacts credential-shaped keys before writing.

### Injection

- Prisma parameterises everything. The one raw query is `SELECT 1` with no
  interpolation.
- Prompt injection: the system prompt is assembled from constants; user and
  document text go in the message body inside delimiters; the delimiter sequence
  is neutralised in content. **Every Copilot tool is a read** — a unit test
  asserts no tool name looks like a mutation, so an injection can produce text a
  human reads and nothing else.
- `looksLikeInjectionAttempt` is a reporting aid for humans, documented as
  trivially evadable, with a test asserting a paraphrase gets past it. Nothing
  depends on it.

### Audit

- Every write, login, permission change and Copilot query is recorded.
- `recordAudit` never throws: losing one row is better than failing the
  customer data edit it was recording.
- Failures and rate-limit hits are recorded alongside successes.

---

## Not covered

Stated so nobody assumes otherwise:

- **No independent penetration test.** This is a self-review.
- **No CSRF token.** Next.js server actions carry origin checks, and cookies are
  `sameSite=lax`; a dedicated token was not added. Worth revisiting if the app
  is ever embedded or exposed cross-origin.
- **No file upload path is implemented yet.** `FileAsset` exists in the schema
  but nothing writes to it. When it does, it needs content-type validation, size
  limits, and storage outside the web root.
- **No secrets-at-rest encryption** beyond what the database provides.
- **No 2FA / SSO.** Credential login only. SSO is where NextAuth would earn its
  keep (ADR-001).
- **Dependency supply chain** is checked by `npm audit` in CI, advisory only.
