# 発電量計算仕様書 / Solar Calculation Specification

**Status:** v1 — `solar-engine-v1`
**This document is the single source of truth for the generation model.**
Code must follow this document. When they disagree, this document is right and
the code is a bug.

---

## 0. Non-negotiable rules

1. **No language model computes a number that reaches a customer.** The engine
   in `src/core/solar/engine.ts` is pure, deterministic arithmetic. The AI
   Copilot may _quote_ engine output; it may never produce it.
2. **Every coefficient carries a source.** Enforced in the type system: a
   coefficient is `Sourced<number>`, not `number`, and
   `assertProductionReady()` throws before any calculation whose inputs include
   an unverified placeholder. Permitted source kinds:
   `manufacturer-datasheet`, `official-standard`, `public-dataset`,
   `provider-api`, `administrator-input`.
3. **Results are reproducible forever.** Every saved simulation stores the
   engine version plus a snapshot of every input and coefficient. Changing the
   model does not change an existing quotation.

---

## 1. Model

Per calendar month _m_:

```
E_m = P_dc × H_m × f_temp(m) × f_inv × f_wire × f_soil × f_shade × f_other
```

| Symbol      | Meaning                                    | Unit   | Source                              |
| ----------- | ------------------------------------------ | ------ | ----------------------------------- |
| `P_dc`      | Installed DC capacity                      | kW     | Panel count × datasheet rated power |
| `H_m`       | Plane-of-array irradiation for the month   | kWh/m² | `SolarDataProvider`                 |
| `f_temp(m)` | Thermal derate                             | –      | Computed, see §2                    |
| `f_inv`     | Inverter / PCS conversion efficiency       | –      | Inverter datasheet                  |
| `f_wire`    | DC + AC wiring loss                        | –      | Administrator, design standard      |
| `f_soil`    | Soiling, snow, module mismatch             | –      | Administrator, regional data        |
| `f_shade`   | Shading not already in the irradiance data | –      | Administrator, site survey          |
| `f_other`   | Any other administrator-approved factor    | –      | Administrator, with reason          |

Annual generation is `Σ E_m` over the twelve months, using **calendar month
lengths** (31/28/31/30/…), not a flat 30 days.

### Why monthly and not annual

The thermal derate is strongly seasonal. In Japan a roof-flush array in August
runs 30–40 K above STC while in January it runs _below_ STC and produces more
than nameplate. Applying an annual-average temperature understates summer losses
and overstates winter gains; the errors do not cancel because irradiation is
also seasonal. Monthly resolution costs nothing and removes the problem.

---

## 2. Thermal model

```
T_cell(m) = T_ambient(m) + ΔT(mounting) × G_mean(m)
f_temp(m) = 1 + γ_Pmax × (T_cell(m) − 25)
```

- `γ_Pmax` — Pmax temperature coefficient, **fraction per Kelvin**, negative.
  From the module datasheet. Datasheets quote %/°C: −0.35 %/°C is
  `-0.0035` /K. The engine rejects values outside −0.02…0 with an explicit
  message, because storing −0.35 without dividing by 100 is a silent 100×
  error that produces a plausible-looking near-zero output.
- `ΔT(mounting)` — cell temperature rise above ambient at 1 kW/m², Kelvin.
  Administrator-supplied per mounting type. Roof-flush runs hottest because air
  cannot circulate behind the modules; ground-mounted runs coolest.
- `G_mean(m)` — mean plane-of-array irradiance during daylight, kW/m², derived
  as `H_m,daily / DAYLIGHT_HOURS`.

### `DAYLIGHT_HOURS = 10`

This is a **modelling constant of this engine**, not a measurement. It converts
mean daily irradiation into the mean irradiance that drives the temperature
rise. It is documented here rather than hidden in the code because it is an
assumption a reviewer may legitimately want to change.

Sensitivity: at `γ = -0.0035` /K, `ΔT = 25` K and 4 kWh/m²/day, moving
`DAYLIGHT_HOURS` from 10 to 8 changes `f_temp` by about 0.9 %. It is a
second-order term, but not a negligible one.

---

## 3. Cross-check against the JPEA formula

The Japan Photovoltaic Energy Association 表示ガイドライン expresses annual
estimated generation as:

```
EPY = PAS × HA × K × 365
```

- `EPY` — 年間推定発電量 (annual estimated generation), kWh
- `PAS` — システム容量 (system capacity), kW
- `HA` — 年平均日射量 (annual mean daily irradiation on the array plane), kWh/m²/day
- `K` — 総合設計係数 (overall design factor)

Source: JPEA 太陽光発電協会 表示ガイドライン,
<https://www.jpea.gr.jp/document/handout/>

