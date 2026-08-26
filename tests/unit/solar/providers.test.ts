import { describe, expect, it, vi } from 'vitest';
import {
  ManualSolarProvider,
  validateManualClimate,
  type ManualDataset,
} from '@core/solar/providers/manual';
import {
  PvgisProvider,
  compassToPvgisAspect,
  parsePvgisMonthly,
  pvgisAspectToCompass,
  type PvgisMonthlyResponse,
} from '@core/solar/providers/pvgis';
import { GoogleSolarProvider, mapBuildingInsight } from '@core/solar/providers/google-solar';
import { resolveIrradiance, type SolarDataProvider } from '@core/solar/providers/types';
import { MONTHS } from '@core/solar/types';
import { SEASONAL_CLIMATE, flatClimate } from '@tests/fixtures/solar/coefficients';

const QUERY = { latitude: 35.6812, longitude: 139.7671, tiltDeg: 30, azimuthDeg: 180 };

describe('PVGIS azimuth convention', () => {
  /**
   * PVGIS `aspect` is 0 = SOUTH; ours is 0 = NORTH. Getting this backwards
   * quotes a north-facing yield for a south-facing roof — a ~40 % error that
   * looks perfectly plausible on a report, so it is pinned down here.
   */
  it('maps compass to aspect', () => {
    expect(compassToPvgisAspect(180)).toBe(0); // south
    expect(compassToPvgisAspect(90)).toBe(-90); // east
    expect(compassToPvgisAspect(270)).toBe(90); // west
    expect(compassToPvgisAspect(0)).toBe(180); // north
    expect(compassToPvgisAspect(360)).toBe(180);
  });

  it('stays inside (-180, 180]', () => {
    for (let deg = 0; deg < 360; deg += 7) {
      const a = compassToPvgisAspect(deg);
      expect(a).toBeGreaterThan(-180.0001);
      expect(a).toBeLessThanOrEqual(180);
    }
  });

  it('round-trips', () => {
    for (const deg of [0, 45, 90, 135, 180, 225, 270, 315]) {
      expect(pvgisAspectToCompass(compassToPvgisAspect(deg))).toBeCloseTo(deg, 9);
    }
  });

  it('handles negative and over-wound input', () => {
    expect(compassToPvgisAspect(-90)).toBe(compassToPvgisAspect(270));
    expect(compassToPvgisAspect(540)).toBe(compassToPvgisAspect(180));
  });
});

describe('PVGIS response mapping', () => {
  const payload = (over: Partial<Record<string, unknown>> = {}): PvgisMonthlyResponse => ({
    outputs: {
      monthly: MONTHS.map((m) => ({ month: m, 'H(i)_m': 120, T2m: 15, ...over })),
    },
  });

  it('converts monthly totals to a daily mean using calendar month lengths', () => {
    const d = parsePvgisMonthly(payload(), QUERY, 'pvgis', 'PVGIS')!;
    expect(d).not.toBeNull();
    expect(d.climate.planeOfArrayKWhPerM2PerDay[1]).toBeCloseTo(120 / 31, 9);
    expect(d.climate.planeOfArrayKWhPerM2PerDay[2]).toBeCloseTo(120 / 28, 9);
    expect(d.climate.planeOfArrayKWhPerM2PerDay[4]).toBeCloseTo(120 / 30, 9);
  });

  it('carries the query geometry into the dataset', () => {
    const d = parsePvgisMonthly(payload(), QUERY, 'pvgis', 'PVGIS')!;
    expect(d.tiltDeg).toBe(30);
    expect(d.azimuthDeg).toBe(180);
    expect(d.isPlaneOfArray).toBe(true);
    expect(d.source.source.kind).toBe('provider-api');
  });

  it('flags horizontal-only data instead of pretending it is plane-of-array', () => {
    const horizontal: PvgisMonthlyResponse = {
      outputs: { monthly: MONTHS.map((m) => ({ month: m, 'H(h)_m': 100, T2m: 15 })) },
    };
    const d = parsePvgisMonthly(horizontal, QUERY, 'pvgis', 'PVGIS')!;
    expect(d.isPlaneOfArray).toBe(false);
  });

  it('refuses a response missing temperature rather than inventing one', () => {
    const noTemp: PvgisMonthlyResponse = {
      outputs: { monthly: MONTHS.map((m) => ({ month: m, 'H(i)_m': 120 })) },
    };
    expect(parsePvgisMonthly(noTemp, QUERY, 'pvgis', 'PVGIS')).toBeNull();
  });

  it('refuses an incomplete year', () => {
    const partial: PvgisMonthlyResponse = {
      outputs: { monthly: [{ month: 1, 'H(i)_m': 120, T2m: 15 }] },
    };
    expect(parsePvgisMonthly(partial, QUERY, 'pvgis', 'PVGIS')).toBeNull();
  });

  it('returns null for an empty or malformed payload', () => {
    expect(parsePvgisMonthly({}, QUERY, 'p', 'P')).toBeNull();
    expect(parsePvgisMonthly({ outputs: { monthly: [] } }, QUERY, 'p', 'P')).toBeNull();
  });
});

