import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';
import { can } from '@/server/auth/rbac';
import { listAuditLog } from '@/server/services/admin';
import { Card, EmptyState, PageHeader } from '@/components/ui';

export const metadata = { title: '操作ログ' };
export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!can(user, 'audit:read')) redirect('/admin/health');

  const entries = await listAuditLog(user, 200);

  return (
    <>
      <PageHeader title="操作ログ" subtitle="直近 200 件。認証情報は記録前にマスクされます。" />
      {entries.length === 0 ? (
        <EmptyState title="記録がありません" />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-2 font-medium">日時</th>
                <th className="px-4 py-2 font-medium">操作者</th>
                <th className="px-4 py-2 font-medium">操作</th>
                <th className="px-4 py-2 font-medium">対象</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-2 text-xs tabular-nums whitespace-nowrap">
                    {e.createdAt.toLocaleString('ja-JP')}
                  </td>
                  <td className="px-4 py-2 text-xs">{e.user?.name ?? '—'}</td>
                  <td className="px-4 py-2">
                    <code className="text-xs">{e.action}</code>
                  </td>
                  <td className="px-4 py-2 text-xs text-[var(--text-muted)]">
                    {e.entityType}
                    {e.entityId && (
                      <span className="ml-1 font-mono">{e.entityId.slice(0, 8)}…</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
