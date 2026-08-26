'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Badge, Button, Card, CardTitle, Field, Input } from '@/components/ui';
import { setPanelActiveAction, upsertPanelAction, type FormState } from '../actions';

export interface PanelView {
  id: string;
  manufacturer: string;
  model: string;
  widthMm: number;
  heightMm: number;
  ratedPowerW: number;
  pmaxTempCoeffPerK: number;
  annualDegradation: number;
  noctC: number | null;
  efficiencyPct: number | null;
  datasheetVersion: string | null;
  sourceCitation: string;
  isActive: boolean;
  verifiedAt: string | null;
}

function Save({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? '保存中…' : label}
    </Button>
  );
}

export function PanelEditor({ panels, canWrite }: { panels: PanelView[]; canWrite: boolean }) {
  const [editing, setEditing] = useState<PanelView | null>(null);
  const [state, action] = useActionState<FormState, FormData>(upsertPanelAction, {});
  const [activeState, setActive] = useActionState<FormState, FormData>(setPanelActiveAction, {});

  return (
    <div className="flex flex-col gap-5">
      {canWrite && (
        <Card>
          <CardTitle
            action={
              editing ? (
                <Button variant="ghost" className="text-xs" onClick={() => setEditing(null)}>
                  新規登録に戻す
                </Button>
              ) : null
            }
          >
            {editing ? `${editing.manufacturer} ${editing.model} を編集` : 'パネルを登録'}
          </CardTitle>
          <form action={action} className="flex flex-col gap-4" key={editing?.id ?? 'new'}>
            {state.error && <Alert tone="danger">{state.error}</Alert>}
            {editing && <input type="hidden" name="id" value={editing.id} />}

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="メーカー" htmlFor="manufacturer" required>
                <Input
                  id="manufacturer"
                  name="manufacturer"
                  defaultValue={editing?.manufacturer}
                  required
                />
              </Field>
              <Field label="型番" htmlFor="model" required>
                <Input id="model" name="model" defaultValue={editing?.model} required />
              </Field>
              <Field label="データシート版" htmlFor="datasheetVersion">
                <Input
                  id="datasheetVersion"
                  name="datasheetVersion"
                  defaultValue={editing?.datasheetVersion ?? ''}
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="幅 (mm)" htmlFor="widthMm" required>
                <Input
                  id="widthMm"
                  name="widthMm"
                  inputMode="numeric"
                  defaultValue={editing?.widthMm}
                  required
                />
              </Field>
              <Field label="高さ (mm)" htmlFor="heightMm" required>
                <Input
                  id="heightMm"
                  name="heightMm"
                  inputMode="numeric"
                  defaultValue={editing?.heightMm}
                  required
                />
              </Field>
              <Field label="公称出力 (W)" htmlFor="ratedPowerW" required>
                <Input
                  id="ratedPowerW"
                  name="ratedPowerW"
                  inputMode="numeric"
                  defaultValue={editing?.ratedPowerW}
                  required
                />
              </Field>
              <Field label="変換効率 (%)" htmlFor="efficiencyPct">
                <Input
                  id="efficiencyPct"
                  name="efficiencyPct"
                  inputMode="decimal"
                  defaultValue={editing?.efficiencyPct ?? ''}
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field
                label="Pmax温度係数 (/K)"
                htmlFor="pmaxTempCoeffPerK"
                required
                error={state.fieldErrors?.pmaxTempCoeffPerK}
                hint="-0.35 %/℃ → -0.0035"
              >
                <Input
                  id="pmaxTempCoeffPerK"
                  name="pmaxTempCoeffPerK"
                  inputMode="decimal"
                  defaultValue={editing?.pmaxTempCoeffPerK ?? '-0.0035'}
                  required
                />
              </Field>
              <Field label="NOCT (℃)" htmlFor="noctC">
                <Input
                  id="noctC"
                  name="noctC"
                  inputMode="decimal"
                  defaultValue={editing?.noctC ?? ''}
                />
              </Field>
              <Field label="年間劣化率" htmlFor="annualDegradation" required hint="0.5%/年 → 0.005">
                <Input
                  id="annualDegradation"
                  name="annualDegradation"
                  inputMode="decimal"
                  defaultValue={editing?.annualDegradation ?? '0.005'}
                  required
                />
              </Field>
            </div>

            <Field
              label="出典"
              htmlFor="sourceCitation"
              required
              error={state.fieldErrors?.sourceCitation}
              hint="データシート名・版・表番号など"
            >
              <Input
                id="sourceCitation"
                name="sourceCitation"
                defaultValue={editing?.sourceCitation ?? ''}
                required
              />
            </Field>
            <Field label="出典URL" htmlFor="sourceUrl">
              <Input id="sourceUrl" name="sourceUrl" type="url" />
            </Field>

            <div>
              <Save label={editing ? '更新する' : '登録する'} />
            </div>
          </form>
        </Card>
      )}

      {panels.length > 0 && (
        <Card className="overflow-x-auto p-0">
          {activeState.error && (
            <div className="p-3">
              <Alert tone="danger">{activeState.error}</Alert>
            </div>
          )}
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">メーカー / 型番</th>
                <th className="px-4 py-3 font-medium">寸法</th>
                <th className="px-4 py-3 font-medium">出力</th>
                <th className="px-4 py-3 font-medium">温度係数</th>
                <th className="px-4 py-3 font-medium">出典</th>
                <th className="px-4 py-3 font-medium">状態</th>
              </tr>
            </thead>
            <tbody>
              {panels.map((p) => (
                <tr key={p.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-3">
                    {canWrite ? (
                      <button
                        type="button"
                        className="font-medium hover:underline"
                        onClick={() => setEditing(p)}
                      >
                        {p.manufacturer} {p.model}
                      </button>
                    ) : (
                      <span className="font-medium">
                        {p.manufacturer} {p.model}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {p.widthMm}×{p.heightMm} mm
                  </td>
                  <td className="px-4 py-3 tabular-nums">{p.ratedPowerW} W</td>
                  <td className="px-4 py-3 tabular-nums">{p.pmaxTempCoeffPerK} /K</td>
                  <td className="max-w-64 truncate px-4 py-3 text-xs" title={p.sourceCitation}>
                    {p.sourceCitation}
                  </td>
                  <td className="px-4 py-3">
                    {canWrite ? (
                      <form action={setActive}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="isActive" value={String(!p.isActive)} />
                        <button type="submit" className="text-xs hover:underline">
                          {p.isActive ? (
                            <Badge className="bg-emerald-500/10 text-emerald-700">有効</Badge>
                          ) : (
                            <Badge>無効</Badge>
                          )}
                        </button>
                      </form>
                    ) : p.isActive ? (
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
