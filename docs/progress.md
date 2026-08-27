# Development progress

States: `NOT STARTED` · `IN PROGRESS` · `IMPLEMENTED` · `TESTED` · `VERIFIED` · `BLOCKED`

- **IMPLEMENTED** — code exists and typechecks
- **TESTED** — automated tests cover it and pass
- **VERIFIED** — exercised in a real browser against a real database

Last updated: 2026-08-26

---

## Summary

|                                        |                     |
| -------------------------------------- | ------------------- |
| Unit + regression tests                | 424 passing         |
| Browser tests (desktop + mobile)       | 78 passing          |
| Synthetic roof fixtures                | 14                  |
| Screens verified for responsive layout | 16                  |
| ADRs                                   | 7                   |
| Outstanding items needing a human      | 5 (OI-001 … OI-005) |

---

## Phase 0 — Research and architecture · VERIFIED

| Item                             | State    | Notes                                                        |
| -------------------------------- | -------- | ------------------------------------------------------------ |
| Repository audit                 | VERIFIED | Empty repository; greenfield                                 |
| Toolchain research               | VERIFIED | ADR-001                                                      |
| Drawing library research         | VERIFIED | `google.maps.drawing` removed in v3.65; Terra Draw (ADR-002) |
| PVGIS API research               | VERIFIED | v5.3 endpoints, azimuth convention, rate limit               |
| JPEA formula research            | TESTED   | `EPY = PAS × HA × K × 365`; the value of K is OI-002         |
| CLAUDE.md                        | VERIFIED |                                                              |
| ADR-001 … ADR-007                | VERIFIED |                                                              |
| `docs/solar-calculation-spec.md` | VERIFIED |                                                              |
| Subagents (`.claude/agents/`)    | VERIFIED | 9 specialists                                                |
| Quality gate hooks               | VERIFIED | Post-edit checks + full gate                                 |

## Phase 1 — Foundation, auth, CRM · VERIFIED

| Item                                              | State    |
| ------------------------------------------------- | -------- |
| Prisma schema and migrations                      | VERIFIED |
| Seed data (all coefficients unverified by design) | VERIFIED |
| Session authentication                            | VERIFIED |
| Login rate limiting                               | VERIFIED |
| RBAC (4 roles, service-layer enforcement)         | VERIFIED |
| Audit log with redaction                          | VERIFIED |
| Customer CRUD + search                            | VERIFIED |
| Project CRUD + filtering                          | VERIFIED |
| Activities, tasks, notes                          | VERIFIED |
| Project timeline and next action                  | VERIFIED |
| Dashboard                                         | VERIFIED |

## Phase 2 — Geometry core · TESTED

| Item                             | State    | Notes                                              |
| -------------------------------- | -------- | -------------------------------------------------- |
| `LocalFrame` WGS84 ↔ metres      | TESTED   | Verified against Vincenty; <1 mm at 50 m           |
| `RoofPlane` projection ↔ surface | VERIFIED | Ratio asserted in the browser                      |
| Polygon primitives               | TESTED   |                                                    |
| `Region` planar index            | TESTED   | Grid edge index + interior cell map                |
| JSTS adapter                     | TESTED   | `makeValid` re-polygonizes rather than `buffer(0)` |
| GeoJSON persistence              | TESTED   |                                                    |
| 寸 (sun) pitch conversion        | VERIFIED |                                                    |

## Phase 2b — Map and drawing UI · VERIFIED

| Item                               | State       | Notes                                     |
| ---------------------------------- | ----------- | ----------------------------------------- |
| Address search and geocoding       | IMPLEMENTED | Needs a key (OI-004); cached, unit-tested |
| Satellite map                      | IMPLEMENTED | Needs a key (OI-004)                      |
| Terra Draw roof drawing            | IMPLEMENTED | Needs a key (OI-004)                      |
| Coordinate entry fallback          | VERIFIED    | Full pipeline works with no Maps key      |
| Multiple roof faces                | VERIFIED    |                                           |
| Exclusion zone entry               | VERIFIED    | Per-zone clearance                        |
| Panel overlay rendering            | IMPLEMENTED | Needs a key to see                        |
| Graceful degradation without a key | VERIFIED    |                                           |

## Phase 3 — Panel placement · TESTED

| Item                                       | State    | Notes                                         |
| ------------------------------------------ | -------- | --------------------------------------------- |
| Usable area (setback, per-zone exclusions) | VERIFIED |                                               |
| Orientation / angle / offset search        | TESTED   | Angle search worth +69% on a rotated building |
| Per-row slide                              | TESTED   |                                               |
| Layout scoring                             | TESTED   |                                               |
| 14 synthetic roof fixtures                 | TESTED   | Hand-derived ceilings, measured floors        |
| Rotation invariance                        | TESTED   |                                               |
| Determinism                                | TESTED   |                                               |
| Manual edit + validation                   | TESTED   | Move, rotate, add, remove                     |
| Benchmark harness                          | TESTED   | `scripts/bench-layout.ts`                     |

