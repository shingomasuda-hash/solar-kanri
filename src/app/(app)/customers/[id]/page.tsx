import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';
import { can } from '@/server/auth/rbac';
import { getCustomer } from '@/server/services/customers';
import { Badge, Card, CardTitle, EmptyState, LinkButton, PageHeader } from '@/components/ui';

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const { id } = await params;
  const customer = await getCustomer(user, id);
  if (!customer) notFound();

  const address = [customer.prefecture, customer.city, customer.addressLine]
    .filter(Boolean)
    .join('');

  return (
    <>
      <PageHeader
        title={customer.name}
        subtitle={
          <>
            <span className="font-mono">{customer.code}</span>
            {customer.companyName && <span className="ml-3">{customer.companyName}</span>}
          </>
        }
        actions={
          <>
            {can(user, 'customer:write') && (
              <LinkButton href={`/customers/${customer.id}/edit`} variant="secondary">
                編集
              </LinkButton>
            )}
            {can(user, 'project:write') && (
              <LinkButton href={`/projects/new?customerId=${customer.id}`}>案件を作成</LinkButton>
            )}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5 lg:col-span-2">
          <Card>
            <CardTitle>案件</CardTitle>
            {customer.projects.length === 0 ? (
              <EmptyState
                title="案件がありません"
                description="この顧客の案件を作成すると、屋根作図とシミュレーションに進めます。"
                action={
                  can(user, 'project:write') ? (
                    <LinkButton href={`/projects/new?customerId=${customer.id}`}>
                      案件を作成
                    </LinkButton>
                  ) : null
                }
              />
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {customer.projects.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                    <div>
                      <Link href={`/projects/${p.id}`} className="font-medium hover:underline">
                        {p.title}
                      </Link>
                      <p className="font-mono text-xs text-[var(--text-muted)]">{p.code}</p>
                    </div>
                    <Badge colorHex={p.status.colorHex}>{p.status.label}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle>対応履歴</CardTitle>
            {customer.activities.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">履歴はまだありません。</p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {customer.activities.map((a) => (
                  <li key={a.id} className="py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-medium">{a.subject}</p>
                      <time className="text-xs text-[var(--text-muted)] tabular-nums">
                        {a.occurredAt.toLocaleDateString('ja-JP')}
                      </time>
                    </div>
                    {a.body && (
                      <p className="mt-1 text-sm whitespace-pre-wrap text-[var(--text-muted)]">
                        {a.body}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardTitle>基本情報</CardTitle>
            <dl className="flex flex-col gap-3 text-sm">
              <Row label="区分" value={customer.type === 'CORPORATE' ? '法人' : '個人'} />
              <Row label="フリガナ" value={customer.nameKana} />
              <Row label="電話番号" value={customer.phone} />
              <Row label="メール" value={customer.email} />
              <Row label="郵便番号" value={customer.postalCode} />
              <Row label="住所" value={address || null} />
              <Row label="流入経路" value={customer.source} />
              <Row label="担当" value={customer.owner?.name ?? '未割当'} />
            </dl>
          </Card>

          <Card>
            <CardTitle>物件</CardTitle>
            {customer.properties.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">
                案件を作成すると物件を登録できます。
              </p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {customer.properties.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <span>{p.label}</span>
                    {p.latitude != null ? (
                      <Badge className="bg-emerald-500/10 text-emerald-700">位置確定</Badge>
                    ) : (
                      <Badge>未設定</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {customer.notes && (
            <Card>
              <CardTitle>メモ</CardTitle>
              <p className="text-sm whitespace-pre-wrap">{customer.notes}</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--text-muted)]">{label}</dt>
      <dd className="text-right">{value || '—'}</dd>
    </div>
  );
}
