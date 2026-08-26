import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';
import { can } from '@/server/auth/rbac';
import { prisma } from '@/server/db/client';
import { listSalesStatuses } from '@/server/services/projects';
import { EmptyState, LinkButton, PageHeader } from '@/components/ui';
import { ProjectForm } from '../project-form';
import { createProjectAction } from '../actions';

export const metadata = { title: '案件を作成' };

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!can(user, 'project:write')) redirect('/projects');

  const { customerId } = await searchParams;
  const [customers, statuses, owners] = await Promise.all([
    prisma.customer.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, code: true },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    }),
    listSalesStatuses(),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  if (customers.length === 0) {
    return (
      <>
        <PageHeader title="案件を作成" />
        <EmptyState
          title="先に顧客を登録してください"
          description="案件は顧客に紐づきます。顧客を登録してから案件を作成します。"
          action={<LinkButton href="/customers/new">顧客を登録</LinkButton>}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="案件を作成" />
      <ProjectForm
        action={createProjectAction}
        customers={customers}
        statuses={statuses}
        owners={owners}
        defaults={{ customerId, statusId: statuses[0]?.id }}
        submitLabel="作成する"
      />
    </>
  );
}
