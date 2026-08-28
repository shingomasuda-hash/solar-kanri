import { prisma } from '../db/client';
import { requirePermission } from '../auth/rbac';
import type { SessionUser } from '../auth/session';
import { recordAudit } from './audit';
import { PvgisProvider, type SolarDataProvider } from '@core/solar/providers';
import {
  coefficientSchema,
  panelModelSchema,
  tariffSchema,
  userSchema,
} from '../validation/schemas';
import { hashPassword } from '../auth/password';
import { revokeAllSessions } from '../auth/service';
import { validateManualClimate } from '@core/solar';
import type { Month } from '@core/solar';

/**
 * Master data administration.
 *
 * The point of this module is rule 30 of the brief: routine operational
 * changes — a new module, a tariff revision, a corrected loss factor — must
 * never require a code change. Everything the engines read is editable here.
 *
 * Every coefficient edit records who verified it and against what. Saving a
 * value without a source is possible only by explicitly choosing
 * UNVERIFIED_PLACEHOLDER, which the engines then refuse.
 */

function blank(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

// ------------------------------------------------------------ coefficients

export async function listCoefficientSets(user: SessionUser) {
  requirePermission(user, 'master:read');
  return prisma.coefficientSet.findMany({
    include: { values: { orderBy: { key: 'asc' } } },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });
}

/**
 * Choose which coefficient set the simulator uses when none is named.
 *
 * This is how an operator leaves demonstration mode, so it has to exist in the
 * console: the alternative is editing the database by hand, which the project
 * rules forbid for good reason. Exactly one set is default at any time, which
 * is why both writes are in one transaction — a moment with two defaults would
 * make `findFirst({ isDefault: true })` return an arbitrary one.
 */
export async function setDefaultCoefficientSet(user: SessionUser, id: string) {
  requirePermission(user, 'coefficient:write');
  const set = await prisma.coefficientSet.findUnique({ where: { id } });
  if (!set) throw new Error('係数セットが見つかりません / Coefficient set not found');

  await prisma.$transaction([
    prisma.coefficientSet.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
    prisma.coefficientSet.update({ where: { id }, data: { isDefault: true } }),
  ]);
  await recordAudit({
    userId: user.id,
    action: 'coefficientSet.setDefault',
    entityType: 'CoefficientSet',
    entityId: id,
    detail: { key: set.key, name: set.name },
  });
  return set;
}

/** The same, for electricity prices. See {@link setDefaultCoefficientSet}. */
export async function setDefaultTariff(user: SessionUser, id: string) {
  requirePermission(user, 'master:write');
  const tariff = await prisma.tariff.findUnique({ where: { id } });
  if (!tariff) throw new Error('単価が見つかりません / Tariff not found');

  await prisma.$transaction([
    prisma.tariff.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
    prisma.tariff.update({ where: { id }, data: { isDefault: true } }),
  ]);
  await recordAudit({
    userId: user.id,
    action: 'tariff.setDefault',
    entityType: 'Tariff',
    entityId: id,
    detail: { key: tariff.key, name: tariff.name },
  });
  return tariff;
}

export async function updateCoefficient(user: SessionUser, id: string, input: unknown) {
  requirePermission(user, 'coefficient:write');
  const data = coefficientSchema.parse(input);
  const before = await prisma.coefficient.findUnique({ where: { id } });
  if (!before) throw new Error('係数が見つかりません / Coefficient not found');

  // A demonstration figure has been supplied but not verified by anyone, so it
  // must not receive a verification stamp.
  const verified =
    data.sourceKind !== 'UNVERIFIED_PLACEHOLDER' && data.sourceKind !== 'DEMO_APPROXIMATION';
  const after = await prisma.coefficient.update({
    where: { id },
    data: {
      label: data.label,
      value: data.value,
      unit: blank(data.unit),
      sourceKind: data.sourceKind,
      sourceCitation: data.sourceCitation,
      sourceUrl: blank(data.sourceUrl),
      effectiveDate: data.effectiveDate ?? null,
      note: blank(data.note),
      // Verification is recorded server-side from the session, never from the
      // form: the whole point is an attributable record of who signed off.
      verifiedAt: verified ? new Date() : null,
      verifiedBy: verified ? user.email : null,
    },
  });

  await recordAudit({
    userId: user.id,
    action: 'coefficient.update',
    entityType: 'Coefficient',
    entityId: id,
    detail: {
      key: after.key,
      before: { value: before.value, sourceKind: before.sourceKind },
      after: { value: after.value, sourceKind: after.sourceKind },
    },
  });
  return after;
}

/** How many coefficients still block a production calculation. */
export async function countUnverified(): Promise<{
  coefficients: number;
  tariffs: number;
  panels: number;
  irradiance: number;
  /** True when the set the simulator would actually use is demonstration data. */
  demoActive: boolean;
}> {
  const [coefficients, tariffs, panels, irradiance, demoCoefficients, demoTariff] =
    await Promise.all([
      prisma.coefficient.count({ where: { sourceKind: 'UNVERIFIED_PLACEHOLDER' } }),
      prisma.tariff.count({ where: { sourceKind: 'UNVERIFIED_PLACEHOLDER', isActive: true } }),
      prisma.panelModel.count({ where: { verifiedAt: null, isDemo: false, isActive: true } }),
      prisma.irradianceStation.count({
        where: { sourceKind: 'UNVERIFIED_PLACEHOLDER', isActive: true },
      }),
      // Only the default set matters: a demo set nobody uses is harmless, and
      // reporting it would train operators to ignore the warning.
      prisma.coefficient.count({
        where: { sourceKind: 'DEMO_APPROXIMATION', set: { isDefault: true } },
      }),
      prisma.tariff.count({ where: { sourceKind: 'DEMO_APPROXIMATION', isDefault: true } }),
    ]);
  return {
    coefficients,
    tariffs,
    panels,
    irradiance,
    demoActive: demoCoefficients > 0 || demoTariff > 0,
  };
}

// ----------------------------------------------------------------- tariffs

export async function listTariffs(user: SessionUser) {
  requirePermission(user, 'master:read');
  return prisma.tariff.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
}

export async function upsertTariff(user: SessionUser, input: unknown, id?: string) {
  requirePermission(user, 'master:write');
  const data = tariffSchema.parse(input);
  // A demonstration figure has been supplied but not verified by anyone, so it
  // must not receive a verification stamp.
  const verified =
    data.sourceKind !== 'UNVERIFIED_PLACEHOLDER' && data.sourceKind !== 'DEMO_APPROXIMATION';

  const values = {
    key: data.key,
    name: data.name,
    purchasePriceJpyPerKWh: data.purchasePriceJpyPerKWh,
    exportPriceJpyPerKWh: data.exportPriceJpyPerKWh,
    exportPriceYears: data.exportPriceYears,
    postExportPriceJpyPerKWh: data.postExportPriceJpyPerKWh,
    annualPriceEscalation: data.annualPriceEscalation,
    monthlyBasicChargeJpy: data.monthlyBasicChargeJpy,
    defaultSelfConsumptionRatio: data.defaultSelfConsumptionRatio,
    sourceKind: data.sourceKind,
    sourceCitation: data.sourceCitation,
    sourceUrl: blank(data.sourceUrl),
    verifiedAt: verified ? new Date() : null,
    verifiedBy: verified ? user.email : null,
  };

  const tariff = id
    ? await prisma.tariff.update({ where: { id }, data: values })
    : await prisma.tariff.create({ data: { ...values, isDefault: false } });

  await recordAudit({
    userId: user.id,
    action: id ? 'tariff.update' : 'tariff.create',
    entityType: 'Tariff',
    entityId: tariff.id,
    detail: { key: tariff.key, sourceKind: tariff.sourceKind },
  });
  return tariff;
}

// ------------------------------------------------------------------ panels

export async function listPanels(user: SessionUser) {
  requirePermission(user, 'master:read');
  return prisma.panelModel.findMany({
    orderBy: [{ isActive: 'desc' }, { manufacturer: 'asc' }, { model: 'asc' }],
  });
}

export async function upsertPanel(user: SessionUser, input: unknown, id?: string) {
  requirePermission(user, 'master:write');
  const data = panelModelSchema.parse(input);

  const values = {
    manufacturer: data.manufacturer,
    model: data.model,
    widthMm: data.widthMm,
    heightMm: data.heightMm,
    thicknessMm: data.thicknessMm ?? null,
    weightKg: data.weightKg ?? null,
    ratedPowerW: data.ratedPowerW,
    efficiencyPct: data.efficiencyPct ?? null,
    pmaxTempCoeffPerK: data.pmaxTempCoeffPerK,
    vocV: data.vocV ?? null,
    iscA: data.iscA ?? null,
    vmpV: data.vmpV ?? null,
    impA: data.impA ?? null,
    noctC: data.noctC ?? null,
    annualDegradation: data.annualDegradation,
    productWarrantyYears: data.productWarrantyYears ?? null,
    performanceWarrantyYears: data.performanceWarrantyYears ?? null,
    datasheetUrl: blank(data.datasheetUrl),
    datasheetVersion: blank(data.datasheetVersion),
    sourceCitation: data.sourceCitation,
    sourceUrl: blank(data.sourceUrl),
    effectiveDate: data.effectiveDate ?? null,
    verifiedAt: new Date(),
    verifiedBy: user.email,
  };

  const panel = id
    ? await prisma.panelModel.update({ where: { id }, data: values })
    : await prisma.panelModel.create({ data: values });

  await recordAudit({
    userId: user.id,
    action: id ? 'panel.update' : 'panel.create',
    entityType: 'PanelModel',
    entityId: panel.id,
    detail: { manufacturer: panel.manufacturer, model: panel.model },
  });
  return panel;
}

export async function setPanelActive(user: SessionUser, id: string, isActive: boolean) {
  requirePermission(user, 'master:write');
  const panel = await prisma.panelModel.update({ where: { id }, data: { isActive } });
  await recordAudit({
    userId: user.id,
    action: isActive ? 'panel.activate' : 'panel.deactivate',
    entityType: 'PanelModel',
    entityId: id,
  });
  return panel;
}

// ------------------------------------------------------- irradiance station

export async function listIrradianceStations(user: SessionUser) {
  requirePermission(user, 'master:read');
  return prisma.irradianceStation.findMany({ orderBy: { label: 'asc' } });
}

export interface IrradianceStationInput {
  label: string;
  latitude: number;
  longitude: number;
  monthlyIrradiation: number[];
  monthlyAmbientTemp: number[];
  isPlaneOfArray: boolean;
  tiltDeg?: number | null;
  azimuthDeg?: number | null;
  sourceKind: string;
  sourceCitation: string;
  sourceUrl?: string | null;
}

export async function upsertIrradianceStation(
  user: SessionUser,
  input: IrradianceStationInput,
  id?: string,
) {
  requirePermission(user, 'master:write');

  if (input.monthlyIrradiation.length !== 12 || input.monthlyAmbientTemp.length !== 12) {
    throw new Error('日射量と気温は12か月分すべて入力してください');
  }
  const toRecord = (values: number[]) => {
    const out = {} as Record<Month, number>;
    values.forEach((v, i) => {
      out[(i + 1) as Month] = v;
    });
    return out;
  };
  const climate = {
    planeOfArrayKWhPerM2PerDay: toRecord(input.monthlyIrradiation),
    ambientTempC: toRecord(input.monthlyAmbientTemp),
  };
  // Catches the classic MJ/m²/day paste, which is 3.6x too large and otherwise
  // produces a confidently wrong yield.
  const errors = validateManualClimate(climate);
  if (errors.length > 0) throw new Error(errors.join(' / '));

  const verified =
    input.sourceKind !== 'UNVERIFIED_PLACEHOLDER' && input.sourceKind !== 'DEMO_APPROXIMATION';
  const values = {
    label: input.label,
    latitude: input.latitude,
    longitude: input.longitude,
    monthlyIrradiationKWhPerM2PerDay: climate.planeOfArrayKWhPerM2PerDay as never,
    monthlyAmbientTempC: climate.ambientTempC as never,
    isPlaneOfArray: input.isPlaneOfArray,
    tiltDeg: input.tiltDeg ?? null,
    azimuthDeg: input.azimuthDeg ?? null,
    sourceKind: input.sourceKind as never,
    sourceCitation: input.sourceCitation,
    sourceUrl: blank(input.sourceUrl),
    verifiedAt: verified ? new Date() : null,
    verifiedBy: verified ? user.email : null,
  };

  const station = id
    ? await prisma.irradianceStation.update({ where: { id }, data: values })
    : await prisma.irradianceStation.create({ data: values });

  await recordAudit({
    userId: user.id,
    action: id ? 'irradianceStation.update' : 'irradianceStation.create',
    entityType: 'IrradianceStation',
    entityId: station.id,
    detail: { label: station.label, sourceKind: station.sourceKind },
  });
  return station;
}

// ------------------------------------------------------------------- users

export async function listUsers(user: SessionUser) {
  requirePermission(user, 'user:manage');
  return prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });
}

