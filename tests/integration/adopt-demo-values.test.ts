import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Adopting demonstration figures as the company's own provisional values.
 *
 * This is the one deliberate door through the demo barrier, so what it does
 * has to be exact. It must not make anything more accurate — the figures are
 * unchanged — and it must not be possible to walk through it anonymously or
 * without saying why. Ownership is the entire difference between a
 * demonstration figure and an administrator's decision, and the citation is
 * the only record of it.
 */

const HAS_DB = Boolean(process.env.DATABASE_URL);
const PREFIX = 'itest-adopt-demo';

describe.skipIf(!HAS_DB)('adopting demo values', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let service: any;
  let admin: any;
  let sales: any;
  let setId: string;
  const createdUserIds: string[] = [];
  const createdKeys: string[] = [];
  // The action is global by design — an operator wants one button, not one per
  // set — so this suite has to put the shared demo catalogue back exactly as it
  // found it, or the browser tests lose the demo they depend on.
  let demoSnapshot: { coefficients: string[]; tariffs: string[]; panels: string[] };

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

    const [demoCoefficients, demoTariffs, demoPanels] = await Promise.all([
      prisma.coefficient.findMany({
        where: { sourceKind: 'DEMO_APPROXIMATION' },
        select: { id: true },
      }),
      prisma.tariff.findMany({ where: { sourceKind: 'DEMO_APPROXIMATION' }, select: { id: true } }),
      prisma.panelModel.findMany({ where: { isDemo: true }, select: { id: true } }),
    ]);
    demoSnapshot = {
      coefficients: demoCoefficients.map((r: any) => r.id),
      tariffs: demoTariffs.map((r: any) => r.id),
      panels: demoPanels.map((r: any) => r.id),
    };

    // Plus an isolated set of this suite's own, so the assertions are about
    // rows nothing else touches.
    const set = await prisma.coefficientSet.create({
      data: { key: `${PREFIX}-set`, name: `${PREFIX} セット` },
    });
    setId = set.id;
    for (const key of [`${PREFIX}-a`, `${PREFIX}-b`]) {
      createdKeys.push(key);
      await prisma.coefficient.create({
        data: {
          setId,
          key,
          label: key,
          value: 0.97,
          sourceKind: 'DEMO_APPROXIMATION',
          sourceCitation: 'DEMO APPROXIMATION',
        },
      });
    }
  });

  afterAll(async () => {
    if (!HAS_DB || !prisma) return;
    await prisma.auditLog.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.coefficientSet.deleteMany({ where: { id: setId } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });

    if (demoSnapshot) {
      const demo = {
        sourceKind: 'DEMO_APPROXIMATION' as const,
        sourceCitation:
          'DEMO APPROXIMATION — representative figure for demonstration only. Not traceable to any ' +
          'datasheet, standard or dataset, and refused when issuing a quotation.',
        verifiedAt: null,
        verifiedBy: null,
      };
      await prisma.coefficient.updateMany({
        where: { id: { in: demoSnapshot.coefficients } },
        data: demo,
      });
      await prisma.tariff.updateMany({ where: { id: { in: demoSnapshot.tariffs } }, data: demo });
      await prisma.panelModel.updateMany({
        where: { id: { in: demoSnapshot.panels } },
        data: {
          isDemo: true,
          verifiedAt: null,
          verifiedBy: null,
          sourceCitation:
            'DEMO APPROXIMATION — representative residential module. NOT this manufacturer’s ' +
            'published specification. Replace with the datasheet figures before quoting.',
        },
      });
    }
  });

  it('refuses a citation too thin to mean anything later', async () => {
    await expect(service.adoptDemoValuesAsProvisional(admin, { citation: '暫定' })).rejects.toThrow(
      /10文字/,
    );
  });

  it('refuses a user who cannot edit coefficients', async () => {
    await expect(
      service.adoptDemoValuesAsProvisional(sales, {
        citation: '2026-08-28 デモ提示用の暫定値。営業担当の判断。',
      }),
    ).rejects.toThrow();
  });

  it('transfers ownership without changing a single figure', async () => {
    const before = await prisma.coefficient.findMany({
      where: { setId },
      orderBy: { key: 'asc' },
      select: { key: true, value: true },
    });

    const citation = '2026-08-28 デモ提示用の暫定値。実測値の入手後に差し替える。';
    await service.adoptDemoValuesAsProvisional(admin, { citation });

    const after = await prisma.coefficient.findMany({
      where: { setId },
      orderBy: { key: 'asc' },
    });

    // The numbers are the same numbers. That is the point, and the reason the
    // citation has to carry the caveat.
    expect(after.map((c: any) => c.value)).toEqual(before.map((c: any) => c.value));

    for (const c of after) {
      expect(c.sourceKind).toBe('ADMINISTRATOR_INPUT');
      expect(c.sourceCitation).toBe(citation);
      expect(c.verifiedBy).toBe(admin.email);
      expect(c.verifiedAt).not.toBeNull();
    }
  });

  it('records who did it, so the decision is attributable', async () => {
    const entry = await prisma.auditLog.findFirst({
      where: { userId: admin.id, action: 'demoValues.adopt' },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry).not.toBeNull();
    expect(JSON.stringify(entry.detail)).toContain('暫定値');
  });
});
