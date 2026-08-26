'use client';

import { useActionState, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button, Card, CardTitle, Input, Select } from '@/components/ui';
import { addTaskAction, toggleTaskAction, type FormState } from '../actions';

export interface TaskView {
  id: string;
  title: string;
  dueAt: string | null;
  completedAt: string | null;
  assigneeName: string | null;
}

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending} className="shrink-0">
      タスクを追加
    </Button>
  );
}

export function TaskPanel({
  projectId,
  tasks,
  users,
  canWrite,
}: {
  projectId: string;
  tasks: TaskView[];
  users: { id: string; name: string }[];
  canWrite: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, addAction] = useActionState<FormState, FormData>(async (prev, formData) => {
    const result = await addTaskAction(prev, formData);
    if (!result.error) formRef.current?.reset();
    return result;
  }, {});
  const [toggleState, toggleAction] = useActionState<FormState, FormData>(toggleTaskAction, {});

  const open = tasks.filter((t) => !t.completedAt);
  const done = tasks.filter((t) => t.completedAt);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Card>
      <CardTitle>タスク</CardTitle>
      {(state.error || toggleState.error) && (
        <Alert tone="danger">{state.error ?? toggleState.error}</Alert>
      )}

      {canWrite && (
        <form ref={formRef} action={addAction} className="mb-4 flex flex-col gap-2">
          <input type="hidden" name="projectId" value={projectId} />
          <div className="flex gap-2">
            <Input name="title" placeholder="タスクを追加" required aria-label="タスク名" />
            <AddButton />
          </div>
          <div className="flex gap-2">
            <Input
              name="dueAt"
              type="date"
              defaultValue={today}
              aria-label="期限"
              className="max-w-40"
            />
            <Select name="assigneeId" aria-label="担当者" defaultValue="">
              <option value="">（自分）</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>
        </form>
      )}

      {tasks.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">タスクはありません。</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm">
          {[...open, ...done].map((t) => {
            const overdue = !t.completedAt && t.dueAt && new Date(t.dueAt) < new Date(today);
            return (
              <li key={t.id} className="flex items-center gap-2">
                {canWrite ? (
                  <form action={toggleAction} className="flex items-center">
                    <input type="hidden" name="projectId" value={projectId} />
                    <input type="hidden" name="taskId" value={t.id} />
                    <button
                      type="submit"
                      aria-label={
                        t.completedAt ? `${t.title} を未完了に戻す` : `${t.title} を完了にする`
                      }
                      className="grid size-4 place-items-center rounded border border-[var(--border)] text-[10px]"
                    >
                      {t.completedAt ? '✓' : ''}
                    </button>
                  </form>
                ) : (
                  <span aria-hidden className="size-4 rounded border border-[var(--border)]" />
                )}
                <span className={t.completedAt ? 'text-[var(--text-muted)] line-through' : ''}>
                  {t.title}
                </span>
                {t.dueAt && !t.completedAt && (
                  <time
                    dateTime={t.dueAt}
                    className={`ml-auto text-xs tabular-nums ${
                      overdue ? 'font-medium text-red-600' : 'text-[var(--text-muted)]'
                    }`}
                  >
                    {new Date(t.dueAt).toLocaleDateString('ja-JP')}
                  </time>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
