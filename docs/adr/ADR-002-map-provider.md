# ADR-002: Map provider and drawing library

**Status:** Accepted · 2026-08-26

## Context

Operators must trace roof outlines on satellite imagery: create polygons, then
add, move and delete individual vertices, move and delete whole polygons, and
come back later to edit them. Multiple roof faces and multiple exclusion zones
per property.

The obvious tool — `google.maps.drawing.DrawingManager` — **is gone**. Google
deprecated the Drawing Library in August 2025 and removed it from the Maps
JavaScript API in v3.65, unavailable as of May 2026. Google's own migration
guidance points at Terra Draw.

Source: <https://developers.google.com/maps/deprecations>

## Decision

**Google Maps JavaScript API** for the base map and satellite imagery.
**Terra Draw** with `terra-draw-google-maps-adapter` for all drawing.
**GeoJSON (RFC 7946, WGS84)** as the persistence format.

## Rationale

**Google Maps for imagery.** Japanese satellite and aerial imagery coverage and
recency are the deciding factor, and Google's is the best available for this
use. Geocoding quality for Japanese addresses is also materially better than the
open alternatives.

**Terra Draw for drawing.** It is what Google itself recommends, it is
actively maintained, and it is adapter-based — the same drawing code works
against Mapbox, MapLibre, OpenLayers and Leaflet. That last point is the real
value: it means the drawing layer is not a second Google lock-in on top of the
imagery one. If Google's pricing or terms change, we replace the base map and
keep the drawing code.

Terra Draw is headless and event-driven rather than a drop-in for
`DrawingManager`, so the UI and state management are ours to write. That is a
one-time cost we would pay anyway, since our editing model (setback preview,
live geometry validation, exclusion zones) is not what `DrawingManager`
provided.

**Rejected: `mcx-drawing-polyfill`.** A drop-in replacement for the removed
library exists. It would be the right call for retrofitting a large legacy
codebase. For greenfield it buys a familiar API in exchange for depending on a
single-purpose shim of a dead interface, and it keeps us on Google's object
model rather than GeoJSON.

**GeoJSON for storage.** A standard, readable format that every geospatial tool
understands. Storing Google's proprietary overlay objects, or our own local
metre coordinates, would tie persisted data to a library version or to a frame
origin that could drift. Local Cartesian coordinates are _derived_ on load
(ADR-003), never stored as the source of truth.

## Consequences

- Google Maps Platform credentials and billing are required before the map works
  at all. Tracked as OI-004 with setup instructions in `docs/setup/`.
- Geocoding is billed per request, so the client debounces, caches per address,
  and reuses a project's stored coordinates. A revisit costs nothing.
- The drawing UI is bespoke. Covered by Playwright tests rather than trusted.
- We must not reintroduce any dependency on `google.maps.drawing`.
