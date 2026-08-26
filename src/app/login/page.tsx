import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';
import { LoginForm } from './login-form';

export const metadata = { title: 'ログイン | 太陽光営業統合プラットフォーム' };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect('/dashboard');

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-lg font-bold">太陽光営業統合プラットフォーム</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Solar sales platform</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
