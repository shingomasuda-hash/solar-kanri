import Link from 'next/link';
import { getCurrentUser } from '@/server/auth/service';
import { can } from '@/server/auth/rbac';
import { listProjects, listSalesStatuses } from '@/server/services/projects';
import { Badge, Card, EmptyState, Input, LinkButton, PageHeader, Select } from '@/components/ui';

export const metadata = { title: '案件一覧' };

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; statusId?: string; mine?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { q, statusId, mine } = await searchParams;
  const [projects, statuses] = await Promise.all([
    listProjects(user, { query: q, statusId, mineOnly: mine === '1' }),
    listSalesStatuses(),
  ]);

  const today = new Date();
  today.setHours(23, 59, 59, 999);

  return (
    <>
      <PageHeader
        title="案件"
        subtitle={`${projects.length} 件`}
        actions={
          can(user, 'project:write') ? (
            <LinkButton href="/projects/new">案件を作成</LinkButton>
          ) : null
        }
      />

      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <Input
          type="search"
          name="q"
          defaultValue={q ?? ''}
          placeholder="案件名・案件コード・顧客名で検索"
          aria-label="案件を検索"
          className="max-w-xs"
        />
        <Select
          name="statusId"
          defaultValue={statusId ?? ''}
          aria-label="ステータスで絞り込み"
          className="max-w-40"
        >
          <option value="">すべてのステータス</option>
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="mine" value="1" defaultChecked={mine === '1'} />
          自分の案件のみ
        </label>
        <button
          type="submit"
          className="rounded-md border border-[var(--border)] px-3.5 py-2 text-sm"
        >
          絞り込む
        </button>
      </form>

      {projects.length === 0 ? (
        <EmptyState
          title="案件がありません"
          description="顧客を登録し、案件を作成すると屋根作図とシミュレーションに進めます。"
          action={
            can(user, 'project:write') ? (
              <LinkButton href="/projects/new">案件を作成</LinkButton>
            ) : null
          }
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">案件コード</th>
                <th className="px-4 py-3 font-medium">案件名</th>
                <th className="px-4 py-3 font-medium">顧客</th>
                <th className="px-4 py-3 font-medium">ステータス</th>
                <th className="px-4 py-3 font-medium">次アクション</th>
                <th className="px-4 py-3 font-medium">担当</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const overdue = p.nextActionAt && p.nextActionAt <= today;
                return (
                  <tr
                    key={p.id}
                    className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-muted)]"
                  >
                    <td className="px-4 py-3 font-mono text-xs">{p.code}</td>
                    <td className="px-4 py-3">
                      <Link href={`/projects/${p.id}`} className="font-medium hover:underline">
                        {p.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/customers/${p.customer.id}`}
                        className="text-xs hover:underline"
                      >
                        {p.customer.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Badge colorHex={p.status.colorHex}>{p.status.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {p.nextActionAt ? (
                        <span className={overdue ? 'font-medium text-red-600' : undefined}>
                          {p.nextActionAt.toLocaleDateString('ja-JP')}
                          {overdue && '（期限超過）'}
                        </span>
                      ) : (
                        <span className="text-[var(--text-muted)]">未設定</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">{p.owner?.name ?? '未割当'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
