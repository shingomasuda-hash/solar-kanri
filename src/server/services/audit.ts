import { prisma } from '../db/client';

/**
 * Append-only audit trail.
 *
 * Every write, login and permission change goes through here (CLAUDE.md,
 * Security rules). Deliberately never throws: an audit failure must not take
 * down the operation it is recording, and losing one row is preferable to
 * losing the customer's data edit. Failures are logged for investigation.
 */
export interface AuditEntry {
  readonly userId?: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly detail?: unknown;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

/** Keys whose values are never written to the audit log. */
const REDACTED_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'tokenHash',
  'apiKey',
  'secret',
  'sessionSecret',
  'authorization',
]);

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = REDACTED_KEYS.has(k) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        detail: entry.detail === undefined ? undefined : (redact(entry.detail) as never),
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  } catch (err) {
    console.error('[audit] failed to record entry', entry.action, err);
  }
}