export async function createUser(user: SessionUser, input: unknown, password: string) {
  requirePermission(user, 'user:manage');
  const data = userSchema.parse(input);
  const created = await prisma.user.create({
    data: {
      email: data.email,
      name: data.name,
      role: data.role,
      isActive: data.isActive,
      passwordHash: await hashPassword(password),
    },
  });
  await recordAudit({
    userId: user.id,
    action: 'user.create',
    entityType: 'User',
    entityId: created.id,
    detail: { email: created.email, role: created.role },
  });
  return created;
}

export async function updateUserRole(user: SessionUser, id: string, role: string) {
  requirePermission(user, 'user:manage');
  if (id === user.id) {
    // Removing your own admin rights locks the last administrator out of the
    // console, which needs a database edit to undo.
    throw new Error('自分自身の権限は変更できません / You cannot change your own role');
  }
  const before = await prisma.user.findUnique({ where: { id } });
  const updated = await prisma.user.update({ where: { id }, data: { role: role as never } });
  // A role change must take effect now, not whenever the session happens to
  // expire, so every existing session for that user is revoked.
  await revokeAllSessions(id);
  await recordAudit({
    userId: user.id,
    action: 'user.role.change',
    entityType: 'User',
    entityId: id,
    detail: { email: updated.email, from: before?.role, to: updated.role },
  });
  return updated;
}

