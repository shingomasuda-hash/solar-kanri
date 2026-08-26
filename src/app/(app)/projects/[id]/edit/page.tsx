import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';
import { can } from '@/server/auth/rbac';
import { getProject, listSalesStatuses } from '@/server/services/projects';
import { prisma } from '@/server/db/client';
import { PageHeader } from '@/components/ui';
import { ProjectForm } from '../../project-form';
import { updateProjectAction } from '../../actions';

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const { id } = await params;
  if (!can(user, 'project:write')) redirect(`/projects/${id}`);

  const project = await getProject(user, id);
  if (!project) notFound();

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

  return (
    <>
      <PageHeader title="案件を編集" subtitle={project.title} />
      <ProjectForm
        action={updateProjectAction}
        customers={customers}
        statuses={statuses}
        owners={owners}
        defaults={project}
        submitLabel="更新する"
      />
    </>
  );
}
