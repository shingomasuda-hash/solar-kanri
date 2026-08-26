import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';
import { can } from '@/server/auth/rbac';
import { prisma } from '@/server/db/client';
import { PageHeader } from '@/components/ui';
import { CustomerForm } from '../customer-form';
import { createCustomerAction } from '../actions';

export const metadata = { title: '顧客を登録' };

export default async function NewCustomerPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!can(user, 'customer:write')) redirect('/customers');

  const owners = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  return (
    <>
      <PageHeader title="顧客を登録" subtitle="問い合わせを受けたら、まず顧客を登録します" />
      <CustomerForm action={createCustomerAction} owners={owners} submitLabel="登録する" />
    </>
  );
}
