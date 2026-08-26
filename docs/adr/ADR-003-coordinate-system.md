# ADR-003: Coordinate systems

**Status:** Accepted · 2026-08-26

## Context

Google Maps produces WGS84 degrees. Panel layout needs consistent metres. And a
polygon traced on satellite imagery is not the roof — it is the roof's _shadow
on the ground_.

Two independent errors follow if this is not handled deliberately:

1. **Degrees are not square.** At 35°N, one degree of longitude is about 91 km
   while one degree of latitude is about 111 km. Treating lat/lng as a Cartesian
   plane distorts x against y by roughly 1.23:1 — a 10 m × 10 m array comes out
   10 m × 8.1 m, and every distance, area and angle is wrong.
2. **Projected area is not roof area.** On a 30° roof the true surface is
   `1/cos(30°) ≈ 1.155` times the horizontal projection in the slope direction.
   Laying real-size panel rectangles onto the projected polygon loses about one
   row in every seven — and it does so _invisibly_, because the result still
   looks like a correct layout.

## Decision

Three coordinate systems, with an explicit contract between them.

| System                  | Type        | Unit                                                          | Used for                        |
| ----------------------- | ----------- | ------------------------------------------------------------- | ------------------------------- |
| WGS84 geographic        | `LatLng`    | degrees                                                       | Display, storage, external APIs |
| Local ENU tangent plane | `Point2D`   | metres (x = East, y = North)                                  | All computation                 |
| Roof plane              | `RoofPoint` | metres along the roof surface (u = cross-slope, v = up-slope) | Panel layout                    |

**Rule: never do metre-scale arithmetic on degrees.** Convert first.

### WGS84 → local metres

`LocalFrame` pins an origin (the roof centroid) and converts via the WGS84
radii of curvature at that origin:

```
east  = Δlng_rad × R_N(φ₀) × cos φ₀      R_N = a / √(1 − e² sin²φ₀)
north = Δlat_rad × R_M(φ₀)               R_M = a(1 − e²) / (1 − e² sin²φ₀)^(3/2)
```

**Measured accuracy** — against an independent Vincenty geodesic
(`tests/unit/geo/local-frame.test.ts`):

| Distance from origin | Error           |
| -------------------- | --------------- |
| 50 m (a whole roof)  | < 1 mm          |
| 500 m (a site)       | ≤ 14 ppm ≈ 7 mm |

Both are far below the ~10 mm tolerance that matters for panel placement. Error
grows as O(d³/R²), so it stays negligible at every scale we use.

### Horizontal projection → roof plane

`RoofPlane` takes a pitch and a down-slope azimuth and defines:

- `u` — cross-slope, parallel to the ridge. **Unscaled.**
- `v` — up-slope. **Scaled by 1/cos(pitch).** `+v` points up the roof.

Panel layout runs entirely in `(u, v)`, where real module dimensions are
correct. Results are projected back for map display. Roof-plane polygons are
carried in `Point2D` (x = u, y = v) so every planar helper — buffering, overlay,
packing — works unchanged.

### Unknown pitch

`pitchSource: 'unknown'` makes the transform the identity and sets
`isFlatAssumption`. The UI **must** show that the result assumes a flat plane.
Guessing a pitch to make a number look tidier would be a fabrication that
propagates into a quotation.

## Rejected alternatives

**Web Mercator (EPSG:3857).** Google's display projection, so tempting. But its
scale factor is `1/cos(latitude)` — at 35°N everything is 1.22× too large, and
areas 1.49× too large. It is a display projection, not a measurement one.

**A national grid (JGD2011 / Japan Plane Rectangular CS).** Genuinely correct
and the right answer for a survey product. Rejected because it needs a zone
lookup, a full projection library, and gives no accuracy we can use — our error
is already sub-millimetre across a roof. Revisit if the product ever exports to
CAD or survey formats.

**Computing in degrees with a latitude correction factor.** The trap this ADR
exists to prevent. It appears to work, and is wrong in a way nobody notices
until a customer measures a finished array.

## Consequences

- One conversion boundary, in one place, with tests.
- `Polygon2D` is metres by construction — the type system prevents mixing.
- Every stored polygon is WGS84 GeoJSON; local coordinates are always derived on
  load, so a frame origin can never drift away from stored data.
- Pitch quality is a first-class field, not an assumption.
