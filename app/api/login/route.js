import { cookies } from 'next/headers';
import { COOKIE, checkPassword, newSession } from '@/lib/session.js';

// naive brute-force brake: failed attempts slow down (per server instance)
let failures = 0;

export async function POST(request) {
  const { password } = await request.json().catch(() => ({}));
  if (failures >= 5) await new Promise((r) => setTimeout(r, Math.min(failures, 10) * 500));
  if (!checkPassword(password)) {
    failures++;
    return Response.json({ error: 'Wrong password' }, { status: 401 });
  }
  failures = 0;
  (await cookies()).set(COOKIE, newSession(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 30 * 86400,
  });
  return Response.json({ ok: true });
}
