import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';
import { can } from '@/server/auth/rbac';
import { getQuotation } from '@/server/services/quotations';
import { Alert, PageHeader } from '@/components/ui';
import { QuotationForm, type LineRow } from '../../quotation-form';
import { updateQuotationAction } from '../../actions';

export default async function EditQuotationPage({
  params,
}: {
  params: Promise<{ id: string; quotationId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const { id, quotationId } = await params;
  if (!can(user, 'quotation:write')) redirect(`/projects/${id}/quotations/${quotationId}`);

  const quotation = await getQuotation(user, quotationId);
  if (!quotation) notFound();

  if (quotation.status !== 'DRAFT') {
    return (
      <>
        <PageHeader title="見積を編集" subtitle={quotation.title} />
        <Alert tone="warning" title="発行済みの見積は編集できません">
          内容を修正する場合は、案件画面から新しいバージョンを作成してください。
          発行済みの見積は顧客が保持している文書であり、後から書き換わってはなりません。
        </Alert>
      </>
    );
  }

  const items: LineRow[] = quotation.items.map((item) => ({
    category: item.category,
    name: item.name,
    description: item.description ?? '',
    quantity: String(item.quantity),
    unit: item.unit,
    unitPriceJpy: String(item.unitPriceJpy),
  }));

  return (
    <>
      <PageHeader title="見積を編集" subtitle={quotation.title} />
      <QuotationForm
        action={updateQuotationAction}
        projectId={id}
        quotationId={quotationId}
        simulationId={quotation.simulationId ?? undefined}
        submitLabel="更新する"
        defaults={{
          title: quotation.title,
          validUntil: quotation.validUntil?.toISOString().slice(0, 10) ?? '',
          discountJpy: String(quotation.discountJpy),
          subsidyJpy: String(quotation.subsidyJpy),
          taxRate: String(quotation.taxRate),
          notes: quotation.notes ?? '',
          items,
        }}
      />
    </>
  );
}
