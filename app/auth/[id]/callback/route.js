import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { finishFlow } from '@/lib/oauth.js';
import { publicBaseUrl } from '@/lib/env.js';

export async function GET(request, { params }) {
  const { id } = await params;
  const q = request.nextUrl.searchParams;
  const jar = await cookies();
  const back = (k, v) => NextResponse.redirect(`${publicBaseUrl()}/?${k}=${encodeURIComponent(v)}`);
  try {
    const names = await finishFlow(
      id,
      { code: q.get('code'), state: q.get('state'), error: q.get('error'), errorDescription: q.get('error_description') },
      jar.get('pp_oauth')?.value
    );
    jar.delete('pp_oauth');
    return back('connected', names.join(', '));
  } catch (e) {
    console.error(`OAuth ${id} failed:`, e.message);
    return back('error', e.message);
  }
}
