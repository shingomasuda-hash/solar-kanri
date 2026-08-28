/**
 * Demonstration dataset.
 *
 * Loads a set of figures that are roughly right for a Japanese residential
 * system, so the whole sales flow — roof, layout, generation, economics,
 * quotation — can be walked through before anyone has collected real
 * datasheets. Run with `npm run db:seed:demo`.
 *
 * **Every value here is marked DEMO_APPROXIMATION and none of it is traceable
 * to any document.** That marking is load-bearing, not decoration:
 *
 *  - the engines will compute with it, so the flow works end to end;
 *  - every screen showing a figure derived from it carries a warning;
 *  - `issueQuotation` refuses outright, so it cannot reach a customer.
 *
 * The panel entries carry real manufacturer names, because which companies
 * supply the Japanese residential market is a plain fact. Their model fields
 * say 相当（デモ）rather than a catalogue number, deliberately: a real model
 * number attached to an invented temperature coefficient is far more dangerous
 * than an obviously generic one, because someone would reasonably believe it.
 *
 * To move to real data: docs/setup/panel-catalogue.md lists what each datasheet
 * supplies and where the six numbers go.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
});

/**
 * Whether to make the demo data the set the simulator actually uses.
 *
 * On by default, because a demo you still have to switch on is not a demo.
 * `DEMO_ACTIVATE=0` loads the rows without touching the defaults, which is how
 * the test suite gets a demo set to work with while every other spec keeps
 * running against the ordinary seed.
 */
const ACTIVATE = process.env.DEMO_ACTIVATE !== '0';

/**
 * Force the demo rows back to DEMO_APPROXIMATION.
 *
 * Adopting the demo values as a company's own is deliberate and one-way from
 * the operator's point of view, so the ordinary seed never undoes it. The test
 * suite needs the opposite: whatever an earlier suite did, the browser tests
 * must find a demonstration catalogue. `DEMO_RESET=1` makes the fixtures
 * idempotent so the gate does not depend on the order its steps ran in.
 */
const RESET = process.env.DEMO_RESET === '1';

const DEMO = {
  sourceKind: 'DEMO_APPROXIMATION',
  sourceCitation:
    'DEMO APPROXIMATION — representative figure for demonstration only. Not traceable to any ' +
    'datasheet, standard or dataset, and refused when issuing a quotation.',
} as const;

const DEMO_PANEL_CITATION =
  'DEMO APPROXIMATION — representative residential module. NOT this manufacturer’s published ' +
  'specification. Replace with the datasheet figures before quoting.';

/**
 * Ten entries spanning the range an operator actually meets: compact modules
 * that suit a Japanese hip roof, and larger high-output ones. The spread of
 * width, height and output is the point — it exercises the placement engine
 * with realistic proportions rather than ten copies of one rectangle.
 */
const DEMO_PANELS = [
  { m: '長州産業', s: 'Gシリーズ', w: 1050, h: 1706, p: 375, e: 20.9, tc: -0.0029, wt: 19.0 },
  { m: '長州産業', s: 'Bシリーズ', w: 1050, h: 1550, p: 340, e: 20.4, tc: -0.0033, wt: 17.5 },
  { m: 'ハンファQセルズ', s: 'Q.PEAK', w: 1030, h: 1720, p: 400, e: 22.1, tc: -0.003, wt: 19.5 },
  {
    m: 'カナディアンソーラー',
    s: 'HiKu',
    w: 1100,
    h: 1760,
    p: 415,
    e: 21.4,
    tc: -0.0032,
    wt: 21.0,
  },
  { m: 'シャープ', s: 'BLACKSOLAR', w: 1004, h: 1657, p: 350, e: 21.0, tc: -0.0034, wt: 18.0 },
  { m: 'パナソニック', s: 'MODULUS', w: 1050, h: 1765, p: 400, e: 21.6, tc: -0.0028, wt: 20.0 },
  { m: '京セラ', s: 'RoofleX', w: 990, h: 1350, p: 270, e: 20.2, tc: -0.0035, wt: 14.0 },
  { m: 'ネクストエナジー', s: 'NER', w: 1050, h: 1700, p: 380, e: 21.3, tc: -0.0031, wt: 19.0 },
  { m: 'トリナソーラー', s: 'Vertex S', w: 1134, h: 1762, p: 430, e: 21.5, tc: -0.003, wt: 21.5 },
  { m: 'エクソル', s: 'XLNシリーズ', w: 1134, h: 1722, p: 420, e: 21.5, tc: -0.0031, wt: 21.0 },
] as const;

