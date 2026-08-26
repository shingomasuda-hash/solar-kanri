import { prisma } from '../db/client';
import { ForbiddenError, ownershipFilter, requirePermission, type Permission } from '../auth/rbac';
import type { SessionUser } from '../auth/session';
import { recordAudit } from './audit';
import {
  activitySchema,
  noteSchema,
  projectSchema,
  taskSchema,
  type ProjectInput,
} from '../validation/schemas';

async function nextProjectCode(tx: typeof prisma): Promise<string> {
  const last = await tx.project.findFirst({ orderBy: { code: 'desc' }, select: { code: true } });
  const n = last ? Number.parseInt(last.code.replace(/\D/g, ''), 10) + 1 : 1;
  return `P-${String(n).padStart(6, '0')}`;
}

function blankToNull(v: FormDataEntryValue | string | null | undefined): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
}

export interface ProjectListOptions {
  readonly query?: string;
  readonly statusId?: string;
  readonly mineOnly?: boolean;
  readonly take?: number;
  readonly skip?: number;
}

export async function listProjects(user: SessionUser, options: ProjectListOptions = {}) {
  requirePermission(user, 'project:read');
  const q = options.query?.trim();
  return prisma.project.findMany({
    where: {
      deletedAt: null,
      ...ownershipFilter(user),
      ...(options.mineOnly ? { ownerId: user.id } : {}),
      ...(options.statusId ? { statusId: options.statusId } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: 'insensitive' as const } },
              { code: { contains: q, mode: 'insensitive' as const } },
              { customer: { name: { contains: q, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    },
    include: {
      customer: { select: { id: true, code: true, name: true } },
      status: true,
      owner: { select: { id: true, name: true } },
      _count: { select: { simulations: true, quotations: true, tasks: true } },
    },
    orderBy: [{ nextActionAt: { sort: 'asc', nulls: 'last' } }, { updatedAt: 'desc' }],
    take: Math.min(options.take ?? 50, 200),
    skip: options.skip ?? 0,
  });
}

export async function getProject(user: SessionUser, id: string) {
  requirePermission(user, 'project:read');
  const project = await prisma.project.findFirst({
    where: { id, deletedAt: null },
    include: {
      customer: { include: { properties: true } },
      property: { include: { roofFaces: { include: { exclusionZones: true } } } },
      status: true,
      owner: { select: { id: true, name: true } },
      activities: { orderBy: { occurredAt: 'desc' }, include: { user: true } },
      tasks: { orderBy: [{ completedAt: 'asc' }, { dueAt: 'asc' }], include: { assignee: true } },
      notes: { orderBy: { createdAt: 'desc' }, include: { user: true } },
      files: { orderBy: { createdAt: 'desc' } },
      simulations: { orderBy: { version: 'desc' } },
      quotations: { orderBy: { version: 'desc' }, include: { items: true } },
    },
  });
  if (!project) return null;
  assertOwnership(user, project.ownerId, 'project:read');
  return project;
}

export async function createProject(user: SessionUser, input: ProjectInput) {
  requirePermission(user, 'project:write');
  const data = projectSchema.parse(input);

  const project = await prisma.$transaction(async (tx) => {
    let propertyId = blankToNull(data.propertyId);

    // Every project needs somewhere to hang its geometry. Creating it here,
    // inside the same transaction, keeps the design page a pure read: a page
    // that writes during render can be triggered by a link prefetch, and
    // produces records nobody deliberately created.
    if (!propertyId) {
      const customer = await tx.customer.findUniqueOrThrow({
        where: { id: data.customerId },
        select: {
          postalCode: true,
          prefecture: true,
          city: true,
          addressLine: true,
        },
      });
      const property = await tx.property.create({
        data: { customerId: data.customerId, label: '本邸', ...customer },
      });
      propertyId = property.id;
    }

    return tx.project.create({
      data: {
        code: await nextProjectCode(tx as unknown as typeof prisma),
        title: data.title,
        customerId: data.customerId,
        propertyId,
        statusId: data.statusId,
        ownerId: blankToNull(data.ownerId) ?? user.id,
        expectedCloseDate: data.expectedCloseDate ?? null,
        nextActionAt: data.nextActionAt ?? null,
        nextActionNote: blankToNull(data.nextActionNote),
      },
    });
  });

  await recordAudit({
    userId: user.id,
    action: 'project.create',
    entityType: 'Project',
    entityId: project.id,
    detail: { code: project.code, title: project.title },
  });
  return project;
}

export async function updateProject(user: SessionUser, id: string, input: ProjectInput) {
  requirePermission(user, 'project:write');
  const existing = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new Error('案件が見つかりません / Project not found');
  assertOwnership(user, existing.ownerId, 'project:write');

  const data = projectSchema.parse(input);
  const project = await prisma.project.update({
    where: { id },
    data: {
      title: data.title,
      customerId: data.customerId,
      propertyId: blankToNull(data.propertyId),
      statusId: data.statusId,
      ownerId: blankToNull(data.ownerId) ?? existing.ownerId,
      expectedCloseDate: data.expectedCloseDate ?? null,
      nextActionAt: data.nextActionAt ?? null,
      nextActionNote: blankToNull(data.nextActionNote),
    },
  });

  await recordAudit({
    userId: user.id,
    action: 'project.update',
    entityType: 'Project',
    entityId: id,
    detail: { before: existing, after: project },
  });
  return project;
}

export async function changeProjectStatus(user: SessionUser, id: string, statusId: string) {
  requirePermission(user, 'project:write');
  const existing = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new Error('案件が見つかりません / Project not found');
  assertOwnership(user, existing.ownerId, 'project:write');

  const status = await prisma.salesStatus.findUnique({ where: { id: statusId } });
  if (!status) throw new Error('ステータスが見つかりません / Status not found');

  const project = await prisma.project.update({ where: { id }, data: { statusId } });
  await prisma.activity.create({
    data: {
      projectId: id,
      kind: 'OTHER',
      subject: `ステータス変更: ${status.label}`,
      userId: user.id,
    },
  });
  await recordAudit({
    userId: user.id,
    action: 'project.status.change',
    entityType: 'Project',
    entityId: id,
    detail: { from: existing.statusId, to: statusId, label: status.label },
  });
  return project;
}

export async function deleteProject(user: SessionUser, id: string): Promise<void> {
  requirePermission(user, 'project:write');
  const existing = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return;
  assertOwnership(user, existing.ownerId, 'project:write');

  await prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });
  await recordAudit({
    userId: user.id,
    action: 'project.delete',
    entityType: 'Project',
    entityId: id,
    detail: { code: existing.code, title: existing.title },
  });
}

