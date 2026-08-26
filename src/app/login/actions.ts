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

export interface LoginState {
  readonly error?: string;
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
    return { error: 'ログイン処理でエラーが発生しました。しばらくしてからお試しください。' };
  }

  // redirect() throws, so it must sit outside the try block.
  redirect('/dashboard');
}
