import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Importing a site's climate from a provider.
 *
 * The behaviour that matters is what gets *stored*: real figures from a named
 * service, with provenance that says so, so a saved simulation stays
 * reproducible when the service changes its answer next year. Fetching per
 * simulation would have quietly rewritten quotations issued today.
 */

const HAS_DB = Boolean(process.env.DATABASE_URL);
const PREFIX = 'itest-irradiance-import';

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const byMonth = (f: (m: number) => number) =>
  Object.fromEntries(MONTHS.map((m) => [m, f(m)])) as Record<number, number>;

/** Stands in for PVGIS; a plausible Japanese annual shape. */
function fakeProvider(overrides: Record<string, unknown> = {}) {
  const calls = { count: 0 };
  const provider = {
    id: 'pvgis',
    name: 'PVGIS (test)',
    isAvailable: () => true,
    fetch: async () => {
      calls.count += 1;
      return {
        providerId: 'pvgis',
        providerName: 'PVGIS (test)',
        latitude: 34.51,
        longitude: 135.74,
        tiltDeg: 0,
        azimuthDeg: 180,
        climate: {
          planeOfArrayKWhPerM2PerDay: byMonth(
            (m) => 2.4 + 2 * Math.sin(((m - 3) / 12) * 2 * Math.PI),
          ),
          ambientTempC: byMonth((m) => 15 + 11 * Math.sin(((m - 4) / 12) * 2 * Math.PI)),
        },
        source: {
          value: 'PVGIS-ERA5',
          source: {
            kind: 'provider-api' as const,
            citation: 'PVGIS-ERA5 monthly means',
            url: 'https://example.invalid/pvgis',
          },
        },
        isPlaneOfArray: false,
        ...overrides,
      };
    },
  };
  return { provider: provider as never, calls };
}

describe.skipIf(!HAS_DB)('irradiance import', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let admin: any;
  let sales: any;
  let service: any;
  const createdUserIds: string[] = [];
  const createdStationIds: string[] = [];

  beforeAll(async () => {
    const [db, mod] = await Promise.all([
      import('@server/db/client'),
      import('@server/services/admin'),
    ]);
    prisma = db.prisma;
    service = mod;

    const make = async (suffix: string, role: 'ADMIN' | 'SALES') => {
      const u = await prisma.user.create({
        data: {
          email: `${PREFIX}-${suffix}@example.invalid`,
          name: `${PREFIX} ${suffix}`,
          passwordHash: 'integration-test-account-no-login',
          role,
        },
      });
      createdUserIds.push(u.id);
      return { id: u.id, email: u.email, name: u.name, role: u.role };
    };
    admin = await make('admin', 'ADMIN');
    sales = await make('sales', 'SALES');
  });

  afterAll(async () => {
    if (!HAS_DB || !prisma) return;
    await prisma.auditLog.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.irradianceStation.deleteMany({ where: { id: { in: createdStationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it('stores the figures the provider returned, with provenance that names it', async () => {
    const { provider, calls } = fakeProvider();
    const station = await service.importIrradianceFromProvider(
      admin,
      { label: `${PREFIX} 大和高田`, latitude: 34.51, longitude: 135.74 },
      { provider },
    );
    createdStationIds.push(station.id);

    expect(calls.count).toBe(1);
    expect(station.sourceKind).toBe('PROVIDER_API');
    expect(station.sourceCitation).toContain('PVGIS');
    // The caveat has to travel with the figure, not live in a wiki.
    expect(station.sourceCitation).toContain('NEDO');
    expect(station.sourceUrl).toContain('pvgis');

    // Twelve months of both series, stored as the provider gave them.
    const irr = station.monthlyIrradiationKWhPerM2PerDay as Record<string, number>;
    expect(Object.keys(irr)).toHaveLength(12);
    // Summer above winter: a stored series that lost its month keys would
    // still have twelve entries, and would be silently wrong.
    expect(irr['7']!).toBeGreaterThan(irr['1']!);
  });

  it('is horizontal by default, since one station serves many roof tilts', async () => {
    const { provider } = fakeProvider();
    const station = await service.importIrradianceFromProvider(
      admin,
      { label: `${PREFIX} 水平`, latitude: 34.6, longitude: 135.8 },
      { provider },
    );
    createdStationIds.push(station.id);
    expect(station.isPlaneOfArray).toBe(false);
    expect(station.tiltDeg).toBe(0);
  });

  it('rejects a physically impossible response instead of storing it', async () => {
    // The classic MJ/m²/day paste is 3.6x too large. A provider that returned
    // one would otherwise produce a confidently wrong yield forever.
    const { provider } = fakeProvider({
      climate: {
        planeOfArrayKWhPerM2PerDay: byMonth(() => 45),
        ambientTempC: byMonth(() => 15),
      },
    });
    await expect(
      service.importIrradianceFromProvider(
        admin,
        { label: `${PREFIX} 不正`, latitude: 34.7, longitude: 135.5 },
        { provider },
      ),
    ).rejects.toThrow();
  });

  it('refuses a user without master:write', async () => {
    const { provider, calls } = fakeProvider();
    await expect(
      service.importIrradianceFromProvider(
        sales,
        { label: `${PREFIX} 権限`, latitude: 34.7, longitude: 135.5 },
        { provider },
      ),
    ).rejects.toThrow();
    // And it must refuse before spending a request.
    expect(calls.count).toBe(0);
  });
});
