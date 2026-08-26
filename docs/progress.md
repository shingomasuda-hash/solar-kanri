# Development progress

States: `NOT STARTED` · `IN PROGRESS` · `IMPLEMENTED` · `TESTED` · `VERIFIED` · `BLOCKED`

- **IMPLEMENTED** — code exists and typechecks
- **TESTED** — automated tests cover it and pass
- **VERIFIED** — exercised in a real browser against a real database

Last updated: 2026-08-26

---

## Phase 0 — Research and architecture

| Item                                      | State    | Notes                                                       |
| ----------------------------------------- | -------- | ----------------------------------------------------------- |
| Repository audit                          | VERIFIED | Empty repository; greenfield                                |
| Toolchain research                        | VERIFIED | Versions pinned, ADR-001                                    |
| Drawing library research                  | VERIFIED | `google.maps.drawing` removed in v3.65; Terra Draw, ADR-002 |
| PVGIS API research                        | VERIFIED | v5.3 endpoints, azimuth convention, rate limit              |
| JPEA formula research                     | TESTED   | `EPY = PAS × HA × K × 365`; the value of K is OI-002        |
| CLAUDE.md                                 | VERIFIED |                                                             |
| ADR-001 … ADR-006                         | VERIFIED |                                                             |
| `docs/solar-calculation-spec.md`          | VERIFIED |                                                             |
| `docs/progress.md`, `docs/open-issues.md` | VERIFIED |                                                             |

## Phase 2 — Geometry core

| Item                             | State  | Notes                                           |
| -------------------------------- | ------ | ----------------------------------------------- |
| `LocalFrame` WGS84 ↔ metres      | TESTED | Verified against Vincenty; <1 mm at 50 m        |
| `RoofPlane` projection ↔ surface | TESTED | 1/cos(pitch); unknown pitch flagged             |
| Polygon primitives               | TESTED | Area, centroid, winding, edges, dominant angles |
| `Region` planar index            | TESTED | Grid edge index + interior cell map             |
| JSTS adapter                     | TESTED | Buffer, overlay, `makeValid` via re-polygonize  |
| GeoJSON persistence              | TESTED | RFC 7946, winding normalised on load            |
| 寸 (sun) pitch conversion        | TESTED |                                                 |

## Phase 3 — Panel placement

| Item                              | State  | Notes                                      |
| --------------------------------- | ------ | ------------------------------------------ |
| Usable area (setback, exclusions) | TESTED |                                            |
| Orientation search                | TESTED |                                            |
| Array angle search                | TESTED | +69% on a rotated building                 |
| Grid phase offset search          | TESTED |                                            |
| Per-row slide                     | TESTED |                                            |
| Layout scoring                    | TESTED | Count dominant, compactness tie-break      |
| 14 synthetic roof fixtures        | TESTED | Hand-derived ceilings, measured floors     |
| Rotation invariance               | TESTED |                                            |
| Determinism                       | TESTED |                                            |
| Manual edit + validation          | TESTED | Move, rotate, add, remove, live validation |
| Benchmark harness                 | TESTED | `scripts/bench-layout.ts`                  |

## Phase 4 — Solar calculation

| Item                               | State   | Notes                                          |
| ---------------------------------- | ------- | ---------------------------------------------- |
| Provenance enforcement (`Sourced`) | TESTED  | Fails closed on unverified values              |
| Monthly generation engine          | TESTED  | Analytic identities verified exactly           |
| Thermal model                      | TESTED  | Seasonal; mounting-type dependent              |
| Degradation and projection         | TESTED  |                                                |
| JPEA K cross-check                 | TESTED  | Both formulations agree                        |
| `SolarDataProvider` abstraction    | TESTED  | Fallback chain, failures collected             |
| PVGIS provider                     | TESTED  | Azimuth convention pinned by test              |
| Manual provider                    | TESTED  | Unit-error detection on entry                  |
| Google Solar adapter               | TESTED  | Supplementary; no-coverage is a normal outcome |
| Golden test harness                | TESTED  | Self-tests; comparisons **BLOCKED** on OI-001  |
| Golden reference dataset           | BLOCKED | OI-001 — egress blocked here; needs a human    |

## Phase 5 — Economic calculation

| Item                                   | State  | Notes                            |
| -------------------------------------- | ------ | -------------------------------- |
| Self-consumption / export split        | TESTED | Consumption is a hard cap        |
| Bill saving with escalation            | TESTED |                                  |
| Export revenue, promo term transition  | TESTED |                                  |
| Scheduled costs (inverter replacement) | TESTED |                                  |
| Payback (interpolated)                 | TESTED |                                  |
| NPV                                    | TESTED |                                  |
| IRR (bisection, deterministic)         | TESTED |                                  |
| Tariff provenance enforcement          | TESTED | Blocked on OI-003 for real rates |

## Phase 1 — Foundation, auth, CRM

| Item                               | State       |
| ---------------------------------- | ----------- |
| Prisma schema and migrations       | NOT STARTED |
| Seed data                          | NOT STARTED |
| Authentication                     | NOT STARTED |
| RBAC                               | NOT STARTED |
| Audit log                          | NOT STARTED |
| Customer / Project / Property CRUD | NOT STARTED |
| Activities, tasks, notes, files    | NOT STARTED |
| Project timeline and next action   | NOT STARTED |

## Phase 2b — Map and drawing UI

| Item                         | State       |
| ---------------------------- | ----------- |
| Address search and geocoding | NOT STARTED |
| Satellite map                | NOT STARTED |
| Terra Draw roof drawing      | NOT STARTED |
| Vertex add / move / delete   | NOT STARTED |
| Multiple roof faces          | NOT STARTED |
| Exclusion zone drawing       | NOT STARTED |
| Panel overlay rendering      | NOT STARTED |
| Manual placement editing UI  | NOT STARTED |

## Phase 6 — Quotation

| Item                               | State       |
| ---------------------------------- | ----------- |
| Quote builder from simulation      | NOT STARTED |
| Line items, discount, subsidy, tax | NOT STARTED |
| Version management                 | NOT STARTED |
| PDF output                         | NOT STARTED |

## Phase 7 — AI Copilot

| Item                      | State       |
| ------------------------- | ----------- |
| `AIProvider` abstraction  | NOT STARTED |
| Grounded tool layer       | NOT STARTED |
| Copilot features (12)     | NOT STARTED |
| Knowledge base + RAG      | NOT STARTED |
| Prompt injection defences | NOT STARTED |

## Phase 8 — Admin

| Item                              | State       |
| --------------------------------- | ----------- |
| Panel / inverter masters          | NOT STARTED |
| Coefficient and tariff management | NOT STARTED |
| User and role management          | NOT STARTED |
| System health                     | NOT STARTED |
| Setup assistant docs              | NOT STARTED |

## Phase 9 — QA and production

| Item                             | State       |
| -------------------------------- | ----------- |
| Playwright E2E of the sales flow | NOT STARTED |
| Screenshot QA                    | NOT STARTED |
| Security review                  | NOT STARTED |
| Production build verification    | NOT STARTED |

---

## Quality gate status

| Gate                    | Status                          |
| ----------------------- | ------------------------------- |
| `prettier --check`      | PASS                            |
| `eslint`                | PASS                            |
| `tsc --noEmit`          | PASS                            |
| Unit + regression tests | PASS — 352 tests                |
| Geometry regression     | PASS — 14 fixtures              |
| Solar golden comparison | BLOCKED — OI-001                |
| Production build        | Not yet run (no app routes yet) |
| E2E browser             | NOT STARTED                     |
