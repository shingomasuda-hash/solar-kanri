'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { clearSessionCookie, logout } from '@/server/auth/service';
import { SESSION_COOKIE } from '@/server/auth/session';

export async function logoutAction(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await logout(token);
  await clearSessionCookie();
  redirect('/login');
}