export async function setUserActive(user: SessionUser, id: string, isActive: boolean) {
  requirePermission(user, 'user:manage');
  if (id === user.id) {
    throw new Error('自分自身を無効化することはできません / You cannot deactivate yourself');
  }
  const updated = await prisma.user.update({ where: { id }, data: { isActive } });
  if (!isActive) await revokeAllSessions(id);
  await recordAudit({
    userId: user.id,
    action: isActive ? 'user.activate' : 'user.deactivate',
    entityType: 'User',
    entityId: id,
    detail: { email: updated.email },
  });
  return updated;
}

// ---------------------------------------------------------- sales statuses

export async function listAllSalesStatuses(user: SessionUser) {
  requirePermission(user, 'master:read');
  return prisma.salesStatus.findMany({ orderBy: { sortOrder: 'asc' } });
}

export async function upsertSalesStatus(
  user: SessionUser,
  input: {
    key: string;
    label: string;
    sortOrder: number;
    colorHex: string;
    isWon: boolean;
    isLost: boolean;
  },
  id?: string,
) {
  requirePermission(user, 'master:write');
  const status = id
    ? await prisma.salesStatus.update({ where: { id }, data: input })
    : await prisma.salesStatus.create({ data: input });
  await recordAudit({
    userId: user.id,
    action: id ? 'salesStatus.update' : 'salesStatus.create',
    entityType: 'SalesStatus',
    entityId: status.id,
    detail: { key: status.key, label: status.label },
  });
  return status;
}

