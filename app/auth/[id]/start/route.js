import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { startFlow } from '@/lib/oauth.js';
import { publicBaseUrl } from '@/lib/env.js';

export async function GET(_req, { params }) {
  const r = startFlow((await params).id);
  if (r.error) return NextResponse.redirect(`${publicBaseUrl()}/?error=${encodeURIComponent(r.error)}`);
  (await cookies()).set('pp_oauth', r.nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/auth',
    maxAge: 600,
  });
  return NextResponse.redirect(r.url);
}
