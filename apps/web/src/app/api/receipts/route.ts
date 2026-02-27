import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get('category');
    const q = searchParams.get('q');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const where: any = {};
    if (category) where.category = category;
    if (q) where.merchantName = { contains: q, mode: 'insensitive' };

    if (startDate || endDate) {
        where.paidAt = {};
        if (startDate) where.paidAt.gte = new Date(startDate);
        if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            where.paidAt.lte = end;
        }
    }

    try {
        const receipts = await prisma.receipt.findMany({
            where,
            orderBy: { paidAt: 'desc' },
        });
        return NextResponse.json(receipts);
    } catch (error: any) {
        console.error('Failed to fetch receipts:', error);
        return NextResponse.json({ error: 'Failed to fetch receipts' }, { status: 500 });
    }
}
