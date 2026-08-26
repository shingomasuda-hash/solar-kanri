import { prisma } from '../db/client';
import { requirePermission } from '../auth/rbac';
import type { SessionUser } from '../auth/session';
import { recordAudit } from './audit';
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

export async function updateCoefficient(user: SessionUser, id: string, input: unknown) {
  requirePermission(user, 'coefficient:write');
  const data = coefficientSchema.parse(input);
  const before = await prisma.coefficient.findUnique({ where: { id } });
  if (!before) throw new Error('係数が見つかりません / Coefficient not found');

  const verified = data.sourceKind !== 'UNVERIFIED_PLACEHOLDER';
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
}> {
  const [coefficients, tariffs, panels, irradiance] = await Promise.all([
    prisma.coefficient.count({ where: { sourceKind: 'UNVERIFIED_PLACEHOLDER' } }),
    prisma.tariff.count({ where: { sourceKind: 'UNVERIFIED_PLACEHOLDER', isActive: true } }),
    prisma.panelModel.count({ where: { verifiedAt: null, isActive: true } }),
    prisma.irradianceStation.count({
      where: { sourceKind: 'UNVERIFIED_PLACEHOLDER', isActive: true },
    }),
  ]);
  return { coefficients, tariffs, panels, irradiance };
}

// ----------------------------------------------------------------- tariffs

export async function listTariffs(user: SessionUser) {
  requirePermission(user, 'master:read');
  return prisma.tariff.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
}

export async function upsertTariff(user: SessionUser, input: unknown, id?: string) {
  requirePermission(user, 'master:write');
  const data = tariffSchema.parse(input);
  const verified = data.sourceKind !== 'UNVERIFIED_PLACEHOLDER';

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

  const verified = input.sourceKind !== 'UNVERIFIED_PLACEHOLDER';
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
