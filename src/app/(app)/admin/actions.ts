'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/server/auth/service';
import { UnauthenticatedError } from '@/server/auth/rbac';
import { toFormState, type FormState } from '@/server/form-state';
import {
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
