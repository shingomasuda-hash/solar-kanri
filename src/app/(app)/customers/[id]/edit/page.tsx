import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';
import { can } from '@/server/auth/rbac';
import { getCustomer } from '@/server/services/customers';
import { prisma } from '@/server/db/client';
import { PageHeader } from '@/components/ui';
import { CustomerForm } from '../../customer-form';
import { updateCustomerAction } from '../../actions';

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const { id } = await params;
  if (!can(user, 'customer:write')) redirect(`/customers/${id}`);

  const customer = await getCustomer(user, id);
  if (!customer) notFound();

  const owners = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  return (
    <>
      <PageHeader title="顧客を編集" subtitle={customer.name} />
      <CustomerForm
        action={updateCustomerAction}
        owners={owners}
        defaults={customer}
        submitLabel="更新する"
      />
    </>
  );
}
