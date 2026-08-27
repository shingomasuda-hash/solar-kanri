/**
 * Turn an infrastructure failure into a sentence an operator can act on.
 *
 * A deployment that is missing its database does not need "please try again
 * later" — waiting will never fix it, and the message sends the operator away
 * from the one thing that would. These faults are deterministic: the same
 * request will fail the same way until a person changes a setting.
 *
 * **What may be said and what may not.** The name of an environment variable
 * and the address of the setup guide are already public in this repository, so
 * naming them costs nothing. A connection string, a host name, a user name or
 * a stack trace is never included — those are exactly what an attacker probing
 * a half-configured deployment would want. The detail stays in the server log.
 */

export type SetupFault =
  | 'database-url-missing'
  | 'database-unreachable'
  | 'database-credentials'
  | 'database-missing'
  | 'migrations-not-applied';

export interface SetupDiagnosis {
  readonly fault: SetupFault;
  /** Shown to whoever hit the error. Safe for an unauthenticated screen. */
  readonly message: string;
}

const MESSAGES: Record<SetupFault, string> = {
  'database-url-missing':
    'サーバーにデータベース接続情報（DATABASE_URL）が設定されていません。' +
    'デプロイ環境の環境変数を確認してください（docs/setup/deployment.md）。',
  'database-unreachable':
    'データベースに接続できません。接続先とネットワーク許可設定を確認してください' +
    '（docs/setup/deployment.md）。',
  'database-credentials':
    'データベースの認証に失敗しました。DATABASE_URL のユーザー名とパスワードを' +
    '確認してください（docs/setup/deployment.md）。',
  'database-missing':
    '指定されたデータベースが存在しません。DATABASE_URL のデータベース名を' +
    '確認してください（docs/setup/deployment.md）。',
  'migrations-not-applied':
    'データベースにテーブルがありません。`prisma migrate deploy` と `npm run db:seed` を' +
    '実行してください（docs/setup/deployment.md）。',
};

/**
 * Classify an error as a setup fault, or return null if it is something else.
 *
 * Matching is on codes where the driver gives one and on message text where it
 * does not. Text matching is deliberately narrow: a phrase that is too loose
 * would eventually classify a genuine bug as a configuration problem and send
 * the operator to check settings that were fine all along.
 */
export function diagnoseSetupFault(err: unknown): SetupDiagnosis | null {
  const fault = classify(err);
  return fault ? { fault, message: MESSAGES[fault] } : null;
}

function classify(err: unknown): SetupFault | null {
  const text = collectText(err);
  if (text === '') return null;

  if (text.includes('DATABASE_URL is not set')) return 'database-url-missing';

  // Postgres SQLSTATE, surfaced by the pg driver adapter.
  if (text.includes('28P01') || text.includes('password authentication failed')) {
    return 'database-credentials';
  }
  if (text.includes('3D000')) return 'database-missing';
  if (text.includes('42P01') || (text.includes('relation') && text.includes('does not exist'))) {
    return 'migrations-not-applied';
  }

  // Prisma initialisation codes.
  if (text.includes('P1000')) return 'database-credentials';
  if (text.includes('P1001') || text.includes('P1017')) return 'database-unreachable';
  if (text.includes('P1003')) return 'database-missing';
  if (text.includes('P2021')) return 'migrations-not-applied';

  if (
    text.includes('ECONNREFUSED') ||
    text.includes('ENOTFOUND') ||
    text.includes('ETIMEDOUT') ||
    text.includes('EAI_AGAIN') ||
    text.includes("Can't reach database server")
  ) {
    return 'database-unreachable';
  }

  return null;
}

/** Error causes nest; the useful code is often two levels down. */
function collectText(err: unknown, depth = 0): string {
  if (depth > 4 || err === null || err === undefined) return '';
  if (typeof err === 'string') return err;
  if (typeof err !== 'object') return String(err);

  const e = err as { message?: unknown; code?: unknown; cause?: unknown };
  return [
    typeof e.message === 'string' ? e.message : '',
    typeof e.code === 'string' ? e.code : '',
    collectText(e.cause, depth + 1),
  ]
    .filter(Boolean)
    .join(' | ');
}
