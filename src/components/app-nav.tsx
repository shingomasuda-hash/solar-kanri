'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import type { SessionUser } from '@/server/auth/session';
import { can } from '@/server/auth/rbac';
import { logoutAction } from '@/app/(app)/logout-action';

const NAV = [
  { href: '/dashboard', label: 'ダッシュボード' },
  { href: '/customers', label: '顧客' },
  { href: '/projects', label: '案件' },
] as const;

export function AppNav({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const showAdmin = can(user, 'master:write') || can(user, 'user:manage');

  return (
    <header className="border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/dashboard" className="text-sm font-bold whitespace-nowrap">
          ☀ 太陽光営業
        </Link>
        <nav className="flex flex-1 flex-wrap items-center gap-1" aria-label="メインナビゲーション">
          {NAV.map((item) => (
            <NavLink key={item.href} href={item.href} active={pathname.startsWith(item.href)}>
              {item.label}
            </NavLink>
          ))}
          {showAdmin && (
            <NavLink href="/admin" active={pathname.startsWith('/admin')}>
              管理
            </NavLink>
          )}
        </nav>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--text-muted)]">
            {user.name}
            <span className="ml-1 rounded bg-[var(--surface-muted)] px-1.5 py-0.5">
              {user.role}
            </span>
          </span>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-md px-2 py-1 text-xs hover:bg-[var(--surface-muted)]"
            >
              ログアウト
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'rounded-md px-3 py-1.5 text-sm transition-colors',
        active
          ? 'bg-brand-500/10 font-medium text-brand-700 dark:text-brand-100'
          : 'hover:bg-[var(--surface-muted)]',
      )}
    >
      {children}
    </Link>
  );
}
