import { prisma } from '../db/client';
import { ForbiddenError, ownershipFilter, requirePermission } from '../auth/rbac';
import type { SessionUser } from '../auth/session';
import { recordAudit } from './audit';
import { quotationSchema } from '../validation/schemas';
import { calculateQuotation, suggestLineItems, type QuotationLineInput } from '@core/quotation';

/**
 * Quotations.
 *
 * Once issued, a quotation is immutable and carries a frozen copy of the
 * simulation figures it quotes. A later re-simulation, a coefficient edit, or a
 * price change must not silently rewrite a document a customer already has.
 */

export class QuotationLockedError extends Error {
  constructor() {
    super(
      '発行済みの見積は変更できません。修正する場合は新しいバージョンを作成してください。 / ' +
        'An issued quotation is immutable; create a new version instead.',
    );
    this.name = 'QuotationLockedError';
  }
}

export async function getQuotation(user: SessionUser, id: string) {
  requirePermission(user, 'quotation:read');
  const quotation = await prisma.quotation.findUnique({
    where: { id },
    include: {
      items: { orderBy: { sortOrder: 'asc' } },
      simulation: true,
      project: {
        include: {
          customer: true,
          owner: { select: { name: true, email: true } },
        },
      },
    },
  });
  if (!quotation) return null;
  assertOwnership(user, quotation.project.ownerId);
  return quotation;
}

export interface QuotationDraft {
  projectId: string;
  simulationId?: string;
  title: string;
  validUntil?: Date | null;
  discountJpy: number;
  subsidyJpy: number;
  taxRate: number;
  notes?: string | null;
  items: QuotationLineInput[];
}

