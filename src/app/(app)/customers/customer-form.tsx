'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button, Card, Field, Input, Select, Textarea } from '@/components/ui';
import type { FormState } from './actions';

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export interface CustomerDefaults {
  id?: string;
  type?: string;
  name?: string;
  nameKana?: string | null;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  postalCode?: string | null;
  prefecture?: string | null;
  city?: string | null;
  addressLine?: string | null;
  source?: string | null;
  notes?: string | null;
  ownerId?: string | null;
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? '保存中…' : label}
    </Button>
  );
}

export function CustomerForm({
  action,
  defaults = {},
  owners,
  submitLabel = '保存',
}: {
  action: Action;
  defaults?: CustomerDefaults;
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

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="区分" htmlFor="type" required>
            <Select id="type" name="type" defaultValue={defaults.type ?? 'INDIVIDUAL'}>
              <option value="INDIVIDUAL">個人</option>
              <option value="CORPORATE">法人</option>
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
          <Field label="氏名" htmlFor="name" required error={err('name')}>
            <Input id="name" name="name" defaultValue={defaults.name ?? ''} required />
          </Field>
          <Field label="フリガナ" htmlFor="nameKana" error={err('nameKana')}>
            <Input id="nameKana" name="nameKana" defaultValue={defaults.nameKana ?? ''} />
          </Field>
          <Field label="会社名" htmlFor="companyName" error={err('companyName')}>
            <Input id="companyName" name="companyName" defaultValue={defaults.companyName ?? ''} />
          </Field>
          <Field label="流入経路" htmlFor="source" hint="Web / 紹介 / 展示会 など">
            <Input id="source" name="source" defaultValue={defaults.source ?? ''} />
          </Field>
          <Field label="メールアドレス" htmlFor="email" error={err('email')}>
            <Input id="email" name="email" type="email" defaultValue={defaults.email ?? ''} />
          </Field>
          <Field label="電話番号" htmlFor="phone" error={err('phone')}>
            <Input id="phone" name="phone" type="tel" defaultValue={defaults.phone ?? ''} />
          </Field>
        </div>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-medium">住所</legend>
          <Field label="郵便番号" htmlFor="postalCode" hint="123-4567" error={err('postalCode')}>
            <Input
              id="postalCode"
              name="postalCode"
              inputMode="numeric"
              defaultValue={defaults.postalCode ?? ''}
            />
          </Field>
          <Field label="都道府県" htmlFor="prefecture" error={err('prefecture')}>
            <Input id="prefecture" name="prefecture" defaultValue={defaults.prefecture ?? ''} />
          </Field>
          <Field label="市区町村" htmlFor="city" error={err('city')}>
            <Input id="city" name="city" defaultValue={defaults.city ?? ''} />
          </Field>
          <Field label="番地・建物名" htmlFor="addressLine" error={err('addressLine')}>
            <Input id="addressLine" name="addressLine" defaultValue={defaults.addressLine ?? ''} />
          </Field>
        </fieldset>

        <Field label="メモ" htmlFor="notes">
          <Textarea id="notes" name="notes" defaultValue={defaults.notes ?? ''} />
        </Field>

        <div className="flex gap-2">
          <Submit label={submitLabel} />
        </div>
      </form>
    </Card>
  );
}
