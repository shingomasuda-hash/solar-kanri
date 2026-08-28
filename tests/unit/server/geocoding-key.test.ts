import { afterEach, describe, expect, it, vi } from 'vitest';
import { geocodingKeySource, isGeocodingConfigured } from '@server/services/geocoding';

/**
 * Which key geocoding uses, and whether the operator is told.
 *
 * A browser key is referrer-restricted; a server request carries no referrer,
 * so Google rejects it. Silently falling back to that key made a deployment
 * look configured and then fail with Google's own wording about referrers,
 * which points at the Maps console rather than at the empty variable that
 * actually caused it. The fallback is still worth having for local
 * development — what it must not be is invisible.
 */
describe('geocoding key source', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('reports a dedicated server key', () => {
    vi.stubEnv('GOOGLE_GEOCODING_API_KEY', 'server-key');
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'browser-key');
    expect(geocodingKeySource()).toBe('dedicated');
  });

  it('reports the browser-key fallback rather than pretending it is configured', () => {
    vi.stubEnv('GOOGLE_GEOCODING_API_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'browser-key');
    expect(geocodingKeySource()).toBe('browser-key-fallback');
    // Still "configured": requests will be attempted, and may well work if the
    // key is unrestricted. The screen says which case this is.
    expect(isGeocodingConfigured()).toBe(true);
  });

  it('reports nothing configured when both are empty', () => {
    vi.stubEnv('GOOGLE_GEOCODING_API_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', '');
    expect(geocodingKeySource()).toBe('none');
    expect(isGeocodingConfigured()).toBe(false);
  });

  it('treats an empty string as absent, not as a value', () => {
    // The trap: a hosting dashboard populated from .env.example registers the
    // name with an empty value. `??` would call that configured.
    vi.stubEnv('GOOGLE_GEOCODING_API_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'browser-key');
    expect(geocodingKeySource()).not.toBe('dedicated');
  });
});
