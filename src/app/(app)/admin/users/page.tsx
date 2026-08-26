import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';
import { can, permissionsFor } from '@/server/auth/rbac';
import { listUsers } from '@/server/services/admin';
import { Alert, Card, PageHeader } from '@/components/ui';
import { UserRow } from './user-row';

export const metadata = { title: 'ユーザー管理' };

const ROLE_LABELS: Record<string, string> = {
  ADMIN: '管理者',
  MANAGER: 'マネージャー',
  SALES: '営業',
  VIEWER: '閲覧のみ',
};

export default async function UsersPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!can(user, 'user:manage')) redirect('/admin/health');

  const users = await listUsers(user);

  return (
    <>
      <PageHeader title="ユーザー" subtitle={`${users.length} 名`} />

      <Alert tone="info" title="権限変更は即時に反映されます">
        権限を変更するか無効化すると、その利用者の既存セッションはすべて失効します。
        次回の操作からログインが必要になります。
      </Alert>

      <Card className="mt-5 overflow-x-auto p-0">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">名前</th>
              <th className="px-4 py-3 font-medium">メールアドレス</th>
              <th className="px-4 py-3 font-medium">権限</th>
              <th className="px-4 py-3 font-medium">最終ログイン</th>
              <th className="px-4 py-3 font-medium">状態</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <UserRow
                key={u.id}
                isSelf={u.id === user.id}
                user={{
                  id: u.id,
                  name: u.name,
                  email: u.email,
                  role: u.role,
                  isActive: u.isActive,
                  lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
                }}
              />
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="mt-5">
        <h2 className="mb-3 text-base font-semibold">権限の内容</h2>
        <dl className="flex flex-col gap-3 text-sm">
          {Object.entries(ROLE_LABELS).map(([role, label]) => (
            <div key={role}>
              <dt className="font-medium">
                {label} <code className="text-xs text-[var(--text-muted)]">{role}</code>
              </dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {permissionsFor(role as never).map((p) => (
                  <code key={p} className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-xs">
                    {p}
                  </code>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
    </>
  );
}
