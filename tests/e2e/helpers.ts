import { expect, type Page } from '@playwright/test';

export const SEED_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMeImmediately!2026';

export const ACCOUNTS = {
  admin: { email: 'admin@example.com', password: SEED_PASSWORD },
  manager: { email: 'manager@example.com', password: SEED_PASSWORD },
  sales: { email: 'sales@example.com', password: SEED_PASSWORD },
  viewer: { email: 'viewer@example.com', password: SEED_PASSWORD },
} as const;

export async function login(page: Page, account: keyof typeof ACCOUNTS = 'admin'): Promise<void> {
  const { email, password } = ACCOUNTS[account];
  await page.goto('/login');
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード').fill(password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await page.waitForURL(/\/dashboard$/);
}

/** A name unique to this run, so tests never collide on shared seed data. */
export function uniqueName(prefix: string): string {
  return `${prefix}-${uniqueSuffix()}`;
}

/**
 * ASCII-only suffix. Used for email local parts, where the browser's own
 * `type="email"` validation rejects non-ASCII and would silently block the
 * form before any server code runs.
 */
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * Set one coefficient's source kind through the admin UI.
 *
 * Tests that depend on the verified/unverified state must establish it
 * themselves: coefficients are global master data, so relying on seed state
 * makes a test order-dependent and it will pass alone and fail in a suite.
 */
export async function setCoefficientSource(
  page: Page,
  key: string,
  sourceKind: 'ADMINISTRATOR_INPUT' | 'UNVERIFIED_PLACEHOLDER',
  citation = 'E2E TEST DATA — synthetic value, not a real-world figure',
): Promise<void> {
  await page.goto('/admin/coefficients');
  const row = page.getByTestId(`coefficient-${key}`);
  await row.getByRole('button', { name: '編集' }).click();
  await row.locator('select[name="sourceKind"]').selectOption(sourceKind);
  await row.locator('input[name="sourceCitation"]').fill(citation);
  await row.getByRole('button', { name: '保存' }).click();
  await expect(row).toHaveAttribute(
    'data-verified',
    sourceKind === 'UNVERIFIED_PLACEHOLDER' ? 'false' : 'true',
    { timeout: 15_000 },
  );
}
