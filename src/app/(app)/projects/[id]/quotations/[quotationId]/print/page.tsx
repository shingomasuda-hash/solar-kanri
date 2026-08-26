import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';
import { prisma } from '@/server/db/client';
import { getQuotation } from '@/server/services/quotations';
import { PrintButton } from './print-button';
import './print.css';

/**
 * Print-optimised quotation document.
 *
 * Rendered as HTML rather than generated as a PDF server-side: see
 * docs/adr/ADR-007-quotation-pdf.md. In short, a PDF library needs an embedded
 * CJK font, and printing from the browser gets correct Japanese typography from
 * the viewer's own fonts with no bundled asset and no licence surface. Every
 * browser's print dialog offers "Save as PDF".
 *
 * Everything on this page comes from STORED figures. Nothing is recomputed, so
 * a document a customer already holds cannot change because a coefficient was
 * edited afterwards.
 */

const jpy = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });

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
  specificYieldKWhPerKw?: number;
  annualCo2AvoidedKg?: number;
  firstYearBenefitJpy?: number;
  lifetimeNetJpy?: number;
  paybackYears?: number | null;
  solarEngineVersion?: string;
  economicsEngineVersion?: string;
  layoutEngineVersion?: string;
}

async function companySettings(): Promise<Record<string, string>> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { startsWith: 'company.' } },
  });
  return Object.fromEntries(
    rows.map((r) => [r.key.replace('company.', ''), String(r.value ?? '')]),
  );
}

