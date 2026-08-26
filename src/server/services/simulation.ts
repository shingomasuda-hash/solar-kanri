import { prisma } from '../db/client';
import { requirePermission } from '../auth/rbac';
import type { SessionUser } from '../auth/session';
import { recordAudit } from './audit';
import {
  MONTHS,
  ManualSolarProvider,
  PvgisProvider,
  UnsourcedCoefficientError,
  resolveIrradiance,
  simulateGeneration,
  sourced,
  type CoefficientSet,
  type IrradianceDataset,
  type ModuleElectricalSpec,
  type Month,
  type MountingType,
  type SolarDataProvider,
  type SourceKind,
} from '@core/solar';
import { calculateEconomics, type EconomicsInput, type TariffSet } from '@core/economics';
import { SOLAR_ENGINE_VERSION } from '@core/solar/types';
import { ECONOMICS_ENGINE_VERSION } from '@core/economics/types';
import { LAYOUT_ENGINE_VERSION } from '@core/layout';
import type { SourceKind as DbSourceKind } from '../../../generated/prisma/enums';

/**
 * Runs the deterministic engines and persists an immutable result.
 *
 * The engines refuse unverified coefficients, so this is where a fresh install
 * fails closed until an administrator has entered real values. That failure is
 * translated into a message naming exactly what is missing, rather than a
 * stack trace.
 */

export class SimulationBlockedError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(
      '係数の出典が未確認のため、シミュレーションを実行できません。' +
        `管理画面で次の項目に出典を登録してください: ${missing.join(', ')} / ` +
        'Refusing to simulate: coefficients without a verified source.',
    );
    this.name = 'SimulationBlockedError';
    this.missing = missing;
  }
}

export interface SimulationRequest {
  readonly projectId: string;
  readonly layoutIds: readonly string[];
  readonly mounting: MountingType;
  readonly coefficientSetKey?: string;
  readonly tariffKey?: string;
  readonly annualConsumptionKWh: number;
  readonly totalCostJpy: number;
  readonly subsidyJpy: number;
  readonly projectionYears?: number;
  readonly label?: string;
}

const SOURCE_KIND_MAP: Record<DbSourceKind, SourceKind> = {
  MANUFACTURER_DATASHEET: 'manufacturer-datasheet',
  OFFICIAL_STANDARD: 'official-standard',
  PUBLIC_DATASET: 'public-dataset',
  PROVIDER_API: 'provider-api',
  ADMINISTRATOR_INPUT: 'administrator-input',
  UNVERIFIED_PLACEHOLDER: 'unverified-placeholder',
};

