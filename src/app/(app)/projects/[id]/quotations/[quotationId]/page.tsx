import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';
import { can } from '@/server/auth/rbac';
import { getQuotation } from '@/server/services/quotations';
import {
  Alert,
  Badge,
  Card,
  CardTitle,
  DemoFiguresNotice,
  LinkButton,
  PageHeader,
  Stat,
} from '@/components/ui';
import { QuotationActions } from './quotation-actions';

const jpy = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: '下書き', color: '#64748b' },
  ISSUED: { label: '発行済', color: '#0284c7' },
  ACCEPTED: { label: '受注', color: '#16a34a' },
  REJECTED: { label: '失注', color: '#dc2626' },
  EXPIRED: { label: '期限切れ', color: '#a16207' },
};

const CATEGORY_LABELS: Record<string, string> = {
  PANEL: '太陽電池モジュール',
  INVERTER: 'パワーコンディショナ',
  MOUNTING: '架台',
  CONSTRUCTION: '設置工事',
  ELECTRICAL: '電気工事',
  BATTERY: '蓄電池',
  OTHER: 'その他',
};

interface SimulationSnapshot {
  installedW?: number;
  panelCount?: number;
  annualGenerationKWh?: number;
  firstYearBenefitJpy?: number;
  paybackYears?: number | null;
  annualCo2AvoidedKg?: number;
}

export default async function QuotationDetailPage({
  params,
}: {
  params: Promise<{ id: string; quotationId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const { id, quotationId } = await params;

  const quotation = await getQuotation(user, quotationId);
  if (!quotation) notFound();

  const status = STATUS_LABELS[quotation.status] ?? { label: quotation.status, color: '#64748b' };
  const snapshot = (quotation.simulationSnapshot ?? {}) as SimulationSnapshot;
  const netCost = quotation.totalJpy - quotation.subsidyJpy;

  return (
    <>
      <PageHeader
        title={quotation.title}
        subtitle={
          <>
            <span>v{quotation.version}</span>
            <Link href={`/projects/${id}`} className="ml-3 hover:underline">
              {quotation.project.title}
            </Link>
          </>
        }
        actions={
          <>
            <LinkButton
              href={`/projects/${id}/quotations/${quotationId}/print`}
              variant="secondary"
              target="_blank"
            >
              印刷 / PDF
            </LinkButton>
            {quotation.status === 'DRAFT' && can(user, 'quotation:write') && (
              <LinkButton
                href={`/projects/${id}/quotations/${quotationId}/edit`}
                variant="secondary"
              >
                編集
              </LinkButton>
            )}
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Badge colorHex={status.color}>{status.label}</Badge>
        {quotation.issuedAt && (
          <span className="text-sm text-[var(--text-muted)]">
            発行 {quotation.issuedAt.toLocaleDateString('ja-JP')}
          </span>
        )}
        {quotation.validUntil && (
          <span className="text-sm text-[var(--text-muted)]">
            有効期限 {quotation.validUntil.toLocaleDateString('ja-JP')}
          </span>
        )}
      </div>

      {quotation.simulation?.isDemo && (
        <div className="mb-4">
          <DemoFiguresNotice
            fields={
              Array.isArray(quotation.simulation.demoFields)
                ? (quotation.simulation.demoFields as string[])
                : []
            }
          />
        </div>
      )}

      {quotation.status !== 'DRAFT' && (
        <Alert tone="info" title="この見積は確定しています">
          発行済みの見積は変更できません。内容を修正する場合は新しいバージョンを作成してください。
          記載されている発電量・経済効果は発行時点の値で固定されており、
          その後にシミュレーションや係数を変更しても書き換わりません。
        </Alert>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-2">
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                <tr>
                  <th className="px-4 py-3 font-medium">区分</th>
                  <th className="px-4 py-3 font-medium">品名</th>
                  <th className="px-4 py-3 text-right font-medium">数量</th>
                  <th className="px-4 py-3 text-right font-medium">単価</th>
                  <th className="px-4 py-3 text-right font-medium">金額</th>
                </tr>
              </thead>
              <tbody>
                {quotation.items.map((item) => (
                  <tr key={item.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-4 py-3 text-xs">
                      {CATEGORY_LABELS[item.category] ?? item.category}
                    </td>
                    <td className="px-4 py-3">
                      {item.name}
                      {item.description && (
                        <p className="text-xs text-[var(--text-muted)]">{item.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {item.quantity} {item.unit}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {jpy.format(item.unitPriceJpy)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {jpy.format(item.amountJpy)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {quotation.notes && (
            <Card>
              <CardTitle>備考</CardTitle>
              <p className="text-sm whitespace-pre-wrap">{quotation.notes}</p>
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardTitle>金額</CardTitle>
            <dl className="flex flex-col gap-2 text-sm" data-testid="quotation-totals">
              <Row label="小計" value={quotation.subtotalJpy} />
              {quotation.discountJpy > 0 && <Row label="値引き" value={-quotation.discountJpy} />}
              <Row
                label={`消費税 (${(quotation.taxRate * 100).toFixed(0)}%)`}
                value={quotation.taxJpy}
              />
              <Row label="税込合計" value={quotation.totalJpy} strong />
              {quotation.subsidyJpy > 0 && (
                <>
                  <Row label="補助金" value={-quotation.subsidyJpy} />
                  <Row label="実質負担額" value={netCost} strong />
                </>
              )}
            </dl>
          </Card>

          {snapshot.installedW !== undefined && (
            <Card>
              <CardTitle>シミュレーション（発行時点で固定）</CardTitle>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="設置容量" value={(snapshot.installedW / 1000).toFixed(2)} unit="kW" />
                <Stat label="パネル" value={snapshot.panelCount ?? '—'} unit="枚" />
                <Stat
                  label="年間発電量"
                  value={jpy.format(Math.round(snapshot.annualGenerationKWh ?? 0))}
                  unit="kWh"
                />
                <Stat
                  label="投資回収"
                  value={snapshot.paybackYears ? snapshot.paybackYears.toFixed(1) : '—'}
                  unit="年"
                />
              </div>
            </Card>
          )}

          {can(user, 'quotation:issue') && (
            <Card>
              <CardTitle>操作</CardTitle>
              <QuotationActions
                projectId={id}
                quotationId={quotationId}
                status={quotation.status}
              />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'font-semibold' : ''}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{jpy.format(value)} 円</dd>
    </div>
  );
}