export default async function QuotationPrintPage({
  params,
}: {
  params: Promise<{ quotationId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const { quotationId } = await params;

  const quotation = await getQuotation(user, quotationId);
  if (!quotation) notFound();

  const company = await companySettings();
  const snapshot = (quotation.simulationSnapshot ?? {}) as SimulationSnapshot;
  const netCost = quotation.totalJpy - quotation.subsidyJpy;
  const issued = quotation.issuedAt ?? quotation.createdAt;

  return (
    <div className="print-document">
      <div className="print-toolbar">
        <PrintButton />
        <p>
          ブラウザの印刷ダイアログから「PDFとして保存」を選ぶと PDF になります。
          用紙サイズと余白もそこで指定できます。
        </p>
      </div>

      <article className="print-sheet">
        <header className="print-header">
          <h1>御見積書</h1>
          <dl className="print-meta">
            <div>
              <dt>見積番号</dt>
              <dd>
                {quotation.project.code}-{String(quotation.version).padStart(2, '0')}
              </dd>
            </div>
            <div>
              <dt>発行日</dt>
              <dd>{issued.toLocaleDateString('ja-JP')}</dd>
            </div>
            {quotation.validUntil && (
              <div>
                <dt>有効期限</dt>
                <dd>{quotation.validUntil.toLocaleDateString('ja-JP')}</dd>
              </div>
            )}
          </dl>
        </header>

        <section className="print-parties">
          <div className="print-customer">
            <p className="print-customer-name">
              {quotation.project.customer.companyName || quotation.project.customer.name}
              <span className="print-honorific">
                {quotation.project.customer.companyName ? ' 御中' : ' 様'}
              </span>
            </p>
            <p className="print-address">
              {[
                quotation.project.customer.postalCode &&
                  `〒${quotation.project.customer.postalCode}`,
                quotation.project.customer.prefecture,
                quotation.project.customer.city,
                quotation.project.customer.addressLine,
              ]
                .filter(Boolean)
                .join(' ')}
            </p>
            <p className="print-subject">件名：{quotation.title}</p>
          </div>

          <div className="print-supplier">
            <p className="print-company">
              {company.name || '（会社名を管理画面で設定してください）'}
            </p>
            {company.address && <p>{company.address}</p>}
            {company.phone && <p>TEL {company.phone}</p>}
            {quotation.project.owner && <p>担当：{quotation.project.owner.name}</p>}
          </div>
        </section>

        <section className="print-total-banner">
          <span>御見積金額（税込）</span>
          <strong>{jpy.format(quotation.totalJpy)} 円</strong>
        </section>

        <table className="print-items">
          <thead>
            <tr>
              <th>区分</th>
              <th>品名・仕様</th>
              <th className="num">数量</th>
              <th className="num">単価</th>
              <th className="num">金額</th>
            </tr>
          </thead>
          <tbody>
            {quotation.items.map((item) => (
              <tr key={item.id}>
                <td>{CATEGORY_LABELS[item.category] ?? item.category}</td>
                <td>
                  {item.name}
                  {item.description && <div className="print-item-note">{item.description}</div>}
                </td>
                <td className="num">
                  {item.quantity} {item.unit}
                </td>
                <td className="num">{jpy.format(item.unitPriceJpy)}</td>
                <td className="num">{jpy.format(item.amountJpy)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={4}>小計</th>
              <td className="num">{jpy.format(quotation.subtotalJpy)}</td>
            </tr>
            {quotation.discountJpy > 0 && (
              <tr>
                <th colSpan={4}>値引き</th>
                <td className="num">-{jpy.format(quotation.discountJpy)}</td>
              </tr>
            )}
            <tr>
              <th colSpan={4}>消費税（{(quotation.taxRate * 100).toFixed(0)}%）</th>
              <td className="num">{jpy.format(quotation.taxJpy)}</td>
            </tr>
            <tr className="print-grand-total">
              <th colSpan={4}>合計（税込）</th>
              <td className="num">{jpy.format(quotation.totalJpy)}</td>
            </tr>
            {quotation.subsidyJpy > 0 && (
              <>
                <tr>
                  <th colSpan={4}>補助金</th>
                  <td className="num">-{jpy.format(quotation.subsidyJpy)}</td>
                </tr>
                <tr className="print-grand-total">
                  <th colSpan={4}>実質御負担額</th>
                  <td className="num">{jpy.format(netCost)}</td>
                </tr>
              </>
            )}
          </tfoot>
        </table>

        {snapshot.installedW !== undefined && (
          <section className="print-simulation">
            <h2>システム概要と発電シミュレーション</h2>
            <dl>
              <div>
                <dt>設置容量</dt>
                <dd>{(snapshot.installedW / 1000).toFixed(2)} kW</dd>
              </div>
              <div>
                <dt>モジュール枚数</dt>
                <dd>{snapshot.panelCount} 枚</dd>
              </div>
              <div>
                <dt>年間推定発電量</dt>
                <dd>{jpy.format(Math.round(snapshot.annualGenerationKWh ?? 0))} kWh</dd>
              </div>
              <div>
                <dt>kW あたり発電量</dt>
                <dd>{jpy.format(Math.round(snapshot.specificYieldKWhPerKw ?? 0))} kWh/kW</dd>
              </div>
              <div>
                <dt>初年度経済効果</dt>
                <dd>{jpy.format(snapshot.firstYearBenefitJpy ?? 0)} 円</dd>
              </div>
              <div>
                <dt>投資回収年数</dt>
                <dd>{snapshot.paybackYears ? `${snapshot.paybackYears.toFixed(1)} 年` : '—'}</dd>
              </div>
              <div>
                <dt>年間 CO₂ 削減量</dt>
                <dd>{jpy.format(Math.round(snapshot.annualCo2AvoidedKg ?? 0))} kg</dd>
              </div>
            </dl>
            <p className="print-disclaimer">
              発電量は推定値であり、実際の発電量は天候・設置条件・使用状況により変動します。
              経済効果は本見積作成時点の電力単価および想定条件に基づく試算です。
            </p>
          </section>
        )}

        {quotation.notes && (
          <section className="print-notes">
            <h2>備考</h2>
            <p>{quotation.notes}</p>
          </section>
        )}

        <footer className="print-footer">
          {/*
            Engine versions are printed so any figure above can be traced back
            to the exact model that produced it, years later.
          */}
          <p>
            算定エンジン: {snapshot.layoutEngineVersion ?? '—'} /{' '}
            {snapshot.solarEngineVersion ?? '—'} / {snapshot.economicsEngineVersion ?? '—'}
          </p>
          <p>
            {quotation.project.code} v{quotation.version} ·{' '}
            {quotation.status === 'DRAFT' ? '下書き（未発行）' : '発行済'}
          </p>
        </footer>
      </article>
    </div>
  );
}
