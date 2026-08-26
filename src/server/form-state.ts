import { z } from 'zod';
import { ForbiddenError, UnauthenticatedError } from './auth/rbac';

/**
 * Shared shape for server-action results.
 *
 * Lives outside any `'use server'` module: a server-action file may only
 * export async functions, so helpers like `toFormState` cannot live alongside
 * the actions themselves.
 */
export interface FormState {
  readonly error?: string;
  readonly fieldErrors?: Record<string, string>;
}

/**
 * Turn any thrown error into something an operator can act on.
 *
 * Domain errors already carry a message written for a human, so they pass
 * through. Anything else is logged and replaced with a generic message —
 * internal details must not reach the browser.
 */
export function toFormState(err: unknown): FormState {
  if (err instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    const messages: string[] = [];
    for (const issue of err.issues) {
      const key = issue.path.join('.');
      if (key && !fieldErrors[key]) {
        fieldErrors[key] = issue.message;
        messages.push(`${key}: ${issue.message}`);
      } else if (!key) {
        messages.push(issue.message);
      }
    }
    // The summary lists every failing field, including ones the form does not
    // render. Without this, a schema mismatch on a hidden field shows only
    // "check your input" with nothing on screen to correct — which reads as the
    // button being broken.
    return {
      error:
        messages.length > 0
          ? `入力内容を確認してください（${messages.join(' / ')}）`
          : '入力内容を確認してください',
      fieldErrors,
    };
  }
  if (err instanceof UnauthenticatedError || err instanceof ForbiddenError) {
    return { error: err.message };
  }
  if (err instanceof Error) return { error: err.message };
  console.error('[form] unexpected failure', err);
  return { error: '予期しないエラーが発生しました' };
}
