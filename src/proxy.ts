import { NextResponse, type NextRequest } from 'next/server';
import { getAuth } from '@/lib/auth/server';

const protectedPaths = ['/dashboard', '/inbox', '/contacts', '/pipelines', '/broadcasts', '/automations', '/flows', '/notifications', '/settings'];
const authPages = ['/login', '/signup', '/forgot-password'];

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // These entrypoints perform their own key/signature/cron checks.
  if (path.startsWith('/api/auth/') || path === '/api/whatsapp/webhook' || path.startsWith('/api/v1/') || path === '/api/flows/cron' || path === '/api/automations/cron' || /^\/api\/invitations\/[^/]+\/peek$/.test(path)) {
    return NextResponse.next();
  }
  const protectedPage = protectedPaths.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
  if (!protectedPage && !authPages.includes(path) && !path.startsWith('/api/')) return NextResponse.next();
  const { response: session, headers } = await getAuth().api.getSession({ headers: request.headers, returnHeaders: true });
  let response: NextResponse;
  if (!session && protectedPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    response = NextResponse.redirect(url);
  } else if (!session && path.startsWith('/api/')) {
    response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  } else if (session && authPages.includes(path)) {
    const url = request.nextUrl.clone();
    const invite = request.nextUrl.searchParams.get('invite');
    url.pathname = invite && path !== '/forgot-password' ? `/join/${encodeURIComponent(invite)}` : '/dashboard';
    url.search = '';
    response = NextResponse.redirect(url);
  } else {
    response = NextResponse.next();
  }
  for (const cookie of headers.getSetCookie()) response.headers.append('set-cookie', cookie);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
