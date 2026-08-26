# Golden dataset format

Each reference case is one JSON file in this directory, named `<id>.json`.

```jsonc
{
  "id": "pvgis-tokyo-30deg-south-5kw",
  "description": "5 kW south-facing array at 30 degrees, Tokyo",
  "source": {
    "kind": "public-dataset",          // manufacturer-datasheet | official-standard | public-dataset | provider-api
    "citation": "PVGIS v5.3 PVcalc, PVGIS-SARAH3 database",
    "url": "https://re.jrc.ec.europa.eu/api/v5_3/PVcalc?lat=35.68&lon=139.77&...",
    "retrievedAt": "2026-08-26T00:00:00Z"
  },
  "input": {
    "installedKw": 5,
    "mounting": "roof-flush",          // roof-flush | roof-raised | ground-mounted
    "latitude": 35.6812,
    "longitude": 139.7671,
    "tiltDeg": 30,
    "azimuthDeg": 180,
    "module": {                        // datasheet values, one per field
      "pmaxTempCoeffPerK": -0.0035,
      "noctC": 44,
      "annualDegradation": 0.005
    },
    "losses": {                        // multipliers in (0, 1]
      "inverterEfficiency": 0.96,
      "wiringFactor": 0.98,
      "soilingFactor": 0.97,
      "shadingFactor": 1.0,
      "otherApprovedFactor": 1.0
    },
    "temperatureRiseK": { "roof-flush": 25, "roof-raised": 20, "ground-mounted": 15 },
    "climate": {
      "planeOfArrayKWhPerM2PerDay": { "1": 3.2, "2": 3.6, "...": 0 },
      "ambientTempC": { "1": 6, "2": 7, "...": 0 }
    }
  },
  "reference": {
    "annualGenerationKWh": 5850,
    "monthlyGenerationKWh": { "1": 420, "...": 0 },   // optional
    "tolerancePct": 5.0                              // optional; falls back to the manifest default
  }
}
```

## Rules

1. `source` is mandatory and must point at something a reviewer can open. A case
   with no verifiable source is worse than no case at all — it launders a guess
   into a test assertion.
2. `tolerancePct` is a stated agreement about how close this engine must track
   the reference, not a knob to turn until the test goes green. Widening it is a
   change to `docs/solar-calculation-spec.md` and needs Product Owner sign-off.
3. Cover, at minimum: several regions, several modules, several azimuths,
   several tilts and several array sizes (project brief rule 22).
4. When a case fails, analyse the discrepancy before touching engine code. A
   systematic offset across every case is a model difference and belongs in the
   spec; one case out of twenty is usually a transcription error in the fixture.

## Loading real data

`npx tsx scripts/fetch-pvgis-golden.ts --lat 35.68 --lon 139.77 --tilt 30 --azimuth 180 --kw 5`
writes a case file from the live PVGIS API. It needs outbound access to
`re.jrc.ec.europa.eu`.
