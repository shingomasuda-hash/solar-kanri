'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/server/auth/service';
import { UnauthenticatedError } from '@/server/auth/rbac';
import { toFormState, type FormState } from '@/server/form-state';
import { prisma } from '@/server/db/client';
import { recordAudit } from '@/server/services/audit';
import { requirePermission } from '@/server/auth/rbac';
import {
  setDefaultCoefficientSet,
  setDefaultTariff,
  setPanelActive,
  setUserActive,
  updateCoefficient,
  updateUserRole,
  upsertIrradianceStation,
  upsertPanel,
  upsertTariff,
} from '@/server/services/admin';

export type { FormState };

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError();
  return user;
}

const num = (v: FormDataEntryValue | null) => Number(String(v ?? '').trim());
const optNum = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : Number(s);
};

export async function updateCoefficientAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireUser();
    await updateCoefficient(user, String(formData.get('id') ?? ''), {
      key: String(formData.get('key') ?? ''),
      label: String(formData.get('label') ?? ''),
      value: num(formData.get('value')),
      unit: formData.get('unit'),
      sourceKind: formData.get('sourceKind'),
      sourceCitation: formData.get('sourceCitation'),
      sourceUrl: formData.get('sourceUrl'),
      effectiveDate: formData.get('effectiveDate'),
      note: formData.get('note'),
    });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath('/admin/coefficients');
  revalidatePath('/admin');
  return {};
}

export async function setDefaultCoefficientSetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireUser();
    await setDefaultCoefficientSet(user, String(formData.get('id') ?? ''));
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath('/admin/coefficients');
  revalidatePath('/admin/health');
  return {};
}

export async function setDefaultTariffAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireUser();
    await setDefaultTariff(user, String(formData.get('id') ?? ''));
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath('/admin/tariffs');
  revalidatePath('/admin/health');
  return {};
}

export async function upsertTariffAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireUser();
    await upsertTariff(
      user,
      {
        key: String(formData.get('key') ?? ''),
        name: String(formData.get('name') ?? ''),
        purchasePriceJpyPerKWh: num(formData.get('purchasePriceJpyPerKWh')),
        exportPriceJpyPerKWh: num(formData.get('exportPriceJpyPerKWh')),
        exportPriceYears: num(formData.get('exportPriceYears')),
        postExportPriceJpyPerKWh: num(formData.get('postExportPriceJpyPerKWh')),
        annualPriceEscalation: num(formData.get('annualPriceEscalation')),
        monthlyBasicChargeJpy: num(formData.get('monthlyBasicChargeJpy')),
        defaultSelfConsumptionRatio: num(formData.get('defaultSelfConsumptionRatio')),
        sourceKind: formData.get('sourceKind'),
        sourceCitation: formData.get('sourceCitation'),
        sourceUrl: formData.get('sourceUrl'),
      },
      String(formData.get('id') ?? '') || undefined,
    );
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath('/admin/tariffs');
  revalidatePath('/admin');
  return {};
}

export async function upsertPanelAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireUser();
    await upsertPanel(
      user,
      {
        manufacturer: String(formData.get('manufacturer') ?? ''),
        model: String(formData.get('model') ?? ''),
        widthMm: num(formData.get('widthMm')),
        heightMm: num(formData.get('heightMm')),
        thicknessMm: optNum(formData.get('thicknessMm')),
        weightKg: optNum(formData.get('weightKg')),
        ratedPowerW: num(formData.get('ratedPowerW')),
        efficiencyPct: optNum(formData.get('efficiencyPct')),
        pmaxTempCoeffPerK: num(formData.get('pmaxTempCoeffPerK')),
        vocV: optNum(formData.get('vocV')),
        iscA: optNum(formData.get('iscA')),
        vmpV: optNum(formData.get('vmpV')),
        impA: optNum(formData.get('impA')),
        noctC: optNum(formData.get('noctC')),
        annualDegradation: num(formData.get('annualDegradation')),
        productWarrantyYears: optNum(formData.get('productWarrantyYears')),
        performanceWarrantyYears: optNum(formData.get('performanceWarrantyYears')),
        datasheetUrl: formData.get('datasheetUrl'),
        datasheetVersion: formData.get('datasheetVersion'),
        sourceCitation: formData.get('sourceCitation'),
        sourceUrl: formData.get('sourceUrl'),
        effectiveDate: formData.get('effectiveDate'),
      },
      String(formData.get('id') ?? '') || undefined,
    );
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath('/admin/panels');
  revalidatePath('/admin');
  return {};
}

