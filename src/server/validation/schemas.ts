import { z } from 'zod';

/**
 * Server-side validation for every input that crosses a trust boundary.
 * Client-side validation is a convenience; this is the authority.
 */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('メールアドレスの形式が正しくありません');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'パスワードを入力してください'),
});

/** Japanese postal code, with or without the hyphen. */
export const postalCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{3}-?\d{4}$/, '郵便番号は 123-4567 の形式で入力してください');

export const customerSchema = z.object({
  type: z.enum(['INDIVIDUAL', 'CORPORATE']),
  name: z.string().trim().min(1, 'お名前を入力してください').max(200),
  nameKana: z.string().trim().max(200).optional().or(z.literal('')),
  companyName: z.string().trim().max(200).optional().or(z.literal('')),
  email: emailSchema.optional().or(z.literal('')),
  phone: z
    .string()
    .trim()
    .regex(/^[\d\-+() ]{7,20}$/, '電話番号の形式が正しくありません')
    .optional()
    .or(z.literal('')),
  postalCode: postalCodeSchema.optional().or(z.literal('')),
  prefecture: z.string().trim().max(20).optional().or(z.literal('')),
  city: z.string().trim().max(100).optional().or(z.literal('')),
  addressLine: z.string().trim().max(300).optional().or(z.literal('')),
  source: z.string().trim().max(100).optional().or(z.literal('')),
  notes: z.string().trim().max(5000).optional().or(z.literal('')),
  ownerId: z.string().cuid().optional().or(z.literal('')),
});

export const projectSchema = z.object({
  title: z.string().trim().min(1, '案件名を入力してください').max(200),
  customerId: z.string().cuid('顧客を選択してください'),
  propertyId: z.string().cuid().optional().or(z.literal('')),
  statusId: z.string().cuid('ステータスを選択してください'),
  ownerId: z.string().cuid().optional().or(z.literal('')),
  expectedCloseDate: z.coerce.date().optional().nullable(),
  nextActionAt: z.coerce.date().optional().nullable(),
  nextActionNote: z.string().trim().max(500).optional().or(z.literal('')),
});

export const propertySchema = z.object({
  customerId: z.string().cuid(),
  label: z.string().trim().min(1).max(100).default('本邸'),
  postalCode: postalCodeSchema.optional().or(z.literal('')),
  prefecture: z.string().trim().max(20).optional().or(z.literal('')),
  city: z.string().trim().max(100).optional().or(z.literal('')),
  addressLine: z.string().trim().max(300).optional().or(z.literal('')),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
});

/** A GeoJSON Polygon in WGS84, validated structurally before it is stored. */
export const geoJsonPolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z
    .array(
      z
        .array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]))
        .min(4, 'ポリゴンには4点以上（閉じた環）が必要です'),
    )
    .min(1, 'ポリゴンには外周が必要です'),
});

export const roofFaceSchema = z.object({
  propertyId: z.string().cuid(),
  label: z.string().trim().min(1).max(100),
  outline: geoJsonPolygonSchema,
  pitchDeg: z.number().min(0).max(89.9).optional().nullable(),
  azimuthDeg: z.number().min(0).max(360),
  pitchSource: z.enum(['MEASURED', 'PROVIDER', 'ASSUMED', 'UNKNOWN']),
  setbackM: z.number().min(0).max(5).default(0.3),
  panelGapM: z.number().min(0).max(1).default(0.02),
});

export const exclusionZoneSchema = z.object({
  roofFaceId: z.string().cuid(),
  kind: z.enum(['SKYLIGHT', 'CHIMNEY', 'AC_UNIT', 'EQUIPMENT', 'MAINTENANCE_AREA', 'OTHER']),
  label: z.string().trim().max(100).optional().or(z.literal('')),
  outline: geoJsonPolygonSchema,
  clearanceM: z.number().min(0).max(5).default(0.3),
});

export const panelModelSchema = z.object({
  manufacturer: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(100),
  widthMm: z.number().int().min(100).max(5000),
  heightMm: z.number().int().min(100).max(5000),
  thicknessMm: z.number().int().min(1).max(200).optional().nullable(),
  weightKg: z.number().min(0).max(200).optional().nullable(),
  ratedPowerW: z.number().int().min(1).max(2000),
  efficiencyPct: z.number().min(1).max(50).optional().nullable(),
  // Datasheets print %/degC. -0.35 %/degC must be stored as -0.0035 /K; the
  // bound catches the missing division, which would be a silent 100x error.
  pmaxTempCoeffPerK: z
    .number()
    .min(-0.02, '温度係数が大きすぎます。%/℃ の値を100で割ってください（例 -0.35 → -0.0035）')
    .max(0, '温度係数は負の値です'),
  vocV: z.number().min(0).max(2000).optional().nullable(),
  iscA: z.number().min(0).max(100).optional().nullable(),
  vmpV: z.number().min(0).max(2000).optional().nullable(),
  impA: z.number().min(0).max(100).optional().nullable(),
  noctC: z.number().min(0).max(100).optional().nullable(),
  annualDegradation: z.number().min(0).max(0.1),
  productWarrantyYears: z.number().int().min(0).max(50).optional().nullable(),
  performanceWarrantyYears: z.number().int().min(0).max(50).optional().nullable(),
  datasheetUrl: z.string().url().optional().or(z.literal('')),
  datasheetVersion: z.string().trim().max(100).optional().or(z.literal('')),
  sourceCitation: z
    .string()
    .trim()
    .min(1, '出典を入力してください（データシート名・版・表番号など）')
    .max(500),
  sourceUrl: z.string().url().optional().or(z.literal('')),
  effectiveDate: z.coerce.date().optional().nullable(),
});

