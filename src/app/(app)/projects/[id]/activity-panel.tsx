'use client';

import { useActionState, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button, Card, CardTitle, Field, Input, Select, Textarea } from '@/components/ui';
import { addActivityAction, type FormState } from '../actions';

const KIND_LABELS: Record<string, string> = {
  CALL: '電話',
  EMAIL: 'メール',
  MEETING: '打合せ',
  SITE_VISIT: '現地調査',
  PROPOSAL: '提案',
  CONTRACT: '契約',
  CONSTRUCTION: '工事',
  OTHER: 'その他',
};

export interface ActivityView {
  id: string;
  kind: string;
  subject: string;
  body: string | null;
  occurredAt: string;
  userName: string | null;
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? '記録中…' : '記録する'}
    </Button>
  );
}

export function ActivityPanel({
  projectId,
  customerId,
  activities,
  canWrite,
}: {
  projectId: string;
  customerId: string;
  activities: ActivityView[];
  canWrite: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action] = useActionState<FormState, FormData>(async (prev, formData) => {
    const result = await addActivityAction(prev, formData);
    if (!result.error) formRef.current?.reset();
    return result;
  }, {});

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Card>
      <CardTitle>対応履歴</CardTitle>

      {canWrite && (
        <form ref={formRef} action={action} className="mb-5 flex flex-col gap-3">
          {state.error && <Alert tone="danger">{state.error}</Alert>}
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="customerId" value={customerId} />
          <div className="grid gap-3 sm:grid-cols-[9rem_1fr_10rem]">
            <Field label="種別" htmlFor="kind">
              <Select id="kind" name="kind" defaultValue="CALL">
                {Object.entries(KIND_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="件名" htmlFor="subject" required error={state.fieldErrors?.subject}>
              <Input id="subject" name="subject" required placeholder="例）初回ヒアリング" />
            </Field>
            <Field label="日付" htmlFor="occurredAt">
              <Input id="occurredAt" name="occurredAt" type="date" defaultValue={today} />
            </Field>
          </div>
          <Field label="内容" htmlFor="body">
            <Textarea id="body" name="body" rows={3} />
          </Field>
          <div>
            <Submit />
          </div>
        </form>
      )}

      {activities.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">履歴はまだありません。</p>
      ) : (
        <ol className="divide-y divide-[var(--border)]">
          {activities.map((a) => (
            <li key={a.id} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">
                  <span className="mr-2 rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-xs">
                    {KIND_LABELS[a.kind] ?? a.kind}
                  </span>
                  {a.subject}
                </p>
                <time
                  dateTime={a.occurredAt}
                  className="text-xs tabular-nums text-[var(--text-muted)]"
                >
                  {new Date(a.occurredAt).toLocaleDateString('ja-JP')}
                  {a.userName && ` · ${a.userName}`}
                </time>
              </div>
              {a.body && (
                <p className="mt-1 text-sm whitespace-pre-wrap text-[var(--text-muted)]">
                  {a.body}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
