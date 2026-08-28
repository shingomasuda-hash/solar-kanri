import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';
import { can } from '@/server/auth/rbac';
import { getProject } from '@/server/services/projects';
import { listPanelModels } from '@/server/services/design';
import { prisma } from '@/server/db/client';
import { geocodingKeySource } from '@/server/services/geocoding';
import { Alert, LinkButton, PageHeader } from '@/components/ui';
import { DesignWorkspace } from './design-workspace';

export default async function DesignPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const { id } = await params;

  const project = await getProject(user, id);
  if (!project) notFound();

  // Read only. The property is created with the project, so this page never
  // writes — a page that writes during render can fire on a link prefetch.
  const property = project.property;

  if (!property) {
    return (
      <>
        <PageHeader title="屋根・パネル設計" subtitle={project.title} />
        <Alert tone="warning" title="物件が未登録です">
          この案件には物件が紐づいていません。案件編集画面から物件を選択してください。
        </Alert>
      </>
    );
  }

  const [panels, layouts] = await Promise.all([
    listPanelModels(),
    prisma.layout.findMany({
      where: { roofFaceId: { in: property.roofFaces.map((f) => f.id) } },
      include: { panelModel: true },
    }),
  ]);

  const defaultAddress =
    [property.prefecture, property.city, property.addressLine].filter(Boolean).join('') ||
    [project.customer.prefecture, project.customer.city, project.customer.addressLine]
      .filter(Boolean)
      .join('');

  return (
    <>
      <PageHeader
        title="屋根・パネル設計"
        subtitle={
          <Link href={`/projects/${project.id}`} className="hover:underline">
            {project.title}
          </Link>
        }
        actions={
          <LinkButton href={`/projects/${project.id}`} variant="secondary">
            案件に戻る
          </LinkButton>
        }
      />

      <DesignWorkspace
        projectId={project.id}
        propertyId={property.id}
        canWrite={can(user, 'project:write')}
        canSimulate={can(user, 'simulation:run')}
        mapsApiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || null}
        mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || null}
        geocodingKeySource={geocodingKeySource()}
        defaultAddress={defaultAddress}
        position={
          property.latitude != null && property.longitude != null
            ? { lat: property.latitude, lng: property.longitude }
            : null
        }
        roofFaces={property.roofFaces.map((f) => ({
          id: f.id,
          label: f.label,
          outline: f.outline as never,
          pitchDeg: f.pitchDeg,
          azimuthDeg: f.azimuthDeg,
          pitchSource: f.pitchSource,
          setbackM: f.setbackM,
          panelGapM: f.panelGapM,
          projectedAreaM2: f.projectedAreaM2,
          surfaceAreaM2: f.surfaceAreaM2,
          exclusions: f.exclusionZones.map((z) => ({
            id: z.id,
            kind: z.kind,
            label: z.label,
            clearanceM: z.clearanceM,
            outline: z.outline as never,
          })),
        }))}
        layouts={layouts.map((l) => ({
          id: l.id,
          roofFaceId: l.roofFaceId,
          panelModelId: l.panelModelId,
          panelLabel: `${l.panelModel.manufacturer} ${l.panelModel.model}`,
          panelCount: l.panelCount,
          installedW: l.installedW,
          orientation: l.orientation,
          angleDeg: l.angleDeg,
          usableAreaM2: l.usableAreaM2,
        }))}
        panels={panels.map((p) => ({
          id: p.id,
          label: `${p.manufacturer} ${p.model}（${p.ratedPowerW}W / ${p.widthMm}×${p.heightMm}mm）`,
        }))}
      />
    </>
  );
}