export async function createQuotation(user: SessionUser, input: QuotationDraft) {
  requirePermission(user, 'quotation:write');
  const data = quotationSchema.parse(input);

  const project = await prisma.project.findFirst({
    where: { id: data.projectId, deletedAt: null },
  });
  if (!project) throw new Error('案件が見つかりません / Project not found');
  assertOwnership(user, project.ownerId);

  const totals = calculateQuotation({
    items: data.items,
    discountJpy: data.discountJpy,
    subsidyJpy: data.subsidyJpy,
    taxRate: data.taxRate,
  });

  const simulation = data.simulationId
    ? await prisma.simulation.findUnique({ where: { id: data.simulationId } })
    : null;

  const lastVersion = await prisma.quotation.findFirst({
    where: { projectId: data.projectId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });

  const quotation = await prisma.quotation.create({
    data: {
      projectId: data.projectId,
      simulationId: simulation?.id ?? null,
      version: (lastVersion?.version ?? 0) + 1,
      status: 'DRAFT',
      title: data.title,
      validUntil: data.validUntil ?? null,
      subtotalJpy: totals.subtotalJpy,
      discountJpy: totals.discountJpy,
      subsidyJpy: totals.subsidyJpy,
      taxRate: data.taxRate,
      taxJpy: totals.taxJpy,
      totalJpy: totals.totalJpy,
      notes: data.notes ?? null,
      // Frozen at creation: what this document claims about generation and
      // savings must not change when the simulation is re-run.
      simulationSnapshot: simulation
        ? {
            version: simulation.version,
            installedW: simulation.installedW,
            panelCount: simulation.panelCount,
            annualGenerationKWh: simulation.annualGenerationKWh,
            specificYieldKWhPerKw: simulation.specificYieldKWhPerKw,
            annualCo2AvoidedKg: simulation.annualCo2AvoidedKg,
            firstYearBenefitJpy: simulation.firstYearBenefitJpy,
            lifetimeNetJpy: simulation.lifetimeNetJpy,
            paybackYears: simulation.paybackYears,
            solarEngineVersion: simulation.solarEngineVersion,
            economicsEngineVersion: simulation.economicsEngineVersion,
            layoutEngineVersion: simulation.layoutEngineVersion,
          }
        : undefined,
      createdById: user.id,
      items: {
        create: totals.lines.map((line, i) => ({
          category: line.category,
          name: line.name,
          description: line.description ?? null,
          quantity: line.quantity,
          unit: line.unit,
          unitPriceJpy: line.unitPriceJpy,
          amountJpy: line.amountJpy,
          sortOrder: i,
        })),
      },
    },
    include: { items: true },
  });

  await recordAudit({
    userId: user.id,
    action: 'quotation.create',
    entityType: 'Quotation',
    entityId: quotation.id,
    detail: { projectId: data.projectId, version: quotation.version, totalJpy: totals.totalJpy },
  });
  return quotation;
}

export async function updateQuotation(user: SessionUser, id: string, input: QuotationDraft) {
  requirePermission(user, 'quotation:write');
  const existing = await prisma.quotation.findUnique({
    where: { id },
    include: { project: true },
  });
  if (!existing) throw new Error('見積が見つかりません / Quotation not found');
  assertOwnership(user, existing.project.ownerId);
  if (existing.status !== 'DRAFT') throw new QuotationLockedError();

  const data = quotationSchema.parse(input);
  const totals = calculateQuotation({
    items: data.items,
    discountJpy: data.discountJpy,
    subsidyJpy: data.subsidyJpy,
    taxRate: data.taxRate,
  });

  const quotation = await prisma.$transaction(async (tx) => {
    await tx.quotationItem.deleteMany({ where: { quotationId: id } });
    return tx.quotation.update({
      where: { id },
      data: {
        title: data.title,
        validUntil: data.validUntil ?? null,
        subtotalJpy: totals.subtotalJpy,
        discountJpy: totals.discountJpy,
        subsidyJpy: totals.subsidyJpy,
        taxRate: data.taxRate,
        taxJpy: totals.taxJpy,
        totalJpy: totals.totalJpy,
        notes: data.notes ?? null,
        items: {
          create: totals.lines.map((line, i) => ({
            category: line.category,
            name: line.name,
            description: line.description ?? null,
            quantity: line.quantity,
            unit: line.unit,
            unitPriceJpy: line.unitPriceJpy,
            amountJpy: line.amountJpy,
            sortOrder: i,
          })),
        },
      },
      include: { items: true },
    });
  });

  await recordAudit({
    userId: user.id,
    action: 'quotation.update',
    entityType: 'Quotation',
    entityId: id,
    detail: { version: quotation.version, totalJpy: totals.totalJpy },
  });
  return quotation;
}

export async function issueQuotation(user: SessionUser, id: string) {
  requirePermission(user, 'quotation:issue');
  const existing = await prisma.quotation.findUnique({
    where: { id },
    include: { project: true, items: true },
  });
  if (!existing) throw new Error('見積が見つかりません / Quotation not found');
  assertOwnership(user, existing.project.ownerId);
  if (existing.status !== 'DRAFT') throw new QuotationLockedError();
  if (existing.items.length === 0) {
    throw new Error('明細が1件もありません。発行前に内容を入力してください。');
  }

  const quotation = await prisma.quotation.update({
    where: { id },
    data: { status: 'ISSUED', issuedAt: new Date() },
  });
  await recordAudit({
    userId: user.id,
    action: 'quotation.issue',
    entityType: 'Quotation',
    entityId: id,
    detail: { version: quotation.version, totalJpy: quotation.totalJpy },
  });
  return quotation;
}

export async function setQuotationStatus(
  user: SessionUser,
  id: string,
  status: 'ACCEPTED' | 'REJECTED' | 'EXPIRED',
) {
  requirePermission(user, 'quotation:issue');
  const existing = await prisma.quotation.findUnique({
    where: { id },
    include: { project: true },
  });
  if (!existing) throw new Error('見積が見つかりません / Quotation not found');
  assertOwnership(user, existing.project.ownerId);
  if (existing.status === 'DRAFT') {
    throw new Error('未発行の見積にこのステータスは設定できません。');
  }

  const quotation = await prisma.quotation.update({ where: { id }, data: { status } });
  await recordAudit({
    userId: user.id,
    action: 'quotation.status',
    entityType: 'Quotation',
    entityId: id,
    detail: { from: existing.status, to: status },
  });
  return quotation;
}

/**
 * A starting draft built from the project's latest simulation. Prices are left
 * at zero: the engine must never invent one, and an operator entering them is
 * exactly the business decision the brief reserves for humans.
 */
export async function draftFromSimulation(user: SessionUser, projectId: string) {
  requirePermission(user, 'quotation:write');
  const simulation = await prisma.simulation.findFirst({
    where: { projectId },
    orderBy: { version: 'desc' },
    include: { layouts: { include: { layout: { include: { panelModel: true } } } } },
  });
  if (!simulation) return null;

  const layout = simulation.layouts[0]?.layout;
  if (!layout) return null;

  return {
    simulationId: simulation.id,
    installedKw: simulation.installedW / 1000,
    panelCount: simulation.panelCount,
    items: suggestLineItems({
      panelLabel: `${layout.panelModel.manufacturer} ${layout.panelModel.model}`,
      panelCount: simulation.panelCount,
      panelUnitPriceJpy: 0,
      installedKw: simulation.installedW / 1000,
      constructionJpy: 0,
      electricalJpy: 0,
    }).map((item) => ({ ...item, unitPriceJpy: 0 })),
  };
}

function assertOwnership(user: SessionUser, ownerId: string | null): void {
  const scope = ownershipFilter(user);
  if (scope.ownerId !== undefined && ownerId !== scope.ownerId) {
    throw new ForbiddenError('quotation:read');
  }
}