export async function runSimulation(user: SessionUser, request: SimulationRequest) {
  requirePermission(user, 'simulation:run');

  const project = await prisma.project.findFirst({
    where: { id: request.projectId, deletedAt: null },
    include: { property: true },
  });
  if (!project) throw new Error('案件が見つかりません / Project not found');

  const layouts = await prisma.layout.findMany({
    where: { id: { in: [...request.layoutIds] } },
    include: { panelModel: true, roofFace: true },
  });
  if (layouts.length === 0) {
    throw new Error(
      'パネル配置がありません。屋根を作図し、自動配置を実行してからシミュレーションしてください。',
    );
  }

  const panelCount = layouts.reduce((s, l) => s + l.panelCount, 0);
  const installedW = layouts.reduce((s, l) => s + l.installedW, 0);
  if (installedW <= 0) {
    throw new Error('設置容量がゼロです。パネルが1枚も配置されていません。');
  }

  // Every layout must use the same module: the thermal model takes one
  // temperature coefficient, and averaging two modules' datasheets would be a
  // fabricated figure.
  const uniqueModules = new Set(layouts.map((l) => l.panelModelId));
  if (uniqueModules.size > 1) {
    throw new Error(
      '複数の異なるパネル型番が選択されています。1回のシミュレーションでは同一型番のみ対応しています。',
    );
  }
  const panel = layouts[0]!.panelModel;

  const [coefficientSet, tariff] = await Promise.all([
    prisma.coefficientSet.findFirst({
      where: request.coefficientSetKey ? { key: request.coefficientSetKey } : { isDefault: true },
      include: { values: true },
    }),
    prisma.tariff.findFirst({
      where: request.tariffKey ? { key: request.tariffKey } : { isDefault: true },
    }),
  ]);
  if (!coefficientSet) throw new Error('係数セットが設定されていません');
  if (!tariff) throw new Error('電力単価が設定されていません');

  const coefficient = (key: string) => {
    const found = coefficientSet.values.find((v) => v.key === key);
    if (!found) {
      throw new Error(`係数 "${key}" が未登録です。管理画面で登録してください。`);
    }
    return sourced(found.value, {
      kind: SOURCE_KIND_MAP[found.sourceKind],
      citation: found.sourceCitation,
      url: found.sourceUrl ?? undefined,
      effectiveDate: found.effectiveDate?.toISOString(),
      verifiedAt: found.verifiedAt?.toISOString(),
      verifiedBy: found.verifiedBy ?? undefined,
      note: found.note ?? undefined,
    });
  };

  // A module row is only a datasheet source once a human has actually checked
  // it against the datasheet. The seeded SAMPLE module has verifiedAt = null
  // and its citation says so, and it must be refused exactly like an unsourced
  // coefficient — otherwise a temperature coefficient nobody verified would
  // reach a customer-facing figure.
  const panelSource = {
    kind: (panel.verifiedAt ? 'manufacturer-datasheet' : 'unverified-placeholder') as SourceKind,
    citation: panel.sourceCitation,
    url: panel.sourceUrl ?? undefined,
    effectiveDate: panel.effectiveDate?.toISOString(),
    verifiedAt: panel.verifiedAt?.toISOString(),
    verifiedBy: panel.verifiedBy ?? undefined,
  };

  const moduleSpec: ModuleElectricalSpec = {
    manufacturer: panel.manufacturer,
    model: panel.model,
    datasheetVersion: panel.datasheetVersion ?? 'unspecified',
    ratedPowerW: sourced(panel.ratedPowerW, panelSource),
    pmaxTempCoeffPerK: sourced(panel.pmaxTempCoeffPerK, panelSource),
    noctC: sourced(panel.noctC ?? 45, panelSource),
    annualDegradation: sourced(panel.annualDegradation, panelSource),
  };

  const coefficients: CoefficientSet = {
    id: coefficientSet.id,
    name: coefficientSet.name,
    losses: {
      inverterEfficiency: coefficient('inverterEfficiency'),
      wiringFactor: coefficient('wiringFactor'),
      soilingFactor: coefficient('soilingFactor'),
      shadingFactor: coefficient('shadingFactor'),
      otherApprovedFactor: coefficient('otherApprovedFactor'),
    },
    thermal: {
      temperatureRiseK: {
        'roof-flush': coefficient('temperatureRiseK.roof-flush'),
        'roof-raised': coefficient('temperatureRiseK.roof-raised'),
        'ground-mounted': coefficient('temperatureRiseK.ground-mounted'),
      },
    },
    gridCo2FactorKgPerKWh: coefficient('gridCo2FactorKgPerKWh'),
  };

  // Irradiance geometry: use the largest roof face, weighted by capacity — it
  // dominates the yield, and modelling each face separately would need a
  // separate simulation per face.
  const dominant = [...layouts].sort((a, b) => b.installedW - a.installedW)[0]!;
  const latitude = project.property?.latitude;
  const longitude = project.property?.longitude;
  if (latitude == null || longitude == null) {
    throw new Error(
      '物件の位置が未設定です。設計画面で住所を検索し、地図上の位置を確定してください。',
    );
  }

  const irradiance = await resolveSiteIrradiance({
    latitude,
    longitude,
    tiltDeg: dominant.roofFace.pitchDeg ?? 0,
    azimuthDeg: dominant.roofFace.azimuthDeg,
  });

  const tariffSet: TariffSet = {
    id: tariff.id,
    name: tariff.name,
    purchasePriceJpyPerKWh: tariffValue(tariff.purchasePriceJpyPerKWh, tariff),
    exportPriceJpyPerKWh: tariffValue(tariff.exportPriceJpyPerKWh, tariff),
    exportPriceYears: tariffValue(tariff.exportPriceYears, tariff),
    postExportPriceJpyPerKWh: tariffValue(tariff.postExportPriceJpyPerKWh, tariff),
    annualPriceEscalation: tariffValue(tariff.annualPriceEscalation, tariff),
    monthlyBasicChargeJpy: tariffValue(tariff.monthlyBasicChargeJpy, tariff),
  };

  const projectionYears = request.projectionYears ?? 20;

  let generation;
  let economics;
  try {
    generation = simulateGeneration({
      installedKw: installedW / 1000,
      module: moduleSpec,
      mounting: request.mounting,
      coefficients,
      irradiance,
      projectionYears,
    });

    const economicsInput: EconomicsInput = {
      yearlyGenerationKWh: generation.yearlyGenerationKWh,
      tariff: tariffSet,
      consumption: {
        annualConsumptionKWh: request.annualConsumptionKWh,
        selfConsumptionRatio: tariffValue(tariff.defaultSelfConsumptionRatio, tariff),
      },
      cost: {
        totalCostJpy: request.totalCostJpy,
        subsidyJpy: request.subsidyJpy,
        annualOpexJpy: sourced(0, {
          kind: 'administrator-input',
          citation: '運用保守費は見積書の項目として計上されます（既定 0 円/年）',
        }),
        scheduledCostsJpy: {},
      },
      discountRate: sourced(0, {
        kind: 'administrator-input',
        citation: '割引率 0%（名目値で表示）',
      }),
    };
    economics = calculateEconomics(economicsInput);
  } catch (err) {
    if (err instanceof UnsourcedCoefficientError) {
      throw new SimulationBlockedError(err.fields);
    }
    throw err;
  }

  const lastVersion = await prisma.simulation.findFirst({
    where: { projectId: request.projectId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });

  const simulation = await prisma.simulation.create({
    data: {
      projectId: request.projectId,
      version: (lastVersion?.version ?? 0) + 1,
      label: request.label ?? null,
      mounting: toDbMounting(request.mounting),
      coefficientSetId: coefficientSet.id,
      tariffId: tariff.id,
      installedW,
      panelCount,
      annualGenerationKWh: generation.annualGenerationKWh,
      specificYieldKWhPerKw: generation.specificYieldKWhPerKw,
      performanceRatio: generation.performanceRatio,
      annualCo2AvoidedKg: generation.annualCo2AvoidedKg,
      firstYearBenefitJpy: Math.round(economics.firstYearBenefitJpy),
      lifetimeNetJpy: Math.round(economics.lifetimeNetJpy),
      paybackYears: economics.paybackYears,
      npvJpy: Math.round(economics.npvJpy),
      irr: economics.irr,
      solarEngineVersion: SOLAR_ENGINE_VERSION,
      economicsEngineVersion: ECONOMICS_ENGINE_VERSION,
      layoutEngineVersion: LAYOUT_ENGINE_VERSION,
      // The snapshot is what makes this result reproducible after the masters
      // have moved on. Without it, editing a coefficient would silently rewrite
      // history on every quotation ever issued.
      inputSnapshot: {
        request,
        module: moduleSpec,
        coefficients,
        tariff: tariffSet,
        irradiance,
        projectionYears,
        layouts: layouts.map((l) => ({
          id: l.id,
          roofFaceId: l.roofFaceId,
          panelModelId: l.panelModelId,
          panelCount: l.panelCount,
          installedW: l.installedW,
          algorithmVersion: l.algorithmVersion,
        })),
      } as never,
      resultSnapshot: { generation, economics } as never,
      warnings: [...generation.warnings, ...economics.warnings] as never,
      createdById: user.id,
      layouts: { create: layouts.map((l) => ({ layoutId: l.id })) },
    },
  });

  await recordAudit({
    userId: user.id,
    action: 'simulation.run',
    entityType: 'Simulation',
    entityId: simulation.id,
    detail: {
      projectId: request.projectId,
      version: simulation.version,
      installedW,
      annualGenerationKWh: generation.annualGenerationKWh,
    },
  });

  return { simulation, generation, economics };
}

function tariffValue(
  value: number,
  tariff: {
    sourceKind: DbSourceKind;
    sourceCitation: string;
    sourceUrl: string | null;
    verifiedAt: Date | null;
    verifiedBy: string | null;
  },
) {
  return sourced(value, {
    kind: SOURCE_KIND_MAP[tariff.sourceKind],
    citation: tariff.sourceCitation,
    url: tariff.sourceUrl ?? undefined,
    verifiedAt: tariff.verifiedAt?.toISOString(),
    verifiedBy: tariff.verifiedBy ?? undefined,
  });
}

function toDbMounting(m: MountingType) {
  return m === 'roof-flush' ? 'ROOF_FLUSH' : m === 'roof-raised' ? 'ROOF_RAISED' : 'GROUND_MOUNTED';
}

/**
 * Resolve site irradiance through the configured provider chain.
 * Order is configuration, not code: a site-specific measured dataset should be
 * ahead of a modelled one.
 */
export async function resolveSiteIrradiance(query: {
  latitude: number;
  longitude: number;
  tiltDeg: number;
  azimuthDeg: number;
}): Promise<IrradianceDataset> {
  const stations = await prisma.irradianceStation.findMany({ where: { isActive: true } });

  const manual = new ManualSolarProvider(
    stations.map((s) => ({
      label: s.label,
      latitude: s.latitude,
      longitude: s.longitude,
      climate: {
        planeOfArrayKWhPerM2PerDay: monthRecord(s.monthlyIrradiationKWhPerM2PerDay),
        ambientTempC: monthRecord(s.monthlyAmbientTempC),
      },
      source: {
        kind: SOURCE_KIND_MAP[s.sourceKind],
        citation: s.sourceCitation,
        url: s.sourceUrl ?? undefined,
        verifiedAt: s.verifiedAt?.toISOString(),
        verifiedBy: s.verifiedBy ?? undefined,
      },
      isPlaneOfArray: s.isPlaneOfArray,
    })),
  );

  const order = (process.env.SOLAR_PROVIDER_ORDER ?? 'manual,pvgis')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const available: Record<string, SolarDataProvider> = {
    manual,
    pvgis: new PvgisProvider({ enabled: process.env.PVGIS_ENABLED !== 'false' }),
  };
  const providers = order.map((id) => available[id]).filter((p): p is SolarDataProvider => !!p);

  const { dataset, attempts } = await resolveIrradiance(providers, query);
  if (!dataset) {
    throw new Error(
      'この地点の日射量データを取得できませんでした。' +
        '管理画面で日射量データを登録するか、外部プロバイダの設定を確認してください。' +
        `（試行: ${attempts.map((a) => `${a.providerId}=${a.outcome}`).join(', ')}）`,
    );
  }
  return dataset;
}

function monthRecord(value: unknown): Record<Month, number> {
  const out = {} as Record<Month, number>;
  const src = (value ?? {}) as Record<string, unknown>;
  for (const m of MONTHS) {
    const v = src[String(m)];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`日射量データの ${m} 月の値が不正です`);
    }
    out[m] = v;
  }
  return out;
}