async function seedDemoPanels(): Promise<void> {
  for (const p of DEMO_PANELS) {
    const model = `${p.s} 相当（デモ）`;
    await prisma.panelModel.upsert({
      where: {
        manufacturer_model_datasheetVersion: {
          manufacturer: p.m,
          model,
          datasheetVersion: 'demo-1',
        },
      },
      // Never overwrite: an administrator may have corrected these against a
      // real datasheet and cleared the demo flag.
      update: {},
      create: {
        manufacturer: p.m,
        model,
        datasheetVersion: 'demo-1',
        widthMm: p.w,
        heightMm: p.h,
        thicknessMm: 35,
        weightKg: p.wt,
        ratedPowerW: p.p,
        efficiencyPct: p.e,
        pmaxTempCoeffPerK: p.tc,
        noctC: 44,
        annualDegradation: 0.005,
        productWarrantyYears: 15,
        performanceWarrantyYears: 25,
        sourceCitation: DEMO_PANEL_CITATION,
        isDemo: true,
        isActive: true,
      },
    });
  }
  console.log(`  demo panels: ${DEMO_PANELS.length} (DEMO — cannot be quoted)`);
}

const DEMO_COEFFICIENTS = [
  { key: 'inverterEfficiency', value: 0.955, unit: '-', label: 'パワコン効率' },
  { key: 'wiringFactor', value: 0.97, unit: '-', label: '配線損失係数' },
  { key: 'soilingFactor', value: 0.97, unit: '-', label: '汚れ損失係数' },
  { key: 'shadingFactor', value: 1.0, unit: '-', label: '影損失係数（影なし前提）' },
  { key: 'otherApprovedFactor', value: 0.98, unit: '-', label: 'その他損失係数' },
  { key: 'temperatureRiseK.roof-flush', value: 18, unit: 'K', label: '温度上昇（屋根置き）' },
  { key: 'temperatureRiseK.roof-raised', value: 15, unit: 'K', label: '温度上昇（架台設置）' },
  { key: 'temperatureRiseK.ground-mounted', value: 12, unit: 'K', label: '温度上昇（地上設置）' },
  { key: 'gridCo2FactorKgPerKWh', value: 0.45, unit: 'kg-CO2/kWh', label: '系統CO2排出係数' },
] as const;

async function seedDemoCoefficients(): Promise<void> {
  const set = await prisma.coefficientSet.upsert({
    where: { key: 'demo' },
    update: {},
    create: { key: 'demo', name: 'デモ用係数セット（参考値・提示不可）', isDefault: false },
  });

  for (const c of DEMO_COEFFICIENTS) {
    await prisma.coefficient.upsert({
      where: { setId_key: { setId: set.id, key: c.key } },
      update: {},
      create: {
        setId: set.id,
        key: c.key,
        label: c.label,
        value: c.value,
        unit: c.unit,
        note: 'デモ用の概算値。実運用では JIS・メーカー資料等に基づく値へ差し替えてください。',
        ...DEMO,
      },
    });
  }

  // Making the demo set the default is what actually turns the demo on: the
  // simulation service resolves `isDefault` when no set is named. Switching it
  // back is one click in 管理 → 係数.
  if (ACTIVATE) {
    await prisma.$transaction([
      prisma.coefficientSet.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
      prisma.coefficientSet.update({ where: { id: set.id }, data: { isDefault: true } }),
    ]);
  }
  console.log(
    `  demo coefficients: ${DEMO_COEFFICIENTS.length}` +
      (ACTIVATE ? ' (now the default set)' : ' (loaded, not activated)'),
  );
}

