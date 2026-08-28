'use client';

import { useActionState, useState } from 'react';
import { adoptDemoValuesAction, type FormState } from '../actions';
import { Alert, Button, Card, CardTitle, Field, Input } from '@/components/ui';

/**
 * Adopt the demonstration figures as the company's own provisional values.
 *
 * Deliberately not a single button. The values do not become more accurate by
 * being adopted — what changes is that a named person now stands behind them,
 * and a form that makes that feel like nothing would be lying about what the
 * operator is doing.
 */
export function AdoptDemoValues({ demoCount }: { demoCount: number }) {
  const [state, action] = useActionState<FormState, FormData>(adoptDemoValuesAction, {});
  const [open, setOpen] = useState(false);

  if (demoCount === 0) return null;

  return (
    <Card className="mb-5 border-amber-500/40" data-testid="adopt-demo-values">
      <CardTitle>デモ値を自社の暫定値として確定する</CardTitle>
      <Alert tone="warning" title="数値の精度は変わりません">
        <p>
          この操作で変わるのは<strong>誰がその値に責任を持つか</strong>だけです。
          デモ用の概算値は出典も責任者もありませんが、確定すると
          「管理者が確認して採用した暫定値」として記録され、見積を発行できるようになります。
        </p>
        <p className="mt-1">
          発行された見積は通常の見積として扱われ、画面上の「参考値」表示も消えます。
          <strong>お客様に金額を提示する場合は、その前提でご判断ください。</strong>
        </p>
      </Alert>

      {!open ? (
        <div className="mt-3">
          <Button variant="secondary" onClick={() => setOpen(true)}>
            内容を確認して確定する（{demoCount} 件）
          </Button>
        </div>
      ) : (
        <form action={action} className="mt-3 flex flex-col gap-3">
          <Field
            label="根拠・出典"
            htmlFor="citation"
            required
            hint="後からこの値を見た人に伝わる書き方で。例）2026-08-28 デモ提示用の暫定値。〇〇部長承認。実測値の入手後に差し替え。"
          >
            <Input id="citation" name="citation" required minLength={10} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit">この内容で確定する</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              やめる
            </Button>
          </div>
          {state.error && <Alert tone="danger">{state.error}</Alert>}
        </form>
      )}
    </Card>
  );
}
