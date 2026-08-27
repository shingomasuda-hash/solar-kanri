import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Satellite roof estimation.
 *
 * The behaviour worth pinning is not "it calls Google" — it is everything
 * around that call:
 *
 *  - the Solar API is billed per request, so a second look at the same
 *    building must not produce a second request;
 *  - "Google does not model this building" is an ordinary outcome, not an
 *    error, because the operator simply traces the roof instead;
 *  - moving the pin invalidates the stored result, since it is then a
 *    different building.
 */

const HAS_DB = Boolean(process.env.DATABASE_URL);
const PREFIX = 'itest-solar-insight';

/** Stands in for Google, and counts how often it was asked. */
function fakeProvider(result: unknown) {
  const calls = { count: 0 };
  const provider = {
    lookup: async () => {
      calls.count += 1;
      return result;
    },
  };
  return { provider: provider as never, calls };
}

const TOKYO = { lat: 35.6812, lng: 139.767 };

const TWO_SEGMENTS = {
  status: 'ok' as const,
  insight: {
    center: TOKYO,
    imageryDate: '2025-04-01',
    imageryQuality: 'HIGH' as const,
    maxArrayPanelCount: 40,
    maxArrayAreaM2: 80,
    maxSunshineHoursPerYear: 1600,
    roofSegments: [
      { pitchDeg: 22.74, azimuthDeg: 178.6, areaM2: 31.25, center: TOKYO },
      { pitchDeg: 22.71, azimuthDeg: 358.6, areaM2: 48.4, center: TOKYO },
    ],
  },
};

describe.skipIf(!HAS_DB)('satellite roof estimation', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let service: any;
  let admin: { id: string; email: string; name: string; role: 'ADMIN' };
  let customerId: string;
  let propertyId: string;

  beforeAll(async () => {
    const [db, mod] = await Promise.all([
      import('@server/db/client'),
      import('@server/services/solar-insight'),
    ]);
    prisma = db.prisma;
    service = mod;

    const user = await prisma.user.create({
      data: {
        email: `${PREFIX}@example.invalid`,
        name: `${PREFIX} admin`,
        passwordHash: 'integration-test-account-no-login',
        role: 'ADMIN',
      },
    });
    admin = { id: user.id, email: user.email, name: user.name, role: 'ADMIN' };

    const customer = await prisma.customer.create({
      data: { code: `${PREFIX}-C`, type: 'INDIVIDUAL', name: `${PREFIX} 顧客` },
    });
    customerId = customer.id;

    const property = await prisma.property.create({
      data: { customerId, label: '本邸', latitude: TOKYO.lat, longitude: TOKYO.lng },
    });
    propertyId = property.id;
  });

  afterAll(async () => {
    if (!HAS_DB || !prisma) return;
    await prisma.auditLog.deleteMany({ where: { userId: admin.id } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: admin.id } });
    vi.unstubAllEnvs();
  });

  it('returns the largest roof face first — that is the one worth panelling', async () => {
    vi.stubEnv('GOOGLE_SOLAR_API_KEY', 'test-key');
    const { provider, calls } = fakeProvider(TWO_SEGMENTS);

    const result = await service.estimateRoofFromSatellite(admin, propertyId, {
      refresh: true,
      provider,
    });

    expect(calls.count).toBe(1);
    expect(result.status).toBe('ok');
    expect(result.cached).toBe(false);
    expect(result.segments.map((s: any) => s.areaM2)).toEqual([48.4, 31.3]);
    // Rounded for display, not carried at full precision into anything.
    expect(result.segments[0].pitchDeg).toBe(22.7);
    expect(result.segments[0].azimuthDeg).toBe(359);
  });

  it('serves the second look from storage, so it is not billed twice', async () => {
    const { provider, calls } = fakeProvider(TWO_SEGMENTS);

    const result = await service.estimateRoofFromSatellite(admin, propertyId, { provider });

    expect(calls.count).toBe(0);
    expect(result.cached).toBe(true);
    expect(result.segments).toHaveLength(2);
  });

  it('discards the stored result when the pin moves to another building', async () => {
    // ~330 m away: a different building, so the stored answer is wrong rather
    // than merely stale.
    await prisma.property.update({
      where: { id: propertyId },
      data: { latitude: TOKYO.lat + 0.003, longitude: TOKYO.lng },
    });
    const { provider, calls } = fakeProvider(TWO_SEGMENTS);

    const result = await service.estimateRoofFromSatellite(admin, propertyId, { provider });

    expect(calls.count).toBe(1);
    expect(result.cached).toBe(false);
  });

  it('treats an unmodelled building as a normal outcome, not an error', async () => {
    await prisma.property.update({
      where: { id: propertyId },
      data: { latitude: TOKYO.lat + 0.01, longitude: TOKYO.lng, solarInsight: undefined },
    });
    const { provider } = fakeProvider({ status: 'no-coverage' });

    const result = await service.estimateRoofFromSatellite(admin, propertyId, { provider });

    expect(result.status).toBe('no-coverage');
    expect(result.segments).toEqual([]);
  });

  it('refuses without a position, naming the step that fixes it', async () => {
    const bare = await prisma.property.create({
      data: { customerId, label: `${PREFIX} 位置なし` },
    });
    await expect(service.estimateRoofFromSatellite(admin, bare.id)).rejects.toThrow(/位置を確定/);
  });

  it('refuses without a key rather than failing obscurely at the request', async () => {
    vi.stubEnv('GOOGLE_SOLAR_API_KEY', '');
    vi.stubEnv('GOOGLE_GEOCODING_API_KEY', '');
    const moved = await prisma.property.create({
      data: { customerId, label: `${PREFIX} キーなし`, latitude: 34.7, longitude: 135.5 },
    });

    await expect(service.estimateRoofFromSatellite(admin, moved.id)).rejects.toBeInstanceOf(
      service.SolarApiNotConfiguredError,
    );
  });
});
