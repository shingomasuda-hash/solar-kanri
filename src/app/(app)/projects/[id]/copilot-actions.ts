'use server';

import { getCurrentUser } from '@/server/auth/service';
import { UnauthenticatedError } from '@/server/auth/rbac';
import { toFormState, type FormState } from '@/server/form-state';
import { askCopilot, type CopilotAnswer } from '@/server/services/copilot';

export interface CopilotState extends FormState {
  readonly answer?: CopilotAnswer;
  readonly question?: string;
}

export async function askCopilotAction(
  _prev: CopilotState,
  formData: FormData,
): Promise<CopilotState> {
  const taskId = String(formData.get('taskId') ?? '') || undefined;
  const message = String(formData.get('message') ?? '').trim() || undefined;
  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthenticatedError();
    const answer = await askCopilot(user, {
      projectId: String(formData.get('projectId') ?? ''),
      taskId,
      message,
    });
    return { answer, question: message ?? taskId };
  } catch (err) {
    return toFormState(err);
  }
}
