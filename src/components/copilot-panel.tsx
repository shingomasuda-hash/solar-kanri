'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button, Card, CardTitle, Textarea } from '@/components/ui';
import { COPILOT_TASKS } from '@core/ai/prompts';
import { askCopilotAction, type CopilotState } from '@/app/(app)/projects/[id]/copilot-actions';

const KIND_LABELS: Record<string, string> = {
  MANUFACTURER_DOC: 'メーカー資料',
  DATASHEET: 'データシート',
  WARRANTY: '保証',
  FAQ: 'FAQ',
  SUBSIDY: '補助金',
  SALES_MATERIAL: '営業資料',
  CASE_STUDY: '事例',
  COMPETITOR: '競合',
  MANUAL: 'マニュアル',
};

function Ask({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? '考えています…' : label}
    </Button>
  );
}

function TaskButton({ id, label, title }: { id: string; label: string; title: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="taskId"
      value={id}
      disabled={pending}
      title={title}
      className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs transition-colors hover:bg-[var(--surface-muted)] disabled:opacity-50"
    >
      {label}
    </button>
  );
}

export function CopilotPanel({ projectId, enabled }: { projectId: string; enabled: boolean }) {
  const [state, ask] = useActionState<CopilotState, FormData>(askCopilotAction, {});

  if (!enabled) {
    return (
      <Card>
        <CardTitle>AI営業コパイロット</CardTitle>
        <Alert tone="info" title="現在は無効です">
          AIプロバイダのAPIキーが設定されていないため、コパイロットは利用できません。 設定手順は{' '}
          <code>docs/setup/ai-provider.md</code> にあります。 他の機能は通常どおり利用できます。
        </Alert>
      </Card>
    );
  }

  return (
    <Card>
      <CardTitle>AI営業コパイロット</CardTitle>

      <form action={ask} className="flex flex-col gap-3">
        <input type="hidden" name="projectId" value={projectId} />

        <div className="flex flex-wrap gap-1.5">
          {COPILOT_TASKS.map((task) => (
            <TaskButton key={task.id} id={task.id} label={task.label} title={task.description} />
          ))}
        </div>

        <Textarea
          name="message"
          rows={2}
          aria-label="コパイロットへの質問"
          placeholder="この案件について自由に質問できます"
        />
        <div>
          <Ask label="質問する" />
        </div>
      </form>

      {state.error && (
        <div className="mt-4">
          <Alert tone="danger">{state.error}</Alert>
        </div>
      )}

      {state.answer && (
        <div className="mt-4 flex flex-col gap-3" data-testid="copilot-answer">
          {state.answer.warnings.map((w) => (
            <Alert key={w} tone="warning" title="注意">
              {w}
            </Alert>
          ))}

          <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <p className="text-sm whitespace-pre-wrap">{state.answer.text}</p>
          </div>

          {state.answer.sources.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium">参照した資料</p>
              <ul className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                {state.answer.sources.map((s) => (
                  <li key={s.id}>
                    <span className="mr-1 rounded bg-[var(--surface-muted)] px-1.5 py-0.5">
                      {KIND_LABELS[s.kind] ?? s.kind}
                    </span>
                    {s.title}
                    {s.citation && <span className="ml-1">（{s.citation}）</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-[var(--text-muted)]">
            数値はデータベースと計算エンジンから取得した値です。
            回答内容は必ずご自身で確認のうえ、顧客にお伝えください。
            <span className="ml-1">
              （参照ツール: {state.answer.toolsUsed.join(', ') || 'なし'}）
            </span>
          </p>
        </div>
      )}
    </Card>
  );
}
