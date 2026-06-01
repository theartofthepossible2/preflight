import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';

const PROTECTED_PREFIXES = ['/dashboard'];

function checkBasicAuth(req: NextRequest): NextResponse | null {
  const expectedUser = process.env.PREVIEW_USERNAME;
  const expectedPass = process.env.PREVIEW_PASSWORD;
  if (!expectedUser || !expectedPass) return null;

  const header = req.headers.get('authorization');
  if (header?.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6));
      const sep = decoded.indexOf(':');
      const user = sep === -1 ? decoded : decoded.slice(0, sep);
      const pass = sep === -1 ? '' : decoded.slice(sep + 1);
      if (user === expectedUser && pass === expectedPass) return null;
    } catch {
      // fall through to 401
    }
  }
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Preflight preview"' },
  });
}

export default auth((req) => {
  const blocked = checkBasicAuth(req);
  if (blocked) return blocked;

  const { pathname } = req.nextUrl;
  const needsAuth = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!needsAuth) return NextResponse.next();
  if (!req.auth) {
    const signin = new URL('/signin', req.url);
    signin.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(signin);
  }
  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
