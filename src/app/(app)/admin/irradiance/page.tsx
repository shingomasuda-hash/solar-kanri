import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';
import { can } from '@/server/auth/rbac';
import { listIrradianceStations } from '@/server/services/admin';
import { Alert, PageHeader } from '@/components/ui';
import { IrradianceEditor } from './irradiance-editor';

export const metadata = { title: '日射量データ' };

export default async function IrradiancePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const stations = await listIrradianceStations(user);

  return (
    <>
      <PageHeader
        title="日射量データ"
        subtitle="観測点ごとの月別日射量と気温。NEDO METPV などの公的データを転記します。"
      />
      <Alert tone="info" title="単位に注意してください">
        入力単位は <strong>kWh/m²/日</strong> です。MJ/m²/日 の資料から転記する場合は 3.6
        で割ってください。物理的にありえない大きさの値は保存時に拒否されます。
      </Alert>
      <div className="mt-5">
        <IrradianceEditor
          canWrite={can(user, 'master:write')}
          stations={stations.map((s) => ({
            id: s.id,
            label: s.label,
            latitude: s.latitude,
            longitude: s.longitude,
            irradiation: monthSeries(s.monthlyIrradiationKWhPerM2PerDay),
            temperature: monthSeries(s.monthlyAmbientTempC),
            isPlaneOfArray: s.isPlaneOfArray,
            sourceKind: s.sourceKind,
            sourceCitation: s.sourceCitation,
          }))}
        />
      </div>
    </>
  );
}

function monthSeries(value: unknown): number[] {
  const src = (value ?? {}) as Record<string, unknown>;
  return Array.from({ length: 12 }, (_, i) => {
    const v = src[String(i + 1)];
    return typeof v === 'number' ? v : 0;
  });
}