export const coefficientSchema = z.object({
  key: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(200),
  value: z.number().finite(),
  unit: z.string().trim().max(30).optional().or(z.literal('')),
  sourceKind: z.enum([
    'MANUFACTURER_DATASHEET',
    'OFFICIAL_STANDARD',
    'PUBLIC_DATASET',
    'PROVIDER_API',
    'ADMINISTRATOR_INPUT',
    'UNVERIFIED_PLACEHOLDER',
  ]),
  sourceCitation: z.string().trim().min(1, '出典は必須です').max(500),
  sourceUrl: z.string().url().optional().or(z.literal('')),
  effectiveDate: z.coerce.date().optional().nullable(),
  note: z.string().trim().max(1000).optional().or(z.literal('')),
});

export const tariffSchema = z.object({
  key: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  purchasePriceJpyPerKWh: z.number().min(0).max(1000),
  exportPriceJpyPerKWh: z.number().min(0).max(1000),
  exportPriceYears: z.number().int().min(0).max(50),
  postExportPriceJpyPerKWh: z.number().min(0).max(1000),
  annualPriceEscalation: z.number().min(-0.5).max(0.5),
  monthlyBasicChargeJpy: z.number().int().min(0).max(1_000_000),
  defaultSelfConsumptionRatio: z.number().min(0).max(1),
  sourceKind: z.enum([
    'MANUFACTURER_DATASHEET',
    'OFFICIAL_STANDARD',
    'PUBLIC_DATASET',
    'PROVIDER_API',
    'ADMINISTRATOR_INPUT',
    'UNVERIFIED_PLACEHOLDER',
  ]),
  sourceCitation: z.string().trim().min(1, '出典は必須です').max(500),
  sourceUrl: z.string().url().optional().or(z.literal('')),
});

export const activitySchema = z.object({
  projectId: z.string().cuid().optional().or(z.literal('')),
  customerId: z.string().cuid().optional().or(z.literal('')),
  kind: z.enum([
    'CALL',
    'EMAIL',
    'MEETING',
    'SITE_VISIT',
    'PROPOSAL',
    'CONTRACT',
    'CONSTRUCTION',
    'OTHER',
  ]),
  subject: z.string().trim().min(1, '件名を入力してください').max(200),
  body: z.string().trim().max(10_000).optional().or(z.literal('')),
  occurredAt: z.coerce.date(),
});

export const taskSchema = z.object({
  projectId: z.string().cuid(),
  title: z.string().trim().min(1, 'タスク名を入力してください').max(200),
  description: z.string().trim().max(5000).optional().or(z.literal('')),
  dueAt: z.coerce.date().optional().nullable(),
  assigneeId: z.string().cuid().optional().or(z.literal('')),
});

export const noteSchema = z.object({
  projectId: z.string().cuid(),
  body: z.string().trim().min(1, '内容を入力してください').max(20_000),
});

export const quotationItemSchema = z.object({
  category: z.enum([
    'PANEL',
    'INVERTER',
    'MOUNTING',
    'CONSTRUCTION',
    'ELECTRICAL',
    'BATTERY',
    'OTHER',
  ]),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  quantity: z.number().min(0).max(100_000),
  unit: z.string().trim().min(1).max(20).default('式'),
  // Money is integer JPY throughout. Floats here are how rounding bugs start.
  unitPriceJpy: z.number().int().min(-1_000_000_000).max(1_000_000_000),
});

export const quotationSchema = z.object({
  projectId: z.string().cuid(),
  simulationId: z.string().cuid().optional().or(z.literal('')),
  title: z.string().trim().min(1).max(200),
  validUntil: z.coerce.date().optional().nullable(),
  discountJpy: z.number().int().min(0).max(1_000_000_000).default(0),
  subsidyJpy: z.number().int().min(0).max(1_000_000_000).default(0),
  taxRate: z.number().min(0).max(1).default(0.1),
  notes: z.string().trim().max(10_000).optional().or(z.literal('')),
  items: z.array(quotationItemSchema).max(200),
});

export const userSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1).max(100),
  role: z.enum(['ADMIN', 'MANAGER', 'SALES', 'VIEWER']),
  isActive: z.boolean().default(true),
});

export const geocodeSchema = z.object({
  address: z.string().trim().min(1, '住所を入力してください').max(300),
});

export type CustomerInput = z.infer<typeof customerSchema>;
export type ProjectInput = z.infer<typeof projectSchema>;
export type RoofFaceInput = z.infer<typeof roofFaceSchema>;
export type PanelModelInput = z.infer<typeof panelModelSchema>;
export type QuotationInput = z.infer<typeof quotationSchema>;