// ------------------------------------------------------- activity / task / note

export async function addActivity(user: SessionUser, input: unknown) {
  requirePermission(user, 'project:write');
  const data = activitySchema.parse(input);
  const activity = await prisma.activity.create({
    data: {
      projectId: blankToNull(data.projectId),
      customerId: blankToNull(data.customerId),
      kind: data.kind,
      subject: data.subject,
      body: blankToNull(data.body),
      occurredAt: data.occurredAt,
      userId: user.id,
    },
  });
  await recordAudit({
    userId: user.id,
    action: 'activity.create',
    entityType: 'Activity',
    entityId: activity.id,
    detail: { subject: activity.subject },
  });
  return activity;
}

export async function addTask(user: SessionUser, input: unknown) {
  requirePermission(user, 'project:write');
  const data = taskSchema.parse(input);
  const task = await prisma.task.create({
    data: {
      projectId: data.projectId,
      title: data.title,
      description: blankToNull(data.description),
      dueAt: data.dueAt ?? null,
      assigneeId: blankToNull(data.assigneeId) ?? user.id,
    },
  });
  await recordAudit({
    userId: user.id,
    action: 'task.create',
    entityType: 'Task',
    entityId: task.id,
    detail: { title: task.title },
  });
  return task;
}

export async function toggleTask(user: SessionUser, taskId: string) {
  requirePermission(user, 'project:write');
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new Error('タスクが見つかりません / Task not found');
  const updated = await prisma.task.update({
    where: { id: taskId },
    data: { completedAt: task.completedAt ? null : new Date() },
  });
  await recordAudit({
    userId: user.id,
    action: updated.completedAt ? 'task.complete' : 'task.reopen',
    entityType: 'Task',
    entityId: taskId,
  });
  return updated;
}

export async function addNote(user: SessionUser, input: unknown) {
  requirePermission(user, 'project:write');
  const data = noteSchema.parse(input);
  const note = await prisma.note.create({
    data: { projectId: data.projectId, body: data.body, userId: user.id },
  });
  await recordAudit({
    userId: user.id,
    action: 'note.create',
    entityType: 'Note',
    entityId: note.id,
  });
  return note;
}

export async function listSalesStatuses() {
  return prisma.salesStatus.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
}

function assertOwnership(user: SessionUser, ownerId: string | null, permission: Permission): void {
  const scope = ownershipFilter(user);
  if (scope.ownerId !== undefined && ownerId !== scope.ownerId) {
    throw new ForbiddenError(permission);
  }
}
