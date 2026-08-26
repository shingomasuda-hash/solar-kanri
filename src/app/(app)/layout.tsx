import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';
import { AppNav } from '@/components/app-nav';

/**
 * Authenticated shell. Every route in this group is behind the session check —
 * middleware would be cheaper, but a server-side check here cannot be bypassed
 * by a route that forgets to opt in.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <div className="flex min-h-screen flex-col">
      <AppNav user={user} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
