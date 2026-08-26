import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GeocodingNotConfiguredError,
  clearGeocodeCache,
  geocodeAddress,
  parseGeocodeResponse,
} from '@server/services/geocoding';

const OK_PAYLOAD = {
  status: 'OK',
  results: [
    {
      formatted_address: '日本、〒100-0001 東京都千代田区千代田1-1',
      place_id: 'ChIJXYZ',
      geometry: {
        location: { lat: 35.6852, lng: 139.7528 },
        location_type: 'ROOFTOP',
      },
    },
  ],
};

function mockFetch(payload: unknown, status = 200) {
  return vi.fn(
    async (_url: string) => new Response(JSON.stringify(payload), { status }),
  ) as unknown as typeof fetch;
}

describe('parseGeocodeResponse', () => {
  it('maps a successful response', () => {
    const [r] = parseGeocodeResponse(OK_PAYLOAD);
    expect(r!.latitude).toBe(35.6852);
    expect(r!.longitude).toBe(139.7528);
    expect(r!.locationType).toBe('ROOFTOP');
    expect(r!.placeId).toBe('ChIJXYZ');
  });

  it('returns nothing for ZERO_RESULTS rather than throwing', () => {
    expect(parseGeocodeResponse({ status: 'ZERO_RESULTS', results: [] })).toEqual([]);
  });

  it('raises an actionable error for a quota breach', () => {
    expect(() => parseGeocodeResponse({ status: 'OVER_QUERY_LIMIT' })).toThrow(/クォータ/);
  });

  it('raises an actionable error when the key is restricted', () => {
    expect(() =>
      parseGeocodeResponse({ status: 'REQUEST_DENIED', error_message: 'referer blocked' }),
    ).toThrow(/APIキーの制限設定/);
  });

  it('skips results with no usable coordinates', () => {
    const payload = {
      status: 'OK',
      results: [{ formatted_address: 'x', geometry: {} }, ...OK_PAYLOAD.results],
    };
    expect(parseGeocodeResponse(payload)).toHaveLength(1);
  });

  it('tolerates junk', () => {
    expect(parseGeocodeResponse(null)).toEqual([]);
    expect(parseGeocodeResponse('nope')).toEqual([]);
    expect(parseGeocodeResponse({ status: 'OK' })).toEqual([]);
  });
});

describe('geocodeAddress', () => {
  beforeEach(() => clearGeocodeCache());

  it('refuses without a key, naming the setup document', async () => {
    await expect(
      geocodeAddress('東京都千代田区', { apiKey: undefined, fetchImpl: mockFetch(OK_PAYLOAD) }),
    ).rejects.toThrow(GeocodingNotConfiguredError);
  });

  it('calls the API with Japanese language and region hints', async () => {
    const fetchImpl = mockFetch(OK_PAYLOAD);
    await geocodeAddress('東京都千代田区千代田1-1', { apiKey: 'k', fetchImpl });
    const url = new URL(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string,
    );
    expect(url.searchParams.get('language')).toBe('ja');
    expect(url.searchParams.get('region')).toBe('jp');
    expect(url.searchParams.get('key')).toBe('k');
  });

  it('caches, so the same address is billed once', async () => {
    const fetchImpl = mockFetch(OK_PAYLOAD);
    await geocodeAddress('東京都千代田区千代田1-1', { apiKey: 'k', fetchImpl });
    await geocodeAddress('東京都千代田区千代田1-1', { apiKey: 'k', fetchImpl });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('treats full-width digits and different dashes as the same address', async () => {
    const fetchImpl = mockFetch(OK_PAYLOAD);
    await geocodeAddress('東京都千代田区千代田1-1', { apiKey: 'k', fetchImpl });
    await geocodeAddress('東京都千代田区千代田１−１', { apiKey: 'k', fetchImpl });
    await geocodeAddress('  東京都千代田区千代田1-1  ', { apiKey: 'k', fetchImpl });
    // All three are the same query; billing it three times would be waste.
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('expires a cache entry after its TTL', async () => {
    const fetchImpl = mockFetch(OK_PAYLOAD);
    const t0 = 1_000_000;
    await geocodeAddress('東京都', { apiKey: 'k', fetchImpl, now: t0 });
    await geocodeAddress('東京都', { apiKey: 'k', fetchImpl, now: t0 + 25 * 3600_000 });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it('surfaces an HTTP failure', async () => {
    await expect(
      geocodeAddress('東京都', { apiKey: 'k', fetchImpl: mockFetch({}, 500) }),
    ).rejects.toThrow(/500/);
  });
});
