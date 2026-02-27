import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { decrypt } from '@/lib/auth';

async function verifyAdmin(request: NextRequest) {
    const cookie = request.cookies.get('auth_token')?.value;
    const session = await decrypt(cookie);
    if (!session || session.role !== 'ADMIN') {
        return null;
    }
    return session;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const admin = await verifyAdmin(request);
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    try {
        const { id } = await params;
        const { role, password } = await request.json();
        const updateData: any = {};
        
        if (role) updateData.role = role;
        if (password) {
            updateData.passwordHash = await bcrypt.hash(password, 10);
        }

        // Check if updating self role down
        if (id === admin.userId && role === 'EMPLOYEE') {
            return NextResponse.json({ error: 'You cannot downgrade your own admin account.' }, { status: 400 });
        }

        const user = await prisma.user.update({
            where: { id },
            data: updateData,
            select: { id: true, email: true, role: true }
        });

        return NextResponse.json({ success: true, user });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const admin = await verifyAdmin(request);
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    try {
        const { id } = await params;
        
        if (id === admin.userId) {
            return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 });
        }

        // In a real app we might not hard-delete, or we need to delete/unlink receipts first.
        // For now safely deleting the user from the DB
        await prisma.user.delete({
            where: { id }
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: 'Failed to delete user. They might have dependent data.' }, { status: 500 });
    }
}
