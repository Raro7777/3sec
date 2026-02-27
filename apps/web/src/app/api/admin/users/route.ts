import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { decrypt } from '@/lib/auth';

// Helper to assert admin privileges
async function verifyAdmin(request: NextRequest) {
    const cookie = request.cookies.get('auth_token')?.value;
    const session = await decrypt(cookie);
    if (!session || session.role !== 'ADMIN') {
        return null;
    }
    return session;
}

export async function GET(request: NextRequest) {
    const admin = await verifyAdmin(request);
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    try {
        const users = await prisma.user.findMany({
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                createdAt: true,
                company: {
                    select: { name: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        return NextResponse.json(users);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    const admin = await verifyAdmin(request);
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    try {
        const { email, password, name, role } = await request.json();

        if (!email || !password) {
            return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
        }

        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            return NextResponse.json({ error: 'Email already exists' }, { status: 400 });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        
        // Find default company for now (assuming mono-company system)
        let company = await prisma.company.findFirst();
        if (!company) {
            company = await prisma.company.create({ data: { name: '3sec Default Company' } });
        }

        const user = await prisma.user.create({
            data: {
                email,
                name: name || '',
                passwordHash,
                role: role || 'EMPLOYEE',
                companyId: company.id
            },
            select: { id: true, email: true, name: true, role: true }
        });

        return NextResponse.json({ success: true, user });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
    }
}
