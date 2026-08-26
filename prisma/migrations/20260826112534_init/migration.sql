-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MANAGER', 'SALES', 'VIEWER');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('INDIVIDUAL', 'CORPORATE');

-- CreateEnum
CREATE TYPE "PitchSource" AS ENUM ('MEASURED', 'PROVIDER', 'ASSUMED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ExclusionKind" AS ENUM ('SKYLIGHT', 'CHIMNEY', 'AC_UNIT', 'EQUIPMENT', 'MAINTENANCE_AREA', 'OTHER');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('MANUFACTURER_DATASHEET', 'OFFICIAL_STANDARD', 'PUBLIC_DATASET', 'PROVIDER_API', 'ADMINISTRATOR_INPUT', 'UNVERIFIED_PLACEHOLDER');

-- CreateEnum
CREATE TYPE "MountingType" AS ENUM ('ROOF_FLUSH', 'ROOF_RAISED', 'GROUND_MOUNTED');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'ISSUED', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "QuotationCategory" AS ENUM ('PANEL', 'INVERTER', 'MOUNTING', 'CONSTRUCTION', 'ELECTRICAL', 'BATTERY', 'OTHER');

-- CreateEnum
CREATE TYPE "ActivityKind" AS ENUM ('CALL', 'EMAIL', 'MEETING', 'SITE_VISIT', 'PROPOSAL', 'CONTRACT', 'CONSTRUCTION', 'OTHER');

-- CreateEnum
CREATE TYPE "KnowledgeKind" AS ENUM ('MANUFACTURER_DOC', 'DATASHEET', 'WARRANTY', 'FAQ', 'SUBSIDY', 'SALES_MATERIAL', 'CASE_STUDY', 'COMPETITOR', 'MANUAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'SALES',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "CustomerType" NOT NULL DEFAULT 'INDIVIDUAL',
    "name" TEXT NOT NULL,
    "nameKana" TEXT,
    "companyName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "postalCode" TEXT,
    "prefecture" TEXT,
    "city" TEXT,
    "addressLine" TEXT,
    "notes" TEXT,
    "source" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesStatus" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "isWon" BOOLEAN NOT NULL DEFAULT false,
    "isLost" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "colorHex" TEXT NOT NULL DEFAULT '#64748b',

    CONSTRAINT "SalesStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "propertyId" TEXT,
    "statusId" TEXT NOT NULL,
    "ownerId" TEXT,
    "expectedCloseDate" TIMESTAMP(3),
    "nextActionAt" TIMESTAMP(3),
    "nextActionNote" TEXT,
    "lostReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '本邸',
    "postalCode" TEXT,
    "prefecture" TEXT,
    "city" TEXT,
    "addressLine" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "geocodedAt" TIMESTAMP(3),
    "geocodeFormattedAddress" TEXT,
    "mapZoom" DOUBLE PRECISION DEFAULT 20,
    "solarInsight" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoofFace" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "outline" JSONB NOT NULL,
    "pitchDeg" DOUBLE PRECISION,
    "azimuthDeg" DOUBLE PRECISION NOT NULL,
    "pitchSource" "PitchSource" NOT NULL DEFAULT 'UNKNOWN',
    "setbackM" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "panelGapM" DOUBLE PRECISION NOT NULL DEFAULT 0.02,
    "projectedAreaM2" DOUBLE PRECISION,
    "surfaceAreaM2" DOUBLE PRECISION,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoofFace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExclusionZone" (
    "id" TEXT NOT NULL,
    "roofFaceId" TEXT NOT NULL,
    "kind" "ExclusionKind" NOT NULL DEFAULT 'OTHER',
    "label" TEXT,
    "outline" JSONB NOT NULL,
    "clearanceM" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExclusionZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PanelModel" (
    "id" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "widthMm" INTEGER NOT NULL,
    "heightMm" INTEGER NOT NULL,
    "thicknessMm" INTEGER,
    "weightKg" DOUBLE PRECISION,
    "ratedPowerW" INTEGER NOT NULL,
    "efficiencyPct" DOUBLE PRECISION,
    "pmaxTempCoeffPerK" DOUBLE PRECISION NOT NULL,
    "vocV" DOUBLE PRECISION,
    "iscA" DOUBLE PRECISION,
    "vmpV" DOUBLE PRECISION,
    "impA" DOUBLE PRECISION,
    "noctC" DOUBLE PRECISION,
    "annualDegradation" DOUBLE PRECISION NOT NULL,
    "productWarrantyYears" INTEGER,
    "performanceWarrantyYears" INTEGER,
    "datasheetUrl" TEXT,
    "datasheetVersion" TEXT,
    "sourceCitation" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PanelModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InverterModel" (
    "id" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "ratedOutputW" INTEGER NOT NULL,
    "maxInputW" INTEGER,
    "peakEfficiency" DOUBLE PRECISION NOT NULL,
    "weightedEfficiency" DOUBLE PRECISION,
    "mpptCount" INTEGER,
    "datasheetUrl" TEXT,
    "datasheetVersion" TEXT,
    "sourceCitation" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InverterModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoefficientSet" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoefficientSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coefficient" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "sourceKind" "SourceKind" NOT NULL DEFAULT 'UNVERIFIED_PLACEHOLDER',
    "sourceCitation" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coefficient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tariff" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purchasePriceJpyPerKWh" DOUBLE PRECISION NOT NULL,
    "exportPriceJpyPerKWh" DOUBLE PRECISION NOT NULL,
    "exportPriceYears" INTEGER NOT NULL,
    "postExportPriceJpyPerKWh" DOUBLE PRECISION NOT NULL,
    "annualPriceEscalation" DOUBLE PRECISION NOT NULL,
    "monthlyBasicChargeJpy" INTEGER NOT NULL,
    "defaultSelfConsumptionRatio" DOUBLE PRECISION NOT NULL,
    "sourceKind" "SourceKind" NOT NULL DEFAULT 'UNVERIFIED_PLACEHOLDER',
    "sourceCitation" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tariff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IrradianceStation" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "monthlyIrradiationKWhPerM2PerDay" JSONB NOT NULL,
    "monthlyAmbientTempC" JSONB NOT NULL,
    "isPlaneOfArray" BOOLEAN NOT NULL DEFAULT false,
    "tiltDeg" DOUBLE PRECISION,
    "azimuthDeg" DOUBLE PRECISION,
    "sourceKind" "SourceKind" NOT NULL DEFAULT 'UNVERIFIED_PLACEHOLDER',
    "sourceCitation" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IrradianceStation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Layout" (
    "id" TEXT NOT NULL,
    "roofFaceId" TEXT NOT NULL,
    "panelModelId" TEXT NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "placements" JSONB NOT NULL,
    "panelCount" INTEGER NOT NULL,
    "installedW" INTEGER NOT NULL,
    "orientation" TEXT,
    "angleDeg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "usableAreaM2" DOUBLE PRECISION NOT NULL,
    "isManuallyEdited" BOOLEAN NOT NULL DEFAULT false,
    "engineMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Layout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Simulation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT,
    "mounting" "MountingType" NOT NULL DEFAULT 'ROOF_FLUSH',
    "inverterModelId" TEXT,
    "coefficientSetId" TEXT NOT NULL,
    "tariffId" TEXT NOT NULL,
    "installedW" INTEGER NOT NULL,
    "panelCount" INTEGER NOT NULL,
    "annualGenerationKWh" DOUBLE PRECISION NOT NULL,
    "specificYieldKWhPerKw" DOUBLE PRECISION NOT NULL,
    "performanceRatio" DOUBLE PRECISION NOT NULL,
    "annualCo2AvoidedKg" DOUBLE PRECISION NOT NULL,
    "firstYearBenefitJpy" INTEGER NOT NULL,
    "lifetimeNetJpy" INTEGER NOT NULL,
    "paybackYears" DOUBLE PRECISION,
    "npvJpy" INTEGER NOT NULL,
    "irr" DOUBLE PRECISION,
    "solarEngineVersion" TEXT NOT NULL,
    "economicsEngineVersion" TEXT NOT NULL,
    "layoutEngineVersion" TEXT NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "resultSnapshot" JSONB NOT NULL,
    "warnings" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Simulation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationLayout" (
    "simulationId" TEXT NOT NULL,
    "layoutId" TEXT NOT NULL,

    CONSTRAINT "SimulationLayout_pkey" PRIMARY KEY ("simulationId","layoutId")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "simulationId" TEXT,
    "version" INTEGER NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "validUntil" TIMESTAMP(3),
    "subtotalJpy" INTEGER NOT NULL DEFAULT 0,
    "discountJpy" INTEGER NOT NULL DEFAULT 0,
    "subsidyJpy" INTEGER NOT NULL DEFAULT 0,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "taxJpy" INTEGER NOT NULL DEFAULT 0,
    "totalJpy" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "simulationSnapshot" JSONB,
    "issuedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationItem" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "category" "QuotationCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT '式',
    "unitPriceJpy" INTEGER NOT NULL,
    "amountJpy" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuotationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "customerId" TEXT,
    "kind" "ActivityKind" NOT NULL DEFAULT 'OTHER',
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "assigneeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileAsset" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDocument" (
    "id" TEXT NOT NULL,
    "kind" "KnowledgeKind" NOT NULL DEFAULT 'MANUAL',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceUrl" TEXT,
    "sourceCitation" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "detail" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "label" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "HealthCheck" (
    "id" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "isHealthy" BOOLEAN NOT NULL,
    "latencyMs" INTEGER,
    "message" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_isActive_idx" ON "User"("role", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");

-- CreateIndex
CREATE INDEX "Customer_ownerId_idx" ON "Customer"("ownerId");

-- CreateIndex
CREATE INDEX "Customer_deletedAt_idx" ON "Customer"("deletedAt");

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "Customer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SalesStatus_key_key" ON "SalesStatus"("key");

-- CreateIndex
CREATE INDEX "SalesStatus_sortOrder_idx" ON "SalesStatus"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");

-- CreateIndex
CREATE INDEX "Project_customerId_idx" ON "Project"("customerId");

-- CreateIndex
CREATE INDEX "Project_statusId_idx" ON "Project"("statusId");

-- CreateIndex
CREATE INDEX "Project_ownerId_idx" ON "Project"("ownerId");

-- CreateIndex
CREATE INDEX "Project_deletedAt_idx" ON "Project"("deletedAt");

-- CreateIndex
CREATE INDEX "Project_nextActionAt_idx" ON "Project"("nextActionAt");

-- CreateIndex
CREATE INDEX "Property_customerId_idx" ON "Property"("customerId");

-- CreateIndex
CREATE INDEX "RoofFace_propertyId_idx" ON "RoofFace"("propertyId");

-- CreateIndex
CREATE INDEX "ExclusionZone_roofFaceId_idx" ON "ExclusionZone"("roofFaceId");

-- CreateIndex
CREATE INDEX "PanelModel_isActive_idx" ON "PanelModel"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PanelModel_manufacturer_model_datasheetVersion_key" ON "PanelModel"("manufacturer", "model", "datasheetVersion");

-- CreateIndex
CREATE INDEX "InverterModel_isActive_idx" ON "InverterModel"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "InverterModel_manufacturer_model_datasheetVersion_key" ON "InverterModel"("manufacturer", "model", "datasheetVersion");

-- CreateIndex
CREATE UNIQUE INDEX "CoefficientSet_key_key" ON "CoefficientSet"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Coefficient_setId_key_key" ON "Coefficient"("setId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Tariff_key_key" ON "Tariff"("key");

-- CreateIndex
CREATE INDEX "IrradianceStation_latitude_longitude_idx" ON "IrradianceStation"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "Layout_roofFaceId_idx" ON "Layout"("roofFaceId");

-- CreateIndex
CREATE INDEX "Simulation_projectId_idx" ON "Simulation"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Simulation_projectId_version_key" ON "Simulation"("projectId", "version");

-- CreateIndex
CREATE INDEX "Quotation_projectId_idx" ON "Quotation"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_projectId_version_key" ON "Quotation"("projectId", "version");

-- CreateIndex
CREATE INDEX "QuotationItem_quotationId_idx" ON "QuotationItem"("quotationId");

-- CreateIndex
CREATE INDEX "Activity_projectId_occurredAt_idx" ON "Activity"("projectId", "occurredAt");

-- CreateIndex
CREATE INDEX "Activity_customerId_occurredAt_idx" ON "Activity"("customerId", "occurredAt");

-- CreateIndex
CREATE INDEX "Task_projectId_idx" ON "Task"("projectId");

-- CreateIndex
CREATE INDEX "Task_assigneeId_completedAt_idx" ON "Task"("assigneeId", "completedAt");

-- CreateIndex
CREATE INDEX "Task_dueAt_idx" ON "Task"("dueAt");

-- CreateIndex
CREATE INDEX "Note_projectId_idx" ON "Note"("projectId");

-- CreateIndex
CREATE INDEX "FileAsset_projectId_idx" ON "FileAsset"("projectId");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_kind_isActive_idx" ON "KnowledgeDocument"("kind", "isActive");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "HealthCheck_component_checkedAt_idx" ON "HealthCheck"("component", "checkedAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "SalesStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoofFace" ADD CONSTRAINT "RoofFace_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExclusionZone" ADD CONSTRAINT "ExclusionZone_roofFaceId_fkey" FOREIGN KEY ("roofFaceId") REFERENCES "RoofFace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coefficient" ADD CONSTRAINT "Coefficient_setId_fkey" FOREIGN KEY ("setId") REFERENCES "CoefficientSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Layout" ADD CONSTRAINT "Layout_roofFaceId_fkey" FOREIGN KEY ("roofFaceId") REFERENCES "RoofFace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Layout" ADD CONSTRAINT "Layout_panelModelId_fkey" FOREIGN KEY ("panelModelId") REFERENCES "PanelModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Simulation" ADD CONSTRAINT "Simulation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Simulation" ADD CONSTRAINT "Simulation_inverterModelId_fkey" FOREIGN KEY ("inverterModelId") REFERENCES "InverterModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Simulation" ADD CONSTRAINT "Simulation_coefficientSetId_fkey" FOREIGN KEY ("coefficientSetId") REFERENCES "CoefficientSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Simulation" ADD CONSTRAINT "Simulation_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "Tariff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Simulation" ADD CONSTRAINT "Simulation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationLayout" ADD CONSTRAINT "SimulationLayout_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationLayout" ADD CONSTRAINT "SimulationLayout_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "Layout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
