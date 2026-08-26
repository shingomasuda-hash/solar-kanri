import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';
import { can } from '@/server/auth/rbac';
import { getProject } from '@/server/services/projects';
import { draftFromSimulation } from '@/server/services/quotations';
import { Alert, PageHeader } from '@/components/ui';
import { QuotationForm, type LineRow } from '../quotation-form';
import { createQuotationAction } from '../actions';

export const metadata = { title: '見積を作成' };

export default async function NewQuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const { id } = await params;
  if (!can(user, 'quotation:write')) redirect(`/projects/${id}`);

  const project = await getProject(user, id);
  if (!project) notFound();

  const draft = await draftFromSimulation(user, id);

  const items: LineRow[] = (draft?.items ?? []).map((item) => ({
    category: item.category,
    name: item.name,
    description: '',
    quantity: String(item.quantity),
    unit: item.unit,
    unitPriceJpy: '0',
  }));

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 30);

  return (
    <>
      <PageHeader title="見積を作成" subtitle={`${project.title} — ${project.customer.name} 様`} />

      {draft ? (
        <Alert tone="info" title="シミュレーションから明細を作成しました">
          {draft.panelCount} 枚 / {draft.installedKw.toFixed(2)} kW の構成です。 単価は 0
          円で入力されています——価格は経営判断のため、システムは推測しません。
        </Alert>
      ) : (
        <Alert tone="warning" title="シミュレーションがありません">
          先に屋根を作図してシミュレーションを実行すると、明細が自動で用意されます。
          このまま手入力で作成することもできます。
        </Alert>
      )}

      <div className="mt-5">
        <QuotationForm
          action={createQuotationAction}
          projectId={id}
          simulationId={draft?.simulationId}
          submitLabel="見積を作成"
          defaults={{
            title: `${project.customer.name} 様邸 太陽光発電システム お見積書`,
            validUntil: validUntil.toISOString().slice(0, 10),
            discountJpy: '0',
            subsidyJpy: '0',
            taxRate: '0.1',
            notes: '',
            items,
          }}
        />
      </div>
    </>
  );
}
