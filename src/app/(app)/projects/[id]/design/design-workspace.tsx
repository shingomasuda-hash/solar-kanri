'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardTitle,
  DemoFiguresNotice,
  EmptyState,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import {
  RoofMap,
  type DrawMode,
  type GeoJSONPolygonLike,
  type MapFeature,
} from '@/components/map/roof-map';
import { drawTargetFor } from '@/components/map/draw-target';
import {
  computeLayoutAction,
  deleteExclusionAction,
  deleteRoofFaceAction,
  geocodeAction,
  estimateRoofAction,
  runSimulationAction,
  saveExclusionAction,
  saveRoofFaceAction,
  setPositionAction,
  type FormState,
  type LayoutState,
  type RoofEstimateState,
  type SimulationState,
} from './actions';

/**
 * The design workspace: address → map → roof outline → exclusions → panel
 * selection → auto layout → simulation.
 *
 * Deliberately usable without Google Maps. When no API key is configured the
 * map panel explains what to set, and the coordinate-entry panel still lets an
 * operator paste an outline (from a survey, a CAD export, or a colleague) and
 * run the whole pipeline. That is not a testing affordance bolted on — a
 * platform that stops dead because one external API is unconfigured fails the
 * brief's own rule that Google must never be a hard dependency.
 */

export interface RoofFaceView {
  id: string;
  label: string;
  outline: GeoJSONPolygonLike;
  pitchDeg: number | null;
  azimuthDeg: number;
  pitchSource: string;
  setbackM: number;
  panelGapM: number;
  projectedAreaM2: number | null;
  surfaceAreaM2: number | null;
  exclusions: {
    id: string;
    kind: string;
    label: string | null;
    clearanceM: number;
    outline: GeoJSONPolygonLike;
  }[];
}

export interface LayoutView {
  id: string;
  roofFaceId: string;
  panelModelId: string;
  panelLabel: string;
  panelCount: number;
  installedW: number;
  orientation: string | null;
  angleDeg: number;
  usableAreaM2: number;
}

export interface DesignWorkspaceProps {
  projectId: string;
  propertyId: string;
  canWrite: boolean;
  canSimulate: boolean;
  mapsApiKey: string | null;
  mapId: string | null;
  geocodingKeySource: 'dedicated' | 'browser-key-fallback' | 'none';
  defaultAddress: string;
  position: { lat: number; lng: number } | null;
  roofFaces: RoofFaceView[];
  layouts: LayoutView[];
  panels: { id: string; label: string }[];
}

const EXCLUSION_KINDS: Record<string, string> = {
  SKYLIGHT: '天窓',
  CHIMNEY: '煙突',
  AC_UNIT: '室外機',
  EQUIPMENT: '設備',
  MAINTENANCE_AREA: 'メンテナンスエリア',
  OTHER: 'その他',
};

const PITCH_PRESETS = [
  { sun: '', label: '不明（水平面として計算）', deg: '' },
  { sun: '1', label: '1寸（5.7°）', deg: '5.71' },
  { sun: '2', label: '2寸（11.3°）', deg: '11.31' },
  { sun: '3', label: '3寸（16.7°）', deg: '16.70' },
  { sun: '3.5', label: '3.5寸（19.3°）', deg: '19.29' },
  { sun: '4', label: '4寸（21.8°）', deg: '21.80' },
  { sun: '4.5', label: '4.5寸（24.2°）', deg: '24.23' },
  { sun: '5', label: '5寸（26.6°）', deg: '26.57' },
  { sun: '6', label: '6寸（31.0°）', deg: '30.96' },
  { sun: '8', label: '8寸（38.7°）', deg: '38.66' },
  { sun: '10', label: '10寸（45.0°）', deg: '45.00' },
];

