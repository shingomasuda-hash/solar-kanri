'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';
import { UnauthenticatedError } from '@/server/auth/rbac';
import { toFormState, type FormState } from '@/server/form-state';
import {
  createQuotation,
  issueQuotation,
  setQuotationStatus,
  updateQuotation,
  type QuotationDraft,
} from '@/server/services/quotations';
import type { QuotationCategory, QuotationLineInput } from '@core/quotation';

export type { FormState };

/**
 * Line items arrive as parallel arrays from a repeating form section. Rows the
 * operator left completely blank are dropped rather than rejected — deleting a
 * row by clearing it is what people expect.
 */
function readItems(formData: FormData): QuotationLineInput[] {
  const categories = formData.getAll('itemCategory').map(String);
  const names = formData.getAll('itemName').map(String);
  const descriptions = formData.getAll('itemDescription').map(String);
  const quantities = formData.getAll('itemQuantity').map(String);
  const units = formData.getAll('itemUnit').map(String);
  const prices = formData.getAll('itemUnitPrice').map(String);

  const items: QuotationLineInput[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = (names[i] ?? '').trim();
    const priceRaw = (prices[i] ?? '').trim();
    if (name === '' && (priceRaw === '' || priceRaw === '0')) continue;
    items.push({
      category: (categories[i] ?? 'OTHER') as QuotationCategory,
      name,
      description: (descriptions[i] ?? '').trim() || null,
      quantity: Number(quantities[i] ?? '1'),
      unit: (units[i] ?? '式').trim() || '式',
      unitPriceJpy: Math.round(Number(priceRaw || '0')),
    });
  }
  return items;
}

function readDraft(formData: FormData): QuotationDraft {
  const validUntil = String(formData.get('validUntil') ?? '').trim();
  return {
    projectId: String(formData.get('projectId') ?? ''),
    simulationId: String(formData.get('simulationId') ?? '') || undefined,
    title: String(formData.get('title') ?? ''),
    validUntil: validUntil === '' ? null : new Date(validUntil),
    discountJpy: Math.round(Number(formData.get('discountJpy') ?? 0)),
    subsidyJpy: Math.round(Number(formData.get('subsidyJpy') ?? 0)),
    taxRate: Number(formData.get('taxRate') ?? 0.1),
    notes: String(formData.get('notes') ?? '') || null,
    items: readItems(formData),
  };
}

export async function createQuotationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const projectId = String(formData.get('projectId') ?? '');
  let quotationId: string;
  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthenticatedError();
    const quotation = await createQuotation(user, readDraft(formData));
    quotationId = quotation.id;
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}/quotations/${quotationId}`);
}

export async function updateQuotationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const projectId = String(formData.get('projectId') ?? '');
  const id = String(formData.get('id') ?? '');
  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthenticatedError();
    await updateQuotation(user, id, readDraft(formData));
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/projects/${projectId}/quotations/${id}`);
  redirect(`/projects/${projectId}/quotations/${id}`);
}

export async function issueQuotationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const projectId = String(formData.get('projectId') ?? '');
  const id = String(formData.get('id') ?? '');
  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthenticatedError();
    await issueQuotation(user, id);
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/projects/${projectId}/quotations/${id}`);
  revalidatePath(`/projects/${projectId}`);
  return {};
}

export async function setQuotationStatusAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const projectId = String(formData.get('projectId') ?? '');
  const id = String(formData.get('id') ?? '');
  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthenticatedError();
    await setQuotationStatus(
      user,
      id,
      String(formData.get('status') ?? '') as 'ACCEPTED' | 'REJECTED' | 'EXPIRED',
    );
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/projects/${projectId}/quotations/${id}`);
  revalidatePath(`/projects/${projectId}`);
  return {};
}