describe('PvgisProvider transport', () => {
  it('builds the documented URL', async () => {
    const fetchImpl = vi.fn(async (_url: string) =>
      new Response(
        JSON.stringify({
          outputs: { monthly: MONTHS.map((m) => ({ month: m, 'H(i)_m': 120, T2m: 15 })) },
        }),
        { status: 200 },
      ),
    );
    const p = new PvgisProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await p.fetch(QUERY);
    const url = new URL(fetchImpl.mock.calls[0]![0]);
    expect(url.pathname).toContain('/MRcalc');
    expect(url.searchParams.get('lat')).toBe('35.6812');
    expect(url.searchParams.get('angle')).toBe('30');
    expect(url.searchParams.get('aspect')).toBe('0'); // south
    expect(url.searchParams.get('outputformat')).toBe('json');
  });

  it('names the rate limit when PVGIS returns 429', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 429 }));
    const p = new PvgisProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(p.fetch(QUERY)).rejects.toThrow(/rate limit/i);
  });

  it('surfaces other HTTP failures', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 500 }));
    const p = new PvgisProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(p.fetch(QUERY)).rejects.toThrow(/500/);
  });

  it('can be disabled', () => {
    expect(new PvgisProvider({ enabled: false }).isAvailable()).toBe(false);
    expect(new PvgisProvider().isAvailable()).toBe(true);
  });
});

describe('ManualSolarProvider', () => {
  const dataset: ManualDataset = {
    label: 'NEDO METPV-20 Tokyo',
    latitude: 35.68,
    longitude: 139.76,
    climate: SEASONAL_CLIMATE,
    source: {
      kind: 'public-dataset',
      citation: 'NEDO METPV-20, station 44132',
      verifiedAt: '2026-01-01T00:00:00Z',
      verifiedBy: 'admin',
    },
    isPlaneOfArray: false,
  };
  const provider = new ManualSolarProvider([dataset]);

  it('is unavailable with no datasets loaded', () => {
    expect(new ManualSolarProvider([]).isAvailable()).toBe(false);
    expect(provider.isAvailable()).toBe(true);
  });

  it('matches a nearby site', async () => {
    const d = await provider.fetch(QUERY);
    expect(d).not.toBeNull();
    expect(d!.source.value).toBe('NEDO METPV-20 Tokyo');
    expect(d!.isPlaneOfArray).toBe(false);
  });

  it('declines a site outside the match radius', async () => {
    expect(await provider.fetch({ ...QUERY, latitude: 43.06, longitude: 141.35 })).toBeNull();
  });

  it('picks the nearest of several datasets', async () => {
    const far: ManualDataset = { ...dataset, label: 'far', latitude: 35.9, longitude: 139.9 };
    const multi = new ManualSolarProvider([far, dataset]);
    const d = await multi.fetch(QUERY);
    expect(d!.source.value).toBe('NEDO METPV-20 Tokyo');
  });
});

describe('validateManualClimate', () => {
  it('accepts a sane table', () => {
    expect(validateManualClimate(SEASONAL_CLIMATE)).toEqual([]);
  });

  it('catches MJ/m2/day entered where kWh/m2/day was wanted', () => {
    // 4 kWh/m2/day is 14.4 MJ/m2/day; pasting the MJ figure is a real mistake.
    const errors = validateManualClimate(flatClimate(14.4, 20));
    expect(errors.length).toBe(12);
    expect(errors[0]).toContain('divide by 3.6');
  });

  it('catches negative irradiation and impossible temperatures', () => {
    expect(validateManualClimate(flatClimate(-1, 20)).length).toBe(12);
    expect(validateManualClimate(flatClimate(4, 200)).length).toBe(12);
  });
});

