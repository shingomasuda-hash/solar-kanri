import { expect, test, type Page } from '@playwright/test';
import { login, uniqueName } from './helpers';

/**
 * Screenshot and layout QA (brief rule 36).
 *
 * The load-bearing assertion is **no horizontal page scroll**. It is the single
 * most common responsive defect and it is invisible in code review: a wide
 * table inside an `overflow-x-auto` card still pushes its grid column out,
 * because grid and flex items default to `min-width: auto`. When the page
 * scrolls sideways, buttons drift out from under the pointer and taps land on
 * the wrong element — which is exactly how this was first noticed, as a click
 * on the issue button being intercepted by `<main>`.
 */

async function assertNoHorizontalScroll(page: Page, label: string): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  // A 1 px allowance for sub-pixel rounding at fractional device ratios.
  expect(
    scrollWidth,
    `${label} scrolls horizontally: ${scrollWidth}px of content in a ${clientWidth}px viewport`,
  ).toBeLessThanOrEqual(clientWidth + 1);
}

async function seedProjectWithQuotation(page: Page): Promise<string> {
  await page.goto('/customers/new');
  await page.getByLabel('氏名').fill(uniqueName('レイアウト顧客'));
  await page.getByLabel('都道府県').fill('東京都');
  await page.getByLabel('市区町村').fill('千代田区');
  await page.getByLabel('番地・建物名').fill('千代田1-1 テストビル10階1001号室');
  await page.getByRole('button', { name: '登録する' }).click();
  await page.getByRole('link', { name: '案件を作成' }).first().click();
  await page.getByLabel('案件名').fill(uniqueName('レイアウト案件'));
  await page.getByRole('button', { name: '作成する' }).click();
  await page.waitForURL(/\/projects\/c[a-z0-9]+$/);
  const projectId = page.url().split('/').pop()!;

  await page.goto(`/projects/${projectId}/quotations/new`);
  await page.getByLabel('件名').fill('レイアウト検証用のかなり長い件名を含むお見積書');
  const row = page.getByTestId('quotation-row-0');
  // A deliberately long product name: the worst case for a fixed-width table.
  await row
    .getByLabel('品名')
    .fill('太陽電池モジュール SAMPLE-400 単結晶ハーフカット 高効率タイプ 400W');
  await row.getByLabel('数量').fill('24');
  await row.getByLabel('単価 (円)').fill('48000');
  await page.getByRole('button', { name: '見積を作成' }).click();
  await expect(page).toHaveURL(/\/quotations\/c[a-z0-9]+$/);
  return projectId;
}

test.describe('layout', () => {
  test('no page scrolls horizontally', async ({ page }, testInfo) => {
    test.slow();
    await login(page, 'admin');
    const projectId = await seedProjectWithQuotation(page);
    const quotationUrl = page.url();

    const pages: { url: string; label: string }[] = [
      { url: '/dashboard', label: 'dashboard' },
      { url: '/customers', label: 'customer list' },
      { url: '/customers/new', label: 'customer form' },
      { url: '/projects', label: 'project list' },
      { url: `/projects/${projectId}`, label: 'project detail' },
      { url: `/projects/${projectId}/design`, label: 'design workspace' },
      { url: `/projects/${projectId}/quotations/new`, label: 'quotation form' },
      { url: quotationUrl, label: 'quotation detail' },
      { url: `${quotationUrl}/print`, label: 'quotation print' },
      { url: '/admin/health', label: 'admin health' },
      { url: '/admin/coefficients', label: 'admin coefficients' },
      { url: '/admin/panels', label: 'admin panels' },
      { url: '/admin/tariffs', label: 'admin tariffs' },
      { url: '/admin/irradiance', label: 'admin irradiance' },
      { url: '/admin/users', label: 'admin users' },
      { url: '/admin/audit', label: 'admin audit' },
    ];

    for (const target of pages) {
      await page.goto(target.url);
      await page.waitForLoadState('networkidle');
      await assertNoHorizontalScroll(page, `${target.label} (${testInfo.project.name})`);
    }
  });

  test('an issued quotation can be actioned on a narrow screen', async ({ page }) => {
    // The regression this suite exists for: a sideways-scrolling page moved the
    // issue button out from under the pointer, and <main> swallowed the click.
    await login(page, 'admin');
    await seedProjectWithQuotation(page);
    await page.getByRole('button', { name: 'この内容で発行する' }).click();
    await expect(page.getByText('発行済', { exact: true })).toBeVisible();
  });

  test('key screens render without visual regressions', async ({ page }, testInfo) => {
    // Screenshots are attached to the report for human review rather than
    // diffed: a pixel baseline would fail on every legitimate copy change and
    // teach everyone to ignore it.
    await login(page, 'admin');
    for (const [label, url] of [
      ['dashboard', '/dashboard'],
      ['customers', '/customers'],
      ['projects', '/projects'],
      ['admin-health', '/admin/health'],
      ['admin-coefficients', '/admin/coefficients'],
    ] as const) {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      await testInfo.attach(`${label}-${testInfo.project.name}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    }
  });

  test('empty states explain what to do next, rather than showing a blank panel', async ({
    page,
  }) => {
    await login(page, 'admin');
    await page.goto('/customers/new');
    await page.getByLabel('氏名').fill(uniqueName('空状態顧客'));
    await page.getByRole('button', { name: '登録する' }).click();

    // A customer with no projects must say so AND offer the next action.
    await expect(page.getByText('案件がありません')).toBeVisible();
    await expect(page.getByText('屋根作図とシミュレーションに進めます')).toBeVisible();
    await expect(page.getByRole('link', { name: '案件を作成' }).first()).toBeVisible();
  });
});
