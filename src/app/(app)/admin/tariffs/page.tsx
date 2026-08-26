import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';
import { can } from '@/server/auth/rbac';
import { listTariffs } from '@/server/services/admin';
import { Alert, PageHeader } from '@/components/ui';
import { TariffEditor } from './tariff-editor';

export const metadata = { title: '電力単価' };

export default async function TariffsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const tariffs = await listTariffs(user);

  return (
    <>
      <PageHeader
        title="電力単価"
        subtitle="買電単価・売電単価・自家消費率。経済効果の計算に使用されます。"
      />
      <Alert tone="warning" title="これらは経営判断です">
        単価と自家消費率は事業上の判断であり、システムが推測してよい数値ではありません。
        根拠（料金プラン名・制度名・年度など）を出典欄に必ず記載してください。
      </Alert>
      <div className="mt-5">
        <TariffEditor
          canWrite={can(user, 'master:write')}
          tariffs={tariffs.map((t) => ({
            id: t.id,
            key: t.key,
            name: t.name,
            purchasePriceJpyPerKWh: t.purchasePriceJpyPerKWh,
            exportPriceJpyPerKWh: t.exportPriceJpyPerKWh,
            exportPriceYears: t.exportPriceYears,
            postExportPriceJpyPerKWh: t.postExportPriceJpyPerKWh,
            annualPriceEscalation: t.annualPriceEscalation,
            monthlyBasicChargeJpy: t.monthlyBasicChargeJpy,
            defaultSelfConsumptionRatio: t.defaultSelfConsumptionRatio,
            sourceKind: t.sourceKind,
            sourceCitation: t.sourceCitation,
            isDefault: t.isDefault,
          }))}
        />
      </div>
    </>
  );
}