describe('resolveIrradiance fallback chain', () => {
  const ok = (id: string): SolarDataProvider => ({
    id,
    name: id,
    isAvailable: () => true,
    fetch: async () => ({
      providerId: id,
      providerName: id,
      latitude: 0,
      longitude: 0,
      tiltDeg: 0,
      azimuthDeg: 0,
      climate: flatClimate(4, 20),
      source: { value: id, source: { kind: 'public-dataset', citation: id } },
      isPlaneOfArray: true,
    }),
  });
  const empty = (id: string): SolarDataProvider => ({
    id,
    name: id,
    isAvailable: () => true,
    fetch: async () => null,
  });
  const broken = (id: string): SolarDataProvider => ({
    id,
    name: id,
    isAvailable: () => true,
    fetch: async () => {
      throw new Error('boom');
    },
  });
  const off = (id: string): SolarDataProvider => ({
    id,
    name: id,
    isAvailable: () => false,
    fetch: async () => null,
  });

  it('returns the first provider with data', async () => {
    const r = await resolveIrradiance([ok('a'), ok('b')], QUERY);
    expect(r.dataset!.providerId).toBe('a');
    expect(r.attempts).toEqual([{ providerId: 'a', outcome: 'ok' }]);
  });

  it('falls past unavailable, empty and broken providers', async () => {
    const r = await resolveIrradiance([off('a'), empty('b'), broken('c'), ok('d')], QUERY);
    expect(r.dataset!.providerId).toBe('d');
    expect(r.attempts.map((a) => a.outcome)).toEqual(['unavailable', 'no-data', 'error', 'ok']);
    expect(r.attempts[2]!.message).toBe('boom');
  });

  it('reports failure without throwing when nothing has data', async () => {
    const r = await resolveIrradiance([empty('a'), broken('b')], QUERY);
    expect(r.dataset).toBeNull();
    expect(r.attempts).toHaveLength(2);
  });

  it('handles an empty provider list', async () => {
    const r = await resolveIrradiance([], QUERY);
    expect(r.dataset).toBeNull();
    expect(r.attempts).toEqual([]);
  });
});

describe('Google Solar adapter', () => {
  it('is unavailable without an API key', () => {
    expect(new GoogleSolarProvider().isAvailable()).toBe(false);
    expect(new GoogleSolarProvider({ apiKey: 'k' }).isAvailable()).toBe(true);
  });

  it('reports no-coverage rather than failing when Google does not model the building', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }));
    const p = new GoogleSolarProvider({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await p.lookup({ latitude: 35, longitude: 139 })).toEqual({ status: 'no-coverage' });
  });

  it('reports unavailable without throwing on a network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    const p = new GoogleSolarProvider({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await p.lookup({ latitude: 35, longitude: 139 });
    expect(r.status).toBe('unavailable');
  });

  it('maps a payload into domain types', () => {
    const insight = mapBuildingInsight({
      center: { latitude: 35.1, longitude: 139.2 },
      imageryDate: { year: 2024, month: 3, day: 7 },
      imageryQuality: 'HIGH',
      solarPotential: {
        maxArrayPanelsCount: 42,
        maxArrayAreaMeters2: 80.5,
        maxSunshineHoursPerYear: 1600,
        roofSegmentStats: [
          {
            pitchDegrees: 22.5,
            azimuthDegrees: 178,
            center: { latitude: 35.1, longitude: 139.2 },
            stats: { areaMeters2: 45.2 },
          },
          { pitchDegrees: 22.5 }, // incomplete: must be dropped, not defaulted
        ],
      },
    });
    expect(insight).not.toBeNull();
    expect(insight!.imageryDate).toBe('2024-03-07');
    expect(insight!.imageryQuality).toBe('HIGH');
    expect(insight!.maxArrayPanelCount).toBe(42);
    expect(insight!.roofSegments).toHaveLength(1);
    expect(insight!.roofSegments[0]!.azimuthDeg).toBe(178);
  });

  it('returns null for junk rather than a half-built object', () => {
    expect(mapBuildingInsight(null)).toBeNull();
    expect(mapBuildingInsight({})).toBeNull();
    expect(mapBuildingInsight('nope')).toBeNull();
  });

  it('defaults unknown imagery quality instead of trusting the string', () => {
    const insight = mapBuildingInsight({
      center: { latitude: 1, longitude: 2 },
      imageryQuality: 'PERFECT',
    });
    expect(insight!.imageryQuality).toBe('UNKNOWN');
  });
});
