import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
        const receipt = await prisma.receipt.findUnique({ where: { id } });
        if (!receipt) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        return NextResponse.json(receipt);
    } catch (error: any) {
        return NextResponse.json({ error: 'Failed to fetch receipt' }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
        const data = await request.json();
        
        // Exclude unchangeable/unmapped properties from frontend like rawText
        const { id: _, companyId, userId, createdAt, updatedAt, rawText, ...safeData } = data;

        if (safeData.paidAt) safeData.paidAt = new Date(safeData.paidAt);

        const receipt = await prisma.receipt.update({
            where: { id },
            data: { ...safeData, status: data.status || 'SUBMITTED' },
        });
        return NextResponse.json(receipt);
    } catch (error: any) {
        return NextResponse.json({ error: 'Failed to update receipt' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
        const receipt = await prisma.receipt.delete({ where: { id } });
        return NextResponse.json(receipt);
    } catch (error: any) {
        return NextResponse.json({ error: 'Failed to delete receipt' }, { status: 500 });
    }
}
