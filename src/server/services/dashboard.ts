import { prisma } from '../db/client';
import { ownershipFilter, requirePermission } from '../auth/rbac';
import type { SessionUser } from '../auth/session';
import { countUnverified } from './admin';

/**
 * Dashboard figures.
 *
 * Scoped by the same ownership rule as the project list, so a SALES user's
 * counts describe their own pipeline rather than the company's. A dashboard
 * showing numbers the viewer cannot drill into is worse than no dashboard.
 *
 * `now` is injected rather than read from the clock so the boundaries are
 * testable — "this week" is otherwise untestable without freezing time.
 */
export interface DashboardData {
  readonly activeProjects: number;
  readonly dueThisWeek: number;
  readonly overdue: number;
  readonly quotedThisMonth: number;
  readonly wonThisMonth: number;
  readonly totalInstalledKw: number;
  readonly upcoming: {
    id: string;
    code: string;
    title: string;
    customerName: string;
    statusLabel: string;
    statusColor: string;
    nextActionAt: Date | null;
    nextActionNote: string | null;
    isOverdue: boolean;
  }[];
  readonly recentActivity: {
    id: string;
    subject: string;
    kind: string;
    occurredAt: Date;
    projectId: string | null;
    projectTitle: string | null;
    userName: string | null;
  }[];
  readonly setupBlockers: number;
}

export async function getDashboard(
  user: SessionUser,
  now: Date = new Date(),
): Promise<DashboardData> {
  requirePermission(user, 'project:read');

  const scope = ownershipFilter(user);
  const base = { deletedAt: null, ...scope };

  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const endOfWeek = new Date(endOfToday);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    activeProjects,
    dueThisWeek,
    overdue,
    quotedThisMonth,
    wonProjects,
    upcomingRows,
    activityRows,
    unverified,
  ] = await Promise.all([
    prisma.project.count({ where: { ...base, status: { isWon: false, isLost: false } } }),
    prisma.project.count({
      where: { ...base, nextActionAt: { gt: endOfToday, lte: endOfWeek } },
    }),
    prisma.project.count({ where: { ...base, nextActionAt: { lte: endOfToday } } }),
    prisma.quotation.count({
      where: { issuedAt: { gte: startOfMonth }, project: base },
    }),
    prisma.project.findMany({
      where: { ...base, status: { isWon: true }, updatedAt: { gte: startOfMonth } },
      select: { id: true },
    }),
    prisma.project.findMany({
      where: { ...base, nextActionAt: { not: null } },
      include: { customer: { select: { name: true } }, status: true },
      orderBy: { nextActionAt: 'asc' },
      take: 10,
    }),
    prisma.activity.findMany({
      where: { project: base },
      include: {
        project: { select: { id: true, title: true } },
        user: { select: { name: true } },
      },
      orderBy: { occurredAt: 'desc' },
      take: 10,
    }),
    countUnverified(),
  ]);

  // Installed capacity of won projects this month, from their latest
  // simulation. Reported as a real figure or not at all — never estimated.
  let totalInstalledKw = 0;
  if (wonProjects.length > 0) {
    const simulations = await prisma.simulation.findMany({
      where: { projectId: { in: wonProjects.map((p) => p.id) } },
      orderBy: [{ projectId: 'asc' }, { version: 'desc' }],
      select: { projectId: true, installedW: true, version: true },
    });
    const latestByProject = new Map<string, number>();
    for (const sim of simulations) {
      if (!latestByProject.has(sim.projectId)) latestByProject.set(sim.projectId, sim.installedW);
    }
    totalInstalledKw = [...latestByProject.values()].reduce((s, w) => s + w, 0) / 1000;
  }

  return {
    activeProjects,
    dueThisWeek,
    overdue,
    quotedThisMonth,
    wonThisMonth: wonProjects.length,
    totalInstalledKw: Math.round(totalInstalledKw * 100) / 100,
    upcoming: upcomingRows.map((p) => ({
      id: p.id,
      code: p.code,
      title: p.title,
      customerName: p.customer.name,
      statusLabel: p.status.label,
      statusColor: p.status.colorHex,
      nextActionAt: p.nextActionAt,
      nextActionNote: p.nextActionNote,
      isOverdue: p.nextActionAt !== null && p.nextActionAt <= endOfToday,
    })),
    recentActivity: activityRows.map((a) => ({
      id: a.id,
      subject: a.subject,
      kind: a.kind,
      occurredAt: a.occurredAt,
      projectId: a.project?.id ?? null,
      projectTitle: a.project?.title ?? null,
      userName: a.user?.name ?? null,
    })),
    setupBlockers: unverified.coefficients + unverified.tariffs + unverified.irradiance,
  };
}
