-- DropForeignKey
ALTER TABLE "SimulationLayout" DROP CONSTRAINT "SimulationLayout_layoutId_fkey";

-- AddForeignKey
ALTER TABLE "SimulationLayout" ADD CONSTRAINT "SimulationLayout_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "Layout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
