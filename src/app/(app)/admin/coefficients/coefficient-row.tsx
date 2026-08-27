'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Badge, Button, Field, Input, Select, Textarea } from '@/components/ui';
import { updateCoefficientAction, type FormState } from '../actions';

export const SOURCE_KINDS = [
  { value: 'MANUFACTURER_DATASHEET', label: 'メーカーデータシート' },
  { value: 'OFFICIAL_STANDARD', label: '公的規格・ガイドライン' },
  { value: 'PUBLIC_DATASET', label: '公的データセット' },
  { value: 'PROVIDER_API', label: '外部API' },
  { value: 'ADMINISTRATOR_INPUT', label: '管理者による決定' },
  // Listed so an existing demo value survives a round trip through this form.
  // Saving one deliberately makes no sense, but silently rewriting its kind
  // because the option was missing would be worse.
  { value: 'DEMO_APPROXIMATION', label: 'デモ用の概算（提示不可）' },
  { value: 'UNVERIFIED_PLACEHOLDER', label: '未確認（プレースホルダ）' },
] as const;

export interface CoefficientView {
  id: string;
  key: string;
  label: string;
  value: number;
  unit: string | null;
  sourceKind: string;
  sourceCitation: string;
  sourceUrl: string | null;
  note: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
}

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? '保存中…' : '保存'}
    </Button>
  );
}

export function CoefficientRow({
  coefficient,
  editable,
}: {
  coefficient: CoefficientView;
  editable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<FormState, FormData>(updateCoefficientAction, {});
  const unverified = coefficient.sourceKind === 'UNVERIFIED_PLACEHOLDER';

  return (
    <li
      className={`rounded-md border p-3 ${
        unverified ? 'border-red-500/50 bg-red-500/5' : 'border-[var(--border)]'
      }`}
      data-testid={`coefficient-${coefficient.key}`}
      data-verified={unverified ? 'false' : 'true'}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">
            {coefficient.label}{' '}
            <code className="text-xs text-[var(--text-muted)]">{coefficient.key}</code>
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            <span className="tabular-nums">{coefficient.value}</span>
            {coefficient.unit && ` ${coefficient.unit}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unverified ? (
            <Badge className="bg-red-500/10 text-red-700">出典未確認</Badge>
          ) : (
            <Badge className="bg-emerald-500/10 text-emerald-700">出典あり</Badge>
          )}
          {editable && (
            <Button variant="secondary" className="text-xs" onClick={() => setOpen(!open)}>
              {open ? '閉じる' : '編集'}
            </Button>
          )}
        </div>
      </div>

      <p className="mt-1 text-xs text-[var(--text-muted)]">
        出典: {coefficient.sourceCitation}
        {coefficient.verifiedBy && ` · 確認者 ${coefficient.verifiedBy}`}
      </p>

      {open && editable && (
        <form
          action={action}
          className="mt-3 flex flex-col gap-3 border-t border-[var(--border)] pt-3"
        >
          {state.error && <Alert tone="danger">{state.error}</Alert>}
          <input type="hidden" name="id" value={coefficient.id} />
          <input type="hidden" name="key" value={coefficient.key} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="表示名" htmlFor={`label-${coefficient.id}`} required>
              <Input
                id={`label-${coefficient.id}`}
                name="label"
                defaultValue={coefficient.label}
                required
              />
            </Field>
            <Field label="値" htmlFor={`value-${coefficient.id}`} required>
              <Input
                id={`value-${coefficient.id}`}
                name="value"
                inputMode="decimal"
                defaultValue={coefficient.value}
                required
              />
            </Field>
            <Field label="単位" htmlFor={`unit-${coefficient.id}`}>
              <Input
                id={`unit-${coefficient.id}`}
                name="unit"
                defaultValue={coefficient.unit ?? ''}
              />
            </Field>
          </div>
          <Field label="出典の種類" htmlFor={`kind-${coefficient.id}`} required>
            <Select
              id={`kind-${coefficient.id}`}
              name="sourceKind"
              defaultValue={coefficient.sourceKind}
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
            htmlFor={`citation-${coefficient.id}`}
            required
            hint="文書名・版・表番号など、第三者が検証できる形で記載してください。"
          >
            <Input
              id={`citation-${coefficient.id}`}
              name="sourceCitation"
              defaultValue={coefficient.sourceCitation}
              required
            />
          </Field>
          <Field label="出典URL" htmlFor={`url-${coefficient.id}`}>
            <Input
              id={`url-${coefficient.id}`}
              name="sourceUrl"
              type="url"
              defaultValue={coefficient.sourceUrl ?? ''}
            />
          </Field>
          <Field label="補足" htmlFor={`note-${coefficient.id}`}>
            <Textarea
              id={`note-${coefficient.id}`}
              name="note"
              rows={2}
              defaultValue={coefficient.note ?? ''}
            />
          </Field>
          <div>
            <Save />
          </div>
        </form>
      )}
    </li>
  );
}
