/**
 * Google Geocoding API adapter.
 *
 * Cost control (project brief rule 42): Geocoding is billed per request, so
 *  - results are cached in-process by normalised address,
 *  - a project reuses its stored coordinates and never re-geocodes on revisit,
 *  - the client debounces typing before it ever reaches this route.
 */

export class GeocodingNotConfiguredError extends Error {
  constructor() {
    super(
      'Google Geocoding API キーが未設定です。docs/setup/google-maps.md の手順に従って ' +
        'GOOGLE_GEOCODING_API_KEY を設定してください。',
    );
    this.name = 'GeocodingNotConfiguredError';
  }
}

export interface GeocodeResult {
  readonly formattedAddress: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly locationType: string;
  readonly placeId: string | null;
}

interface CacheEntry {
  readonly results: GeocodeResult[];
  readonly expiresAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const cache = new Map<string, CacheEntry>();

function normalise(address: string): string {
  // Full-width to half-width digits, collapse whitespace: "１２３-４５６７" and
  // "123-4567" are the same lookup and must not be billed twice.
  return address
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[－‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function clearGeocodeCache(): void {
  cache.clear();
}

export async function geocodeAddress(
  address: string,
  options: { fetchImpl?: typeof fetch; apiKey?: string; now?: number } = {},
): Promise<GeocodeResult[]> {
  const key = normalise(address);
  const now = options.now ?? Date.now();

  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.results;

  // `||` rather than `??` throughout: a variable registered with an empty
  // value is not a key. With `??` an empty GOOGLE_GEOCODING_API_KEY would
  // shadow a perfectly good browser key and report "not configured" — which is
  // exactly what a dashboard populated from .env.example produces.
  const apiKey =
    options.apiKey ||
    process.env.GOOGLE_GEOCODING_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new GeocodingNotConfiguredError();

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('language', 'ja');
  url.searchParams.set('region', 'jp');
  url.searchParams.set('key', apiKey);

  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const res = await doFetch(url.toString());
  if (!res.ok) throw new Error(`Geocoding API responded ${res.status}`);

  const payload = (await res.json()) as unknown;
  const results = parseGeocodeResponse(payload);

  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Simple FIFO eviction; the working set here is a day's addresses.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { results, expiresAt: now + CACHE_TTL_MS });
  return results;
}

/** Map a raw Geocoding payload into domain types. Pure, so it is testable. */
export function parseGeocodeResponse(payload: unknown): GeocodeResult[] {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as { status?: unknown; results?: unknown; error_message?: unknown };

  if (p.status === 'ZERO_RESULTS') return [];
  if (p.status === 'OVER_QUERY_LIMIT') {
    throw new Error('Geocoding API のクォータを超過しました。時間をおいて再試行してください。');
  }
  if (p.status === 'REQUEST_DENIED') {
    throw new Error(
      `Geocoding API がリクエストを拒否しました: ${String(p.error_message ?? '')}。` +
        'APIキーの制限設定を確認してください。',
    );
  }
  if (p.status !== 'OK' || !Array.isArray(p.results)) return [];

  const out: GeocodeResult[] = [];
  for (const raw of p.results as Record<string, unknown>[]) {
    const geometry = raw.geometry as Record<string, unknown> | undefined;
    const location = geometry?.location as Record<string, unknown> | undefined;
    const lat = location?.lat;
    const lng = location?.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    out.push({
      formattedAddress: typeof raw.formatted_address === 'string' ? raw.formatted_address : '',
      latitude: lat,
      longitude: lng,
      locationType:
        typeof geometry?.location_type === 'string' ? geometry.location_type : 'UNKNOWN',
      placeId: typeof raw.place_id === 'string' ? raw.place_id : null,
    });
  }
  return out;
}

/** True when a key is configured, so the UI can show setup guidance instead of an error. */
export function isGeocodingConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_GEOCODING_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
  );
}
