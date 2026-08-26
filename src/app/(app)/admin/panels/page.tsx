import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';
import { can } from '@/server/auth/rbac';
import { listPanels } from '@/server/services/admin';
import { Alert, Card, PageHeader } from '@/components/ui';
import { PanelEditor } from './panel-editor';

export const metadata = { title: 'パネルマスタ' };

export default async function PanelsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const panels = await listPanels(user);

  return (
    <>
      <PageHeader
        title="パネルマスタ"
        subtitle="メーカー・型番ごとの寸法と電気的特性。すべてデータシートを出典として登録します。"
      />
      <Alert tone="info" title="温度係数の入力について">
        データシートは %/℃ で表記されています。−0.35 %/℃ の場合は
        <code className="mx-1">-0.0035</code>
        （100で割った値）を入力してください。桁を間違えた値は保存時に拒否されます。
      </Alert>

      <div className="mt-5">
        <PanelEditor
          canWrite={can(user, 'master:write')}
          panels={panels.map((p) => ({
            id: p.id,
            manufacturer: p.manufacturer,
            model: p.model,
            widthMm: p.widthMm,
            heightMm: p.heightMm,
            ratedPowerW: p.ratedPowerW,
            pmaxTempCoeffPerK: p.pmaxTempCoeffPerK,
            annualDegradation: p.annualDegradation,
            noctC: p.noctC,
            efficiencyPct: p.efficiencyPct,
            datasheetVersion: p.datasheetVersion,
            sourceCitation: p.sourceCitation,
            isActive: p.isActive,
            verifiedAt: p.verifiedAt?.toISOString() ?? null,
          }))}
        />
      </div>

      {panels.length === 0 && (
        <Card className="mt-5">
          <p className="text-sm text-[var(--text-muted)]">
            パネルが登録されていません。上のフォームから追加してください。
          </p>
        </Card>
      )}
    </>
  );
}
