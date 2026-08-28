import { prisma } from '../db/client';
import { requirePermission } from '../auth/rbac';
import type { SessionUser } from '../auth/session';
import { countUnverified } from './admin';

/**
 * System self-diagnostics for the admin console (project brief rule 31).
 *
 * Every probe is bounded and non-destructive, and a failing component never
 * takes the page down — the whole point is to be readable when something is
 * already broken.
 */

export type HealthState = 'ok' | 'degraded' | 'down' | 'not-configured';

export interface ComponentHealth {
  readonly component: string;
  readonly label: string;
  readonly state: HealthState;
  readonly message: string;
  readonly latencyMs?: number;
  /** What an administrator should do about it, when there is something to do. */
  readonly action?: string;
}

const TIMEOUT_MS = 5_000;

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = process.hrtime.bigint();
  const value = await fn();
  return { value, ms: Number(process.hrtime.bigint() - started) / 1e6 };
}

async function withTimeout<T>(fn: () => Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms),
    ),
  ]);
}

async function checkDatabase(): Promise<ComponentHealth> {
  try {
    const { ms } = await timed(() => withTimeout(() => prisma.$queryRaw`SELECT 1`));
    return {
      component: 'database',
      label: 'データベース',
      state: ms > 1000 ? 'degraded' : 'ok',
      message: ms > 1000 ? '応答が遅くなっています' : '正常',
      latencyMs: Math.round(ms),
    };
  } catch (err) {
    return {
      component: 'database',
      label: 'データベース',
      state: 'down',
      message: err instanceof Error ? err.message : String(err),
      action: 'DATABASE_URL と PostgreSQL の稼働状況を確認してください。',
    };
  }
}

function checkGoogleMaps(): ComponentHealth {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) {
    return {
      component: 'google-maps',
      label: 'Google Maps',
      state: 'not-configured',
      message: 'APIキーが未設定です。地図表示と屋根作図は利用できません。',
      action: 'docs/setup/google-maps.md の手順で NEXT_PUBLIC_GOOGLE_MAPS_API_KEY を設定。',
    };
  }
  return {
    component: 'google-maps',
    label: 'Google Maps',
    state: 'ok',
    message: 'APIキーが設定されています（実際の疎通はブラウザ側で確認されます）。',
  };
}

