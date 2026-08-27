import { expect, test, type Page } from '@playwright/test';
import { login, selectPanel, uniqueName } from './helpers';

/**
 * Demonstration mode, in a real browser.
 *
 * Two things have to be true at once, and only the browser can show both:
 *
 *  1. with the demo data active the whole flow works — roof, layout,
 *     generation, economics, quotation draft. A demo that stops halfway is
 *     useless.
 *  2. the result is unmistakably marked, and issuing is refused. The danger of
 *     demonstration figures is precisely that they look like answers.
 *
 * The demo set is loaded by `npm run db:seed:demo` but not activated (the gate
 * runs it with DEMO_ACTIVATE=0). This spec activates it through the admin
 * console — which is also how an operator would — and restores the ordinary set
 * afterwards, so it cannot leave the other specs simulating on demo data.
 */

const ROOF_OUTLINE = {
  type: 'Polygon',
  coordinates: [
    [
      [139.767, 35.6812],
      [139.7671105, 35.6812],
      [139.7671105, 35.68127194],
      [139.767, 35.68127194],
      [139.767, 35.6812],
    ],
  ],
};

async function activateSet(page: Page, key: 'default' | 'demo'): Promise<void> {
  await page.goto('/admin/coefficients');
  const card = page.getByTestId(`coefficient-set-${key}`);
  const already = await card.getByTestId(`default-set-${key}`).count();
  if (already === 0) {
    await card.getByRole('button', { name: 'このセットを既定にする' }).click();
  }
  await expect(card.getByTestId(`default-set-${key}`)).toBeVisible({ timeout: 15_000 });
}

async function buildDesignedProject(page: Page): Promise<string> {
  await page.goto('/customers/new');
  await page.getByLabel('氏名').fill(uniqueName('デモ顧客'));
  await page.getByLabel('都道府県').fill('東京都');
  await page.getByLabel('市区町村').fill('千代田区');
  await page.getByRole('button', { name: '登録する' }).click();
  await page.getByRole('link', { name: '案件を作成' }).first().click();
  await page.getByLabel('案件名').fill(uniqueName('デモ案件'));
  await page.getByRole('button', { name: '作成する' }).click();
  await page.waitForURL(/\/projects\/c[a-z0-9]+$/);
  const projectId = page.url().split('/').pop()!;

  await page.goto(`/projects/${projectId}/design`);
  await page.getByText('緯度・経度を直接入力', { exact: true }).click();
  await page.getByLabel('緯度').fill('35.6812');
  await page.getByLabel('経度').fill('139.767');
  await page.getByRole('button', { name: '位置を設定' }).click();

  await page.getByLabel('屋根の外周（GeoJSON Polygon）').fill(JSON.stringify(ROOF_OUTLINE));
  await page.getByLabel('屋根勾配').selectOption({ label: '4寸（21.8°）' });
  await page.getByRole('button', { name: '屋根面を保存' }).click();

  // A demo module, deliberately: the panel is one of the inputs that makes the
  // result demonstration-derived, and picking SAMPLE here would hide that.
  await selectPanel(page, /デモ/);
  await page.getByRole('button', { name: '自動配置を実行' }).click();
  await expect(page.getByTestId('layout-result')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'シミュレーション実行' }).click();
  return projectId;
}

test.describe('demonstration mode', () => {
  // The full flow plus two admin round trips; the default 60 s is tight.
  test.setTimeout(150_000);

  test('runs the whole flow, marks every figure, and refuses to issue', async ({ page }) => {
    await login(page, 'admin');
    await activateSet(page, 'demo');

    try {
      const projectId = await buildDesignedProject(page);

      // 1. It computes rather than refusing — that is what the demo is for.
      await expect(page.getByTestId('demo-figures-notice')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('simulation-error')).toBeHidden();

      // 2. The warning follows the figures onto the project screen.
      await page.goto(`/projects/${projectId}`);
      await expect(page.getByTestId('demo-figures-notice')).toBeVisible();
      await expect(page.getByText('参考値').first()).toBeVisible();

      // 3. A quotation can still be drafted — reviewing one is part of a demo.
      await page.goto(`/projects/${projectId}/quotations/new`);
      await page.getByLabel('件名').fill('デモ見積書');
      await page.getByRole('button', { name: '見積を作成' }).click();
      await expect(page).toHaveURL(/\/quotations\/c[a-z0-9]+$/);
      await expect(page.getByTestId('demo-figures-notice')).toBeVisible();

      // 4. And issuing it is refused, saying why.
      const quotationUrl = page.url();
      await page.getByRole('button', { name: 'この内容で発行する' }).click();
      await expect(page.getByText('見積を発行できません')).toBeVisible({ timeout: 15_000 });
      // Still a draft: a refusal that half-issued would be worse than none.
      await expect(page.getByText('下書き').first()).toBeVisible();

      // 5. The printed sheet carries the warning too, since that is the copy
      //    that would physically leave the office.
      await page.goto(`${quotationUrl}/print`);
      await expect(page.getByTestId('print-demo-banner')).toBeVisible();
    } finally {
      await activateSet(page, 'default');
    }
  });

  test('system health reports demo mode rather than showing green', async ({ page }) => {
    await login(page, 'admin');
    await activateSet(page, 'demo');
    try {
      await page.goto('/admin/health');
      const calculation = page.getByTestId('health-calculation');
      await expect(calculation).toBeVisible();
      await expect(calculation).toContainText('デモ');
    } finally {
      await activateSet(page, 'default');
    }
  });
});
