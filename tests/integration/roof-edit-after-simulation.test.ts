import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * A roof stays editable after a simulation has been run on it.
 *
 * It did not. `SimulationLayout.layoutId` was `Restrict`, and every edit path —
 * changing the outline, deleting the face, adding or removing an exclusion zone
 * — invalidates the layout it was computed from. So the first simulation froze
 * the roof, and the operator got a raw foreign-key error with no way forward.
 *
 * The property that actually matters is the other one: the saved simulation
 * must not change. Reproducibility lives in the input snapshot, not in the link
 * to a live layout, and that is exactly what these tests separate.
 */

const HAS_DB = Boolean(process.env.DATABASE_URL);
const PREFIX = 'itest-roof-edit';

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

describe.skipIf(!HAS_DB)('editing a roof after simulating', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let design: any;
  let simulationService: any;
  let quotations: any;
  let projects: any;
  let admin: any;
  let customerId: string;
  let projectId: string;
  let propertyId: string;
  let faceId: string;
  let simulationId: string;
  let savedFigures: { installedW: number; annualGenerationKWh: number };

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
    simulationService = mods[2];
    quotations = mods[3];
    projects = mods[4];

    const panel = await prisma.panelModel.findFirst({ where: { isDemo: true } });
    if (!panel) throw new Error('Run `npm run db:seed:demo` before this suite.');

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

    const status = await prisma.salesStatus.findFirstOrThrow({ orderBy: { sortOrder: 'asc' } });
    const project = await projects.createProject(admin, {
      title: `${PREFIX} 案件`,
      customerId,
      statusId: status.id,
    });
    projectId = project.id;
    propertyId = project.propertyId!;

    await prisma.property.update({
      where: { id: propertyId },
      data: { latitude: 35.6812, longitude: 139.767 },
    });

    const face = await design.saveRoofFace(admin, {
      propertyId,
      label: '南面',
      outline: ROOF_OUTLINE,
      pitchDeg: 30,
      azimuthDeg: 180,
      pitchSource: 'MEASURED',
      setbackM: 0.3,
      panelGapM: 0.02,
    });
    faceId = face.id;

    const layout = await design.computeAndSaveLayout(admin, faceId, panel.id);
    const run = await simulationService.runSimulation(admin, {
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
    savedFigures = {
      installedW: run.simulation.installedW,
      annualGenerationKWh: run.simulation.annualGenerationKWh,
    };
  });

  afterAll(async () => {
    if (!HAS_DB || !prisma) return;
    await prisma.auditLog.deleteMany({ where: { userId: admin.id } });
    await prisma.project.deleteMany({ where: { customerId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: admin.id } });
  });

  it('lets the roof outline be corrected', async () => {
    await expect(
      design.saveRoofFace(
        admin,
        {
          propertyId,
          label: '南面（修正）',
          outline: ROOF_OUTLINE,
          pitchDeg: 25,
          azimuthDeg: 180,
          pitchSource: 'MEASURED',
          setbackM: 0.4,
          panelGapM: 0.02,
        },
        faceId,
      ),
    ).resolves.toBeTruthy();
  });

  it('leaves the saved simulation exactly as it was', async () => {
    // The whole reason the constraint existed. It has to hold without it.
    const after = await prisma.simulation.findUniqueOrThrow({ where: { id: simulationId } });
    expect(after.installedW).toBe(savedFigures.installedW);
    expect(after.annualGenerationKWh).toBe(savedFigures.annualGenerationKWh);
    expect(after.inputSnapshot).not.toBeNull();
  });

  it('can still draft a quotation from it, using the snapshot', async () => {
    // The live layout is gone with the edit; the module it used is not.
    const draft = await quotations.draftFromSimulation(admin, projectId);
    expect(draft).not.toBeNull();
    expect(draft.items.length).toBeGreaterThan(0);
    expect(draft.items[0].name).toMatch(/太陽電池モジュール/);
    // And the draft carries real prices, not a row of zeroes.
    expect(draft.items[0].unitPriceJpy).toBeGreaterThan(0);
  });

  it('lets the roof face be deleted', async () => {
    await expect(design.deleteRoofFace(admin, faceId)).resolves.toBeUndefined();
    expect(await prisma.roofFace.findUnique({ where: { id: faceId } })).toBeNull();
    // Still there. A roof is a drawing; a simulation is a record of a decision.
    expect(await prisma.simulation.findUnique({ where: { id: simulationId } })).not.toBeNull();
  });
});