async function checkGeocoding(): Promise<ComponentHealth> {
  const key = process.env.GOOGLE_GEOCODING_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) {
    return {
      component: 'geocoding',
      label: 'Geocoding API',
      state: 'not-configured',
      message: 'APIキーが未設定です。住所検索は利用できません（緯度経度の直接入力は可能）。',
      action: 'docs/setup/google-maps.md の手順で GOOGLE_GEOCODING_API_KEY を設定。',
    };
  }
  try {
    const { value, ms } = await timed(() =>
      withTimeout(async () => {
        const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
        url.searchParams.set('address', '東京都千代田区');
        url.searchParams.set('key', key);
        const res = await fetch(url.toString());
        return (await res.json()) as { status?: string; error_message?: string };
      }),
    );
    if (value.status === 'OK') {
      return {
        component: 'geocoding',
        label: 'Geocoding API',
        state: 'ok',
        message: '正常',
        latencyMs: Math.round(ms),
      };
    }
    return {
      component: 'geocoding',
      label: 'Geocoding API',
      state: 'degraded',
      message: `${value.status ?? 'UNKNOWN'}: ${value.error_message ?? ''}`,
      action: 'APIキーの制限設定と課金の有効化を確認してください。',
    };
  } catch (err) {
    return {
      component: 'geocoding',
      label: 'Geocoding API',
      state: 'down',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkSolarProvider(): Promise<ComponentHealth> {
  const stations = await prisma.irradianceStation.count({ where: { isActive: true } });
  const pvgisEnabled = process.env.PVGIS_ENABLED !== 'false';

  if (stations === 0 && !pvgisEnabled) {
    return {
      component: 'solar-provider',
      label: '日射量プロバイダ',
      state: 'not-configured',
      message: '日射量データが一つも登録されておらず、PVGIS も無効です。',
      action: '管理画面で日射量データを登録するか、PVGIS_ENABLED を有効にしてください。',
    };
  }
  return {
    component: 'solar-provider',
    label: '日射量プロバイダ',
    state: 'ok',
    message: `登録済み観測点 ${stations} 件${pvgisEnabled ? ' / PVGIS 有効' : ''}`,
  };
}

function checkAiProvider(): ComponentHealth {
  const provider = process.env.AI_PROVIDER || 'anthropic';
  const key = provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return {
      component: 'ai-provider',
      label: 'AIプロバイダ',
      state: 'not-configured',
      message:
        'APIキーが未設定です。AIコパイロットは無効化されています（他機能に影響はありません）。',
      action: `${provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'} を設定。`,
    };
  }
  return {
    component: 'ai-provider',
    label: 'AIプロバイダ',
    state: 'ok',
    message: `${provider} のAPIキーが設定されています。`,
  };
}

/**
 * Coefficient readiness is a health concern, not just a data concern: while any
 * required coefficient is unverified, the platform cannot quote at all.
 */
async function checkCalculationReadiness(): Promise<ComponentHealth> {
  const unverified = await countUnverified();
  const total =
    unverified.coefficients + unverified.tariffs + unverified.panels + unverified.irradiance;
  // Demo mode is reported before the count, and as 'degraded' rather than
  // 'down': the platform works, which is the whole point, but a green light
  // here would say the figures are ready to quote, and they are not.
  if (unverified.demoActive) {
    return {
      component: 'calculation',
      label: '計算エンジン（係数の出典）',
      state: 'degraded',
      message:
        'デモ用の概算データが既定になっています。シミュレーションは動作しますが、' +
        'すべて参考値として表示され、見積は発行できません。',
      action:
        '管理画面 → 係数・単価 で実データのセットを既定に切り替えてください' +
        '（docs/setup/panel-catalogue.md）。',
    };
  }

  if (total === 0) {
    return {
      component: 'calculation',
      label: '計算エンジン（係数の出典）',
      state: 'ok',
      message: 'すべての係数に出典が登録されています。',
    };
  }
  return {
    component: 'calculation',
    label: '計算エンジン（係数の出典）',
    state: 'down',
    message:
      `出典未確認: 係数 ${unverified.coefficients} 件 / 電力単価 ${unverified.tariffs} 件 / ` +
      `パネル ${unverified.panels} 件 / 日射量 ${unverified.irradiance} 件。` +
      'この状態ではシミュレーションは実行できません。',
    action:
      '管理画面 → 係数・単価 で出典を登録してください（docs/open-issues.md OI-002, OI-003）。',
  };
}

async function checkStorage(): Promise<ComponentHealth> {
  const files = await prisma.fileAsset.count();
  return {
    component: 'storage',
    label: 'ファイルストレージ',
    state: 'ok',
    message: `登録ファイル ${files} 件`,
  };
}

export async function runHealthChecks(user: SessionUser): Promise<ComponentHealth[]> {
  requirePermission(user, 'health:read');

  // Run concurrently; a slow external probe must not delay the whole page.
  const results = await Promise.all([
    checkDatabase(),
    Promise.resolve(checkGoogleMaps()),
    checkGeocoding(),
    checkSolarProvider(),
    Promise.resolve(checkAiProvider()),
    checkCalculationReadiness(),
    checkStorage(),
  ]);

  // Best-effort history so the console can show recency, not just a live probe.
  void prisma.healthCheck
    .createMany({
      data: results.map((r) => ({
        component: r.component,
        isHealthy: r.state === 'ok',
        latencyMs: r.latencyMs ?? null,
        message: r.message.slice(0, 500),
      })),
    })
    .catch((err) => console.error('[health] failed to record history', err));

  return results;
}

export async function recentHealthHistory(component: string, take = 20) {
  return prisma.healthCheck.findMany({
    where: { component },
    orderBy: { checkedAt: 'desc' },
    take,
  });
}
