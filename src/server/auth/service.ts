import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { prisma } from '../db/client';
import { hashPassword, needsRehash, verifyPassword } from './password';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  generateSessionToken,
  hashSessionToken,
  sessionCookieOptions,
  type SessionUser,
} from './session';
import { recordAudit } from '../services/audit';

/**
 * A deliberately vague failure. Distinguishing "no such user" from "wrong
 * password" hands an attacker a free account-enumeration oracle.
 */
export class InvalidCredentialsError extends Error {
  constructor() {
    super('メールアドレスまたはパスワードが正しくありません / Invalid email or password');
    this.name = 'InvalidCredentialsError';
  }
}

export class AccountDisabledError extends Error {
  constructor() {
    super('このアカウントは無効化されています / This account has been disabled');
    this.name = 'AccountDisabledError';
  }
}

export interface LoginContext {
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

export async function login(
  email: string,
  password: string,
  context: LoginContext = {},
): Promise<{ user: SessionUser; token: string; expiresAt: Date }> {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalized } });

  if (!user) {
    // Burn comparable time on a dummy hash so response timing does not reveal
    // whether the address exists.
    await verifyPassword(password, DUMMY_HASH);
    throw new InvalidCredentialsError();
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    await recordAudit({
      userId: user.id,
      action: 'auth.login.failed',
      entityType: 'User',
      entityId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    throw new InvalidCredentialsError();
  }
  if (!user.isActive) throw new AccountDisabledError();

  // Opportunistically upgrade a hash made with an older cost factor.
  if (needsRehash(user.passwordHash)) {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password) },
    });
  }

  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
    },
  });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await recordAudit({
    userId: user.id,
    action: 'auth.login',
    entityType: 'User',
    entityId: user.id,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });

  return {
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    token,
    expiresAt,
  };
}

/** A bcrypt hash of a value nobody knows, used only to equalise timing. */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO3Q7sJQ8/2bqvC.q0nJ0EiEB1YV1zjBS';

export async function logout(token: string): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashSessionToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessions(userId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function resolveSession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (!session.user.isActive) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
  };
}

/**
 * The current user for this request.
 *
 * Wrapped in React `cache` so a page rendering a dozen server components
 * resolves the session once, not a dozen times.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  return resolveSession(store.get(SESSION_COOKIE)?.value);
});

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function requestContext(): Promise<LoginContext> {
  const h = await headers();
  return {
    // x-forwarded-for is client-controllable unless a trusted proxy rewrites it.
    // Recorded for audit only; never used for an authorisation decision.
    ipAddress: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    userAgent: h.get('user-agent') ?? undefined,
  };
}

/** Housekeeping: drop sessions that expired or were revoked over a week ago. */
export async function purgeStaleSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const result = await prisma.session.deleteMany({
    where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
  });
  return result.count;
}
