import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { decrypt } from '@/lib/auth';

const publicRoutes = ['/login', '/api/auth/login'];

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Ignore static files and images
    if (
        pathname.startsWith('/_next') ||
        pathname.startsWith('/favicon.ico') ||
        pathname.match(/\.(png|jpg|jpeg|svg|webp)$/)
    ) {
        return NextResponse.next();
    }

    const isPublicRoute = publicRoutes.includes(pathname);

    const cookie = request.cookies.get('auth_token')?.value;
    const session = await decrypt(cookie);

    // Redirect to login if user is not authenticated and trying to access protected route
    if (!isPublicRoute && !session) {
        return NextResponse.redirect(new URL('/login', request.url));
    }

    // Role-based Access Control
    if (session) {
        // Redirect to / if logged-in user tries to access public auth routes like /login
        if (isPublicRoute) {
            return NextResponse.redirect(new URL('/', request.url));
        }

        // Prevent EMPLOYEE from accessing /admin dashboard
        if (pathname.startsWith('/admin') && session.role !== 'ADMIN') {
            return NextResponse.redirect(new URL('/', request.url));
        }
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/((?!api|_next/static|_next/image|.*\\.png$).*)'],
};
