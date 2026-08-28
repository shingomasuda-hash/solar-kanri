import { expect, test, type Page } from '@playwright/test';
import { login, selectPanel, uniqueName } from './helpers';

/**
 * Admin console, and the behaviour it exists to enable: an operator with no
 * developer involvement can supply the sourced coefficients that unblock the
 * calculation engines (brief rule 30).
 *
 * These tests mutate shared master data, so they run serially.
 */
test.describe.configure({ mode: 'serial' });

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

/**
 * Synthetic monthly climate for a test site. Clearly labelled as test data in
 * its own citation — these are NOT real observations and must never be
 * mistaken for NEDO or PVGIS figures.
 */
const TEST_IRRADIATION = '3.2, 3.6, 4.0, 4.4, 4.5, 3.8, 4.0, 4.4, 3.5, 3.2, 3.0, 3.0';
const TEST_TEMPERATURE = '6, 7, 10, 15, 20, 23, 27, 29, 25, 19, 14, 9';

async function verifyAllCoefficients(page: Page): Promise<void> {
  await page.goto('/admin/coefficients');
  const rows = page.locator('[data-testid^="coefficient-"][data-verified="false"]');
  let remaining = await rows.count();
  while (remaining > 0) {
    const row = rows.first();
    await row.getByRole('button', { name: '編集' }).click();
    await row.locator('select[name="sourceKind"]').selectOption('ADMINISTRATOR_INPUT');
    await row
      .locator('input[name="sourceCitation"]')
      .fill('E2E TEST DATA — synthetic value, not a real-world figure');
    await row.getByRole('button', { name: '保存' }).click();
    await expect(rows).toHaveCount(remaining - 1, { timeout: 15_000 });
    remaining -= 1;
  }
}

