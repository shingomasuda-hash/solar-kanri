'use client';

import { useActionState } from 'react';
import { importIrradianceAction, type FormState } from '../actions';
import { Alert, Button, Card, CardTitle, Field, Input } from '@/components/ui';

/**
 * Pull a site's monthly climate from PVGIS and store it as a station.
 *
 * Deliberately explicit rather than automatic. Fetching per simulation would
 * make a saved result depend on a service that can change its answer, and a
 * quotation issued last year would silently acquire different numbers. Storing
 * it also puts the figures somewhere an administrator can read, check against
 * a national dataset, and replace.
 */
export function ImportFromPvgis() {
  const [state, action] = useActionState<FormState, FormData>(importIrradianceAction, {});

  return (
    <Card className="mb-5" data-testid="pvgis-import">
      <CardTitle>PVGIS から取得して登録</CardTitle>
      <p className="mb-3 text-sm text-[var(--text-muted)]">
        欧州委員会 JRC の公開サービス PVGIS に問い合わせ、その地点の月別日射量と気温を
        観測点として登録します。APIキーは不要です。取得元と取得日を出典として記録します。
      </p>
      <form action={action} className="flex flex-wrap items-end gap-3">
        <Field label="地点の名称" htmlFor="pvgisLabel" required>
          <Input id="pvgisLabel" name="label" required placeholder="例）大和高田市" />
        </Field>
        <Field label="緯度" htmlFor="pvgisLat" required>
          <Input id="pvgisLat" name="latitude" inputMode="decimal" required className="w-36" />
        </Field>
        <Field label="経度" htmlFor="pvgisLng" required>
          <Input id="pvgisLng" name="longitude" inputMode="decimal" required className="w-36" />
        </Field>
        <Button type="submit">取得して登録</Button>
      </form>
      {state.error && (
        <div className="mt-3">
          <Alert tone="danger" title="取得できませんでした">
            {state.error}
          </Alert>
        </div>
      )}
      <p className="mt-3 text-xs text-[var(--text-muted)]">
        PVGIS は再解析データです。日本国内で本格運用する場合は NEDO METPV / MONSOLA
        などの国内データセットと突き合わせ、必要なら手入力の値に置き換えてください。
      </p>
    </Card>
  );
}
