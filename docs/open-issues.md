# Open Issues

Technical issues are resolved by the development agent without escalation.
Only items marked **HUMAN DECISION REQUIRED** are waiting on a person.

Last updated: 2026-08-26

---

## HUMAN DECISION REQUIRED

### OI-001 — Golden reference dataset for generation calculation

**Category:** Domain acceptance (project brief rule 3D)
**Blocks:** Setting `tests/fixtures/solar/golden/manifest.json` to `ACTIVE`;
final sign-off on generation accuracy.

The golden-test harness is built and self-tests against an analytic case, but no
third-party reference case is loaded. This environment cannot reach
`re.jrc.ec.europa.eu` (PVGIS) or `www.jpea.gr.jp` — both are blocked by the
network egress policy — so reference figures could not be fetched.

**What is needed:** at least one, preferably several, reference cases covering
multiple regions, modules, azimuths, tilts and system sizes.

**How to supply them:** from a machine with outbound access, run

```
npx tsx scripts/fetch-pvgis-golden.ts --lat 35.6812 --lon 139.7671 \
  --tilt 30 --azimuth 180 --kw 5 --id pvgis-tokyo-30s-5kw
```

then review the module thermal figures in the generated file, and set
`status: "ACTIVE"` in the manifest. The comparison suite becomes mandatory at
that point.

Alternatively, paste figures from a manufacturer's own sizing tool into a case
file by hand — the format is documented in
`tests/fixtures/solar/golden/schema.md`.

---

### OI-002 — Loss coefficients and the JPEA overall design factor K

**Category:** Domain acceptance + business decision (rules 3B, 3D)
**Blocks:** Any customer-facing generation figure. The engine currently _refuses
to run_ with the seeded values, by design.

Every seeded loss coefficient is marked `unverified-placeholder`:

| Coefficient                            | Needs                                                       |
| -------------------------------------- | ----------------------------------------------------------- |
| `inverterEfficiency`                   | Value from the inverter datasheet actually being sold       |
| `wiringFactor`                         | Company design standard or a measured figure                |
| `soilingFactor`                        | Regional soiling/snow assumption, with its basis            |
| `shadingFactor`                        | Default site-survey assumption                              |
| `temperatureRiseK` (×3 mounting types) | Design standard or measurement                              |
| `gridCo2FactorKgPerKWh`                | Published emission factor for the relevant utility and year |

**What is needed:** for each, a value plus a citation (document, table, revision,
date). Enter them in Admin → Coefficients. The engine accepts
`administrator-input` as a source kind, so a documented internal standard is
sufficient — but _something_ must be recorded.

The related question is the standard value of `K` (総合設計係数) this company
quotes to customers, so engine output can be sanity-checked against it. Sourced
from the JPEA 表示ガイドライン (`https://www.jpea.gr.jp/document/handout/`),
which the Product Owner should confirm against the current year's edition.

---

### OI-003 — Tariff rates and margin policy

**Category:** Business decision (rule 3B)
**Blocks:** Any economic result reaching a customer.

Needed in Admin → Tariffs, each with its basis:

- 買電単価 purchase price, JPY/kWh (and which tariff plan it reflects)
- 売電単価 export price, JPY/kWh, and the term in years
- Post-term export price
- Assumed annual retail price escalation
- Default self-consumption ratio per customer segment
- Standard gross margin, and whether it may be shown in the PDF
- Whether subsidies are quoted gross or net of tax

The economics engine refuses to run until each carries a source, exactly as the
generation engine does.

---

### OI-004 — Google Maps Platform credentials and billing

**Category:** Secret / credential + billing (rule 3A)
**Blocks:** Address search, satellite view, roof drawing — i.e. the whole map
workflow.

Needed: a Google Cloud project with billing enabled and an API key with
Maps JavaScript API, Geocoding API and (optionally) Solar API enabled, restricted
by HTTP referrer.

Step-by-step instructions, including the referrer restrictions to set, are in
`docs/setup/google-maps.md`. The key goes in `GOOGLE_MAPS_API_KEY` /
`NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`; never commit it.

Cost note: Geocoding is billed per request. The implementation debounces input,
caches results per address and reuses a project's stored coordinates, so a
repeat visit to a project costs nothing.

---

### OI-005 — AI provider credentials

**Category:** Secret / credential (rule 3A)
**Blocks:** The AI Sales Copilot only. Everything else works without it.

Needed: an Anthropic API key in `ANTHROPIC_API_KEY` (or an OpenAI key — the
provider is abstracted). The Copilot degrades cleanly to disabled when absent
rather than erroring.

---

## Resolved / technical (no human action needed)

### OI-100 — JSTS `PreparedGeometry` is broken in 2.12.1 — RESOLVED

`PreparedPolygon`'s constructor calls `super()` with no arguments, so
`BasicPreparedGeometry.constructor_` receives `undefined` and throws inside
`ComponentCoordinateExtracter.getCoordinates`.

Resolved by not using it. `src/core/geo/region.ts` implements a purpose-built
uniform-grid edge index instead, which is also substantially faster for our
access pattern (many rectangle queries against one static region) because it
precomputes which grid cells are wholly interior.

### OI-101 — `buffer(0)` silently discards half a self-crossing roof — RESOLVED

The usual JTS "make valid" shortcut keeps only the counter-clockwise lobe of a
bow-tie. For a freehand-drawn roof that means silently losing half the area.
Resolved by re-polygonizing the noded ring in `makeValid()`, which keeps every
enclosed face and lets the operator see and correct what they actually drew.

### OI-102 — `prisma` CLI depends on a vulnerable `deepmerge-ts` — ACCEPTED RISK

`npm audit` reports GHSA-ggr8-5vv4-36mx (stack exhaustion on recursive object
graphs) via `@prisma/config` → `deepmerge-ts`. It is a **devDependency of the
CLI only** and is not in the runtime bundle; the only input it merges is our own
`prisma.config.ts`. The only remediation `npm audit fix --force` offers is
downgrading to Prisma 6, which is a larger risk. Re-check on each Prisma release.

### OI-103 — Region rejected points a hair outside its bounding box — RESOLVED

Rotating a layout back from the search frame leaves ~1e-15 m of drift, so a
module flush with the eaves landed marginally outside the index extent and was
discarded before the epsilon-tolerant boundary test could run. Found by the
panel-placement regression suite on the 60×40 m industrial fixture. Guards are
now epsilon-padded, with a dedicated regression test.

### OI-106 — Rate limit state is per application instance — ACCEPTED RISK

Login rate limiting uses in-process counters, so N instances allow N × the
limit. For one or two instances this is an acceptable trade against adding Redis
to the stack. The store interface in `src/server/auth/rate-limit.ts` is narrow
enough that swapping it for a shared store is a small change. Revisit before
scaling out horizontally. See `docs/security-review.md` S-3.

### OI-107 — Module state resets across Next.js bundles — RESOLVED

Login rate limiting silently became per-bundle because Next.js can include a
module in more than one server bundle, giving each copy its own counter. Now
held on `globalThis`, the same pattern the Prisma client uses. Worth knowing
generally: **module-level mutable state is not reliable in this framework**. The
unit tests could not catch it (they import the module once); the browser test
did.