Our engine reports `breakdown.overallDesignFactorK`, defined as
`annualGeneration / (P_dc × Σ H_m)`. This is exactly JPEA's `K`, so the two
formulations must agree — and a test asserts they do to within floating-point
error (`tests/regression/solar/generation.test.ts`, "reconstructs the annual
total from the reported K factor").

Working from separately-sourced factors rather than a single `K` is deliberate:
`K` is an aggregate, and an aggregate cannot be individually cited, audited, or
adjusted for a specific site. We compute `K` and _report_ it so results can be
compared against industry figures.

> **OPEN — requires Product Owner sign-off (OI-002).** The standard value of `K`
> for this company's typical installations has not been agreed. Until it is, the
> engine's seeded loss factors are `unverified-placeholder` and it will refuse to
> produce a customer-facing number. See `docs/open-issues.md`.

---

## 4. Degradation

```
E_year(n) = E_year(1) × (1 − d)^(n−1)
```

Year 1 is un-degraded. `d` is the annual power degradation rate from the module
datasheet or its performance warranty. Typical warranties state an initial-year
drop plus a linear annual rate; where they differ, the engine's single rate is a
simplification and the warranty schedule should be recorded in the coefficient's
`note`.

---

## 5. Irradiance sources

Providers implement `SolarDataProvider` and are tried in configured order. The
platform must never depend on any single one (project brief rule 20).

| Provider              | Status             | Notes                                                                                                      |
| --------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `ManualSolarProvider` | Always available   | Administrator-entered monthly table, typically NEDO METPV. The floor that guarantees any site is quotable. |
| `PvgisProvider`       | Implemented        | PVGIS v5.3 `MRcalc`. Confirm the radiation database covers Japan before relying on it.                     |
| `GoogleSolarProvider` | Supplementary only | Returns building geometry and annual flux, not the monthly series the engine needs. Never required.        |
| NEDO METPV direct     | Not implemented    | Distributed as files rather than an API; load via `ManualSolarProvider`.                                   |

### Plane-of-array vs horizontal

`IrradianceDataset.isPlaneOfArray` records which the figures are. When false,
the engine emits `IRRADIANCE_NOT_PLANE_OF_ARRAY` and the UI must show it: a
horizontal figure needs a tilt/azimuth correction, and that correction is an
administrator-supplied, sourced table — never something the engine invents.

### PVGIS azimuth convention

PVGIS `aspect` is **0 = south**, negative = east, positive = west. Our domain
model uses compass degrees (0 = north). The conversion is
`aspect = compass − 180`. Reversing this quotes a north-facing yield for a
south-facing roof — roughly a 40 % error that looks entirely plausible on a
report. Pinned down by dedicated tests.

---

## 6. Accuracy and tolerance

Golden tests compare the engine against published reference figures. Harness:
`tests/regression/solar/golden.test.ts`; dataset format:
`tests/fixtures/solar/golden/schema.md`.

**Agreed tolerance: ±5 % on annual generation**, pending Product Owner
confirmation (OI-002). Widening this number is a change to _this document_ and
needs sign-off — it is not a knob to turn until a test goes green.

Coverage required before the harness may be set to `ACTIVE`
(project brief rule 22): multiple regions, multiple modules, multiple azimuths,
multiple tilts, multiple system sizes.

> **OPEN (OI-001).** No third-party reference case is loaded yet. The harness
> self-tests against an analytic case so it cannot rot, and reports the gap on
> every run. `scripts/fetch-pvgis-golden.ts` loads real cases when
> `re.jrc.ec.europa.eu` is reachable.

When a case fails, analyse before editing engine code. A consistent offset
across every case is a model difference and belongs in this document; one case
out of twenty is almost always a transcription error in the fixture.

---

## 7. What this model does **not** do

Stated plainly so nobody assumes otherwise:

- **No hourly simulation.** Monthly means, not 8760-hour time series. Adequate
  for sales-stage estimates; not a substitute for an engineering yield study.
- **No horizon or near-object shading model.** Shading enters as a single
  administrator-supplied factor, or is already baked into the provider's
  irradiance.
- **No per-string or per-MPPT modelling.** Mismatch is inside `f_soil`.
- **No inverter clipping model.** A heavily over-sized DC:AC ratio will be
  overstated. Flag such designs in review.
- **No snow-cover or seasonal-soiling time profile.** One annual factor.
- **No spectral or angle-of-incidence correction** beyond what the irradiance
  provider already applies.

Each is a candidate for `solar-engine-v2`. None may be added silently: a new
term means a new engine version, so existing quotations keep their numbers.

---

## 8. Versioning

`SOLAR_ENGINE_VERSION` is stamped on every result and persisted with every saved
simulation, alongside snapshots of the inputs, module, coefficients, tariff and
irradiance dataset. A simulation is re-computed only on explicit request; it
never silently changes because a coefficient was edited.

Bump the version for any change to the formulae in §1–§4. Do **not** bump it for
a coefficient value change — that is data, and the snapshot already records it.
