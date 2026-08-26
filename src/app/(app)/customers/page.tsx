import Link from 'next/link';
import { getCurrentUser } from '@/server/auth/service';
import { can } from '@/server/auth/rbac';
import { listCustomers } from '@/server/services/customers';
import { Badge, Card, EmptyState, Input, LinkButton, PageHeader } from '@/components/ui';

export const metadata = { title: '顧客一覧' };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { q } = await searchParams;
  const customers = await listCustomers(user, { query: q });

  return (
    <>
      <PageHeader
        title="顧客"
        subtitle={`${customers.length} 件`}
        actions={
          can(user, 'customer:write') ? (
            <LinkButton href="/customers/new">顧客を登録</LinkButton>
          ) : null
        }
      />

      <form className="mb-4 flex gap-2" role="search">
        <Input
          type="search"
          name="q"
          defaultValue={q ?? ''}
          placeholder="名前・会社名・顧客コード・メール・電話で検索"
          aria-label="顧客を検索"
          className="max-w-md"
        />
        <button
          type="submit"
          className="rounded-md border border-[var(--border)] px-3.5 py-2 text-sm"
        >
          検索
        </button>
      </form>

      {customers.length === 0 ? (
        <EmptyState
          title={q ? '該当する顧客が見つかりません' : 'まだ顧客が登録されていません'}
          description={
            q ? '検索条件を変えてお試しください。' : '問い合わせを受けたら、まず顧客を登録します。'
          }
          action={
            can(user, 'customer:write') ? (
              <LinkButton href="/customers/new">顧客を登録</LinkButton>
            ) : null
          }
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">顧客コード</th>
                <th className="px-4 py-3 font-medium">氏名 / 会社名</th>
                <th className="px-4 py-3 font-medium">連絡先</th>
                <th className="px-4 py-3 font-medium">担当</th>
                <th className="px-4 py-3 text-right font-medium">案件</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-muted)]"
                >
                  <td className="px-4 py-3 font-mono text-xs">{c.code}</td>
                  <td className="px-4 py-3">
                    <Link href={`/customers/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    {c.companyName && (
                      <span className="ml-2 text-xs text-[var(--text-muted)]">{c.companyName}</span>
                    )}
                    <Badge className="ml-2">{c.type === 'CORPORATE' ? '法人' : '個人'}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                    {c.phone ?? '—'}
                    {c.email && <div>{c.email}</div>}
                  </td>
                  <td className="px-4 py-3 text-xs">{c.owner?.name ?? '未割当'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c._count.projects}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
