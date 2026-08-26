'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button } from '@/components/ui';
import { issueQuotationAction, setQuotationStatusAction, type FormState } from '../actions';

function Submit({
  label,
  variant = 'primary',
}: {
  label: string;
  variant?: 'primary' | 'secondary';
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} className="w-full">
      {pending ? '処理中…' : label}
    </Button>
  );
}

export function QuotationActions({
  projectId,
  quotationId,
  status,
}: {
  projectId: string;
  quotationId: string;
  status: string;
}) {
  const [issueState, issue] = useActionState<FormState, FormData>(issueQuotationAction, {});
  const [statusState, setStatus] = useActionState<FormState, FormData>(
    setQuotationStatusAction,
    {},
  );
  const error = issueState.error ?? statusState.error;

  return (
    <div className="flex flex-col gap-2">
      {error && <Alert tone="danger">{error}</Alert>}

      {status === 'DRAFT' && (
        <form action={issue}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="id" value={quotationId} />
          <Submit label="この内容で発行する" />
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            発行すると内容は変更できなくなります。
          </p>
        </form>
      )}

      {status === 'ISSUED' && (
        <>
          {(['ACCEPTED', 'REJECTED', 'EXPIRED'] as const).map((next) => (
            <form key={next} action={setStatus}>
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="id" value={quotationId} />
              <input type="hidden" name="status" value={next} />
              <Submit
                variant="secondary"
                label={
                  next === 'ACCEPTED'
                    ? '受注にする'
                    : next === 'REJECTED'
                      ? '失注にする'
                      : '期限切れにする'
                }
              />
            </form>
          ))}
        </>
      )}

      {status !== 'DRAFT' && status !== 'ISSUED' && (
        <p className="text-sm text-[var(--text-muted)]">この見積は完了しています。</p>
      )}
    </div>
  );
}
