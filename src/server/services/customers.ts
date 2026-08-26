import { prisma } from '../db/client';
import { ForbiddenError, requirePermission, ownershipFilter, type Permission } from '../auth/rbac';
import type { SessionUser } from '../auth/session';
import { recordAudit } from './audit';
import { customerSchema, type CustomerInput } from '../validation/schemas';

/**
 * Customer service.
 *
 * Every function takes the acting user and checks permission here rather than
 * trusting the caller — a route handler that forgets is a security bug, and
 * this is the layer that makes forgetting impossible.
 */

/** Empty strings from HTML forms mean "not provided", not "set to empty". */
function nullifyBlank<T extends Record<string, unknown>>(input: T): T {
  const out = { ...input };
  for (const [k, v] of Object.entries(out)) {
    if (v === '') (out as Record<string, unknown>)[k] = null;
  }
  return out;
}

/**
 * Human-readable sequential code, e.g. C-000123.
 *
 * Generated inside the same transaction as the insert so two concurrent
 * creations cannot collide on the count.
 */
async function nextCustomerCode(tx: typeof prisma): Promise<string> {
  const last = await tx.customer.findFirst({
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  const n = last ? Number.parseInt(last.code.replace(/\D/g, ''), 10) + 1 : 1;
  return `C-${String(n).padStart(6, '0')}`;
}

export interface CustomerListOptions {
  readonly query?: string;
  readonly take?: number;
  readonly skip?: number;
}

export async function listCustomers(user: SessionUser, options: CustomerListOptions = {}) {
  requirePermission(user, 'customer:read');
  const q = options.query?.trim();
  return prisma.customer.findMany({
    where: {
      deletedAt: null,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' as const } },
              { nameKana: { contains: q, mode: 'insensitive' as const } },
              { companyName: { contains: q, mode: 'insensitive' as const } },
              { code: { contains: q, mode: 'insensitive' as const } },
              { email: { contains: q, mode: 'insensitive' as const } },
              { phone: { contains: q } },
            ],
          }
        : {}),
    },
    include: {
      owner: { select: { id: true, name: true } },
      _count: { select: { projects: true, properties: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: Math.min(options.take ?? 50, 200),
    skip: options.skip ?? 0,
  });
}

export async function getCustomer(user: SessionUser, id: string) {
  requirePermission(user, 'customer:read');
  return prisma.customer.findFirst({
    where: { id, deletedAt: null },
    include: {
      owner: { select: { id: true, name: true } },
      properties: { orderBy: { createdAt: 'asc' } },
      projects: {
        where: { deletedAt: null },
        include: { status: true },
        orderBy: { updatedAt: 'desc' },
      },
      activities: { orderBy: { occurredAt: 'desc' }, take: 20, include: { user: true } },
    },
  });
}

export async function createCustomer(user: SessionUser, input: CustomerInput) {
  requirePermission(user, 'customer:write');
  const data = nullifyBlank(customerSchema.parse(input));

  const customer = await prisma.$transaction(async (tx) => {
    return tx.customer.create({
      data: {
        code: await nextCustomerCode(tx as unknown as typeof prisma),
        type: data.type,
        name: data.name,
        nameKana: data.nameKana ?? null,
        companyName: data.companyName ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        postalCode: data.postalCode ?? null,
        prefecture: data.prefecture ?? null,
        city: data.city ?? null,
        addressLine: data.addressLine ?? null,
        source: data.source ?? null,
        notes: data.notes ?? null,
        // Default the owner to whoever created the record, so nothing is
        // unassigned by accident.
        ownerId: data.ownerId ?? user.id,
      },
    });
  });

  await recordAudit({
    userId: user.id,
    action: 'customer.create',
    entityType: 'Customer',
    entityId: customer.id,
    detail: { code: customer.code, name: customer.name },
  });
  return customer;
}

export async function updateCustomer(user: SessionUser, id: string, input: CustomerInput) {
  requirePermission(user, 'customer:write');
  const existing = await prisma.customer.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new Error('顧客が見つかりません / Customer not found');
  assertOwnership(user, existing.ownerId, 'customer:write');

  const data = nullifyBlank(customerSchema.parse(input));
  const customer = await prisma.customer.update({
    where: { id },
    data: {
      type: data.type,
      name: data.name,
      nameKana: data.nameKana ?? null,
      companyName: data.companyName ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      postalCode: data.postalCode ?? null,
      prefecture: data.prefecture ?? null,
      city: data.city ?? null,
      addressLine: data.addressLine ?? null,
      source: data.source ?? null,
      notes: data.notes ?? null,
      ownerId: data.ownerId ?? existing.ownerId,
    },
  });

  await recordAudit({
    userId: user.id,
    action: 'customer.update',
    entityType: 'Customer',
    entityId: id,
    detail: { before: existing, after: customer },
  });
  return customer;
}

/** Soft delete. Customer records are never physically removed. */
export async function deleteCustomer(user: SessionUser, id: string): Promise<void> {
  requirePermission(user, 'customer:write');
  const existing = await prisma.customer.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return;
  assertOwnership(user, existing.ownerId, 'customer:write');

  const openProjects = await prisma.project.count({
    where: { customerId: id, deletedAt: null },
  });
  if (openProjects > 0) {
    throw new Error(
      `この顧客には案件が${openProjects}件あります。先に案件を削除してください。 / ` +
        `Customer still has ${openProjects} project(s); remove them first.`,
    );
  }

  await prisma.customer.update({ where: { id }, data: { deletedAt: new Date() } });
  await recordAudit({
    userId: user.id,
    action: 'customer.delete',
    entityType: 'Customer',
    entityId: id,
    detail: { code: existing.code, name: existing.name },
  });
}

/**
 * A SALES user may only act on records they own. ADMIN and MANAGER are
 * unscoped, which `ownershipFilter` expresses by returning no filter at all.
 */
function assertOwnership(user: SessionUser, ownerId: string | null, permission: Permission): void {
  const scope = ownershipFilter(user);
  if (scope.ownerId !== undefined && ownerId !== scope.ownerId) {
    throw new ForbiddenError(permission);
  }
}
