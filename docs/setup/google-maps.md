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

Set a **budget alert** in Cloud Billing and a **daily quota cap** per API
(APIs & Services → Quotas). A cap is the only thing that bounds the damage from
a leaked key.

## Deprecation note

`google.maps.drawing.DrawingManager` was deprecated in August 2025 and removed
in Maps JavaScript API v3.65 — unavailable since May 2026. This project uses
**Terra Draw**, Google's own recommended replacement (see
`docs/adr/ADR-002-map-provider.md`). Do not reintroduce a dependency on the
drawing library.
