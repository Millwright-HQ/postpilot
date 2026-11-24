import { NextResponse } from 'next/server';
import { COOKIE, validSession } from '@/lib/session.js';

// Everything requires the owner session except the login page/endpoint and static assets.
// (Local-dev media is public on purpose: it mimics S3 URLs that platforms fetch.)
export function proxy(request) {
  const { pathname } = request.nextUrl;
  if (validSession(request.cookies.get(COOKIE)?.value)) return NextResponse.next();

  if (pathname.startsWith('/api/')) return Response.json({ error: 'Not logged in' }, { status: 401 });
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  matcher: ['/((?!login|api/login|media/|_next/|favicon.ico).*)'],
};
