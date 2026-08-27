-- AlterEnum
ALTER TYPE "SourceKind" ADD VALUE 'DEMO_APPROXIMATION';

-- AlterTable
ALTER TABLE "PanelModel" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Simulation" ADD COLUMN     "demoFields" JSONB,
ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;
