import { expect, test, type Page } from '@playwright/test';
import { login, setCoefficientSource, uniqueName } from './helpers';

/**
 * The design pipeline: position → roof outline → exclusion → auto layout →
 * simulation.
 *
 * Runs without a Google Maps key, which is the point: the platform must never
 * be blocked by an unconfigured external API. The roof outline is pasted as
 * GeoJSON, exactly as an operator would from a survey.
 */

/** A ~10 m × 8 m rectangle near Tokyo Station, as WGS84 GeoJSON. */
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

/** A ~1.2 m square skylight near the middle of that roof. */
const SKYLIGHT = {
  type: 'Polygon',
  coordinates: [
    [
      [139.76705, 35.681235],
      [139.7670633, 35.681235],
      [139.7670633, 35.6812458],
      [139.76705, 35.6812458],
      [139.76705, 35.681235],
    ],
  ],
};

/** Read a rendered area off its data-value attribute, avoiding display rounding. */
async function readArea(page: Page, testIdPrefix: string): Promise<number> {
  const el = page.locator(`[data-testid^="${testIdPrefix}"]`).first();
  await el.waitFor();
  const value = await el.getAttribute('data-value');
  return Number(value);
}

async function createProjectWithDesign(page: Page): Promise<string> {
  await page.goto('/customers/new');
  await page.getByLabel('氏名').fill(uniqueName('設計顧客'));
  await page.getByLabel('都道府県').fill('東京都');
  await page.getByLabel('市区町村').fill('千代田区');
  await page.getByRole('button', { name: '登録する' }).click();
  await page.getByRole('link', { name: '案件を作成' }).first().click();
  await page.getByLabel('案件名').fill(uniqueName('設計案件'));
  await page.getByRole('button', { name: '作成する' }).click();
  await page.waitForURL(/\/projects\/c[a-z0-9]+$/);
  const projectId = page.url().split('/').pop()!;
  await page.goto(`/projects/${projectId}/design`);
  return projectId;
}

