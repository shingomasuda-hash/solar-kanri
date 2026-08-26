import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';
import { can } from '@/server/auth/rbac';
import { getDashboard } from '@/server/services/dashboard';
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

export const metadata = { title: 'ダッシュボード' };
export const dynamic = 'force-dynamic';

const KIND_LABELS: Record<string, string> = {
  CALL: '電話',
  EMAIL: 'メール',
  MEETING: '打合せ',
  SITE_VISIT: '現地調査',
  PROPOSAL: '提案',
  CONTRACT: '契約',
  CONSTRUCTION: '工事',
  OTHER: 'その他',
};

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const data = await getDashboard(user);
  const scopeNote = user.role === 'SALES' ? '自分の担当案件' : '全案件';

  return (
    <>
      <PageHeader
        title="ダッシュボード"
        subtitle={`${user.name} さん、おつかれさまです（${scopeNote}）`}
        actions={
          can(user, 'project:write') ? (
            <LinkButton href="/projects/new">案件を作成</LinkButton>
          ) : null
        }
      />

      {data.setupBlockers > 0 && can(user, 'master:read') && (
        <div className="mb-5">
          <Alert tone="warning" title="初期設定が完了していません">
            出典が未確認の係数・単価・日射量が {data.setupBlockers} 件あります。
            この状態ではシミュレーションを実行できません。
            {can(user, 'coefficient:write') ? (
              <Link href="/admin/coefficients" className="ml-1 font-medium underline">
                係数を設定する
              </Link>
            ) : (
              <span className="ml-1">管理者に設定を依頼してください。</span>
            )}
          </Alert>
        </div>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="進行中の案件" value={data.activeProjects} unit="件" />
        <Stat
          label="対応期限"
          value={data.overdue}
          unit="件超過"
          hint={`今週中 ${data.dueThisWeek} 件`}
        />
        <Stat label="今月の見積提出" value={data.quotedThisMonth} unit="件" />
        <Stat
          label="今月の受注"
          value={data.wonThisMonth}
          unit="件"
          hint={data.totalInstalledKw > 0 ? `${data.totalInstalledKw.toFixed(2)} kW` : undefined}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle
            action={
              <LinkButton href="/projects" variant="ghost" className="text-xs">
                すべて見る
              </LinkButton>
            }
          >
            次のアクション
          </CardTitle>
          {data.upcoming.length === 0 ? (
            <EmptyState
              title="予定されたアクションはありません"
              description="案件に次アクションの日付を設定すると、ここに期限順で並びます。"
            />
          ) : (
            <ul className="divide-y divide-[var(--border)]" data-testid="dashboard-upcoming">
              {data.upcoming.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link href={`/projects/${p.id}`} className="font-medium hover:underline">
                      {p.title}
                    </Link>
                    <p className="truncate text-xs text-[var(--text-muted)]">
                      {p.customerName}
                      {p.nextActionNote && ` · ${p.nextActionNote}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge colorHex={p.statusColor}>{p.statusLabel}</Badge>
                    {p.nextActionAt && (
                      <p
                        className={`mt-1 text-xs tabular-nums ${
                          p.isOverdue ? 'font-medium text-red-600' : 'text-[var(--text-muted)]'
                        }`}
                      >
                        {p.nextActionAt.toLocaleDateString('ja-JP')}
                        {p.isOverdue && '（超過）'}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>最近の活動</CardTitle>
          {data.recentActivity.length === 0 ? (
            <EmptyState
              title="活動記録がありません"
              description="案件画面で対応履歴を記録すると、ここに表示されます。"
            />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.recentActivity.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm">
                      <span className="mr-2 rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-xs">
                        {KIND_LABELS[a.kind] ?? a.kind}
                      </span>
                      {a.subject}
                    </p>
                    {a.projectId && (
                      <Link
                        href={`/projects/${a.projectId}`}
                        className="truncate text-xs text-[var(--text-muted)] hover:underline"
                      >
                        {a.projectTitle}
                      </Link>
                    )}
                  </div>
                  <time className="shrink-0 text-xs tabular-nums text-[var(--text-muted)]">
                    {a.occurredAt.toLocaleDateString('ja-JP')}
                    {a.userName && ` · ${a.userName}`}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
