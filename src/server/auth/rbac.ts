import type { Role } from '../../../generated/prisma/enums';
import type { SessionUser } from './session';

/**
 * Role-based access control.
 *
 * Checked in the service layer, never only in the UI — hiding a button is not
 * access control (CLAUDE.md, Security rules). Every server action and route
 * handler that mutates or reads scoped data calls into here.
 */

export type Permission =
  | 'customer:read'
  | 'customer:write'
  | 'project:read'
  | 'project:write'
  | 'simulation:run'
  | 'quotation:read'
  | 'quotation:write'
  | 'quotation:issue'
  | 'master:read'
  | 'master:write'
  | 'coefficient:write'
  | 'user:manage'
  | 'audit:read'
  | 'health:read'
  | 'copilot:use';

const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  ADMIN: [
    'customer:read',
    'customer:write',
    'project:read',
    'project:write',
    'simulation:run',
    'quotation:read',
    'quotation:write',
    'quotation:issue',
    'master:read',
    'master:write',
    'coefficient:write',
    'user:manage',
    'audit:read',
    'health:read',
    'copilot:use',
  ],
  MANAGER: [
    'customer:read',
    'customer:write',
    'project:read',
    'project:write',
    'simulation:run',
    'quotation:read',
    'quotation:write',
    'quotation:issue',
    'master:read',
    'audit:read',
    'health:read',
    'copilot:use',
  ],
  SALES: [
    'customer:read',
    'customer:write',
    'project:read',
    'project:write',
    'simulation:run',
    'quotation:read',
    'quotation:write',
    'master:read',
    'copilot:use',
  ],
  VIEWER: ['customer:read', 'project:read', 'quotation:read', 'master:read'],
};

export function can(user: SessionUser | null, permission: Permission): boolean {
  if (!user) return false;
  return ROLE_PERMISSIONS[user.role]?.includes(permission) ?? false;
}

export class ForbiddenError extends Error {
  readonly permission: Permission;

  constructor(permission: Permission) {
    super(`この操作を行う権限がありません / Missing permission: ${permission}`);
    this.name = 'ForbiddenError';
    this.permission = permission;
  }
}

export class UnauthenticatedError extends Error {
  constructor() {
    super('ログインが必要です / Authentication required');
    this.name = 'UnauthenticatedError';
  }
}

export function requirePermission(user: SessionUser | null, permission: Permission): SessionUser {
  if (!user) throw new UnauthenticatedError();
  if (!can(user, permission)) throw new ForbiddenError(permission);
  return user;
}

/**
 * Whether a user may act on a record owned by `ownerId`.
 *
 * SALES users are scoped to their own records; MANAGER and ADMIN see
 * everything. An unowned record (owner deleted) is visible to managers and
 * above only, so it cannot silently become nobody's responsibility.
 */
export function canAccessOwnedRecord(user: SessionUser | null, ownerId: string | null): boolean {
  if (!user) return false;
  if (user.role === 'ADMIN' || user.role === 'MANAGER') return true;
  if (user.role === 'VIEWER') return true; // read-scoped elsewhere
  return ownerId !== null && ownerId === user.id;
}

/** Prisma `where` fragment enforcing the same scoping at the query level. */
export function ownershipFilter(user: SessionUser): { ownerId?: string } {
  if (user.role === 'ADMIN' || user.role === 'MANAGER' || user.role === 'VIEWER') return {};
  return { ownerId: user.id };
}

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}
