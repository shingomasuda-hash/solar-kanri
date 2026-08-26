'use client';

import { useActionState } from 'react';
import { Badge, Select } from '@/components/ui';
import { setUserActiveAction, updateUserRoleAction, type FormState } from '../actions';

const ROLES = [
  { value: 'ADMIN', label: '管理者' },
  { value: 'MANAGER', label: 'マネージャー' },
  { value: 'SALES', label: '営業' },
  { value: 'VIEWER', label: '閲覧のみ' },
];

export function UserRow({
  user,
  isSelf,
}: {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    isActive: boolean;
    lastLoginAt: string | null;
  };
  isSelf: boolean;
}) {
  const [roleState, changeRole] = useActionState<FormState, FormData>(updateUserRoleAction, {});
  const [activeState, setActive] = useActionState<FormState, FormData>(setUserActiveAction, {});
  const error = roleState.error ?? activeState.error;

  return (
    <tr className="border-b border-[var(--border)] last:border-0">
      <td className="px-4 py-3 font-medium">
        {user.name}
        {isSelf && <span className="ml-1 text-xs text-[var(--text-muted)]">（自分）</span>}
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {error}
          </p>
        )}
      </td>
      <td className="px-4 py-3 text-xs">{user.email}</td>
      <td className="px-4 py-3">
        {isSelf ? (
          <Badge>{ROLES.find((r) => r.value === user.role)?.label ?? user.role}</Badge>
        ) : (
          <form action={changeRole}>
            <input type="hidden" name="id" value={user.id} />
            <Select
              name="role"
              defaultValue={user.role}
              aria-label={`${user.name} の権限`}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className="w-40"
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </form>
        )}
      </td>
      <td className="px-4 py-3 text-xs tabular-nums">
        {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('ja-JP') : '—'}
      </td>
      <td className="px-4 py-3">
        {isSelf ? (
          <Badge className="bg-emerald-500/10 text-emerald-700">有効</Badge>
        ) : (
          <form action={setActive}>
            <input type="hidden" name="id" value={user.id} />
            <input type="hidden" name="isActive" value={String(!user.isActive)} />
            <button
              type="submit"
              aria-label={`${user.name} を${user.isActive ? '無効化' : '有効化'}`}
            >
              {user.isActive ? (
                <Badge className="bg-emerald-500/10 text-emerald-700">有効</Badge>
              ) : (
                <Badge>無効</Badge>
              )}
            </button>
          </form>
        )}
      </td>
    </tr>
  );
}
