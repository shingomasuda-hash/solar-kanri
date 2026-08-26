'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button, Card, CardTitle, Field, Input, Select, Textarea } from '@/components/ui';
import { calculateQuotation, type QuotationCategory } from '@core/quotation';
import type { FormState } from './actions';

const CATEGORY_LABELS: Record<QuotationCategory, string> = {
  PANEL: '太陽電池モジュール',
  INVERTER: 'パワーコンディショナ',
  MOUNTING: '架台',
  CONSTRUCTION: '設置工事',
  ELECTRICAL: '電気工事',
  BATTERY: '蓄電池',
  OTHER: 'その他',
};

export interface LineRow {
  category: QuotationCategory;
  name: string;
  description: string;
  quantity: string;
  unit: string;
  unitPriceJpy: string;
}

const EMPTY_ROW: LineRow = {
  category: 'OTHER',
  name: '',
  description: '',
  quantity: '1',
  unit: '式',
  unitPriceJpy: '0',
};

const jpy = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });

function Save({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? '保存中…' : label}
    </Button>
  );
}

export function QuotationForm({
  action,
  projectId,
  quotationId,
  simulationId,
  defaults,
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  projectId: string;
  quotationId?: string;
  simulationId?: string;
  defaults: {
    title: string;
    validUntil: string;
    discountJpy: string;
    subsidyJpy: string;
    taxRate: string;
    notes: string;
    items: LineRow[];
  };
  submitLabel: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const [rows, setRows] = useState<LineRow[]>(
    defaults.items.length > 0 ? defaults.items : [EMPTY_ROW],
  );
  const [discount, setDiscount] = useState(defaults.discountJpy);
  const [subsidy, setSubsidy] = useState(defaults.subsidyJpy);
  const [taxRate, setTaxRate] = useState(defaults.taxRate);

  // Live preview using the SAME engine the server will use, so what the
  // operator sees while typing is what gets stored — not a second, subtly
  // different sum written for the UI.
  let preview: ReturnType<typeof calculateQuotation> | null = null;
  let previewError: string | null = null;
  try {
    preview = calculateQuotation({
      items: rows
        .filter((r) => r.name.trim() !== '')
        .map((r) => ({
          category: r.category,
          name: r.name,
          quantity: Number(r.quantity || '0'),
          unit: r.unit || '式',
          unitPriceJpy: Math.round(Number(r.unitPriceJpy || '0')),
        })),
      discountJpy: Math.round(Number(discount || '0')),
      subsidyJpy: Math.round(Number(subsidy || '0')),
      taxRate: Number(taxRate || '0'),
    });
  } catch (err) {
    previewError = err instanceof Error ? err.message : String(err);
  }

  const update = (index: number, patch: Partial<LineRow>) =>
    setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <input type="hidden" name="projectId" value={projectId} />
      {quotationId && <input type="hidden" name="id" value={quotationId} />}
      {simulationId && <input type="hidden" name="simulationId" value={simulationId} />}

      <Card>
        <CardTitle>基本情報</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="件名" htmlFor="title" required>
            <Input id="title" name="title" defaultValue={defaults.title} required />
          </Field>
          <Field label="有効期限" htmlFor="validUntil">
            <Input
              id="validUntil"
              name="validUntil"
              type="date"
              defaultValue={defaults.validUntil}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardTitle
          action={
            <Button
              variant="secondary"
              className="text-xs"
              onClick={() => setRows([...rows, { ...EMPTY_ROW }])}
            >
              明細を追加
            </Button>
          }
        >
          明細
        </CardTitle>

        <div className="flex flex-col gap-3">
          {rows.map((row, i) => (
            <div
              key={i}
              className="grid gap-2 rounded-md border border-[var(--border)] p-3 sm:grid-cols-12"
              data-testid={`quotation-row-${i}`}
            >
              <div className="sm:col-span-3">
                <Field label="区分" htmlFor={`itemCategory-${i}`}>
                  <Select
                    id={`itemCategory-${i}`}
                    name="itemCategory"
                    value={row.category}
                    onChange={(e) => update(i, { category: e.target.value as QuotationCategory })}
                  >
                    {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="sm:col-span-5">
                <Field label="品名" htmlFor={`itemName-${i}`}>
                  <Input
                    id={`itemName-${i}`}
                    name="itemName"
                    value={row.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="数量" htmlFor={`itemQuantity-${i}`}>
                  <Input
                    id={`itemQuantity-${i}`}
                    name="itemQuantity"
                    inputMode="decimal"
                    value={row.quantity}
                    onChange={(e) => update(i, { quantity: e.target.value })}
                  />
                </Field>
              </div>
              <div className="sm:col-span-1">
                <Field label="単位" htmlFor={`itemUnit-${i}`}>
                  <Input
                    id={`itemUnit-${i}`}
                    name="itemUnit"
                    value={row.unit}
                    onChange={(e) => update(i, { unit: e.target.value })}
                  />
                </Field>
              </div>
              <div className="sm:col-span-8">
                <Field label="摘要" htmlFor={`itemDescription-${i}`}>
                  <Input
                    id={`itemDescription-${i}`}
                    name="itemDescription"
                    value={row.description}
                    onChange={(e) => update(i, { description: e.target.value })}
                  />
                </Field>
              </div>
              <div className="sm:col-span-3">
                <Field label="単価 (円)" htmlFor={`itemUnitPrice-${i}`}>
                  <Input
                    id={`itemUnitPrice-${i}`}
                    name="itemUnitPrice"
                    inputMode="numeric"
                    value={row.unitPriceJpy}
                    onChange={(e) => update(i, { unitPriceJpy: e.target.value })}
                  />
                </Field>
              </div>
              <div className="flex items-end justify-between gap-2 sm:col-span-1">
                <span className="text-xs tabular-nums text-[var(--text-muted)]">
                  {jpy.format(
                    Math.round(Number(row.quantity || '0') * Number(row.unitPriceJpy || '0')),
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  className="pb-2 text-xs text-red-600 hover:underline"
                  aria-label={`${i + 1} 行目を削除`}
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle>金額</CardTitle>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="値引き (円)" htmlFor="discountJpy">
            <Input
              id="discountJpy"
              name="discountJpy"
              inputMode="numeric"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </Field>
          <Field label="補助金 (円)" htmlFor="subsidyJpy" hint="税込総額から差し引いて表示します">
            <Input
              id="subsidyJpy"
              name="subsidyJpy"
              inputMode="numeric"
              value={subsidy}
              onChange={(e) => setSubsidy(e.target.value)}
            />
          </Field>
          <Field label="消費税率" htmlFor="taxRate" hint="10% は 0.1">
            <Input
              id="taxRate"
              name="taxRate"
              inputMode="decimal"
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
            />
          </Field>
        </div>

        {previewError ? (
          <div className="mt-4">
            <Alert tone="warning">{previewError}</Alert>
          </div>
        ) : (
          preview && (
            <dl
              className="mt-4 flex flex-col gap-1 border-t border-[var(--border)] pt-4 text-sm"
              data-testid="quotation-preview"
              data-total={preview.totalJpy}
            >
              <Row label="小計" value={preview.subtotalJpy} />
              {preview.discountJpy > 0 && <Row label="値引き" value={-preview.discountJpy} />}
              <Row label="消費税" value={preview.taxJpy} />
              <Row label="税込合計" value={preview.totalJpy} strong />
              {preview.subsidyJpy > 0 && (
                <>
                  <Row label="補助金" value={-preview.subsidyJpy} />
                  <Row label="実質負担額" value={preview.netCostJpy} strong />
                </>
              )}
            </dl>
          )
        )}
      </Card>

      <Card>
        <CardTitle>備考</CardTitle>
        <Textarea name="notes" rows={4} defaultValue={defaults.notes} aria-label="備考" />
      </Card>

      <div>
        <Save label={submitLabel} />
      </div>
    </form>
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
