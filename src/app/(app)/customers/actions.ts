'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';
import { UnauthenticatedError } from '@/server/auth/rbac';
import { toFormState, type FormState } from '@/server/form-state';
import { createCustomer, deleteCustomer, updateCustomer } from '@/server/services/customers';
import { customerSchema } from '@/server/validation/schemas';

export type { FormState };

function readCustomerForm(formData: FormData) {
  return {
    type: formData.get('type'),
    name: formData.get('name'),
    nameKana: formData.get('nameKana'),
    companyName: formData.get('companyName'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    postalCode: formData.get('postalCode'),
    prefecture: formData.get('prefecture'),
    city: formData.get('city'),
    addressLine: formData.get('addressLine'),
    source: formData.get('source'),
    notes: formData.get('notes'),
    ownerId: formData.get('ownerId'),
  };
}

export async function createCustomerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let id: string;
  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthenticatedError();
    const parsed = customerSchema.parse(readCustomerForm(formData));
    const customer = await createCustomer(user, parsed);
    id = customer.id;
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath('/customers');
  redirect(`/customers/${id}`);
}

export async function updateCustomerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthenticatedError();
    const parsed = customerSchema.parse(readCustomerForm(formData));
    await updateCustomer(user, id, parsed);
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/customers/${id}`);
  redirect(`/customers/${id}`);
}

export async function deleteCustomerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthenticatedError();
    await deleteCustomer(user, String(formData.get('id') ?? ''));
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath('/customers');
  redirect('/customers');
}
