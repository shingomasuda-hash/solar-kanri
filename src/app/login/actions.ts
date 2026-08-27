'use server';

import { redirect } from 'next/navigation';
import {
  AccountDisabledError,
  InvalidCredentialsError,
  login,
  requestContext,
  setSessionCookie,
} from '@/server/auth/service';
import { RateLimitedError } from '@/server/auth/rate-limit';
import { loginSchema } from '@/server/validation/schemas';
import { diagnoseSetupFault } from '@/server/setup-diagnosis';

export interface LoginState {
  readonly error?: string;
  /** True when the failure is a configuration fault, not a bad password. */
  readonly isSetupFault?: boolean;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: 'メールアドレスとパスワードを入力してください' };
  }

  try {
    const context = await requestContext();
    const { token, expiresAt } = await login(parsed.data.email, parsed.data.password, context);
    await setSessionCookie(token, expiresAt);
  } catch (err) {
    if (
      err instanceof InvalidCredentialsError ||
      err instanceof AccountDisabledError ||
      err instanceof RateLimitedError
    ) {
      return { error: err.message };
    }
    console.error('[login] unexpected failure', err);

    // A deployment missing its database is not a transient failure, and
    // "try again later" sends the operator away from the only thing that
    // would fix it. Name the setting; never the value.
    const setup = diagnoseSetupFault(err);
    if (setup) return { error: setup.message, isSetupFault: true };

    return { error: 'ログイン処理でエラーが発生しました。しばらくしてからお試しください。' };
  }

  // redirect() throws, so it must sit outside the try block.
  redirect('/dashboard');
}
