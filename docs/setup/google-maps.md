# Google Maps Platform setup

Required for: address search, satellite imagery, roof drawing.
Optional: the Solar API (building insights).

**The platform works without any of this.** With no key, the map panel explains
what to configure and an operator can still set the site position by
latitude/longitude and paste a roof outline as GeoJSON. Everything downstream —
panel layout, simulation, quotation — is unaffected. Configure Maps when you
want the tracing workflow, not because the system is broken without it.

Tracked as **OI-004** in `docs/open-issues.md`.

---

## 1. Create a project and enable billing

1. Open <https://console.cloud.google.com/>.
2. Create a project (or pick an existing one).
3. **Billing → Link a billing account.** The Maps Platform returns errors on
   every request without it, even inside the free tier.

## 2. Enable the APIs

Under **APIs & Services → Library**, enable:

| API                     | Needed for                  | Billing      |
| ----------------------- | --------------------------- | ------------ |
| **Maps JavaScript API** | Satellite map, roof drawing | Per map load |
| **Geocoding API**       | Address → coordinates       | Per request  |
| **Solar API**           | Optional building insights  | Per request  |

Do not enable anything else. Every enabled API is attack surface on a key that
is readable from the page source.

## 3. Create two keys, not one

The browser key is public by definition — anyone can read it out of the page.
The geocoding key never needs to be, so it should not be.

### Browser key — `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`

1. **APIs & Services → Credentials → Create credentials → API key.**
2. Name it `solar-kanri-browser`.
3. **Application restrictions → Websites**, and add exactly the origins you
   serve from:
   ```
   https://your-domain.example/*
   http://localhost:3000/*      # development only
   ```
4. **API restrictions → Restrict key →** Maps JavaScript API only.

### Server key — `GOOGLE_GEOCODING_API_KEY`

Two keys, not one. A browser key is referrer-restricted, and a request made
from the server carries no referrer, so Google rejects it. If
`GOOGLE_GEOCODING_API_KEY` is empty the application falls back to the browser
key — convenient locally with one unrestricted key, wrong in production — and
the design screen says so rather than leaving you to decode Google's error
about referrers.

1. Create a second key, named `solar-kanri-server`.
2. **Application restrictions → IP addresses**, and add your server's egress IP.
3. **API restrictions → Restrict key →** Geocoding API (and Solar API if used).

An unrestricted key found in a page source is billed by whoever finds it. Set
the restrictions when you create the key, not later.

## 4. Optional: a Map ID for vector styling

**Google Maps Platform → Map management → Create Map ID**, type JavaScript,
raster or vector. Put it in `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`. Leave it empty and
the default raster satellite style is used.

## 5. Configure the application

```bash
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY="AIza...browser"
NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=""            # optional
GOOGLE_GEOCODING_API_KEY="AIza...server"
GOOGLE_SOLAR_API_KEY=""                      # optional
```

Restart the server (`NEXT_PUBLIC_*` is inlined at build time, so a production
deployment needs a **rebuild**, not just a restart).

## 6. Verify

**管理 → システム状態** probes both keys and reports what it finds:

| Component                   | Meaning                                                             |
| --------------------------- | ------------------------------------------------------------------- |
| Google Maps: 未設定         | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is empty                          |
| Geocoding: 正常             | A live test request succeeded                                       |
| Geocoding: REQUEST_DENIED   | Key restrictions are blocking the server — check the IP restriction |
| Geocoding: OVER_QUERY_LIMIT | Quota or billing problem                                            |

Then open a project's 屋根・パネル設計 screen: the satellite map should render
and 住所検索 should move the map to the address.

## Cost control

Geocoding is billed per request, so the application:

- caches results by **normalised** address for 24 hours — full-width digits,
  different dash characters and stray whitespace all resolve to one cache entry
  rather than three billed lookups;
- stores each project's coordinates, so revisiting a project costs nothing;
- never geocodes on keystroke.

### What this actually costs

Google removed the universal $200 monthly credit in March 2025. Each API now
has its own free monthly allowance — 10,000 calls, at the time of writing —
after which you pay per request (Geocoding is around $5 per 1,000).

For a small sales team the bill is nothing, and the reason is worth
understanding rather than assuming:

| API             | Called when              | Realistic month |
| --------------- | ------------------------ | --------------- |
| Maps JavaScript | Every design-screen open | ~3,300          |
| Geocoding       | Once per property, ever  | ~200            |
| Solar           | Once per building, ever  | ~200            |

The last two are two orders of magnitude smaller than the first because both
are cached — the address by normalised string and then by the project's stored
coordinates, the building insight on the property row. Only the map load
recurs, because a map cannot be cached across page loads.

**Set a daily quota cap anyway.** Google Maps Platform → 割り当て, per API:

| API                 | Requests per day |
| ------------------- | ---------------- |
| Maps JavaScript API | 300              |
| Geocoding API       | 100              |
| Solar API           | 100              |

300 × 31 stays inside the free allowance even if the cap is hit every day.

A cap is the only thing that bounds the damage from a leaked key, and the
browser key is readable by anyone who views the page — that is what it is for.
A budget alert (Cloud Billing → 予算とアラート) tells you afterwards; only the
quota stops it. When a cap is reached the address search fails with a message
and the operator carries on by entering coordinates directly, which is the
behaviour you want: stopping and being noticed beats billing quietly.

Verify current prices before relying on these numbers — Google has restructured
this pricing once already.

## Deprecation note

`google.maps.drawing.DrawingManager` was deprecated in August 2025 and removed
in Maps JavaScript API v3.65 — unavailable since May 2026. This project uses
**Terra Draw**, Google's own recommended replacement (see
`docs/adr/ADR-002-map-provider.md`). Do not reintroduce a dependency on the
drawing library.

---

## Roof pitch from satellite imagery

The design screen has an optional **衛星から屋根勾配を推定** step. It calls the
Solar API's `buildingInsights` endpoint and offers each detected roof face's
pitch, orientation and area; one click fills the roof form.

Three things to know before relying on it.

**It does not draw the outline.** Google returns a segment's centre and
bounding box, not its boundary. The tracing stays manual — the estimate saves
you the pitch, which is otherwise a trip onto the roof.

**Not every building is modelled.** Coverage is good in dense urban Japan and
thin elsewhere. An unmodelled building is a normal outcome, reported as such,
and nothing downstream changes: the operator states the pitch and the result is
exactly as accurate.

**An applied estimate is recorded as `PROVIDER`, not `MEASURED`.** That
provenance travels with the roof face, so a figure derived from satellite
imagery is never presented as a site measurement. Picking a pitch from the
preset list afterwards drops it back to `ASSUMED` — the provenance follows the
number, not the field.

Billing: charged per request. The result is stored on the property, so
revisiting the same building costs nothing; moving the pin more than 15 m
invalidates it, because it is then a different building.

Set `GOOGLE_SOLAR_API_KEY`, or leave it empty and the step will say it is
unconfigured. It falls back to `GOOGLE_GEOCODING_API_KEY` if that key has the
Solar API enabled.
