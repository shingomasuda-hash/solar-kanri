import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The demonstration dataset, end to end.
 *
 * The demo exists so the sales flow can be walked through before anyone has
 * collected datasheets. That is only safe if the boundary holds: figures marked
 * as a demonstration must compute happily and must never leave the building.
 * Both halves are asserted here, against a real database, because the boundary
 * is enforced across the engine, the service and the schema together — no unit
 * test sees all three.
 */

const HAS_DB = Boolean(process.env.DATABASE_URL);
const PREFIX = 'itest-demo-figures';

/** A ~10 m × 8 m rectangle near Tokyo Station, WGS84, as an operator would draw. */
const ROOF_OUTLINE = {
  type: 'Polygon',
  coordinates: [
    [
      [139.767, 35.6812],
      [139.7671105, 35.6812],
      [139.7671105, 35.68127194],
      [139.767, 35.68127194],
      [139.767, 35.6812],
    ],
  ],
};

describe.skipIf(!HAS_DB)('demonstration figures', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let design: any;
  let simulation: any;
  let quotations: any;
  let projects: any;
  let admin: { id: string; email: string; name: string; role: 'ADMIN' };
  let customerId: string;
  let projectId: string;
  let simulationId: string;

  beforeAll(async () => {
    const mods = await Promise.all([
      import('@server/db/client'),
      import('@server/services/design'),
      import('@server/services/simulation'),
      import('@server/services/quotations'),
      import('@server/services/projects'),
    ]);
    prisma = mods[0].prisma;
    design = mods[1];
    simulation = mods[2];
    quotations = mods[3];
    projects = mods[4];

    const demoPanel = await prisma.panelModel.findFirst({ where: { isDemo: true } });
    const demoSet = await prisma.coefficientSet.findUnique({ where: { key: 'demo' } });
    if (!demoPanel || !demoSet) {
      throw new Error(
        'Demo fixtures missing. Run `DEMO_ACTIVATE=0 npm run db:seed:demo` before this suite.',
      );
    }

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

    const status = await prisma.salesStatus.findFirstOrThrow({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    const project = await projects.createProject(admin, {
      title: `${PREFIX} 案件`,
      customerId,
      statusId: status.id,
    });
    projectId = project.id;

    // The property needs a position: irradiance is resolved from it.
    await prisma.property.update({
      where: { id: project.propertyId! },
      data: { latitude: 35.6812, longitude: 139.767 },
    });

    const face = await design.saveRoofFace(admin, {
      propertyId: project.propertyId!,
      label: '南面',
      outline: ROOF_OUTLINE,
      pitchDeg: 30,
      azimuthDeg: 180,
      pitchSource: 'MEASURED',
      setbackM: 0.3,
      panelGapM: 0.02,
    });

    const layout = await design.computeAndSaveLayout(admin, face.id, demoPanel.id);
    expect(layout.panelCount).toBeGreaterThan(0);

    // Name the demo set and tariff explicitly rather than relying on which one
    // happens to be default: defaults are global state that the browser suite
    // also moves, and a test that depends on it would pass or fail by ordering.
    const run = await simulation.runSimulation(admin, {
      projectId,
      layoutIds: [layout.layoutId],
      mounting: 'roof-flush',
      coefficientSetKey: 'demo',
      tariffKey: 'demo',
      annualConsumptionKWh: 5000,
      totalCostJpy: 1_500_000,
      subsidyJpy: 0,
    });
    simulationId = run.simulation.id;
  });

  afterAll(async () => {
    if (!HAS_DB || !prisma) return;
    await prisma.auditLog.deleteMany({ where: { userId: admin.id } });
    await prisma.project.deleteMany({ where: { customerId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: admin.id } });
  });

  it('computes a result rather than refusing, so the flow can be demonstrated', async () => {
    const saved = await prisma.simulation.findUniqueOrThrow({ where: { id: simulationId } });
    expect(saved.annualGenerationKWh).toBeGreaterThan(0);
    expect(saved.installedW).toBeGreaterThan(0);
    // Sanity, not accuracy: a Japanese residential system lands near
    // 1000 kWh per installed kW per year. Far outside that band would mean the
    // demo dataset is not merely approximate but wrong.
    const specificYield = saved.annualGenerationKWh / (saved.installedW / 1000);
    expect(specificYield).toBeGreaterThan(600);
    expect(specificYield).toBeLessThan(1600);
  });

  it('marks the result as demonstration-derived and names the fields', async () => {
    const saved = await prisma.simulation.findUniqueOrThrow({ where: { id: simulationId } });
    expect(saved.isDemo).toBe(true);
    expect(Array.isArray(saved.demoFields)).toBe(true);
    // The module, the loss coefficients and the tariff all came from the demo
    // seed, so all three families must be named — a flag alone would not tell
    // an administrator what to go and fix.
    const fields = saved.demoFields as string[];
    expect(fields.some((f) => f.startsWith('module.'))).toBe(true);
    expect(fields.some((f) => f.startsWith('coefficients.'))).toBe(true);
    expect(fields.some((f) => f.startsWith('tariff.'))).toBe(true);
  });

  it('lets a quotation be drafted, and refuses to issue it', async () => {
    const quotation = await quotations.createQuotation(admin, {
      projectId,
      simulationId,
      title: `${PREFIX} 見積`,
      discountJpy: 0,
      subsidyJpy: 0,
      taxRate: 0.1,
      items: [
        { category: 'PANEL', name: 'パネル', quantity: 10, unit: '枚', unitPriceJpy: 40_000 },
      ],
    });
    expect(quotation.status).toBe('DRAFT');

    await expect(quotations.issueQuotation(admin, quotation.id)).rejects.toBeInstanceOf(
      quotations.DemoQuotationError,
    );

    // And it really did not issue — a refusal that left the row half-updated
    // would be worse than no check at all.
    const after = await prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } });
    expect(after.status).toBe('DRAFT');
    expect(after.issuedAt).toBeNull();
  });
});
