import { z } from 'zod';

/**
 * Server-side validation for every input that crosses a trust boundary.
 * Client-side validation is a convenience; this is the authority.
 */

/**
 * HTML forms and FormData give three different shapes for "not filled in":
 * `''` from a rendered empty field, `null` from `formData.get()` when the field
 * is absent entirely, and `undefined` from a JSON caller. All three mean the
 * same thing, so every optional field normalises them to `undefined` before
 * validation.
 *
 * Getting this wrong is not a cosmetic bug: it produces a validation failure on
 * a field the form does not even render, so the operator sees a generic "check
 * your input" message with nothing on screen to correct.
 */
function optional<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    schema.optional(),
  );
}

const optionalText = (max: number) => optional(z.string().trim().max(max));
const optionalCuid = () => optional(z.string().cuid());
const optionalDate = () => optional(z.coerce.date());
const optionalUrl = () => optional(z.string().url());

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
  nameKana: optionalText(200),
  companyName: optionalText(200),
  email: optional(emailSchema),
  phone: optional(
    z
      .string()
      .trim()
      .regex(/^[\d\-+() ]{7,20}$/, '電話番号の形式が正しくありません'),
  ),
  postalCode: optional(postalCodeSchema),
  prefecture: optionalText(20),
  city: optionalText(100),
  addressLine: optionalText(300),
  source: optionalText(100),
  notes: optionalText(5000),
  ownerId: optionalCuid(),
});

export const projectSchema = z.object({
  title: z.string().trim().min(1, '案件名を入力してください').max(200),
  customerId: z.string().cuid('顧客を選択してください'),
  propertyId: optionalCuid(),
  statusId: z.string().cuid('ステータスを選択してください'),
  ownerId: optionalCuid(),
  expectedCloseDate: optionalDate(),
  nextActionAt: optionalDate(),
  nextActionNote: optionalText(500),
});

export const propertySchema = z.object({
  customerId: z.string().cuid(),
  label: z.string().trim().min(1).max(100).default('本邸'),
  postalCode: optional(postalCodeSchema),
  prefecture: optionalText(20),
  city: optionalText(100),
  addressLine: optionalText(300),
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
  label: optionalText(100),
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
  datasheetUrl: optionalUrl(),
  datasheetVersion: optionalText(100),
  sourceCitation: z
    .string()
    .trim()
    .min(1, '出典を入力してください（データシート名・版・表番号など）')
    .max(500),
  sourceUrl: optionalUrl(),
  effectiveDate: optionalDate(),
});

export const coefficientSchema = z.object({
  key: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(200),
  value: z.number().finite(),
  unit: optionalText(30),
  sourceKind: z.enum([
    'MANUFACTURER_DATASHEET',
    'OFFICIAL_STANDARD',
    'PUBLIC_DATASET',
    'PROVIDER_API',
    'ADMINISTRATOR_INPUT',
    'DEMO_APPROXIMATION',
    'UNVERIFIED_PLACEHOLDER',
  ]),
  sourceCitation: z.string().trim().min(1, '出典は必須です').max(500),
  sourceUrl: optionalUrl(),
  effectiveDate: optionalDate(),
  note: optionalText(1000),
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
    'DEMO_APPROXIMATION',
    'UNVERIFIED_PLACEHOLDER',
  ]),
  sourceCitation: z.string().trim().min(1, '出典は必須です').max(500),
  sourceUrl: optionalUrl(),
});

export const activitySchema = z.object({
  projectId: optionalCuid(),
  customerId: optionalCuid(),
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
  body: optionalText(10_000),
  occurredAt: z.coerce.date(),
});

export const taskSchema = z.object({
  projectId: z.string().cuid(),
  title: z.string().trim().min(1, 'タスク名を入力してください').max(200),
  description: optionalText(5000),
  dueAt: optionalDate(),
  assigneeId: optionalCuid(),
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
  description: optionalText(1000),
  quantity: z.number().min(0).max(100_000),
  unit: z.string().trim().min(1).max(20).default('式'),
  // Money is integer JPY throughout. Floats here are how rounding bugs start.
  unitPriceJpy: z.number().int().min(-1_000_000_000).max(1_000_000_000),
});

export const quotationSchema = z.object({
  projectId: z.string().cuid(),
  simulationId: optionalCuid(),
  title: z.string().trim().min(1).max(200),
  validUntil: optionalDate(),
  discountJpy: z.number().int().min(0).max(1_000_000_000).default(0),
  subsidyJpy: z.number().int().min(0).max(1_000_000_000).default(0),
  taxRate: z.number().min(0).max(1).default(0.1),
  notes: optionalText(10_000),
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
