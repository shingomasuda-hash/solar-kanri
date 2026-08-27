'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Badge, Button, Card, CardTitle, Field, Input, Select } from '@/components/ui';
import { setDefaultTariffAction, upsertTariffAction, type FormState } from '../actions';
import { SOURCE_KINDS } from '../coefficients/coefficient-row';

export interface TariffView {
  id: string;
  key: string;
  name: string;
  purchasePriceJpyPerKWh: number;
  exportPriceJpyPerKWh: number;
  exportPriceYears: number;
  postExportPriceJpyPerKWh: number;
  annualPriceEscalation: number;
  monthlyBasicChargeJpy: number;
  defaultSelfConsumptionRatio: number;
  sourceKind: string;
  sourceCitation: string;
  isDefault: boolean;
}

function Save({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? '保存中…' : label}
    </Button>
  );
}

export function TariffEditor({ tariffs, canWrite }: { tariffs: TariffView[]; canWrite: boolean }) {
  const [editing, setEditing] = useState<TariffView | null>(tariffs[0] ?? null);
  const [state, action] = useActionState<FormState, FormData>(upsertTariffAction, {});
  const [defaultState, setDefault] = useActionState<FormState, FormData>(
    setDefaultTariffAction,
    {},
  );

  return (
    <div className="flex flex-col gap-5">
      <ul className="flex flex-wrap gap-2">
        {tariffs.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => setEditing(t)}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                editing?.id === t.id ? 'border-brand-500' : 'border-[var(--border)]'
              }`}
              data-testid={`tariff-${t.key}`}
              data-verified={t.sourceKind === 'UNVERIFIED_PLACEHOLDER' ? 'false' : 'true'}
            >
              {t.name}
              {t.isDefault && <span className="ml-1 text-xs">（既定）</span>}
              {t.sourceKind === 'UNVERIFIED_PLACEHOLDER' && (
                <Badge className="ml-2 bg-red-500/10 text-red-700">出典未確認</Badge>
              )}
              {t.sourceKind === 'DEMO_APPROXIMATION' && (
                <Badge className="ml-2 bg-amber-500/15 text-amber-700">デモ用・提示不可</Badge>
              )}
            </button>
          </li>
        ))}
        {canWrite && (
          <li>
            <Button variant="secondary" className="text-xs" onClick={() => setEditing(null)}>
              新規追加
            </Button>
          </li>
        )}
      </ul>

      {canWrite && editing && !editing.isDefault && (
        <form action={setDefault} className="flex items-center gap-3">
          <input type="hidden" name="id" value={editing.id} />
          <Button type="submit" variant="secondary" className="text-xs">
            「{editing.name}」を既定にする
          </Button>
          {defaultState.error && <Alert tone="danger">{defaultState.error}</Alert>}
        </form>
      )}

      {canWrite && (
        <Card>
          <CardTitle>{editing ? `${editing.name} を編集` : '電力単価を追加'}</CardTitle>
          <form action={action} className="flex flex-col gap-4" key={editing?.id ?? 'new'}>
            {state.error && <Alert tone="danger">{state.error}</Alert>}
            {editing && <input type="hidden" name="id" value={editing.id} />}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="キー" htmlFor="key" required hint="英数字の識別子（例: default）">
                <Input id="key" name="key" defaultValue={editing?.key ?? ''} required />
              </Field>
              <Field label="名称" htmlFor="name" required>
                <Input id="name" name="name" defaultValue={editing?.name ?? ''} required />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="買電単価 (円/kWh)" htmlFor="purchasePriceJpyPerKWh" required>
                <Input
                  id="purchasePriceJpyPerKWh"
                  name="purchasePriceJpyPerKWh"
                  inputMode="decimal"
                  defaultValue={editing?.purchasePriceJpyPerKWh ?? ''}
                  required
                />
              </Field>
              <Field label="売電単価 (円/kWh)" htmlFor="exportPriceJpyPerKWh" required>
                <Input
                  id="exportPriceJpyPerKWh"
                  name="exportPriceJpyPerKWh"
                  inputMode="decimal"
                  defaultValue={editing?.exportPriceJpyPerKWh ?? ''}
                  required
                />
              </Field>
              <Field label="売電期間 (年)" htmlFor="exportPriceYears" required>
                <Input
                  id="exportPriceYears"
                  name="exportPriceYears"
                  inputMode="numeric"
                  defaultValue={editing?.exportPriceYears ?? ''}
                  required
                />
              </Field>
              <Field label="期間後売電単価 (円/kWh)" htmlFor="postExportPriceJpyPerKWh" required>
                <Input
                  id="postExportPriceJpyPerKWh"
                  name="postExportPriceJpyPerKWh"
                  inputMode="decimal"
                  defaultValue={editing?.postExportPriceJpyPerKWh ?? ''}
                  required
                />
              </Field>
              <Field
                label="電気代上昇率"
                htmlFor="annualPriceEscalation"
                required
                hint="年2% → 0.02、想定しない場合は 0"
              >
                <Input
                  id="annualPriceEscalation"
                  name="annualPriceEscalation"
                  inputMode="decimal"
                  defaultValue={editing?.annualPriceEscalation ?? '0'}
                  required
                />
              </Field>
              <Field label="基本料金 (円/月)" htmlFor="monthlyBasicChargeJpy" required>
                <Input
                  id="monthlyBasicChargeJpy"
                  name="monthlyBasicChargeJpy"
                  inputMode="numeric"
                  defaultValue={editing?.monthlyBasicChargeJpy ?? '0'}
                  required
                />
              </Field>
            </div>

            <Field
              label="既定の自家消費率"
              htmlFor="defaultSelfConsumptionRatio"
              required
              hint="30% → 0.3"
            >
              <Input
                id="defaultSelfConsumptionRatio"
                name="defaultSelfConsumptionRatio"
                inputMode="decimal"
                defaultValue={editing?.defaultSelfConsumptionRatio ?? '0.3'}
                required
              />
            </Field>

            <Field label="出典の種類" htmlFor="sourceKind" required>
              <Select
                id="sourceKind"
                name="sourceKind"
                defaultValue={editing?.sourceKind ?? 'ADMINISTRATOR_INPUT'}
              >
                {SOURCE_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="出典"
              htmlFor="sourceCitation"
              required
              hint="料金プラン名・制度名・年度など"
            >
              <Input
                id="sourceCitation"
                name="sourceCitation"
                defaultValue={editing?.sourceCitation ?? ''}
                required
              />
            </Field>
            <Field label="出典URL" htmlFor="sourceUrl">
              <Input id="sourceUrl" name="sourceUrl" type="url" />
            </Field>

            <div>
              <Save label={editing ? '更新する' : '追加する'} />
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