async function seedDemoTariff(): Promise<void> {
  const tariff = await prisma.tariff.upsert({
    where: { key: 'demo' },
    update: {},
    create: {
      key: 'demo',
      name: 'デモ用単価（参考値・提示不可）',
      purchasePriceJpyPerKWh: 31,
      exportPriceJpyPerKWh: 15,
      exportPriceYears: 10,
      postExportPriceJpyPerKWh: 8.5,
      annualPriceEscalation: 0,
      monthlyBasicChargeJpy: 1200,
      defaultSelfConsumptionRatio: 0.3,
      isDefault: false,
      ...DEMO,
    },
  });

  if (ACTIVATE) {
    await prisma.$transaction([
      prisma.tariff.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
      prisma.tariff.update({ where: { id: tariff.id }, data: { isDefault: true } }),
    ]);
  }
  console.log('  demo tariff: 1' + (ACTIVATE ? ' (now the default)' : ' (loaded, not activated)'));
}

/**
 * Without an irradiance dataset there is nothing to simulate, and the online
 * provider needs network access the demo cannot assume. These four stations
 * cover the country coarsely; the resolver picks the nearest.
 *
 * The monthly shape — a summer peak, a shallower winter trough on the Pacific
 * side, a deeper one on the Sea of Japan side — is what makes a demo result
 * look like a real one. The magnitudes are approximate.
 */
const DEMO_STATIONS = [
  {
    label: 'デモ観測点・札幌',
    latitude: 43.06,
    longitude: 141.35,
    irr: [2.0, 2.6, 3.4, 4.2, 4.6, 4.5, 4.3, 4.0, 3.4, 2.7, 1.7, 1.6],
    temp: [-3.2, -2.7, 1.1, 7.3, 12.6, 16.7, 20.5, 22.3, 18.1, 11.8, 4.9, -0.9],
  },
  {
    label: 'デモ観測点・東京',
    latitude: 35.69,
    longitude: 139.69,
    irr: [2.8, 3.2, 3.6, 4.1, 4.4, 3.8, 4.0, 4.4, 3.3, 2.7, 2.5, 2.6],
    temp: [5.4, 6.1, 9.4, 14.3, 18.8, 21.9, 25.7, 26.9, 23.3, 18.0, 12.5, 7.7],
  },
  {
    label: 'デモ観測点・大阪',
    latitude: 34.69,
    longitude: 135.5,
    irr: [2.7, 3.2, 3.7, 4.3, 4.6, 4.0, 4.3, 4.6, 3.5, 3.0, 2.5, 2.5],
    temp: [6.2, 6.5, 9.8, 15.2, 19.8, 23.4, 27.4, 28.6, 24.9, 19.2, 13.6, 8.6],
  },
  {
    label: 'デモ観測点・福岡',
    latitude: 33.59,
    longitude: 130.4,
    irr: [2.4, 3.0, 3.6, 4.3, 4.7, 3.9, 4.4, 4.6, 3.6, 3.2, 2.5, 2.3],
    temp: [6.9, 7.8, 10.8, 15.4, 19.9, 23.3, 27.4, 28.4, 24.7, 19.6, 14.2, 9.1],
  },
] as const;

function byMonth(values: readonly number[]): Record<string, number> {
  return Object.fromEntries(values.map((v, i) => [String(i + 1), v]));
}

async function seedDemoIrradiance(): Promise<void> {
  for (const s of DEMO_STATIONS) {
    const existing = await prisma.irradianceStation.findFirst({ where: { label: s.label } });
    if (existing) continue;
    await prisma.irradianceStation.create({
      data: {
        label: s.label,
        latitude: s.latitude,
        longitude: s.longitude,
        monthlyIrradiationKWhPerM2PerDay: byMonth(s.irr),
        monthlyAmbientTempC: byMonth(s.temp),
        // Horizontal, so the engine applies its tilt correction and says so.
        isPlaneOfArray: false,
        isActive: true,
        ...DEMO,
      },
    });
  }
  console.log(`  demo irradiance stations: ${DEMO_STATIONS.length}`);
}