// --------------------------------------------------------------- audit log

export async function listAuditLog(user: SessionUser, take = 100) {
  requirePermission(user, 'audit:read');
  return prisma.auditLog.findMany({
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(take, 500),
  });
}

// ------------------------------------------------- irradiance from a provider

/**
 * Fetch a site's monthly irradiation and temperature from PVGIS and store it
 * as an irradiance station.
 *
 * This is what "pull the data in" means here. PVGIS is a free service of the
 * European Commission's Joint Research Centre, needs no key, and covers Japan
 * through its global reanalysis database. Nothing about it is invented by this
 * application: the numbers are whatever the service returned, stored verbatim
 * with the request that produced them.
 *
 * Stored rather than fetched per simulation for two reasons. A saved
 * simulation must stay reproducible, and an external service that changes its
 * answer next year would quietly rewrite quotations issued today. And a
 * station an administrator can see is one they can check, correct, or replace
 * with a national dataset — which is the intended destination.
 *
 * The provenance is PROVIDER_API, not a placeholder and not a demonstration
 * figure: it is a real measurement chain, from a named service, captured at a
 * known moment. It therefore does not block issuing. Whether PVGIS's
 * reanalysis is accurate enough for Japanese sites is a judgement for the
 * administrator, and the note on the record says so.
 */