const AZIMUTHS = [
  { value: 180, label: '南（180°）' },
  { value: 135, label: '南東（135°）' },
  { value: 225, label: '南西（225°）' },
  { value: 90, label: '東（90°）' },
  { value: 270, label: '西（270°）' },
  { value: 45, label: '北東（45°）' },
  { value: 315, label: '北西（315°）' },
  { value: 0, label: '北（0°）' },
];

function Submitting({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

export function DesignWorkspace(props: DesignWorkspaceProps) {
  const { projectId, propertyId, canWrite, roofFaces, layouts, panels } = props;
  const [mode, setMode] = useState<DrawMode>('none');
  // One buffer per drawing target. A single shared one sent every polygon to
  // the roof field, which made it impossible to draw an exclusion zone at all:
  // the operator drew a skylight and watched the roof outline change instead.
  const [drawnRoof, setDrawnRoof] = useState<string>('');
  const [drawnExclusion, setDrawnExclusion] = useState<string>('');
  const [selectedFaceId, setSelectedFaceId] = useState<string | null>(roofFaces[0]?.id ?? null);

  const [geocodeState, geocode] = useActionState(geocodeAction, {} as FormState);
  const [positionState, setPosition] = useActionState(setPositionAction, {} as FormState);
  const [roofState, saveRoof] = useActionState(saveRoofFaceAction, {} as FormState);
  const [deleteRoofState, deleteRoof] = useActionState(deleteRoofFaceAction, {} as FormState);
  const [exclusionState, saveExclusion] = useActionState(saveExclusionAction, {} as FormState);
  const [deleteExclusionState, deleteExclusion] = useActionState(
    deleteExclusionAction,
    {} as FormState,
  );
  const [layoutState, computeLayout] = useActionState(computeLayoutAction, {} as LayoutState);
  const [simState, runSim] = useActionState(runSimulationAction, {} as SimulationState);
  const [estimateState, estimateRoof] = useActionState(estimateRoofAction, {} as RoofEstimateState);

  // Pitch and orientation are controlled, so a satellite estimate can fill them
  // and record where the number came from. `pitchSource` is what the rest of
  // the system reads to decide whether a figure may be presented as measured;
  // it must never say PROVIDER for a value a person picked off a list.
  const [pitchDeg, setPitchDeg] = useState('');
  const [azimuthDeg, setAzimuthDeg] = useState('180');
  const [pitchSource, setPitchSource] = useState<'ASSUMED' | 'PROVIDER' | 'UNKNOWN'>('ASSUMED');
  const estimated = pitchSource === 'PROVIDER' ? { pitchDeg, azimuthDeg } : null;

  const applyEstimate = (segment: { pitchDeg: number; azimuthDeg: number }) => {
    setPitchDeg(String(segment.pitchDeg));
    setAzimuthDeg(String(segment.azimuthDeg));
    setPitchSource('PROVIDER');
  };

  const selectedFace = roofFaces.find((f) => f.id === selectedFaceId) ?? roofFaces[0] ?? null;

  const features = useMemo<MapFeature[]>(() => {
    const out: MapFeature[] = [];
    for (const face of roofFaces) {
      out.push({ id: face.id, kind: 'roof', polygon: face.outline, label: face.label });
      for (const z of face.exclusions) {
        out.push({ id: z.id, kind: 'exclusion', polygon: z.outline, label: z.label ?? undefined });
      }
    }
    return out;
  }, [roofFaces]);

  // Editing a roof or an exclusion deletes the layouts computed from it. The
  // transient success banner must go with them: leaving "36 枚" on screen after
  // the layout it described has been invalidated is worse than showing nothing.
  const staleSummary =
    layoutState.summary != null &&
    !layouts.some((l) => l.roofFaceId === layoutState.summary!.roofFaceId);
  const layoutSummary = staleSummary ? undefined : layoutState.summary;

  const totalPanels = layouts.reduce((s, l) => s + l.panelCount, 0);
  const totalW = layouts.reduce((s, l) => s + l.installedW, 0);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
      {/* ------------------------------------------------ map column */}
      <div className="flex min-w-0 flex-col gap-5">
        <Card>
          <CardTitle>1. 住所から位置を確定</CardTitle>
          {props.geocodingKeySource === 'none' && (
            <Alert tone="warning" title="住所検索が未設定です">
              Geocoding API キーが未設定のため、住所検索は使えません。下の「緯度・経度を直接入力」
              から位置を設定できます。手順は <code>docs/setup/google-maps.md</code> にあります。
            </Alert>
          )}
          {props.geocodingKeySource === 'browser-key-fallback' && (
            <Alert tone="warning" title="ブラウザ用のキーで代用しています">
              <p>
                <code>GOOGLE_GEOCODING_API_KEY</code> が空のため、地図用のキーで住所検索を
                実行します。そのキーにリファラー制限がかかっていると、サーバーからの リクエストは
                Google に拒否されます（リファラーが付かないため）。
              </p>
              <p className="mt-1">
                サーバー用のキーを別に発行し、
                <code className="mx-1">GOOGLE_GEOCODING_API_KEY</code>
                に設定してください。手順は <code>docs/setup/google-maps.md</code> にあります。
              </p>
            </Alert>
          )}
          {props.geocodingKeySource !== 'none' && (
            <form action={geocode} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="propertyId" value={propertyId} />
              <Field label="住所" htmlFor="address" hint="例）東京都千代田区千代田1-1">
                <Input
                  id="address"
                  name="address"
                  defaultValue={props.defaultAddress}
                  className="min-w-72"
                />
              </Field>
              <Submitting label="検索して位置を確定" busy="検索中…" />
            </form>
          )}
          {geocodeState.error && (
            <Alert tone="danger" title="住所検索に失敗しました">
              {geocodeState.error}
            </Alert>
          )}

          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium">緯度・経度を直接入力</summary>
            <form action={setPosition} className="mt-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="propertyId" value={propertyId} />
              <Field label="緯度" htmlFor="latitude">
                <Input
                  id="latitude"
                  name="latitude"
                  inputMode="decimal"
                  defaultValue={props.position?.lat ?? ''}
                  className="w-40"
                />
              </Field>
              <Field label="経度" htmlFor="longitude">
                <Input
                  id="longitude"
                  name="longitude"
                  inputMode="decimal"
                  defaultValue={props.position?.lng ?? ''}
                  className="w-40"
                />
              </Field>
              <Submitting label="位置を設定" busy="保存中…" />
            </form>
            {positionState.error && <Alert tone="danger">{positionState.error}</Alert>}
          </details>

          {props.position && (
            <p className="mt-3 text-sm text-[var(--text-muted)]" data-testid="position-set">
              位置: <span className="tabular-nums">{props.position.lat.toFixed(6)}</span>,{' '}
              <span className="tabular-nums">{props.position.lng.toFixed(6)}</span>
            </p>
          )}
        </Card>

        {canWrite && props.position && (
          <Card>
            <CardTitle
              action={
                <form action={estimateRoof}>
                  <input type="hidden" name="propertyId" value={propertyId} />
                  <input type="hidden" name="refresh" value="true" />
                  <Button type="submit" variant="ghost" className="text-xs">
                    再取得
                  </Button>
                </form>
              }
            >
              衛星から屋根勾配を推定（任意）
            </CardTitle>

            <form action={estimateRoof} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="propertyId" value={propertyId} />
              <Submitting label="衛星写真から推定" busy="問い合わせ中…" />
              <p className="text-xs text-[var(--text-muted)]">
                Google Solar API に問い合わせ、勾配と向きを推定します。外周の作図は手動のままです。
              </p>
            </form>

            {estimateState.error && (
              <div className="mt-3">
                <Alert tone="warning" title="推定できませんでした">
                  {estimateState.error}
                </Alert>
              </div>
            )}

            {estimateState.result && (
              <div className="mt-3" data-testid="roof-estimate">
                {estimateState.result.status !== 'ok' ? (
                  <Alert tone="info" title="この建物のデータがありません">
                    Google
                    はこの建物をモデル化していません。屋根を手で作図し、勾配を選択してください。
                    精度は変わりません。
                  </Alert>
                ) : (
                  <>
                    <p className="mb-2 text-xs text-[var(--text-muted)]">
                      {estimateState.result.segments.length} 面を検出
                      {estimateState.result.imageryDate &&
                        ` ・ 撮影 ${estimateState.result.imageryDate}`}
                      {estimateState.result.imageryQuality &&
                        ` ・ 画質 ${estimateState.result.imageryQuality}`}
                      {estimateState.result.cached && ' ・ 保存済みの結果'}
                    </p>
                    <ul className="flex flex-col gap-2">
                      {estimateState.result.segments.map((seg, i) => (
                        <li
                          key={`${seg.pitchDeg}-${seg.azimuthDeg}-${i}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm"
                        >
                          <span className="tabular-nums">
                            勾配 {seg.pitchDeg}° ・ 向き {seg.azimuthDeg}° ・ 面積 {seg.areaM2} m²
                          </span>
                          <Button
                            variant="secondary"
                            className="text-xs"
                            onClick={() => applyEstimate(seg)}
                          >
                            この値を使う
                          </Button>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-[var(--text-muted)]">
                      面積は作図した外周と突き合わせる目安に使えます。大きく食い違う場合は作図を見直してください。
                    </p>
                  </>
                )}
              </div>
            )}
          </Card>
        )}

        <Card>
          <CardTitle
            action={
              canWrite ? (
                <div className="flex gap-1">
                  <Button
                    variant={mode === 'roof' ? 'primary' : 'secondary'}
                    onClick={() => setMode(mode === 'roof' ? 'none' : 'roof')}
                    className="text-xs"
                  >
                    屋根を描く
                  </Button>
                  <Button
                    variant={mode === 'exclusion' ? 'primary' : 'secondary'}
                    onClick={() => setMode(mode === 'exclusion' ? 'none' : 'exclusion')}
                    className="text-xs"
                  >
                    禁止区域を描く
                  </Button>
                  <Button
                    variant={mode === 'select' ? 'primary' : 'secondary'}
                    onClick={() => setMode(mode === 'select' ? 'none' : 'select')}
                    className="text-xs"
                  >
                    編集
                  </Button>
                </div>
              ) : null
            }
          >
            2. 衛星写真の上に作図
          </CardTitle>

          <RoofMap
            apiKey={props.mapsApiKey}
            mapId={props.mapId}
            center={props.position}
            mode={mode}
            features={features}
            onPolygonDrawn={(polygon) => {
              const target = drawTargetFor(mode);
              if (!target) return;
              const json = JSON.stringify(polygon);
              if (target === 'exclusion') setDrawnExclusion(json);
              else setDrawnRoof(json);
            }}
            onFeatureSelected={(id) => setSelectedFaceId(id)}
          />
        </Card>
      </div>

      {/* --------------------------------------------- controls column */}
      <div className="flex min-w-0 flex-col gap-5">
        {canWrite && (
          <Card>
            <CardTitle>3. 屋根面を登録</CardTitle>
            <form action={saveRoof} className="flex flex-col gap-3">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="propertyId" value={propertyId} />
              <Field label="名称" htmlFor="label" required>
                <Input
                  id="label"
                  name="label"
                  defaultValue={`屋根面${roofFaces.length + 1}`}
                  required
                />
              </Field>
              <Field
                label="屋根の外周（GeoJSON Polygon）"
                htmlFor="outline"
                required
                hint="地図で作図すると自動で入ります。座標を直接貼り付けることもできます。"
              >
                <Textarea
                  id="outline"
                  name="outline"
                  rows={4}
                  required
                  value={drawnRoof}
                  onChange={(e) => setDrawnRoof(e.target.value)}
                  placeholder='{"type":"Polygon","coordinates":[[[139.767,35.681],...]]}'
                  className="font-mono text-xs"
                />
              </Field>
              <Field
                label="屋根勾配"
                htmlFor="pitchDeg"
                hint="不明の場合は水平面として計算し、結果にその旨を表示します。"
              >
                <Select
                  id="pitchDeg"
                  name="pitchDeg"
                  value={pitchDeg}
                  onChange={(e) => {
                    setPitchDeg(e.target.value);
                    // Picking from the list is a person's assumption, not a
                    // measurement — the provenance has to fall back with it.
                    setPitchSource(e.target.value === '' ? 'UNKNOWN' : 'ASSUMED');
                  }}
                >
                  {estimated && (
                    <option value={estimated.pitchDeg}>衛星推定（{estimated.pitchDeg}°）</option>
                  )}
                  {PITCH_PRESETS.map((p) => (
                    <option key={p.label} value={p.deg}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <input type="hidden" name="pitchSource" value={pitchSource} />
              <Field label="屋根の向き（軒先方向）" htmlFor="azimuthDeg" required>
                <Select
                  id="azimuthDeg"
                  name="azimuthDeg"
                  value={azimuthDeg}
                  onChange={(e) => setAzimuthDeg(e.target.value)}
                >
                  {estimated && !AZIMUTHS.some((a) => String(a.value) === estimated.azimuthDeg) && (
                    <option value={estimated.azimuthDeg}>
                      衛星推定（{estimated.azimuthDeg}°）
                    </option>
                  )}
                  {AZIMUTHS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {pitchSource === 'PROVIDER' && (
                <p className="text-xs text-[var(--text-muted)]" data-testid="pitch-from-satellite">
                  勾配・向きは衛星写真からの推定値です。現地で確認できる場合は実測値に置き換えてください。
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="離隔距離 (m)" htmlFor="setbackM">
                  <Input id="setbackM" name="setbackM" inputMode="decimal" defaultValue="0.3" />
                </Field>
                <Field label="パネル間隔 (m)" htmlFor="panelGapM">
                  <Input id="panelGapM" name="panelGapM" inputMode="decimal" defaultValue="0.02" />
                </Field>
              </div>
              {roofState.error && <Alert tone="danger">{roofState.error}</Alert>}
              <Submitting label="屋根面を保存" busy="保存中…" />
            </form>
          </Card>
        )}

        <Card>
          <CardTitle>屋根面</CardTitle>
          {roofFaces.length === 0 ? (
            <EmptyState
              title="屋根面がまだありません"
              description="地図で屋根の外周を描くか、座標を貼り付けて登録してください。"
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {roofFaces.map((face) => {
                const layout = layouts.find((l) => l.roofFaceId === face.id);
                return (
                  <li
                    key={face.id}
                    className={`rounded-md border p-3 ${
                      face.id === selectedFace?.id ? 'border-brand-500' : 'border-[var(--border)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedFaceId(face.id)}
                        className="text-left text-sm font-medium hover:underline"
                      >
                        {face.label}
                      </button>
                      {canWrite && (
                        <form action={deleteRoof}>
                          <input type="hidden" name="projectId" value={projectId} />
                          <input type="hidden" name="id" value={face.id} />
                          <button
                            type="submit"
                            className="text-xs text-red-600 hover:underline"
                            aria-label={`${face.label} を削除`}
                          >
                            削除
                          </button>
                        </form>
                      )}
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
                      <div>投影面積</div>
                      <div
                        className="text-right tabular-nums"
                        data-testid={`projected-area-${face.id}`}
                        data-value={face.projectedAreaM2 ?? ''}
                      >
                        {face.projectedAreaM2?.toFixed(1) ?? '—'} m²
                      </div>
                      <div>屋根面積</div>
                      <div
                        className="text-right tabular-nums"
                        data-testid={`surface-area-${face.id}`}
                        data-value={face.surfaceAreaM2 ?? ''}
                      >
                        {face.surfaceAreaM2?.toFixed(1) ?? '—'} m²
                      </div>
                      <div>勾配</div>
                      <div className="text-right tabular-nums">
                        {face.pitchDeg != null ? `${face.pitchDeg.toFixed(1)}°` : '不明'}
                      </div>
                      <div>方位</div>
                      <div className="text-right tabular-nums">{face.azimuthDeg}°</div>
                    </dl>
                    {face.pitchDeg == null && (
                      <p className="mt-2 text-xs text-amber-700">
                        勾配が未設定です。水平面として計算されます。
                      </p>
                    )}
                    {face.exclusions.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-1">
                        {face.exclusions.map((z) => (
                          <li key={z.id}>
                            <span className="inline-flex items-center gap-1 rounded bg-red-500/10 px-1.5 py-0.5 text-xs text-red-700">
                              {EXCLUSION_KINDS[z.kind] ?? z.kind}
                              {canWrite && (
                                <form action={deleteExclusion} className="inline">
                                  <input type="hidden" name="projectId" value={projectId} />
                                  <input type="hidden" name="id" value={z.id} />
                                  <button
                                    type="submit"
                                    aria-label={`${EXCLUSION_KINDS[z.kind] ?? z.kind} を削除`}
                                  >
                                    ×
                                  </button>
                                </form>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {layout && (
                      <p
                        className="mt-2 text-xs"
                        data-testid={`layout-${face.id}`}
                        data-panel-count={layout.panelCount}
                      >
                        <Badge className="bg-emerald-500/10 text-emerald-700">
                          {layout.panelCount} 枚 / {(layout.installedW / 1000).toFixed(2)} kW
                        </Badge>
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {(deleteRoofState.error || deleteExclusionState.error) && (
            <Alert tone="danger">{deleteRoofState.error ?? deleteExclusionState.error}</Alert>
          )}
        </Card>

        {canWrite && selectedFace && (
          <Card>
            <CardTitle>4. 禁止区域を追加（任意）</CardTitle>
            <p className="mb-3 text-sm text-[var(--text-muted)]">
              天窓や障害物があれば登録します。
              <strong>
                なければこの手順は飛ばして、下の「5. パネルを自動配置」に進んでください。
              </strong>
            </p>
            <form action={saveExclusion} className="flex flex-col gap-3">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="roofFaceId" value={selectedFace.id} />
              <Field label="対象の屋根面" htmlFor="exclusionFace">
                <Select
                  id="exclusionFace"
                  value={selectedFace.id}
                  onChange={(e) => setSelectedFaceId(e.target.value)}
                >
                  {roofFaces.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="種別" htmlFor="kind">
                <Select id="kind" name="kind" defaultValue="SKYLIGHT">
                  {Object.entries(EXCLUSION_KINDS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="禁止区域の外周（GeoJSON Polygon）" htmlFor="exclusionOutline" required>
                <Textarea
                  id="exclusionOutline"
                  name="outline"
                  rows={3}
                  required
                  value={drawnExclusion}
                  onChange={(e) => setDrawnExclusion(e.target.value)}
                  placeholder="地図で「禁止区域を描く」を押して作図すると自動で入ります"
                  className="font-mono text-xs"
                />
              </Field>
              <Field label="離隔 (m)" htmlFor="clearanceM">
                <Input id="clearanceM" name="clearanceM" inputMode="decimal" defaultValue="0.3" />
              </Field>
              {exclusionState.error && <Alert tone="danger">{exclusionState.error}</Alert>}
              <Submitting label="禁止区域を保存" busy="保存中…" />
            </form>
          </Card>
        )}

        {canWrite && (
          <Card>
            <CardTitle>5. パネルを自動配置</CardTitle>
            {panels.length === 0 ? (
              <Alert tone="warning" title="パネルマスタが未登録です">
                管理画面でパネルの型番と寸法を登録してください。
              </Alert>
            ) : roofFaces.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">先に屋根面を登録してください。</p>
            ) : (
              <form action={computeLayout} className="flex flex-col gap-3">
                <input type="hidden" name="projectId" value={projectId} />
                <Field label="屋根面" htmlFor="layoutFace" required>
                  <Select
                    id="layoutFace"
                    name="roofFaceId"
                    defaultValue={selectedFace?.id}
                    required
                  >
                    {roofFaces.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="パネル型番" htmlFor="panelModelId" required>
                  <Select id="panelModelId" name="panelModelId" required>
                    {panels.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Submitting label="自動配置を実行" busy="計算中…" />
              </form>
            )}
            {layoutState.error && <Alert tone="danger">{layoutState.error}</Alert>}
            {layoutSummary && (
              <div
                className="mt-3"
                data-testid="layout-result"
                data-panel-count={layoutSummary.panelCount}
              >
                <Alert tone="success" title="自動配置が完了しました">
                  <p className="tabular-nums">
                    {layoutSummary.panelCount} 枚 / {layoutSummary.installedKw.toFixed(2)} kW（
                    {layoutSummary.orientation === 'portrait' ? '縦置き' : '横置き'}、 配置角{' '}
                    {layoutSummary.angleDeg.toFixed(0)}°）
                  </p>
                  <p className="mt-1 text-xs tabular-nums">
                    有効面積 {layoutSummary.usableAreaM2.toFixed(1)} m² / 屋根面積{' '}
                    {layoutSummary.roofAreaM2.toFixed(1)} m²
                  </p>
                </Alert>
                {layoutSummary.warnings.map((w) => (
                  <div key={w} className="mt-2">
                    <Alert tone="warning">{w}</Alert>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {props.canSimulate && layouts.length > 0 && (
          <Card>
            <CardTitle>6. シミュレーションを実行</CardTitle>
            <p className="mb-3 text-sm tabular-nums text-[var(--text-muted)]">
              合計 {totalPanels} 枚 / {(totalW / 1000).toFixed(2)} kW
            </p>
            <form action={runSim} className="flex flex-col gap-3">
              <input type="hidden" name="projectId" value={projectId} />
              {layouts.map((l) => (
                <input key={l.id} type="hidden" name="layoutIds" value={l.id} />
              ))}
              <Field label="設置方式" htmlFor="mounting">
                <Select id="mounting" name="mounting" defaultValue="roof-flush">
                  <option value="roof-flush">屋根置き（密着）</option>
                  <option value="roof-raised">屋根置き（架台）</option>
                  <option value="ground-mounted">地上設置</option>
                </Select>
              </Field>
              <Field label="年間消費電力量 (kWh)" htmlFor="annualConsumptionKWh">
                <Input
                  id="annualConsumptionKWh"
                  name="annualConsumptionKWh"
                  inputMode="numeric"
                  defaultValue="5000"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="システム総額 (円)" htmlFor="totalCostJpy">
                  <Input
                    id="totalCostJpy"
                    name="totalCostJpy"
                    inputMode="numeric"
                    defaultValue="0"
                  />
                </Field>
                <Field label="補助金 (円)" htmlFor="subsidyJpy">
                  <Input id="subsidyJpy" name="subsidyJpy" inputMode="numeric" defaultValue="0" />
                </Field>
              </div>
              <Submitting label="シミュレーション実行" busy="計算中…" />
            </form>
            {simState.error && (
              <div className="mt-3" data-testid="simulation-error">
                <Alert tone="danger" title="シミュレーションを実行できません">
                  {simState.error}
                </Alert>
              </div>
            )}
            {simState.simulationId && (
              <div className="mt-3 space-y-3">
                <Alert tone="success" title="シミュレーションを保存しました">
                  案件画面で結果を確認できます。
                </Alert>
                {simState.isDemo && <DemoFiguresNotice fields={simState.demoFields} />}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
