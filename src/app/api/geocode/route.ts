import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/server/auth/service';
import { geocodeSchema } from '@/server/validation/schemas';
import { geocodeAddress, GeocodingNotConfiguredError } from '@/server/services/geocoding';

/**
 * Address → coordinates.
 *
 * Server-side so the Geocoding key is never in the browser bundle, and so the
 * cache is shared across users rather than per-tab. Geocoding is billed per
 * request; see docs/setup/google-maps.md.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストの形式が不正です' }, { status: 400 });
  }

  const parsed = geocodeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '住所を入力してください' },
      { status: 400 },
    );
  }

  try {
    const results = await geocodeAddress(parsed.data.address);
    return NextResponse.json({ results });
  } catch (err) {
    if (err instanceof GeocodingNotConfiguredError) {
      // 503 rather than 500: the service is fine, it just has not been given a
      // key yet, and the UI shows setup guidance for exactly this case.
      return NextResponse.json({ error: err.message, code: 'NOT_CONFIGURED' }, { status: 503 });
    }
    console.error('[geocode] failed', err);
    return NextResponse.json({ error: '住所検索に失敗しました' }, { status: 502 });
  }
}
