/**
 * Seed reference data.
 *
 * IMPORTANT: every numeric coefficient is seeded as UNVERIFIED_PLACEHOLDER.
 * The calculation engines refuse to run on unverified values (ADR-005), so a
 * fresh install cannot produce a customer-facing figure until an administrator
 * enters real values with citations. That is the intended behaviour, not a bug
 * — see docs/open-issues.md OI-002 and OI-003.
 *
 * The values below are structurally plausible so the UI can be exercised. They
 * are NOT industry figures and must not be quoted.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { hashPassword } from '../src/server/auth/password';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
});

const PLACEHOLDER = {
  sourceKind: 'UNVERIFIED_PLACEHOLDER',
  sourceCitation:
    'UNVERIFIED PLACEHOLDER — an administrator must replace this with a real source before quoting',
} as const;

async function seedUsers(): Promise<void> {
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMeImmediately!2026';
  const users = [
    { email: 'admin@example.com', name: '管理者', role: 'ADMIN' as const },
    { email: 'manager@example.com', name: '営業マネージャー', role: 'MANAGER' as const },
    { email: 'sales@example.com', name: '営業担当', role: 'SALES' as const },
    { email: 'viewer@example.com', name: '閲覧者', role: 'VIEWER' as const },
  ];
  const passwordHash = await hashPassword(password);
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role },
      create: { ...u, passwordHash },
    });
  }
  console.log(`  users: ${users.length} (password from SEED_ADMIN_PASSWORD)`);
}

async function seedStatuses(): Promise<void> {
  const statuses = [
    { key: 'inquiry', label: '問い合わせ', sortOrder: 10, colorHex: '#94a3b8' },
    { key: 'qualified', label: 'ヒアリング済', sortOrder: 20, colorHex: '#38bdf8' },
    { key: 'surveying', label: '現地調査', sortOrder: 30, colorHex: '#22d3ee' },
    { key: 'proposing', label: '提案中', sortOrder: 40, colorHex: '#a78bfa' },
    { key: 'quoted', label: '見積提出', sortOrder: 50, colorHex: '#fbbf24' },
    { key: 'negotiating', label: '商談中', sortOrder: 60, colorHex: '#fb923c' },
    { key: 'won', label: '受注', sortOrder: 70, isWon: true, colorHex: '#22c55e' },
    { key: 'construction', label: '工事中', sortOrder: 80, isWon: true, colorHex: '#16a34a' },
    { key: 'completed', label: '完工', sortOrder: 90, isWon: true, colorHex: '#15803d' },
    { key: 'lost', label: '失注', sortOrder: 100, isLost: true, colorHex: '#ef4444' },
  ];
  for (const s of statuses) {
    await prisma.salesStatus.upsert({ where: { key: s.key }, update: s, create: s });
  }
  console.log(`  sales statuses: ${statuses.length}`);
}

async function seedCoefficients(): Promise<void> {
  const set = await prisma.coefficientSet.upsert({
    where: { key: 'default' },
    update: {},
    create: { key: 'default', name: '標準係数セット', isDefault: true },
  });

  const values = [
    {
      key: 'inverterEfficiency',
      label: 'パワーコンディショナ変換効率',
      value: 0.95,
      unit: '倍率',
      note: 'Replace with the weighted efficiency from the datasheet of the inverter actually sold.',
    },
    {
      key: 'wiringFactor',
      label: '配線損失係数',
      value: 0.98,
      unit: '倍率',
      note: 'Replace with the company design standard or a measured figure.',
    },
    {
      key: 'soilingFactor',
      label: '汚れ・積雪・ミスマッチ損失係数',
      value: 0.97,
      unit: '倍率',
      note: 'Regional. Snow-region sites need a materially lower value; state the basis.',
    },
    {
      key: 'shadingFactor',
      label: '影損失係数',
      value: 1.0,
      unit: '倍率',
      note: 'Default when shading is already in the irradiance data or assessed on site.',
    },
    {
      key: 'otherApprovedFactor',
      label: 'その他承認済み補正係数',
      value: 1.0,
      unit: '倍率',
      note: 'Any additional approved derate. Record the reason in this note.',
    },
    {
      key: 'temperatureRiseK.roof-flush',
      label: '温度上昇（屋根置き・密着）',
      value: 25,
      unit: 'K',
      note: 'Cell temperature rise above ambient at 1 kW/m². Flush mounting runs hottest.',
    },
    {
      key: 'temperatureRiseK.roof-raised',
      label: '温度上昇（屋根置き・架台）',
      value: 20,
      unit: 'K',
      note: 'Raised mounting allows some airflow behind the modules.',
    },
    {
      key: 'temperatureRiseK.ground-mounted',
      label: '温度上昇（地上設置）',
      value: 15,
      unit: 'K',
      note: 'Ground mounting runs coolest.',
    },
    {
      key: 'gridCo2FactorKgPerKWh',
      label: '系統CO2排出係数',
      value: 0.45,
      unit: 'kg-CO2/kWh',
      note: 'Use the published emission factor for the relevant utility and reporting year.',
    },
  ];

  for (const v of values) {
    await prisma.coefficient.upsert({
      where: { setId_key: { setId: set.id, key: v.key } },
      update: { label: v.label, unit: v.unit, note: v.note },
      create: { setId: set.id, ...v, ...PLACEHOLDER },
    });
  }
  console.log(`  coefficients: ${values.length} (ALL unverified — see OI-002)`);
}

async function seedTariff(): Promise<void> {
  await prisma.tariff.upsert({
    where: { key: 'default' },
    update: {},
    create: {
      key: 'default',
      name: '標準単価（要確認）',
      purchasePriceJpyPerKWh: 30,
      exportPriceJpyPerKWh: 16,
      exportPriceYears: 10,
      postExportPriceJpyPerKWh: 8,
      annualPriceEscalation: 0,
      monthlyBasicChargeJpy: 1000,
      defaultSelfConsumptionRatio: 0.3,
      isDefault: true,
      ...PLACEHOLDER,
    },
  });
  console.log('  tariffs: 1 (unverified — see OI-003)');
}

async function seedSettings(): Promise<void> {
  const settings = [
    { key: 'company.name', value: '株式会社サンプル', label: '会社名' },
    { key: 'company.address', value: '', label: '会社住所' },
    { key: 'company.phone', value: '', label: '会社電話番号' },
    { key: 'quotation.validityDays', value: 30, label: '見積有効期限（日）' },
    { key: 'quotation.defaultTaxRate', value: 0.1, label: '消費税率' },
    { key: 'simulation.projectionYears', value: 20, label: 'シミュレーション年数' },
    { key: 'layout.defaultSetbackM', value: 0.3, label: '既定の離隔距離（m）' },
    { key: 'layout.defaultPanelGapM', value: 0.02, label: '既定のパネル間隔（m）' },
    { key: 'copilot.enabled', value: true, label: 'AIコパイロットを有効にする' },
  ];
  for (const s of settings) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: { label: s.label },
      create: { key: s.key, value: s.value as never, label: s.label },
    });
  }
  console.log(`  system settings: ${settings.length}`);
}

async function main(): Promise<void> {
  console.log('Seeding reference data...');
  await seedUsers();
  await seedStatuses();
  await seedCoefficients();
  await seedTariff();
  await seedSettings();
  console.log('\nDone.');
  console.log(
    '\nNOTE: every coefficient and tariff is UNVERIFIED. The calculation engines\n' +
      'will refuse to produce a customer-facing figure until an administrator\n' +
      'enters real values with citations in Admin → Coefficients / Tariffs.\n' +
      'See docs/open-issues.md (OI-002, OI-003).',
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
