import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';
import { can } from '@/server/auth/rbac';
import { listCoefficientSets } from '@/server/services/admin';
import { Alert, Card, CardTitle, PageHeader } from '@/components/ui';
import { CoefficientRow } from './coefficient-row';
import { DefaultSetButton } from './default-set-button';

export const metadata = { title: '係数の管理' };

export default async function CoefficientsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const sets = await listCoefficientSets(user);
  const editable = can(user, 'coefficient:write');

  return (
    <>
      <PageHeader
        title="係数"
        subtitle="発電量計算に使用する係数。出典のない数値は計算に使用されません。"
      />

      <Alert tone="info" title="出典の登録について">
        <p>
          温度係数・配線損失・CO₂排出係数などは、必ずメーカーのデータシート、公的規格、
          公的データセット、または管理者による明示的な決定を出典として登録してください。
        </p>
        <p className="mt-1">
          「未確認（プレースホルダ）」のままの係数がひとつでもあると、
          シミュレーションは実行されません。これは仕様であり、不具合ではありません。
        </p>
      </Alert>

      {sets.map((set) => (
        <Card key={set.id} className="mt-5" data-testid={`coefficient-set-${set.key}`}>
          <CardTitle
            action={
              editable && !set.isDefault ? <DefaultSetButton id={set.id} name={set.name} /> : null
            }
          >
            {set.name}
            {set.isDefault && (
              <span
                className="ml-2 rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-xs"
                data-testid={`default-set-${set.key}`}
              >
                既定
              </span>
            )}
            {set.values.some((c) => c.sourceKind === 'DEMO_APPROXIMATION') && (
              <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-300">
                デモ用・提示不可
              </span>
            )}
          </CardTitle>
          <ul className="flex flex-col gap-3">
            {set.values.map((c) => (
              <CoefficientRow
                key={c.id}
                editable={editable}
                coefficient={{
                  id: c.id,
                  key: c.key,
                  label: c.label,
                  value: c.value,
                  unit: c.unit,
                  sourceKind: c.sourceKind,
                  sourceCitation: c.sourceCitation,
                  sourceUrl: c.sourceUrl,
                  note: c.note,
                  verifiedAt: c.verifiedAt?.toISOString() ?? null,
                  verifiedBy: c.verifiedBy,
                }}
              />
            ))}
          </ul>
        </Card>
      ))}
    </>
  );
}
