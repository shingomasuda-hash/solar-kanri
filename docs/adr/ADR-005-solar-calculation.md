# ADR-005: Solar calculation architecture

**Status:** Accepted · 2026-08-26

## Context

The generation figure is what a customer signs against. It must be defensible,
reproducible, and traceable to something other than an assistant's recollection.

The project brief is unusually explicit here (rules 18, 19, 21, 22): the AI must
not compute it, no constant may come from memory, results must be versioned and
snapshotted, and the model must be validated against published references.

## Decision

### 1. A pure, deterministic engine

`src/core/solar/engine.ts` is arithmetic over its arguments. No I/O, no clock,
no environment access, no randomness — enforced by lint rules over `src/core`.
The AI Copilot may _quote_ its output; it may never produce a number.

### 2. Provenance in the type system

A coefficient is `Sourced<number>`, not `number`:

```ts
interface Sourced<T> {
  value: T;
  source: CoefficientSource;
}
```

`assertProductionReady()` walks the input tree before any calculation and throws
`UnsourcedCoefficientError` — naming every offending field by dotted path — if
any value is still an `unverified-placeholder`.

This is the mechanism that makes rule 19 real rather than aspirational. The
seeded development database marks **everything** as a placeholder, so a fresh
install _cannot_ produce a customer-facing number until a human has entered
real values with citations. Failing closed is the point: a system that silently
falls back to a plausible default is exactly the failure mode being guarded
against.

### 3. Monthly resolution

`E_m = P × H_m × f_temp(m) × f_inv × f_wire × f_soil × f_shade × f_other`

The thermal derate is strongly seasonal — a roof-flush array in a Japanese
August runs 30–40 K above STC, while in January it runs _below_ STC and exceeds
nameplate. An annual average understates summer losses and overstates winter
gains, and the errors do not cancel because irradiation is seasonal too.
Monthly resolution costs nothing and removes the problem.

### 4. Separate factors, not one bundled K

JPEA quotes `EPY = PAS × HA × K × 365` with a single 総合設計係数 K. We compute
the factors separately, because an aggregate cannot be individually cited,
audited, or adjusted for a site — and then **report** `K` so results can be
cross-checked against industry figures. A test asserts the two formulations
agree to floating-point error.

### 5. Provider abstraction

`SolarDataProvider` with PVGIS, Manual and (supplementary) Google Solar
implementations, tried in configured order. `ManualSolarProvider` is the floor
that guarantees any site is quotable: an operator keys in a sourced monthly
table and the system works end to end with no external dependency at all.

External payloads are mapped into domain types at the provider boundary and
never reach the UI raw (rule 17), so a change on Google's or the JRC's side
cannot reshape our screens.

### 6. Versioning and snapshots

`SOLAR_ENGINE_VERSION` is stamped on every result. A saved simulation persists
snapshots of its inputs, module, coefficients, tariff and irradiance dataset, so
editing a coefficient tomorrow does not change a quotation issued today.

## Consequences

- A fresh install refuses to simulate until coefficients are entered. This is
  correct and is documented in the setup guide so it does not read as a bug.
- Golden validation is blocked on reference data this environment cannot reach
  (OI-001). The harness is built and self-tests; the gap is reported on every
  run rather than being quietly absent.
- Adding a physical term (clipping, horizon shading, hourly simulation) requires
  a version bump, which is the intended friction.

## Rejected alternatives

**Calling PVGIS `PVcalc` and using its yield directly.** Simple, and it hands us
one opaque `loss` percentage that cannot be decomposed or cited per component —
the opposite of what rule 19 asks for. We take irradiance and temperature from
PVGIS and apply our own auditable derates.

**An hourly (8760) simulation.** More accurate, materially more complex, and it
needs hourly source data we do not have for every site. Documented explicitly in
`docs/solar-calculation-spec.md` §7 as something this model does _not_ do, so
nobody mistakes it for an engineering yield study.

**Letting the LLM estimate when data is missing.** Directly prohibited, and
correctly so. Missing data produces a refusal with an actionable message, not a
plausible number.
