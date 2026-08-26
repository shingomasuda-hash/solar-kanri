import { expect, test } from '@playwright/test';

const ADMIN = {
  email: 'admin@example.com',
  password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMeImmediately!2026',
};

test.describe('authentication', () => {
  test('an anonymous visitor is sent to the login page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole('heading', { name: '太陽光営業統合プラットフォーム' }),
    ).toBeVisible();
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

test.describe('login rate limiting', () => {
  test('repeated failures are throttled, and a real login still works after', async ({ page }) => {
    // A distinct address per run: the account bucket is keyed by email, and a
    // shared one would make this test order-dependent.
    const victim = `ratelimit-${Date.now().toString(36)}@example.com`;
    const formAlert = page.locator('form [role="alert"]');

    await page.goto('/login');
    let throttled = false;
    for (let attempt = 0; attempt < 14; attempt++) {
      await page.getByLabel('メールアドレス').fill(victim);
      await page.getByLabel('パスワード').fill(`wrong-password-${attempt}`);

      // Wait for the round trip, not just for an alert to be visible: the
      // previous attempt's alert is still on screen, and useActionState drops
      // a submit while one is in flight — so clicking on a stale alert
      // silently loses attempts.
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/login')),
        page.getByRole('button', { name: 'ログイン' }).click(),
      ]);
      expect(response.status()).toBeLessThan(500);

      const message = (await formAlert.textContent()) ?? '';
      if (message.includes('ログイン試行が多すぎます')) {
        throttled = true;
        break;
      }
    }
    expect(throttled, 'brute force was never throttled').toBe(true);

    // The throttle is per account, and it counts FAILURES only — so a
    // different, valid account from the same address is unaffected. Getting
    // this wrong would let a shared office IP lock itself out simply by having
    // people log in, which is how the suite itself caught the original bug.
    await page.goto('/login');
    await page.getByLabel('メールアドレス').fill(ADMIN.email);
    await page.getByLabel('パスワード').fill(ADMIN.password);
    await page.getByRole('button', { name: 'ログイン' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('successful logins never consume the budget', async ({ page }) => {
    // Twelve successful logins from one address, well past both limits. If a
    // success counted, this would throttle — and so would a real office.
    for (let i = 0; i < 12; i++) {
      await page.goto('/login');
      await page.getByLabel('メールアドレス').fill(ADMIN.email);
      await page.getByLabel('パスワード').fill(ADMIN.password);
      await page.getByRole('button', { name: 'ログイン' }).click();
      await expect(page, `login ${i + 1} was refused`).toHaveURL(/\/dashboard$/);
      await page.getByRole('button', { name: 'ログアウト' }).click();
      await expect(page).toHaveURL(/\/login$/);
    }
  });
});
