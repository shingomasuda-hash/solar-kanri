import { expect, test } from '@playwright/test';

const ADMIN = { email: 'admin@example.com', password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMeImmediately!2026' };

test.describe('authentication', () => {
  test('an anonymous visitor is sent to the login page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: '太陽光営業統合プラットフォーム' })).toBeVisible();
  });

  test('the dashboard is not reachable without a session', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('bad credentials are rejected without revealing whether the account exists', async ({
    page,
  }) => {
    // Scoped to the form: Next.js's own route announcer also carries role=alert.
    const formAlert = page.locator('form [role="alert"]');

    await page.goto('/login');
    await page.getByLabel('メールアドレス').fill('nobody@example.com');
    await page.getByLabel('パスワード').fill('wrong-password-here');
    await page.getByRole('button', { name: 'ログイン' }).click();
    await expect(formAlert).toBeVisible();
    const wrongUser = await formAlert.textContent();

    await page.getByLabel('メールアドレス').fill(ADMIN.email);
    await page.getByLabel('パスワード').fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'ログイン' }).click();
    await expect(formAlert).toBeVisible();
    const wrongPassword = await formAlert.textContent();

    // The two messages must be identical, or the form is an account oracle.
    expect(wrongPassword).toBe(wrongUser);
    expect(wrongUser).toContain('メールアドレスまたはパスワードが正しくありません');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a valid login reaches the dashboard and can log out again', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('メールアドレス').fill(ADMIN.email);
    await page.getByLabel('パスワード').fill(ADMIN.password);
    await page.getByRole('button', { name: 'ログイン' }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible();

    await page.getByRole('button', { name: 'ログアウト' }).click();
    await expect(page).toHaveURL(/\/login$/);

    // The session must be genuinely gone, not just navigated away from.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });
});
