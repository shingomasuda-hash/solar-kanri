'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Select } from '@/components/ui';
import { changeStatusAction, type FormState } from '../actions';

function AutoSubmit({
  currentStatusId,
  statuses,
}: {
  currentStatusId: string;
  statuses: { id: string; label: string }[];
}) {
  const { pending } = useFormStatus();
  return (
    <Select
      name="statusId"
      defaultValue={currentStatusId}
      disabled={pending}
      aria-label="ステータスを変更"
      // Changing the select submits immediately: an extra "save" click on a
      // one-field form is friction operators hit dozens of times a day.
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
    >
      {statuses.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
    </Select>
  );
}

export function StatusChanger({
  projectId,
  currentStatusId,
  statuses,
}: {
  projectId: string;
  currentStatusId: string;
  statuses: { id: string; label: string }[];
}) {
  const [state, action] = useActionState<FormState, FormData>(changeStatusAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <AutoSubmit currentStatusId={currentStatusId} statuses={statuses} />
      {state.error && <Alert tone="danger">{state.error}</Alert>}
    </form>
  );
}