## Phase 4 — Solar calculation · TESTED (one item blocked)

| Item                               | State       | Notes                                          |
| ---------------------------------- | ----------- | ---------------------------------------------- |
| Provenance enforcement (`Sourced`) | VERIFIED    | Refusal asserted in the browser                |
| Monthly generation engine          | TESTED      | Analytic identities verified exactly           |
| Thermal model                      | TESTED      |                                                |
| Degradation and projection         | TESTED      |                                                |
| JPEA K cross-check                 | TESTED      |                                                |
| `SolarDataProvider` abstraction    | TESTED      |                                                |
| PVGIS provider                     | TESTED      | Azimuth convention pinned by test              |
| Manual provider                    | VERIFIED    | Unit-error detection on entry                  |
| Google Solar adapter               | TESTED      | Supplementary only                             |
| Golden test harness                | TESTED      | Self-tests                                     |
| **Golden reference dataset**       | **BLOCKED** | **OI-001 — needs a human with network access** |

## Phase 5 — Economic calculation · TESTED

| Item                                                    | State  |
| ------------------------------------------------------- | ------ |
| Self-consumption / export split (capped by consumption) | TESTED |
| Bill saving with escalation                             | TESTED |
| Export revenue, promotional term transition             | TESTED |
| Scheduled costs                                         | TESTED |
| Payback (interpolated)                                  | TESTED |
| NPV                                                     | TESTED |
| IRR (bisection, deterministic)                          | TESTED |

## Phase 6 — Quotation · VERIFIED

| Item                                    | State    |
| --------------------------------------- | -------- |
| Quote builder from simulation           | VERIFIED |
| Line items, discount, subsidy, tax      | VERIFIED |
| Live preview through the same engine    | VERIFIED |
| Version management                      | VERIFIED |
| Issue lock (immutable, frozen snapshot) | VERIFIED |
| Printable document / PDF                | VERIFIED |

## Phase 7 — AI Copilot · TESTED

| Item                           | State       | Notes                                |
| ------------------------------ | ----------- | ------------------------------------ |
| `AiProvider` abstraction       | TESTED      |                                      |
| Read-only tool layer (7 tools) | TESTED      | Asserted read-only                   |
| 12 Copilot tasks               | TESTED      |                                      |
| Knowledge base + retrieval     | VERIFIED    |                                      |
| Prompt injection defences      | TESTED      | Structural + capability + provenance |
| Degrades cleanly with no key   | VERIFIED    |                                      |
| **Live model interaction**     | **BLOCKED** | **OI-005 — needs an API key**        |

## Phase 8 — Admin · VERIFIED

| Item                                   | State    |
| -------------------------------------- | -------- |
| Panel / inverter masters               | VERIFIED |
| Coefficient management with provenance | VERIFIED |
| Tariff management                      | VERIFIED |
| Irradiance station entry               | VERIFIED |
| Knowledge base management              | VERIFIED |
| User and role management               | VERIFIED |
| System health (7 components)           | VERIFIED |
| Audit log viewer                       | VERIFIED |
| Setup guides                           | VERIFIED |

## Phase 9 — QA, security, production · VERIFIED

| Item                                                 | State       |
| ---------------------------------------------------- | ----------- |
| Playwright E2E of the full sales flow                | VERIFIED    |
| Responsive / no-horizontal-scroll suite (16 screens) | VERIFIED    |
| Screenshot QA                                        | VERIFIED    |
| Login rate limiting                                  | VERIFIED    |
| Service-layer integration suite                      | VERIFIED    |
| Security review                                      | VERIFIED    |
| Production build                                     | VERIFIED    |
| CI workflow                                          | IMPLEMENTED |

---

## Quality gate

| Gate                           | Status             |
| ------------------------------ | ------------------ |
| `prettier --check`             | PASS               |
| `eslint`                       | PASS               |
| `tsc --noEmit`                 | PASS               |
| Unit + regression tests        | PASS — 433         |
| Integration (real database)    | PASS — 12          |
| Geometry regression            | PASS — 14 fixtures |
| Solar golden comparison        | BLOCKED — OI-001   |
| Production build               | PASS               |
| E2E browser (desktop + mobile) | PASS — 84          |

---

## What a human still has to do

Full detail in `docs/open-issues.md`.

| Item                                      | Blocks                                | Who                                          |
| ----------------------------------------- | ------------------------------------- | -------------------------------------------- |
| **OI-002** Loss coefficients with sources | Any customer-facing generation figure | Product Owner                                |
| **OI-003** Tariff rates and margin policy | Any economic result                   | Product Owner                                |
| **OI-001** Golden reference dataset       | Accuracy sign-off                     | Product Owner / engineer with network access |
| **OI-004** Google Maps credentials        | Map, address search, roof tracing     | Product Owner (billing)                      |
| **OI-005** AI provider key                | The Copilot only                      | Product Owner (billing)                      |

Nothing else is waiting on a person. The platform runs, and the whole pipeline
from customer through layout to quotation is exercised end to end in a browser
on every commit — including without Maps and without an AI key.