/**
 * Provisional business figures, so a drafted quotation has a total and the
 * payback period is computable. These are settings, not coefficients: they are
 * an administrator's to decide and they are not traceable to a datasheet, which
 * is exactly why they live in system settings rather than the coefficient set.
 */
const DEMO_SETTINGS = [
  {
    key: 'quotation.defaultPricePerKwJpy',
    value: 250_000,
    label: '見積の既定単価（円/kW・暫定）',
  },
  { key: 'quotation.costRatio', value: 0.3, label: '原価率（暫定）' },
];

async function seedDemoSettings(): Promise<void> {
  for (const s of DEMO_SETTINGS) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      // Never overwrite: an administrator may have set a real figure.
      update: {},
      create: { key: s.key, value: s.value as never, label: s.label },
    });
  }
  console.log(`  demo settings: ${DEMO_SETTINGS.length}`);
}

async function resetDemoProvenance(): Promise<void> {
  const [coefficients, tariffs, panels] = await prisma.$transaction([
    prisma.coefficient.updateMany({
      where: { set: { key: 'demo' } },
      data: { ...DEMO, verifiedAt: null, verifiedBy: null },
    }),
    prisma.tariff.updateMany({
      where: { key: 'demo' },
      data: { ...DEMO, verifiedAt: null, verifiedBy: null },
    }),
    prisma.panelModel.updateMany({
      where: { datasheetVersion: 'demo-1' },
      data: {
        isDemo: true,
        verifiedAt: null,
        verifiedBy: null,
        sourceCitation: DEMO_PANEL_CITATION,
      },
    }),
  ]);
  console.log(
    `  reset to DEMO: ${coefficients.count} coefficients, ${tariffs.count} tariffs, ` +
      `${panels.count} panels`,
  );

  // Reset means reset. Leaving the demo set as the default is exactly the state
  // that made the health check disagree with a suite that had just sourced
  // every coefficient — and no other step could repair it.
  const [ordinarySet, ordinaryTariff] = await Promise.all([
    prisma.coefficientSet.findUnique({ where: { key: 'default' } }),
    prisma.tariff.findUnique({ where: { key: 'default' } }),
  ]);
  if (ordinarySet) {
    await prisma.$transaction([
      prisma.coefficientSet.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
      prisma.coefficientSet.update({ where: { id: ordinarySet.id }, data: { isDefault: true } }),
    ]);
  }
  if (ordinaryTariff) {
    await prisma.$transaction([
      prisma.tariff.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
      prisma.tariff.update({ where: { id: ordinaryTariff.id }, data: { isDefault: true } }),
    ]);
  }
  console.log('  defaults restored to the ordinary set and tariff');
}

async function main(): Promise<void> {
  console.log(`Seeding DEMO data... (activate: ${ACTIVATE}, reset: ${RESET})`);
  await seedDemoPanels();
  await seedDemoCoefficients();
  await seedDemoTariff();
  await seedDemoIrradiance();
  await seedDemoSettings();
  if (RESET) await resetDemoProvenance();
  if (!ACTIVATE) {
    console.log('\nLoaded without activating. Switch to it in 管理 → 係数 / 単価.');
    return;
  }
  console.log(
    '\nDone. The full flow now runs end to end.\n\n' +
      'Everything loaded is marked DEMO_APPROXIMATION: results carry a 参考値 warning on\n' +
      'every screen and on the printed sheet, and issuing a quotation is refused.\n' +
      'Replace it with real values in 管理 → 係数 / 単価 / パネル.\n' +
      'See docs/setup/panel-catalogue.md.',
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
