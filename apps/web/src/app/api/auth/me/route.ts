import { NextRequest, NextResponse } from 'next/server';
import { decrypt } from '@/lib/auth';

export async function GET(request: NextRequest) {
    const cookie = request.cookies.get('auth_token')?.value;
    const session = await decrypt(cookie);

    if (!session) {
        return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    return NextResponse.json({
        authenticated: true,
        user: {
            id: session.userId,
            email: session.email,
            role: session.role
        }
    });
}