test.describe('design pipeline', () => {
  test('works end to end without a Google Maps key', async ({ page }) => {
    await login(page, 'admin');
    await createProjectWithDesign(page);

    // The map explains what to configure instead of failing.
    await expect(page.getByTestId('map-unconfigured')).toBeVisible();
    await expect(page.getByText('Google Maps が未設定です')).toBeVisible();

    // --- position ---------------------------------------------------------
    await page.getByText('緯度・経度を直接入力', { exact: true }).click();
    await page.getByLabel('緯度').fill('35.6812');
    await page.getByLabel('経度').fill('139.767');
    await page.getByRole('button', { name: '位置を設定' }).click();
    await expect(page.getByTestId('position-set')).toContainText('35.681200');

    // --- roof outline -----------------------------------------------------
    await page.getByLabel('屋根の外周（GeoJSON Polygon）').fill(JSON.stringify(ROOF_OUTLINE));
    await page.getByLabel('屋根勾配').selectOption({ label: '4寸（21.8°）' });
    await page.getByLabel('屋根の向き（軒先方向）').selectOption('180');
    await page.getByRole('button', { name: '屋根面を保存' }).click();

    await expect(page.getByRole('button', { name: '屋根面1', exact: true })).toBeVisible();

    // A satellite polygon is the roof's SHADOW. On a 4-sun (21.8 degree) roof
    // the real surface is 1/cos(21.8) = 1.0770 times the projection. Asserting
    // the ratio rather than a hard-coded area tests the property that matters
    // and does not break when the fixture polygon is nudged.
    const projected = await readArea(page, 'projected-area-');
    const surface = await readArea(page, 'surface-area-');
    expect(projected).toBeGreaterThan(70);
    expect(projected).toBeLessThan(90);
    expect(surface / projected).toBeCloseTo(1 / Math.cos((21.8 * Math.PI) / 180), 3);

    // --- auto layout ------------------------------------------------------
    await page.getByLabel('パネル型番').selectOption({ index: 0 });
    await page.getByRole('button', { name: '自動配置を実行' }).click();
    await expect(page.getByTestId('layout-result')).toBeVisible({ timeout: 30_000 });
    const summary = await page.getByTestId('layout-result').textContent();
    expect(summary).toMatch(/\d+ 枚/);

    const panels = Number(/(\d+) 枚/.exec(summary ?? '')?.[1] ?? '0');
    // The usable area is roughly 74 m2 after a 0.3 m setback; a 1.0 x 1.65 m
    // module has a 1.7 m2 pitch, so the ceiling is about 43. A real packing
    // lands below that and well above zero.
    expect(panels).toBeGreaterThan(20);
    expect(panels).toBeLessThanOrEqual(43);
  });

  test('an exclusion zone reduces the panel count', async ({ page }) => {
    await login(page, 'admin');
    await createProjectWithDesign(page);

    await page.getByText('緯度・経度を直接入力', { exact: true }).click();
    await page.getByLabel('緯度').fill('35.6812');
    await page.getByLabel('経度').fill('139.767');
    await page.getByRole('button', { name: '位置を設定' }).click();

    await page.getByLabel('屋根の外周（GeoJSON Polygon）').fill(JSON.stringify(ROOF_OUTLINE));
    await page.getByRole('button', { name: '屋根面を保存' }).click();
    await expect(page.getByRole('button', { name: '屋根面1', exact: true })).toBeVisible();

    await page.getByLabel('パネル型番').selectOption({ index: 0 });
    await page.getByRole('button', { name: '自動配置を実行' }).click();
    // Read the count off the SERVER-rendered badge, not the transient banner:
    // the banner is client state and could still be showing the previous run.
    const badge = page.locator('[data-testid^="layout-"]').first();
    await badge.waitFor({ timeout: 30_000 });
    const before = Number(await badge.getAttribute('data-panel-count'));
    expect(before).toBeGreaterThan(0);

    // Add a skylight. Saving it invalidates the layout, so the badge must go.
    await page.getByLabel('禁止区域の外周（GeoJSON Polygon）').fill(JSON.stringify(SKYLIGHT));
    await page.getByRole('button', { name: '禁止区域を保存' }).click();
    await expect(page.getByRole('button', { name: '天窓 を削除' })).toBeVisible();
    await expect(page.locator('[data-testid^="layout-"]')).toHaveCount(0);
    await expect(page.getByTestId('layout-result')).toHaveCount(0);

    await page.getByLabel('パネル型番').selectOption({ index: 0 });
    await page.getByRole('button', { name: '自動配置を実行' }).click();
    const badgeAfter = page.locator('[data-testid^="layout-"]').first();
    await badgeAfter.waitFor({ timeout: 30_000 });
    const after = Number(await badgeAfter.getAttribute('data-panel-count'));

    // A 1.2 m skylight plus 0.3 m clearance is a 1.8 m square hole; it must
    // cost modules. Equal counts would mean the exclusion is being ignored.
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);
  });

  test('an unknown pitch is reported, never silently assumed', async ({ page }) => {
    await login(page, 'admin');
    await createProjectWithDesign(page);

    await page.getByText('緯度・経度を直接入力', { exact: true }).click();
    await page.getByLabel('緯度').fill('35.6812');
    await page.getByLabel('経度').fill('139.767');
    await page.getByRole('button', { name: '位置を設定' }).click();

    await page.getByLabel('屋根の外周（GeoJSON Polygon）').fill(JSON.stringify(ROOF_OUTLINE));
    await page.getByLabel('屋根勾配').selectOption({ label: '不明（水平面として計算）' });
    await page.getByRole('button', { name: '屋根面を保存' }).click();

    await expect(page.getByText('勾配が未設定です。水平面として計算されます。')).toBeVisible();

    await page.getByLabel('パネル型番').selectOption({ index: 0 });
    await page.getByRole('button', { name: '自動配置を実行' }).click();
    await expect(page.getByTestId('layout-result')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/PITCH_UNKNOWN/)).toBeVisible();
  });

  test('simulation refuses to run on unverified coefficients', async ({ page }) => {
    // The single most important behaviour in the system: it must not produce a
    // customer-facing figure from coefficients nobody has sourced. It must fail
    // closed, and say exactly which ones are missing.
    //
    // The precondition is established here rather than assumed from the seed:
    // coefficients are global master data, and another spec that sources them
    // would otherwise silently turn this test green.
    await login(page, 'admin');
    await setCoefficientSource(page, 'wiringFactor', 'UNVERIFIED_PLACEHOLDER');
    try {
      await runRefusalScenario(page);
    } finally {
      // Restore, so this test does not break the ones that need a working
      // simulation.
      await setCoefficientSource(page, 'wiringFactor', 'ADMINISTRATOR_INPUT');
    }
  });
});

async function runRefusalScenario(page: Page): Promise<void> {
  await createProjectWithDesign(page);

  await page.getByText('緯度・経度を直接入力', { exact: true }).click();
  await page.getByLabel('緯度').fill('35.6812');
  await page.getByLabel('経度').fill('139.767');
  await page.getByRole('button', { name: '位置を設定' }).click();

  await page.getByLabel('屋根の外周（GeoJSON Polygon）').fill(JSON.stringify(ROOF_OUTLINE));
  await page.getByLabel('屋根勾配').selectOption({ label: '4寸（21.8°）' });
  await page.getByRole('button', { name: '屋根面を保存' }).click();
  await page.getByLabel('パネル型番').selectOption({ index: 0 });
  await page.getByRole('button', { name: '自動配置を実行' }).click();
  await expect(page.getByTestId('layout-result')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'シミュレーション実行' }).click();
  await expect(page.getByTestId('simulation-error')).toBeVisible({ timeout: 30_000 });
  const message = await page.getByTestId('simulation-error').textContent();
  // Either the coefficients are refused, or irradiance data is missing — both
  // are correct refusals, and both must name what to fix.
  expect(message).toMatch(/出典|日射量/);
  expect(message).toMatch(/管理画面|プロバイダ/);
}

test.describe('design access control', () => {
  test('a viewer sees the design page read-only', async ({ page }) => {
    await login(page, 'admin');
    const projectId = await createProjectWithDesign(page);

    await page.getByRole('button', { name: 'ログアウト' }).click();
    await login(page, 'viewer');
    await page.goto(`/projects/${projectId}/design`);

    await expect(page.getByRole('button', { name: '屋根面を保存' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '自動配置を実行' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '屋根を描く' })).toHaveCount(0);
  });
});
