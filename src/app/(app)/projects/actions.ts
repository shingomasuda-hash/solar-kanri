'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';
import { UnauthenticatedError } from '@/server/auth/rbac';
import {
  addActivity,
  addNote,
  addTask,
  changeProjectStatus,
  createProject,
  toggleTask,
  updateProject,
} from '@/server/services/projects';
import { projectSchema } from '@/server/validation/schemas';
import { toFormState, type FormState } from '@/server/form-state';

export type { FormState };

function readProjectForm(formData: FormData) {
  const optionalDate = (v: FormDataEntryValue | null) =>
    typeof v === 'string' && v !== '' ? v : null;
  return {
    title: formData.get('title'),
    customerId: formData.get('customerId'),
    propertyId: formData.get('propertyId'),
    statusId: formData.get('statusId'),
    ownerId: formData.get('ownerId'),
    expectedCloseDate: optionalDate(formData.get('expectedCloseDate')),
    nextActionAt: optionalDate(formData.get('nextActionAt')),
    nextActionNote: formData.get('nextActionNote'),
  };
}

export async function createProjectAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let id: string;
  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthenticatedError();
    const project = await createProject(user, projectSchema.parse(readProjectForm(formData)));
    id = project.id;
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath('/projects');
  redirect(`/projects/${id}`);
}

export async function updateProjectAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthenticatedError();
    await updateProject(user, id, projectSchema.parse(readProjectForm(formData)));
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/projects/${id}`);
  redirect(`/projects/${id}`);
}

export async function changeStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('projectId') ?? '');
  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthenticatedError();
    await changeProjectStatus(user, id, String(formData.get('statusId') ?? ''));
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/projects/${id}`);
  return {};
}

export async function addActivityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = String(formData.get('projectId') ?? '');
  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthenticatedError();
    await addActivity(user, {
      projectId,
      customerId: formData.get('customerId') ?? '',
      kind: formData.get('kind'),
      subject: formData.get('subject'),
      body: formData.get('body'),
      occurredAt: formData.get('occurredAt') || new Date(),
    });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/projects/${projectId}`);
  return {};
}

export async function addTaskAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = String(formData.get('projectId') ?? '');
  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthenticatedError();
    await addTask(user, {
      projectId,
      title: formData.get('title'),
      description: formData.get('description'),
      dueAt: formData.get('dueAt') || null,
      assigneeId: formData.get('assigneeId') ?? '',
    });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/projects/${projectId}`);
  return {};
}

export async function toggleTaskAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = String(formData.get('projectId') ?? '');
  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthenticatedError();
    await toggleTask(user, String(formData.get('taskId') ?? ''));
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/projects/${projectId}`);
  return {};
}

export async function addNoteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = String(formData.get('projectId') ?? '');
  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthenticatedError();
    await addNote(user, { projectId, body: formData.get('body') });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/projects/${projectId}`);
  return {};
}
