import { expect, test } from '@playwright/test';
import { login, uniqueName, uniqueSuffix } from './helpers';

test.describe('CRM flow', () => {
  test('a customer can be registered, found, edited and given a project', async ({ page }) => {
    await login(page, 'admin');
    const suffix = uniqueSuffix();
    const name = uniqueName('テスト顧客');

    // --- register ---------------------------------------------------------
    await page.goto('/customers');
    await page.getByRole('link', { name: '顧客を登録' }).first().click();
    await expect(page).toHaveURL(/\/customers\/new$/);

    await page.getByLabel('氏名').fill(name);
    await page.getByLabel('フリガナ').fill('テストコキャク');
    await page.getByLabel('電話番号').fill('03-1234-5678');
    await page.getByLabel('メールアドレス').fill(`test-${suffix}@example.com`);
    await page.getByLabel('郵便番号').fill('100-0001');
    await page.getByLabel('都道府県').fill('東京都');
    await page.getByLabel('市区町村').fill('千代田区');
    await page.getByRole('button', { name: '登録する' }).click();

    await expect(page).toHaveURL(/\/customers\/[a-z0-9]+$/);
    await expect(page.getByRole('heading', { name })).toBeVisible();
    // A customer code must have been assigned automatically.
    await expect(page.getByText(/^C-\d{6}$/)).toBeVisible();

    const customerUrl = page.url();

    // --- search finds it --------------------------------------------------
    await page.goto('/customers');
    await page.getByRole('searchbox', { name: '顧客を検索' }).fill(name);
    await page.getByRole('button', { name: '検索' }).click();
    await expect(page.getByRole('link', { name })).toBeVisible();

    // --- edit persists ----------------------------------------------------
    await page.goto(customerUrl);
    await page.getByRole('link', { name: '編集' }).click();
    await page.getByLabel('会社名').fill('テスト株式会社');
    await page.getByRole('button', { name: '更新する' }).click();
    await expect(page.getByText('テスト株式会社').first()).toBeVisible();

    // --- create a project from the customer -------------------------------
    await page.getByRole('link', { name: '案件を作成' }).first().click();
    await expect(page).toHaveURL(/\/projects\/new/);

    const projectTitle = uniqueName('テスト案件');
    await page.getByLabel('案件名').fill(projectTitle);
    await expect(page.getByLabel('顧客')).not.toHaveValue('');
    await page.getByRole('button', { name: '作成する' }).click();

    await expect(page).toHaveURL(/\/projects\/[a-z0-9]+$/);
    await expect(page.getByRole('heading', { name: projectTitle })).toBeVisible();
    await expect(page.getByText(/^P-\d{6}$/)).toBeVisible();
  });

  test('a project records activities, tasks and notes', async ({ page }) => {
    await login(page, 'admin');

    const customerName = uniqueName('活動テスト');
    await page.goto('/customers/new');
    await page.getByLabel('氏名').fill(customerName);
    await page.getByRole('button', { name: '登録する' }).click();
    await page.getByRole('link', { name: '案件を作成' }).first().click();

    const projectTitle = uniqueName('活動案件');
    await page.getByLabel('案件名').fill(projectTitle);
    await page.getByRole('button', { name: '作成する' }).click();
    await expect(page).toHaveURL(/\/projects\/[a-z0-9]+$/);

    // Activity
    await page.getByLabel('件名').fill('初回ヒアリング');
    await page.getByLabel('内容').fill('屋根の状態と電気使用量を確認');
    await page.getByRole('button', { name: '記録する' }).click();
    await expect(page.getByText('初回ヒアリング')).toBeVisible();
    await expect(page.getByText('屋根の状態と電気使用量を確認')).toBeVisible();

    // Task, then complete it
    await page.getByRole('textbox', { name: 'タスク名' }).fill('見積書を送付する');
    await page.getByRole('button', { name: 'タスクを追加', exact: true }).click();
    await expect(page.getByText('見積書を送付する')).toBeVisible();
    await page.getByRole('button', { name: '見積書を送付する を完了にする' }).click();
    await expect(
      page.getByRole('button', { name: '見積書を送付する を未完了に戻す' }),
    ).toBeVisible();

    // Note
    await page.getByRole('textbox', { name: 'メモ' }).fill('北側は影の影響あり');
    await page.getByRole('button', { name: 'メモを追加', exact: true }).click();
    await expect(page.getByText('北側は影の影響あり')).toBeVisible();
  });

  test('changing status is recorded on the timeline', async ({ page }) => {
    await login(page, 'admin');

    const customerName = uniqueName('ステータス');
    await page.goto('/customers/new');
    await page.getByLabel('氏名').fill(customerName);
    await page.getByRole('button', { name: '登録する' }).click();
    await page.getByRole('link', { name: '案件を作成' }).first().click();
    await page.getByLabel('案件名').fill(uniqueName('ステータス案件'));
    await page.getByRole('button', { name: '作成する' }).click();

    await page.getByLabel('ステータスを変更').selectOption({ label: '提案中' });
    await expect(page.getByText('ステータス変更: 提案中')).toBeVisible();
  });
});

test.describe('access control', () => {
  test('a viewer cannot see the create buttons', async ({ page }) => {
    await login(page, 'viewer');
    await page.goto('/customers');
    await expect(page.getByRole('link', { name: '顧客を登録' })).toHaveCount(0);
    await page.goto('/projects');
    await expect(page.getByRole('link', { name: '案件を作成' })).toHaveCount(0);
  });

  test('a viewer is redirected away from the create form, not just hidden from it', async ({
    page,
  }) => {
    // Hiding a button is not access control — the route itself must refuse.
    await login(page, 'viewer');
    await page.goto('/customers/new');
    await expect(page).toHaveURL(/\/customers$/);
    await page.goto('/projects/new');
    await expect(page).toHaveURL(/\/projects$/);
  });

  test('a viewer does not see the admin navigation', async ({ page }) => {
    await login(page, 'viewer');
    await expect(page.getByRole('link', { name: '管理' })).toHaveCount(0);
  });

  test('an admin does see the admin navigation', async ({ page }) => {
    await login(page, 'admin');
    await expect(page.getByRole('link', { name: '管理' })).toBeVisible();
  });
});
