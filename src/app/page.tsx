import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';

export default async function RootPage() {
  redirect((await getCurrentUser()) ? '/dashboard' : '/login');
}