export async function setPanelActiveAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireUser();
    await setPanelActive(
      user,
      String(formData.get('id') ?? ''),
      formData.get('isActive') === 'true',
    );
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath('/admin/panels');
  return {};
}

export async function upsertIrradianceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireUser();
    const parseSeries = (name: string) =>
      String(formData.get(name) ?? '')
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number);

    await upsertIrradianceStation(
      user,
      {
        label: String(formData.get('label') ?? ''),
        latitude: num(formData.get('latitude')),
        longitude: num(formData.get('longitude')),
        monthlyIrradiation: parseSeries('monthlyIrradiation'),
        monthlyAmbientTemp: parseSeries('monthlyAmbientTemp'),
        isPlaneOfArray: formData.get('isPlaneOfArray') === 'on',
        tiltDeg: optNum(formData.get('tiltDeg')),
        azimuthDeg: optNum(formData.get('azimuthDeg')),
        sourceKind: String(formData.get('sourceKind') ?? 'UNVERIFIED_PLACEHOLDER'),
        sourceCitation: String(formData.get('sourceCitation') ?? ''),
        sourceUrl: formData.get('sourceUrl') as string | null,
      },
      String(formData.get('id') ?? '') || undefined,
    );
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath('/admin/irradiance');
  revalidatePath('/admin');
  return {};
}

export async function updateUserRoleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireUser();
    await updateUserRole(
      user,
      String(formData.get('id') ?? ''),
      String(formData.get('role') ?? ''),
    );
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath('/admin/users');
  return {};
}

export async function setUserActiveAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireUser();
    await setUserActive(
      user,
      String(formData.get('id') ?? ''),
      formData.get('isActive') === 'true',
    );
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath('/admin/users');
  return {};
}

export async function saveKnowledgeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireUser();
    requirePermission(user, 'master:write');

    const id = String(formData.get('id') ?? '') || undefined;
    const values = {
      kind: String(formData.get('kind') ?? 'MANUAL') as never,
      title: String(formData.get('title') ?? '').trim(),
      body: String(formData.get('body') ?? '').trim(),
      tags: String(formData.get('tags') ?? '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      sourceUrl: String(formData.get('sourceUrl') ?? '').trim() || null,
      sourceCitation: String(formData.get('sourceCitation') ?? '').trim() || null,
    };
    if (values.title === '') throw new Error('タイトルを入力してください');
    if (values.body === '') throw new Error('本文を入力してください');

    const doc = id
      ? await prisma.knowledgeDocument.update({ where: { id }, data: values })
      : await prisma.knowledgeDocument.create({ data: values });

    await recordAudit({
      userId: user.id,
      action: id ? 'knowledge.update' : 'knowledge.create',
      entityType: 'KnowledgeDocument',
      entityId: doc.id,
      detail: { title: doc.title, kind: doc.kind },
    });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath('/admin/knowledge');
  return {};
}

export async function setKnowledgeActiveAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireUser();
    requirePermission(user, 'master:write');
    const id = String(formData.get('id') ?? '');
    const isActive = formData.get('isActive') === 'true';
    await prisma.knowledgeDocument.update({ where: { id }, data: { isActive } });
    await recordAudit({
      userId: user.id,
      action: isActive ? 'knowledge.activate' : 'knowledge.deactivate',
      entityType: 'KnowledgeDocument',
      entityId: id,
    });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath('/admin/knowledge');
  return {};
}
