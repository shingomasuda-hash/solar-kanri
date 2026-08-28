import { prisma } from '../db/client';

/**
 * System settings, read as typed values.
 *
 * Operational numbers live here rather than in code so that changing one is an
 * administrator's afternoon, not a deployment (brief rule 30). The defaults
 * below are what a fresh install uses until someone sets otherwise.
 */

export const SETTING_DEFAULTS = {
  /**
   * Provisional selling price per installed kW, used to fill a quotation drafted
   * from a simulation.
   *
   * A drafted quotation used to arrive with every line at ¥0, which is worse
   * than it sounds: a zero total makes payback read as immediate and IRR as
   * infinite, so the most flattering numbers the model can produce appeared by
   * default. A starting figure the operator then edits is both more useful and
   * more honest.
   *
   * This is a **business figure, not a physical one**. It is an administrator's
   * to set, it is not traceable to a datasheet, and it does not pretend to be.
   */
  'quotation.defaultPricePerKwJpy': 250_000,
  /**
   * Cost of goods as a fraction of the selling price. Used to show margin on
   * the internal quotation screen; it never appears on the customer's copy.
   */
  'quotation.costRatio': 0.3,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export async function getSetting<K extends SettingKey>(
  key: K,
): Promise<(typeof SETTING_DEFAULTS)[K]> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  const fallback = SETTING_DEFAULTS[key];
  if (row === null) return fallback;

  // Settings are stored as JSON, so a hand-edited row can be any shape. A wrong
  // type here would propagate into a price, so fall back rather than trust it.
  return (
    typeof row.value === typeof fallback ? row.value : fallback
  ) as (typeof SETTING_DEFAULTS)[K];
}

export async function getSettings(): Promise<{ [K in SettingKey]: (typeof SETTING_DEFAULTS)[K] }> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: Object.keys(SETTING_DEFAULTS) } },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = { ...SETTING_DEFAULTS };
  for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) {
    const value = byKey.get(key);
    if (typeof value === typeof SETTING_DEFAULTS[key]) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}
