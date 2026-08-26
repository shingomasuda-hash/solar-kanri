'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Badge, Button, Card, CardTitle, Field, Input, Select } from '@/components/ui';
import { upsertIrradianceAction, type FormState } from '../actions';
import { SOURCE_KINDS } from '../coefficients/coefficient-row';

export interface StationView {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  irradiation: number[];
  temperature: number[];
  isPlaneOfArray: boolean;
  sourceKind: string;
  sourceCitation: string;
}

function Save({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? '保存中…' : label}
    </Button>
  );
}

export function IrradianceEditor({
  stations,
  canWrite,
}: {
  stations: StationView[];
  canWrite: boolean;
}) {
  const [editing, setEditing] = useState<StationView | null>(null);
  const [state, action] = useActionState<FormState, FormData>(upsertIrradianceAction, {});

  return (
    <div className="flex flex-col gap-5">
      {stations.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">観測点</th>
                <th className="px-4 py-3 font-medium">位置</th>
                <th className="px-4 py-3 font-medium">年平均日射量</th>
                <th className="px-4 py-3 font-medium">基準面</th>
                <th className="px-4 py-3 font-medium">出典</th>
              </tr>
            </thead>
            <tbody>
              {stations.map((s) => {
                const mean = s.irradiation.reduce((a, b) => a + b, 0) / 12;
                return (
                  <tr key={s.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-4 py-3">
                      {canWrite ? (
                        <button
                          type="button"
                          className="font-medium hover:underline"
                          onClick={() => setEditing(s)}
                        >
                          {s.label}
                        </button>
                      ) : (
                        s.label
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-xs">
                      {s.latitude.toFixed(4)}, {s.longitude.toFixed(4)}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{mean.toFixed(2)} kWh/m²/日</td>
                    <td className="px-4 py-3 text-xs">{s.isPlaneOfArray ? '傾斜面' : '水平面'}</td>
                    <td className="max-w-64 truncate px-4 py-3 text-xs">
                      {s.sourceKind === 'UNVERIFIED_PLACEHOLDER' ? (
                        <Badge className="bg-red-500/10 text-red-700">出典未確認</Badge>
                      ) : (
                        s.sourceCitation
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

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
            {editing ? `${editing.label} を編集` : '観測点を登録'}
          </CardTitle>
          <form action={action} className="flex flex-col gap-4" key={editing?.id ?? 'new'}>
            {state.error && <Alert tone="danger">{state.error}</Alert>}
            {editing && <input type="hidden" name="id" value={editing.id} />}

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="観測点名" htmlFor="label" required>
                <Input id="label" name="label" defaultValue={editing?.label ?? ''} required />
              </Field>
              <Field label="緯度" htmlFor="latitude" required>
                <Input
                  id="latitude"
                  name="latitude"
                  inputMode="decimal"
                  defaultValue={editing?.latitude ?? ''}
                  required
                />
              </Field>
              <Field label="経度" htmlFor="longitude" required>
                <Input
                  id="longitude"
                  name="longitude"
                  inputMode="decimal"
                  defaultValue={editing?.longitude ?? ''}
                  required
                />
              </Field>
            </div>

            <Field
              label="月別日射量 (kWh/m²/日)"
              htmlFor="monthlyIrradiation"
              required
              hint="1月から12月まで、カンマまたは空白区切りで12個"
            >
              <Input
                id="monthlyIrradiation"
                name="monthlyIrradiation"
                defaultValue={editing?.irradiation.join(', ') ?? ''}
                placeholder="3.2, 3.6, 4.0, 4.4, 4.5, 3.8, 4.0, 4.4, 3.5, 3.2, 3.0, 3.0"
                required
                className="font-mono text-xs"
              />
            </Field>
            <Field
              label="月別平均気温 (℃)"
              htmlFor="monthlyAmbientTemp"
              required
              hint="1月から12月まで、カンマまたは空白区切りで12個"
            >
              <Input
                id="monthlyAmbientTemp"
                name="monthlyAmbientTemp"
                defaultValue={editing?.temperature.join(', ') ?? ''}
                placeholder="6, 7, 10, 15, 20, 23, 27, 29, 25, 19, 14, 9"
                required
                className="font-mono text-xs"
              />
            </Field>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="isPlaneOfArray"
                defaultChecked={editing?.isPlaneOfArray ?? false}
              />
              傾斜面（アレイ面）の値である
            </label>
            <p className="-mt-2 text-xs text-[var(--text-muted)]">
              チェックしない場合は水平面の値として扱い、計算結果にその旨の警告が表示されます。
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="傾斜角 (°)" htmlFor="tiltDeg">
                <Input id="tiltDeg" name="tiltDeg" inputMode="decimal" />
              </Field>
              <Field label="方位角 (°)" htmlFor="azimuthDeg">
                <Input id="azimuthDeg" name="azimuthDeg" inputMode="decimal" />
              </Field>
            </div>

            <Field label="出典の種類" htmlFor="sourceKind" required>
              <Select
                id="sourceKind"
                name="sourceKind"
                defaultValue={editing?.sourceKind ?? 'PUBLIC_DATASET'}
              >
                {SOURCE_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="出典"
              htmlFor="sourceCitation"
              required
              hint="例）NEDO METPV-20 地点番号 44132"
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
    </div>
  );
}
