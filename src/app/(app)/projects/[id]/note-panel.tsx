'use client';

import { useActionState, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button, Card, CardTitle, Textarea } from '@/components/ui';
import { addNoteAction, type FormState } from '../actions';

export interface NoteView {
  id: string;
  body: string;
  createdAt: string;
  userName: string | null;
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? '保存中…' : 'メモを追加'}
    </Button>
  );
}

export function NotePanel({
  projectId,
  notes,
  canWrite,
}: {
  projectId: string;
  notes: NoteView[];
  canWrite: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action] = useActionState<FormState, FormData>(async (prev, formData) => {
    const result = await addNoteAction(prev, formData);
    if (!result.error) formRef.current?.reset();
    return result;
  }, {});

  return (
    <Card>
      <CardTitle>メモ</CardTitle>
      {canWrite && (
        <form ref={formRef} action={action} className="mb-4 flex flex-col gap-2">
          {state.error && <Alert tone="danger">{state.error}</Alert>}
          <input type="hidden" name="projectId" value={projectId} />
          <Textarea
            name="body"
            rows={3}
            required
            aria-label="メモ"
            placeholder="気づいたことを残しておく"
          />
          <div>
            <Submit />
          </div>
        </form>
      )}
      {notes.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">メモはまだありません。</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {notes.map((n) => (
            <li key={n.id} className="py-3">
              <p className="text-sm whitespace-pre-wrap">{n.body}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {new Date(n.createdAt).toLocaleString('ja-JP')}
                {n.userName && ` · ${n.userName}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
