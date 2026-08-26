import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';
import { can } from '@/server/auth/rbac';
import { countUnverified } from '@/server/services/admin';
import { Alert } from '@/components/ui';

const SECTIONS = [
  { href: '/admin/coefficients', label: '係数', permission: 'master:read' },
  { href: '/admin/tariffs', label: '電力単価', permission: 'master:read' },
  { href: '/admin/panels', label: 'パネル', permission: 'master:read' },
  { href: '/admin/irradiance', label: '日射量', permission: 'master:read' },
  { href: '/admin/users', label: 'ユーザー', permission: 'user:manage' },
  { href: '/admin/health', label: 'システム状態', permission: 'health:read' },
  { href: '/admin/audit', label: '操作ログ', permission: 'audit:read' },
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  // The admin console is for people who can change something. A VIEWER holds
  // master:read so they can see product specs in a quotation context, but the
  // console itself is not for them — and the route must agree with the
  // navigation, because hiding a link is not access control.
  if (!can(user, 'master:write') && !can(user, 'user:manage')) redirect('/dashboard');

  const unverified = await countUnverified();
  const blocking = unverified.coefficients + unverified.tariffs + unverified.irradiance;

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="管理メニュー" className="flex flex-wrap gap-1">
        {SECTIONS.filter((s) => can(user, s.permission)).map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-muted)]"
          >
            {s.label}
          </Link>
        ))}
      </nav>

      {blocking > 0 && (
        <Alert tone="danger" title="シミュレーションが実行できない状態です">
          出典が未確認の項目が {blocking} 件あります（係数 {unverified.coefficients} / 電力単価{' '}
          {unverified.tariffs} / 日射量 {unverified.irradiance}）。
          計算エンジンは出典のない数値を使用しません。
          <Link href="/admin/coefficients" className="ml-1 font-medium underline">
            係数を確認する
          </Link>
        </Alert>
      )}

      {children}
    </div>
  );
}
