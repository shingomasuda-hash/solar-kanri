'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button, Card, Field, Input, Select, Textarea } from '@/components/ui';
import type { FormState } from './actions';

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

function toDateInput(d: Date | null | undefined): string {
  if (!d) return '';
  return d.toISOString().slice(0, 10);
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? '保存中…' : label}
    </Button>
  );
}

export function ProjectForm({
  action,
  defaults = {},
  customers,
  statuses,
  owners,
  submitLabel = '保存',
}: {
  action: Action;
  defaults?: {
    id?: string;
    title?: string;
    customerId?: string;
    propertyId?: string | null;
    statusId?: string;
    ownerId?: string | null;
    expectedCloseDate?: Date | null;
    nextActionAt?: Date | null;
    nextActionNote?: string | null;
  };
  customers: { id: string; name: string; code: string }[];
  statuses: { id: string; label: string }[];
  owners: { id: string; name: string }[];
  submitLabel?: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const err = (field: string) => state.fieldErrors?.[field];

  return (
    <Card>
      <form action={formAction} className="flex flex-col gap-5">
        {state.error && <Alert tone="danger">{state.error}</Alert>}
        {defaults.id && <input type="hidden" name="id" value={defaults.id} />}

        <Field label="案件名" htmlFor="title" required error={err('title')}>
          <Input
            id="title"
            name="title"
            defaultValue={defaults.title ?? ''}
            placeholder="例）〇〇様邸 太陽光発電システム"
            required
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="顧客" htmlFor="customerId" required error={err('customerId')}>
            <Select
              id="customerId"
              name="customerId"
              defaultValue={defaults.customerId ?? ''}
              required
            >
              <option value="">選択してください</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}（{c.code}）
                </option>
              ))}
            </Select>
          </Field>
          <Field label="ステータス" htmlFor="statusId" required error={err('statusId')}>
            <Select id="statusId" name="statusId" defaultValue={defaults.statusId ?? ''} required>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="担当者" htmlFor="ownerId" hint="未選択の場合は自分が担当になります">
            <Select id="ownerId" name="ownerId" defaultValue={defaults.ownerId ?? ''}>
              <option value="">（自分）</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="受注予定日" htmlFor="expectedCloseDate">
            <Input
              id="expectedCloseDate"
              name="expectedCloseDate"
              type="date"
              defaultValue={toDateInput(defaults.expectedCloseDate)}
            />
          </Field>
          <Field label="次アクション予定日" htmlFor="nextActionAt">
            <Input
              id="nextActionAt"
              name="nextActionAt"
              type="date"
              defaultValue={toDateInput(defaults.nextActionAt)}
            />
          </Field>
        </div>

        <Field label="次アクション内容" htmlFor="nextActionNote">
          <Textarea
            id="nextActionNote"
            name="nextActionNote"
            defaultValue={defaults.nextActionNote ?? ''}
            placeholder="例）現地調査の日程調整、見積書の送付"
          />
        </Field>

        <div>
          <Submit label={submitLabel} />
        </div>
      </form>
    </Card>
  );
}