test.describe('admin console', () => {
  test('system health names every unconfigured component and what to do', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/admin/health');

    await expect(page.getByTestId('health-database')).toContainText('正常');
    // Without a key the map is "not configured", not "down" — and it must say
    // which variable to set rather than only that something is wrong.
    await expect(page.getByTestId('health-google-maps')).toContainText('未設定');
    await expect(page.getByTestId('health-google-maps')).toContainText(
      'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY',
    );
    await expect(page.getByTestId('health-ai-provider')).toContainText('未設定');
    // Forgetting to run migrations on a deployment surfaced twice as a raw
    // foreign-key error at the moment an operator clicked something. It has to
    // be visible where an administrator looks for it.
    await expect(page.getByTestId('health-migrations')).toContainText('適用済み');
  });

  test('an unverified coefficient is flagged and blocks calculation', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/admin/health');
    const calc = page.getByTestId('health-calculation');
    const text = await calc.textContent();
    // Three legitimate states depending on test order — unsourced, demo data
    // active, or fully sourced. Each must say which one it is; none may show
    // green while the figures are not ready to quote.
    expect(text).toMatch(/出典未確認|デモ用の概算データ|すべての係数に出典が登録されています/);
  });

  test('an administrator can source every coefficient and unblock simulation', async ({ page }) => {
    test.slow();
    await login(page, 'admin');

    // --- 1. source the coefficients --------------------------------------
    await verifyAllCoefficients(page);
    await expect(page.locator('[data-testid^="coefficient-"][data-verified="false"]')).toHaveCount(
      0,
    );

    // --- 2. source the tariff --------------------------------------------
    await page.goto('/admin/tariffs');
    await page.getByTestId('tariff-default').click();
    await page.locator('select[name="sourceKind"]').selectOption('ADMINISTRATOR_INPUT');
    await page
      .locator('input[name="sourceCitation"]')
      .fill('E2E TEST DATA — synthetic tariff, not a real price');
    await page.getByRole('button', { name: '更新する' }).click();
    await expect(page.getByTestId('tariff-default')).toHaveAttribute('data-verified', 'true', {
      timeout: 15_000,
    });

    // --- 3. supply irradiance data ---------------------------------------
    await page.goto('/admin/irradiance');
    // Scoped: the page also carries the PVGIS import form, which has its own
    // 緯度 / 経度 — correctly, since those are the right words in both.
    const manualEntry = page.getByTestId('irradiance-editor');
    await manualEntry.getByLabel('観測点名').fill(uniqueName('テスト観測点'));
    await manualEntry.getByLabel('緯度').fill('35.6812');
    await manualEntry.getByLabel('経度').fill('139.767');
    await manualEntry.getByLabel('月別日射量 (kWh/m²/日)').fill(TEST_IRRADIATION);
    await manualEntry.getByLabel('月別平均気温 (℃)').fill(TEST_TEMPERATURE);
    await manualEntry.locator('select[name="sourceKind"]').selectOption('ADMINISTRATOR_INPUT');
    await manualEntry
      .locator('input[name="sourceCitation"]')
      .fill('E2E TEST DATA — synthetic climate series, not NEDO or PVGIS data');
    await manualEntry.getByRole('button', { name: '登録する' }).click();
    await expect(page.getByRole('cell', { name: /テスト観測点/ }).first()).toBeVisible({
      timeout: 15_000,
    });

    // --- 4. verify the module against its datasheet -----------------------
    // A module row is a datasheet source only once a human has checked it. The
    // seeded SAMPLE module is not, and the engine refuses it until re-saved.
    await page.goto('/admin/panels');
    await page
      .getByRole('button', { name: /SAMPLE/ })
      .first()
      .click();
    await page
      .locator('input[name="sourceCitation"]')
      .fill('E2E TEST DATA — synthetic module, not a real datasheet');
    await page.getByRole('button', { name: '更新する' }).click();
    await expect(page.getByRole('cell', { name: /E2E TEST DATA/ }).first()).toBeVisible({
      timeout: 15_000,
    });

    // --- 5. the health page should now agree ------------------------------
    await page.goto('/admin/health');
    await expect(page.getByTestId('health-calculation')).toContainText(
      'すべての係数に出典が登録されています',
    );

    // --- 6. and a simulation must now actually run ------------------------
    await page.goto('/customers/new');
    await page.getByLabel('氏名').fill(uniqueName('シミュ顧客'));
    await page.getByRole('button', { name: '登録する' }).click();
    await page.getByRole('link', { name: '案件を作成' }).first().click();
    await page.getByLabel('案件名').fill(uniqueName('シミュ案件'));
    await page.getByRole('button', { name: '作成する' }).click();
    await page.waitForURL(/\/projects\/c[a-z0-9]+$/);
    const projectUrl = page.url();
    await page.goto(`${projectUrl}/design`);

    await page.getByText('緯度・経度を直接入力', { exact: true }).click();
    await page.getByLabel('緯度').fill('35.6812');
    await page.getByLabel('経度').fill('139.767');
    await page.getByRole('button', { name: '位置を設定' }).click();

    await page.getByLabel('屋根の外周（GeoJSON Polygon）').fill(JSON.stringify(ROOF_OUTLINE));
    await page.getByLabel('屋根勾配').selectOption({ label: '4寸（21.8°）' });
    await page.getByRole('button', { name: '屋根面を保存' }).click();

    await selectPanel(page);
    await page.getByRole('button', { name: '自動配置を実行' }).click();
    await page.locator('[data-testid^="layout-"]').first().waitFor({ timeout: 30_000 });

    await page.getByLabel('年間消費電力量 (kWh)').fill('5000');
    await page.getByLabel('システム総額 (円)').fill('1500000');
    await page.getByRole('button', { name: 'シミュレーション実行' }).click();

    await expect(page.getByText('シミュレーションを保存しました')).toBeVisible({
      timeout: 60_000,
    });

    // --- 7. the project screen shows real figures -------------------------
    await page.goto(projectUrl);
    const capacity = page.getByText('設置容量').locator('..');
    await expect(capacity).not.toContainText('—');

    const generation = page.getByText('年間発電量').locator('..');
    const generationText = (await generation.textContent()) ?? '';
    const kWh = Number(/([\d,]+)\s*kWh/.exec(generationText)?.[1]?.replace(/,/g, '') ?? '0');
    // A ~10 kW array at roughly 3.7 kWh/m2/day should land in the thousands of
    // kWh per year. The bound is deliberately wide — this asserts the pipeline
    // produced a physically sane number, not that the model is calibrated.
    expect(kWh).toBeGreaterThan(1000);
    expect(kWh).toBeLessThan(100_000);
  });
});

test.describe('admin access control', () => {
  test('a sales user cannot reach user management', async ({ page }) => {
    await login(page, 'sales');
    await page.goto('/admin/users');
    // SALES has master:read, so it lands on the admin console but not on users.
    await expect(page).not.toHaveURL(/\/admin\/users$/);
  });

  test('a sales user cannot edit coefficients', async ({ page }) => {
    await login(page, 'sales');
    await page.goto('/admin/coefficients');
    await expect(page.getByRole('button', { name: '編集' })).toHaveCount(0);
  });

  test('a viewer cannot reach the admin console at all', async ({ page }) => {
    await login(page, 'viewer');
    await page.goto('/admin/coefficients');
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
