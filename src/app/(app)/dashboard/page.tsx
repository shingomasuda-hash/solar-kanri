import { getCurrentUser } from '@/server/auth/service';
import { PageHeader, Stat } from '@/components/ui';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  return (
    <>
      <PageHeader title="ダッシュボード" subtitle={`${user?.name} さん、おつかれさまです`} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="進行中の案件" value="—" />
        <Stat label="今週の対応予定" value="—" />
        <Stat label="今月の見積提出" value="—" />
        <Stat label="今月の受注" value="—" />
      </div>
    </>
  );
}
