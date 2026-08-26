'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardTitle,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import { looksLikeInjectionAttempt } from '@core/ai/safety';
import { saveKnowledgeAction, setKnowledgeActiveAction, type FormState } from '../actions';

const KINDS = [
  { value: 'MANUFACTURER_DOC', label: 'メーカー資料' },
  { value: 'DATASHEET', label: 'データシート' },
  { value: 'WARRANTY', label: '保証資料' },
  { value: 'FAQ', label: 'FAQ' },
  { value: 'SUBSIDY', label: '補助金' },
  { value: 'SALES_MATERIAL', label: '営業資料' },
  { value: 'CASE_STUDY', label: '成功事例' },
  { value: 'COMPETITOR', label: '競合比較' },
  { value: 'MANUAL', label: '営業マニュアル' },
];

export interface KnowledgeView {
  id: string;
  kind: string;
  title: string;
  body: string;
  tags: string[];
  sourceUrl: string | null;
  sourceCitation: string | null;
  isActive: boolean;
  updatedAt: string;
}

function Save({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? '保存中…' : label}
    </Button>
  );
}

export function KnowledgeEditor({
  documents,
  canWrite,
}: {
  documents: KnowledgeView[];
  canWrite: boolean;
}) {
  const [editing, setEditing] = useState<KnowledgeView | null>(null);
  const [body, setBody] = useState('');
  const [state, action] = useActionState<FormState, FormData>(saveKnowledgeAction, {});
  const [activeState, setActive] = useActionState<FormState, FormData>(
    setKnowledgeActiveAction,
    {},
  );

  // Surfaced while typing so the person pasting a supplier PDF sees it, rather
  // than discovering it later in a Copilot answer.
  const suspicious = looksLikeInjectionAttempt(body);

  return (
    <div className="flex flex-col gap-5">
      {canWrite && (
        <Card>
          <CardTitle
            action={
              editing ? (
                <Button
                  variant="ghost"
                  className="text-xs"
                  onClick={() => {
                    setEditing(null);
                    setBody('');
                  }}
                >
                  新規登録に戻す
                </Button>
              ) : null
            }
          >
            {editing ? `${editing.title} を編集` : '資料を登録'}
          </CardTitle>

          <form action={action} className="flex flex-col gap-4" key={editing?.id ?? 'new'}>
            {state.error && <Alert tone="danger">{state.error}</Alert>}
            {editing && <input type="hidden" name="id" value={editing.id} />}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="種別" htmlFor="kind" required>
                <Select id="kind" name="kind" defaultValue={editing?.kind ?? 'FAQ'}>
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="タイトル" htmlFor="title" required>
                <Input id="title" name="title" defaultValue={editing?.title ?? ''} required />
              </Field>
            </div>

            <Field label="本文" htmlFor="body" required>
              <Textarea
                id="body"
                name="body"
                rows={8}
                required
                defaultValue={editing?.body ?? ''}
                onChange={(e) => setBody(e.target.value)}
              />
            </Field>

            {suspicious && (
              <Alert tone="warning" title="指示のような記述が含まれています">
                本文にAIへの指示のように読める記述があります。登録は可能で、内容は
                データとして扱われますが、意図しない文章が混入していないか確認してください。
              </Alert>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="タグ" htmlFor="tags" hint="カンマ区切り">
                <Input id="tags" name="tags" defaultValue={editing?.tags.join(', ') ?? ''} />
              </Field>
              <Field label="出典" htmlFor="sourceCitation">
                <Input
                  id="sourceCitation"
                  name="sourceCitation"
                  defaultValue={editing?.sourceCitation ?? ''}
                />
              </Field>
            </div>
            <Field label="出典URL" htmlFor="sourceUrl">
              <Input
                id="sourceUrl"
                name="sourceUrl"
                type="url"
                defaultValue={editing?.sourceUrl ?? ''}
              />
            </Field>

            <div>
              <Save label={editing ? '更新する' : '登録する'} />
            </div>
          </form>
        </Card>
      )}

      {documents.length > 0 && (
        <Card className="overflow-x-auto p-0">
          {activeState.error && (
            <div className="p-3">
              <Alert tone="danger">{activeState.error}</Alert>
            </div>
          )}
          <table className="w-full min-w-[680px] text-sm">
            <thead className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">種別</th>
                <th className="px-4 py-3 font-medium">タイトル</th>
                <th className="px-4 py-3 font-medium">出典</th>
                <th className="px-4 py-3 font-medium">更新</th>
                <th className="px-4 py-3 font-medium">状態</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-3 text-xs">
                    {KINDS.find((k) => k.value === d.kind)?.label ?? d.kind}
                  </td>
                  <td className="px-4 py-3">
                    {canWrite ? (
                      <button
                        type="button"
                        className="font-medium hover:underline"
                        onClick={() => {
                          setEditing(d);
                          setBody(d.body);
                        }}
                      >
                        {d.title}
                      </button>
                    ) : (
                      d.title
                    )}
                    {looksLikeInjectionAttempt(d.body) && (
                      <Badge className="ml-2 bg-amber-500/10 text-amber-700">要確認</Badge>
                    )}
                  </td>
                  <td className="max-w-56 truncate px-4 py-3 text-xs">{d.sourceCitation ?? '—'}</td>
                  <td className="px-4 py-3 text-xs tabular-nums whitespace-nowrap">
                    {new Date(d.updatedAt).toLocaleDateString('ja-JP')}
                  </td>
                  <td className="px-4 py-3">
                    {canWrite ? (
                      <form action={setActive}>
                        <input type="hidden" name="id" value={d.id} />
                        <input type="hidden" name="isActive" value={String(!d.isActive)} />
                        <button
                          type="submit"
                          aria-label={`${d.title} を${d.isActive ? '無効化' : '有効化'}`}
                        >
                          {d.isActive ? (
                            <Badge className="bg-emerald-500/10 text-emerald-700">有効</Badge>
                          ) : (
                            <Badge>無効</Badge>
                          )}
                        </button>
                      </form>
                    ) : d.isActive ? (
                      <Badge className="bg-emerald-500/10 text-emerald-700">有効</Badge>
                    ) : (
                      <Badge>無効</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
