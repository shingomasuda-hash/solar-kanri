import { expect, test, type Page } from '@playwright/test';
import { login, uniqueName } from './helpers';

/**
 * Quotation lifecycle: draft → issue → immutable, plus the printable document.
 */

async function createProject(page: Page): Promise<string> {
  await page.goto('/customers/new');
  await page.getByLabel('氏名').fill(uniqueName('見積顧客'));
  await page.getByLabel('都道府県').fill('東京都');
  await page.getByLabel('市区町村').fill('千代田区');
  await page.getByRole('button', { name: '登録する' }).click();
  await page.getByRole('link', { name: '案件を作成' }).first().click();
  await page.getByLabel('案件名').fill(uniqueName('見積案件'));
  await page.getByRole('button', { name: '作成する' }).click();
  await page.waitForURL(/\/projects\/c[a-z0-9]+$/);
  return page.url().split('/').pop()!;
}

async function fillLine(
  page: Page,
  index: number,
  values: { name: string; quantity: string; unit: string; price: string },
): Promise<void> {
  const row = page.getByTestId(`quotation-row-${index}`);
  await row.getByLabel('品名').fill(values.name);
  await row.getByLabel('数量').fill(values.quantity);
  await row.getByLabel('単位').fill(values.unit);
  await row.getByLabel('単価 (円)').fill(values.price);
}

test.describe('quotation', () => {
  test('is built, totalled, issued, and then immutable', async ({ page }) => {
    await login(page, 'admin');
    const projectId = await createProject(page);
    await page.goto(`/projects/${projectId}/quotations/new`);

    await page.getByLabel('件名').fill('テスト見積書');

    // Two line items: 20 x 45,000 = 900,000 and 1 x 300,000.
    await fillLine(page, 0, { name: 'モジュール', quantity: '20', unit: '枚', price: '45000' });
    await page.getByRole('button', { name: '明細を追加' }).click();
    await fillLine(page, 1, { name: '設置工事', quantity: '1', unit: '式', price: '300000' });

    await page.getByLabel('値引き (円)').fill('50000');
    await page.getByLabel('補助金 (円)').fill('100000');

    // The live preview uses the same engine the server will use.
    // subtotal 1,200,000 - discount 50,000 = 1,150,000; tax 115,000;
    // total 1,265,000; net after subsidy 1,165,000.
    const preview = page.getByTestId('quotation-preview');
    await expect(preview).toHaveAttribute('data-total', '1265000');
    await expect(preview).toContainText('1,265,000');
    await expect(preview).toContainText('1,165,000');

    await page.getByRole('button', { name: '見積を作成' }).click();
    await expect(page).toHaveURL(/\/quotations\/c[a-z0-9]+$/);

    // Stored totals must match what the preview showed.
    const totals = page.getByTestId('quotation-totals');
    await expect(totals).toContainText('1,265,000');
    await expect(totals).toContainText('1,165,000');
    await expect(page.getByText('下書き')).toBeVisible();

    // --- issue ------------------------------------------------------------
    await page.getByRole('button', { name: 'この内容で発行する' }).click();
    await expect(page.getByText('発行済', { exact: true })).toBeVisible();

    // --- immutable --------------------------------------------------------
    // The edit link disappears, and the route itself refuses. Hiding the link
    // alone would not be enough.
    await expect(page.getByRole('link', { name: '編集' })).toHaveCount(0);
    await page.goto(`${page.url().replace(/\/$/, '')}/edit`);
    await expect(page.getByText('発行済みの見積は編集できません')).toBeVisible();
  });

  test('the printable document shows the frozen figures and its engine versions', async ({
    page,
  }) => {
    await login(page, 'admin');
    const projectId = await createProject(page);
    await page.goto(`/projects/${projectId}/quotations/new`);

    await page.getByLabel('件名').fill('印刷テスト見積書');
    await fillLine(page, 0, { name: 'モジュール', quantity: '10', unit: '枚', price: '50000' });
    await page.getByRole('button', { name: '見積を作成' }).click();
    await expect(page).toHaveURL(/\/quotations\/c[a-z0-9]+$/);

    await page.goto(`${page.url()}/print`);

    await expect(page.getByRole('heading', { name: '御見積書' })).toBeVisible();
    await expect(page.getByText('印刷テスト見積書')).toBeVisible();
    // 10 x 50,000 appears as both the line amount and the subtotal.
    await expect(page.getByText('500,000')).toHaveCount(2);
    // Tax at 10% and the grand total banner.
    await expect(page.getByText('550,000 円')).toBeVisible();
    // The engine-version footer is what makes a figure traceable years later.
    await expect(page.getByText(/算定エンジン/)).toBeVisible();
    // Print affordance, not a server-side PDF (ADR-007).
    await expect(page.getByRole('button', { name: /印刷/ })).toBeVisible();
  });

  test('refuses a discount larger than the subtotal', async ({ page }) => {
    await login(page, 'admin');
    const projectId = await createProject(page);
    await page.goto(`/projects/${projectId}/quotations/new`);

    await page.getByLabel('件名').fill('値引き超過テスト');
    await fillLine(page, 0, { name: 'モジュール', quantity: '1', unit: '枚', price: '10000' });
    await page.getByLabel('値引き (円)').fill('99999999');

    // Caught in the live preview before the operator can even submit.
    await expect(page.getByText(/値引き.*小計.*超えています/)).toBeVisible();

    await page.getByRole('button', { name: '見積を作成' }).click();
    // And refused server-side too, if they submit anyway.
    await expect(page).toHaveURL(/\/quotations\/new$/);
  });

  test('a quotation appears on the project screen', async ({ page }) => {
    await login(page, 'admin');
    const projectId = await createProject(page);
    await page.goto(`/projects/${projectId}/quotations/new`);
    await page.getByLabel('件名').fill('一覧テスト見積');
    await fillLine(page, 0, { name: 'モジュール', quantity: '5', unit: '枚', price: '40000' });
    await page.getByRole('button', { name: '見積を作成' }).click();
    await expect(page).toHaveURL(/\/quotations\/c[a-z0-9]+$/);

    await page.goto(`/projects/${projectId}`);
    await expect(page.getByRole('link', { name: /一覧テスト見積/ })).toBeVisible();
    await expect(page.getByText('220,000 円')).toBeVisible();
  });
});

test.describe('quotation access control', () => {
  test('a viewer cannot open the create form', async ({ page }) => {
    await login(page, 'admin');
    const projectId = await createProject(page);

    await page.getByRole('button', { name: 'ログアウト' }).click();
    await login(page, 'viewer');
    await page.goto(`/projects/${projectId}/quotations/new`);
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
  });

  test('a sales user can draft but not issue', async ({ page }) => {
    // SALES holds quotation:write but not quotation:issue — drafting a proposal
    // is routine, committing the company to a price is not.
    await login(page, 'sales');
    const projectId = await createProject(page);
    await page.goto(`/projects/${projectId}/quotations/new`);
    await page.getByLabel('件名').fill('営業担当の見積');
    await fillLine(page, 0, { name: 'モジュール', quantity: '5', unit: '枚', price: '40000' });
    await page.getByRole('button', { name: '見積を作成' }).click();
    await expect(page).toHaveURL(/\/quotations\/c[a-z0-9]+$/);

    await expect(page.getByRole('button', { name: 'この内容で発行する' })).toHaveCount(0);
  });
});
