import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';
import { runHealthChecks, type HealthState } from '@/server/services/health';
import { Card, PageHeader } from '@/components/ui';

export const metadata = { title: 'システム状態' };
export const dynamic = 'force-dynamic';

const STATE_STYLE: Record<HealthState, { label: string; className: string }> = {
  ok: { label: '正常', className: 'bg-emerald-500/10 text-emerald-700' },
  degraded: { label: '低下', className: 'bg-amber-500/10 text-amber-700' },
  down: { label: '停止', className: 'bg-red-500/10 text-red-700' },
  'not-configured': { label: '未設定', className: 'bg-slate-500/10 text-slate-600' },
};

export default async function HealthPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const checks = await runHealthChecks(user);

  return (
    <>
      <PageHeader
        title="システム状態"
        subtitle={`最終確認 ${new Date().toLocaleString('ja-JP')}`}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {checks.map((check) => {
          const style = STATE_STYLE[check.state];
          return (
            <Card key={check.component} data-testid={`health-${check.component}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{check.label}</h2>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${style.className}`}
                >
                  {style.label}
                </span>
              </div>
              <p className="text-sm text-[var(--text-muted)]">{check.message}</p>
              {check.latencyMs !== undefined && (
                <p className="mt-1 text-xs tabular-nums text-[var(--text-muted)]">
                  応答 {check.latencyMs} ms
                </p>
              )}
              {check.action && (
                <p className="mt-2 rounded bg-[var(--surface-muted)] px-2 py-1.5 text-xs">
                  対応: {check.action}
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
