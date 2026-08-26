'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui';

/**
 * Google Maps + Terra Draw roof editor.
 *
 * `google.maps.drawing.DrawingManager` was removed from the Maps JavaScript
 * API in v3.65 and has been unavailable since May 2026 — Terra Draw is Google's
 * own recommended replacement (ADR-002). Terra Draw is headless and speaks
 * GeoJSON, so nothing here depends on Google's overlay object model.
 *
 * Everything loads lazily on the client: the Maps library is heavy, and the
 * whole design page must still work when no API key is configured.
 */

export type DrawMode = 'select' | 'roof' | 'exclusion' | 'none';

export interface GeoJSONPolygonLike {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface MapFeature {
  readonly id: string;
  readonly kind: 'roof' | 'exclusion' | 'panel' | 'usable';
  readonly polygon: GeoJSONPolygonLike;
  readonly label?: string;
}

export interface RoofMapProps {
  readonly apiKey: string | null;
  readonly mapId: string | null;
  readonly center: { lat: number; lng: number } | null;
  readonly zoom?: number;
  readonly mode: DrawMode;
  readonly features: readonly MapFeature[];
  readonly onPolygonDrawn?: (polygon: GeoJSONPolygonLike) => void;
  readonly onFeatureSelected?: (id: string | null) => void;
  readonly onCenterChanged?: (center: { lat: number; lng: number }, zoom: number) => void;
}

const STYLE: Record<MapFeature['kind'], { fill: string; outline: string; opacity: number }> = {
  roof: { fill: '#38bdf8', outline: '#0284c7', opacity: 0.18 },
  exclusion: { fill: '#ef4444', outline: '#b91c1c', opacity: 0.35 },
  panel: { fill: '#1e293b', outline: '#0f172a', opacity: 0.75 },
  usable: { fill: '#22c55e', outline: '#15803d', opacity: 0.12 },
};

interface DrawHandle {
  setMode: (mode: string) => void;
  stop: () => void;
}

export function RoofMap(props: RoofMapProps) {
  const { apiKey, mapId, center, zoom = 20, mode, features } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const drawRef = useRef<DrawHandle | null>(null);
  const overlaysRef = useRef<google.maps.Polygon[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  // Callbacks are kept in a ref so the map effect can depend only on the API
  // key: re-creating the map because a parent re-rendered would throw away the
  // operator's pan and zoom in the middle of tracing a roof. The ref is
  // updated in an effect, not during render.
  const callbacksRef = useRef<RoofMapProps>(props);
  useEffect(() => {
    callbacksRef.current = props;
  });

  useEffect(() => {
    if (!apiKey || !containerRef.current || mapRef.current) return;
    let cancelled = false;
    setStatus('loading');

    void (async () => {
      try {
        await loadGoogleMaps(apiKey);
        if (cancelled || !containerRef.current) return;

        const { Map } = (await google.maps.importLibrary('maps')) as google.maps.MapsLibrary;

        const map = new Map(containerRef.current, {
          center: center ?? { lat: 35.681236, lng: 139.767125 },
          zoom,
          mapTypeId: 'satellite',
          // Tilt and rotation would mean a traced outline no longer matches the
          // imagery a second operator sees, so both stay off.
          tilt: 0,
          streetViewControl: false,
          fullscreenControl: true,
          mapTypeControl: true,
          ...(mapId ? { mapId } : {}),
        });
        mapRef.current = map;

        map.addListener('idle', () => {
          const c = map.getCenter();
          if (c) {
            callbacksRef.current.onCenterChanged?.(
              { lat: c.lat(), lng: c.lng() },
              map.getZoom() ?? zoom,
            );
          }
        });

        drawRef.current = await setupTerraDraw(map, (polygon) => {
          callbacksRef.current.onPolygonDrawn?.(polygon);
        });

        if (!cancelled) setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        console.error('[map] failed to initialise', err);
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      drawRef.current?.stop();
      drawRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  useEffect(() => {
    if (mapRef.current && center) {
      mapRef.current.setCenter(center);
      mapRef.current.setZoom(zoom);
    }
  }, [center, zoom]);

  useEffect(() => {
    const draw = drawRef.current;
    if (!draw || status !== 'ready') return;
    if (mode === 'roof' || mode === 'exclusion') draw.setMode('polygon');
    else if (mode === 'select') draw.setMode('select');
    else draw.setMode('static');
  }, [mode, status]);

  const onFeatureSelected = props.onFeatureSelected;

  const redraw = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const overlay of overlaysRef.current) overlay.setMap(null);
    overlaysRef.current = [];

    for (const feature of features) {
      const style = STYLE[feature.kind];
      const paths = feature.polygon.coordinates.map((ring) =>
        ring.map((pair) => ({ lat: pair[1]!, lng: pair[0]! })),
      );
      const polygon = new google.maps.Polygon({
        paths,
        map,
        fillColor: style.fill,
        fillOpacity: style.opacity,
        strokeColor: style.outline,
        strokeWeight: feature.kind === 'panel' ? 0.7 : 2,
        clickable: feature.kind === 'roof' || feature.kind === 'exclusion',
        zIndex: feature.kind === 'panel' ? 3 : feature.kind === 'exclusion' ? 2 : 1,
      });
      if (onFeatureSelected && (feature.kind === 'roof' || feature.kind === 'exclusion')) {
        polygon.addListener('click', () => onFeatureSelected(feature.id));
      }
      overlaysRef.current.push(polygon);
    }
  }, [features, onFeatureSelected]);

  useEffect(() => {
    if (status === 'ready') redraw();
  }, [status, redraw]);

  useEffect(
    () => () => {
      for (const overlay of overlaysRef.current) overlay.setMap(null);
      overlaysRef.current = [];
    },
    [],
  );

  if (!apiKey) {
    return (
      <div
        data-testid="map-unconfigured"
        className="flex min-h-[20rem] items-center justify-center rounded-lg border border-dashed border-[var(--border)] p-6"
      >
        <Alert tone="warning" title="Google Maps が未設定です">
          <p>
            衛星写真の表示と屋根の作図には Google Maps Platform の API キーが必要です。
            <code className="mx-1 rounded bg-black/10 px-1 py-0.5 text-xs">
              NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
            </code>
            を設定してください。手順は{' '}
            <code className="rounded bg-black/10 px-1 py-0.5 text-xs">
              docs/setup/google-maps.md
            </code>{' '}
            にあります。
          </p>
          <p className="mt-2">
            キーがなくても、「座標を直接入力」から屋根の座標を貼り付ければ、
            パネル配置とシミュレーションはそのまま利用できます。
          </p>
        </Alert>
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={containerRef}
        role="application"
        aria-label="屋根作図マップ"
        className="min-h-[20rem] w-full rounded-lg border border-[var(--border)] lg:min-h-[30rem]"
      />
      {status === 'loading' && (
        <div className="absolute inset-0 grid place-items-center rounded-lg bg-black/10 text-sm">
          地図を読み込み中…
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-x-2 top-2">
          <Alert tone="danger" title="地図を読み込めませんでした">
            {error}
          </Alert>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

let mapsLoader: Promise<void> | null = null;

/**
 * Load the Maps JS API once per page using Google's documented bootstrap, which
 * sets up `importLibrary` for on-demand library loading.
 */
function loadGoogleMaps(apiKey: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  // `importLibrary` is typed as always present, but it only exists once the
  // bootstrap script has run — hence the runtime check on `window.google`.
  if (window.google?.maps !== undefined) return Promise.resolve();
  if (mapsLoader) return mapsLoader;

  mapsLoader = new Promise<void>((resolve, reject) => {
    const params = new URLSearchParams({
      key: apiKey,
      v: 'weekly',
      language: 'ja',
      region: 'JP',
      loading: 'async',
      callback: '__solarKanriMapsReady',
    });
    (window as unknown as Record<string, unknown>).__solarKanriMapsReady = () => resolve();

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onerror = () => {
      mapsLoader = null;
      reject(
        new Error(
          'Google Maps の読み込みに失敗しました。APIキーの有効性とリファラ制限を確認してください。',
        ),
      );
    };
    document.head.appendChild(script);
  });
  return mapsLoader;
}

/**
 * Wire up Terra Draw against the Google Maps adapter. Imported dynamically so
 * pages that never draw do not pay for the bundle.
 */
async function setupTerraDraw(
  map: google.maps.Map,
  onFinished: (polygon: GeoJSONPolygonLike) => void,
): Promise<DrawHandle> {
  const [terraDraw, adapterModule] = await Promise.all([
    import('terra-draw'),
    import('terra-draw-google-maps-adapter'),
  ]);
  const { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode } = terraDraw;
  const { TerraDrawGoogleMapsAdapter } = adapterModule;

  const draw = new TerraDraw({
    adapter: new TerraDrawGoogleMapsAdapter({ map, lib: google.maps }),
    modes: [
      new TerraDrawPolygonMode({ pointerDistance: 20 }),
      new TerraDrawSelectMode({
        flags: {
          polygon: {
            feature: {
              draggable: true,
              rotateable: false,
              scaleable: false,
              coordinates: { midpoints: true, draggable: true, deletable: true },
            },
          },
        },
      }),
    ],
  });

  draw.start();
  draw.setMode('static');

  draw.on('finish', (id) => {
    const feature = draw.getSnapshot().find((f) => f.id === id);
    if (feature && feature.geometry.type === 'Polygon') {
      onFinished({
        type: 'Polygon',
        coordinates: feature.geometry.coordinates as number[][][],
      });
      // The drawn shape is handed to the app, which persists it and re-renders
      // it as a saved feature. Clearing avoids two copies of the same roof.
      draw.clear();
      draw.setMode('static');
    }
  });

  return {
    setMode: (m: string) => draw.setMode(m),
    stop: () => {
      try {
        draw.stop();
      } catch {
        // Already torn down by a fast unmount; nothing to do.
      }
    },
  };
}