export async function importIrradianceFromProvider(
  user: SessionUser,
  input: {
    readonly label: string;
    readonly latitude: number;
    readonly longitude: number;
    readonly tiltDeg?: number;
    readonly azimuthDeg?: number;
  },
  options: { readonly provider?: SolarDataProvider } = {},
) {
  requirePermission(user, 'master:write');

  const provider =
    options.provider ?? new PvgisProvider({ enabled: process.env.PVGIS_ENABLED !== 'false' });

  if (!provider.isAvailable()) {
    throw new Error(
      'PVGIS が無効になっています。環境変数 PVGIS_ENABLED を確認してください。' +
        '（無効のままにする場合は、日射量を手入力で登録してください）',
    );
  }

  // Horizontal by default: a station is reused across roof faces with
  // different tilts, so storing a plane-of-array figure for one of them would
  // be wrong for all the others.
  const tiltDeg = input.tiltDeg ?? 0;
  const azimuthDeg = input.azimuthDeg ?? 180;

  const dataset = await provider.fetch({
    latitude: input.latitude,
    longitude: input.longitude,
    tiltDeg,
    azimuthDeg,
  });
  if (!dataset) {
    throw new Error(
      `PVGIS からこの地点のデータを取得できませんでした（${input.latitude}, ${input.longitude}）。` +
        '座標を確認するか、日射量を手入力で登録してください。',
    );
  }

  const monthly = (record: Record<number, number>) =>
    Array.from({ length: 12 }, (_, i) => record[i + 1] ?? 0);

  // The station table has no free-text note, so the caveat travels in the
  // citation — where anyone reading the figure will see it.
  const citation =
    `PVGIS (EC Joint Research Centre) — ${dataset.source.source.citation}. ` +
    `取得 ${new Date().toISOString().slice(0, 10)} / 地点 ${input.latitude}, ${input.longitude} / ` +
    '再解析データのため、日本国内では NEDO METPV 等と突き合わせて確認してください。';

  return upsertIrradianceStation(user, {
    label: input.label,
    latitude: input.latitude,
    longitude: input.longitude,
    monthlyIrradiation: monthly(dataset.climate.planeOfArrayKWhPerM2PerDay),
    monthlyAmbientTemp: monthly(dataset.climate.ambientTempC),
    isPlaneOfArray: dataset.isPlaneOfArray,
    tiltDeg,
    azimuthDeg,
    sourceKind: 'PROVIDER_API',
    sourceCitation: citation.slice(0, 500),
    sourceUrl: dataset.source.source.url ?? null,
  });
}

// -------------------------------------------------- adopting provisional values

export interface AdoptDemoValuesResult {
  readonly coefficients: number;
  readonly tariffs: number;
  readonly panels: number;
}

/**
 * Adopt the demonstration figures as this company's own provisional values.
 *
 * This is the one deliberate door through the demo barrier, and it is worth
 * being precise about what it does and does not change.
 *
 * It does **not** make the numbers more accurate. They are the same figures
 * they were a moment ago. What changes is who owns them: `ADMINISTRATOR_INPUT`
 * means a named person entered this value and stands behind it, which is a
 * real thing an administrator can decide and a demonstration figure — traceable
 * to nothing and to nobody — is not. That is why a citation is required rather
 * than optional, why it is stamped with the caller's identity and the date, and
 * why every row is written to the audit log.
 *
 * The intended use is a demonstration to a prospect, where the flow has to run
 * to the end. Quotations issued afterwards are ordinary quotations, so the
 * citation the administrator supplies is the only thing that will later tell
 * anyone these were provisional. Ask for a real one.
 */
export async function adoptDemoValuesAsProvisional(
  user: SessionUser,
  input: { readonly citation: string },
): Promise<AdoptDemoValuesResult> {
  requirePermission(user, 'coefficient:write');
  requirePermission(user, 'master:write');

  const citation = input.citation.trim();
  if (citation.length < 10) {
    throw new Error(
      '出典・根拠を10文字以上で入力してください。' +
        '「誰がいつ何を根拠に決めたか」が、この値について後から分かる唯一の手がかりになります。',
    );
  }

  const stamp = { verifiedAt: new Date(), verifiedBy: user.email, sourceCitation: citation };

  const [coefficients, tariffs, panels] = await prisma.$transaction([
    prisma.coefficient.updateMany({
      where: { sourceKind: 'DEMO_APPROXIMATION' },
      data: { sourceKind: 'ADMINISTRATOR_INPUT', ...stamp },
    }),
    prisma.tariff.updateMany({
      where: { sourceKind: 'DEMO_APPROXIMATION' },
      data: { sourceKind: 'ADMINISTRATOR_INPUT', ...stamp },
    }),
    // A module is a datasheet source only once a human has checked it against
    // the datasheet, which nobody has. Clearing isDemo and stamping the check
    // records that an administrator accepted the electrical figures as they
    // stand — the same claim, at the same strength, as the coefficients above.
    prisma.panelModel.updateMany({
      where: { isDemo: true },
      data: { isDemo: false, ...stamp },
    }),
  ]);

  await recordAudit({
    userId: user.id,
    action: 'demoValues.adopt',
    entityType: 'CoefficientSet',
    entityId: 'demo',
    detail: {
      citation,
      coefficients: coefficients.count,
      tariffs: tariffs.count,
      panels: panels.count,
    },
  });

  return {
    coefficients: coefficients.count,
    tariffs: tariffs.count,
    panels: panels.count,
  };
}
