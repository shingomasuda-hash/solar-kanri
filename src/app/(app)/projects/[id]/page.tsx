import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';
import { can } from '@/server/auth/rbac';
import { getProject, listSalesStatuses } from '@/server/services/projects';
import { prisma } from '@/server/db/client';
import {
  Alert,
  Badge,
  Card,
  CardTitle,
  EmptyState,
  LinkButton,
  PageHeader,
  Stat,
} from '@/components/ui';
import { StatusChanger } from './status-changer';
import { ActivityPanel } from './activity-panel';
import { TaskPanel } from './task-panel';
import { NotePanel } from './note-panel';

const jpy = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const { id } = await params;

  const project = await getProject(user, id);
  if (!project) notFound();

  const [statuses, users] = await Promise.all([
    listSalesStatuses(),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const latest = project.simulations[0];
  const writable = can(user, 'project:write');
  const roofCount = project.property?.roofFaces.length ?? 0;

  return (
    <>
      <PageHeader
        title={project.title}
        subtitle={
          <>
            <span className="font-mono">{project.code}</span>
            <Link href={`/customers/${project.customer.id}`} className="ml-3 hover:underline">
              {project.customer.name}
            </Link>
          </>
        }
        actions={
          <>
            <LinkButton href={`/projects/${project.id}/design`} variant="secondary">
              屋根・パネル設計
            </LinkButton>
            {writable && (
              <LinkButton href={`/projects/${project.id}/edit`} variant="secondary">
                編集
              </LinkButton>
            )}
          </>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="設置容量"
          value={latest ? (latest.installedW / 1000).toFixed(2) : '—'}
          unit="kW"
          hint={latest ? `パネル ${latest.panelCount} 枚` : '未シミュレーション'}
        />
        <Stat
          label="年間発電量"
          value={latest ? jpy.format(Math.round(latest.annualGenerationKWh)) : '—'}
          unit="kWh"
        />
        <Stat
          label="初年度経済効果"
          value={latest ? jpy.format(latest.firstYearBenefitJpy) : '—'}
          unit="円"
        />
        <Stat
          label="投資回収"
          value={latest?.paybackYears ? latest.paybackYears.toFixed(1) : '—'}
          unit="年"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5 lg:col-span-2">
          {roofCount === 0 && (
            <Alert tone="info" title="次のステップ">
              屋根がまだ登録されていません。
              <Link href={`/projects/${project.id}/design`} className="ml-1 font-medium underline">
                屋根・パネル設計
              </Link>
              で住所を検索し、衛星写真の上に屋根を作図してください。
            </Alert>
          )}

          <ActivityPanel
            projectId={project.id}
            customerId={project.customer.id}
            activities={project.activities.map((a) => ({
              id: a.id,
              kind: a.kind,
              subject: a.subject,
              body: a.body,
              occurredAt: a.occurredAt.toISOString(),
              userName: a.user?.name ?? null,
            }))}
            canWrite={writable}
          />

          <NotePanel
            projectId={project.id}
            notes={project.notes.map((n) => ({
              id: n.id,
              body: n.body,
              createdAt: n.createdAt.toISOString(),
              userName: n.user?.name ?? null,
            }))}
            canWrite={writable}
          />
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardTitle>ステータス</CardTitle>
            <div className="mb-3">
              <Badge colorHex={project.status.colorHex}>{project.status.label}</Badge>
            </div>
            {writable && (
              <StatusChanger
                projectId={project.id}
                currentStatusId={project.statusId}
                statuses={statuses.map((s) => ({ id: s.id, label: s.label }))}
              />
            )}
          </Card>

          <Card>
            <CardTitle>次のアクション</CardTitle>
            {project.nextActionAt ? (
              <>
                <p className="text-sm font-medium tabular-nums">
                  {project.nextActionAt.toLocaleDateString('ja-JP')}
                </p>
                {project.nextActionNote && (
                  <p className="mt-1 text-sm whitespace-pre-wrap text-[var(--text-muted)]">
                    {project.nextActionNote}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">未設定</p>
            )}
          </Card>

          <TaskPanel
            projectId={project.id}
            tasks={project.tasks.map((t) => ({
              id: t.id,
              title: t.title,
              dueAt: t.dueAt?.toISOString() ?? null,
              completedAt: t.completedAt?.toISOString() ?? null,
              assigneeName: t.assignee?.name ?? null,
            }))}
            users={users}
            canWrite={writable}
          />

          <Card>
            <CardTitle
              action={
                <LinkButton
                  href={`/projects/${project.id}/design`}
                  variant="ghost"
                  className="text-xs"
                >
                  設計へ
                </LinkButton>
              }
            >
              シミュレーション
            </CardTitle>
            {project.simulations.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">
                まだありません。屋根を作図してパネルを配置すると実行できます。
              </p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {project.simulations.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2">
                    <span>v{s.version}</span>
                    <span className="tabular-nums text-[var(--text-muted)]">
                      {(s.installedW / 1000).toFixed(2)} kW ·{' '}
                      {jpy.format(Math.round(s.annualGenerationKWh))} kWh
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle
              action={
                can(user, 'quotation:write') ? (
                  <LinkButton
                    href={`/projects/${project.id}/quotations/new`}
                    variant="ghost"
                    className="text-xs"
                  >
                    作成
                  </LinkButton>
                ) : null
              }
            >
              見積
            </CardTitle>
            {project.quotations.length === 0 ? (
              <EmptyState title="見積はまだありません" />
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {project.quotations.map((q) => (
                  <li key={q.id} className="flex items-center justify-between gap-2">
                    <Link
                      href={`/projects/${project.id}/quotations/${q.id}`}
                      className="hover:underline"
                    >
                      v{q.version} {q.title}
                    </Link>
                    <span className="tabular-nums">{jpy.format(q.totalJpy)} 円</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
