import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decrypt } from '@/lib/auth';

export async function GET(request: NextRequest) {
    const cookie = request.cookies.get('auth_token')?.value;
    const session = await decrypt(cookie);

    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const month = searchParams.get('month');
    const year = searchParams.get('year');

    const now = new Date();
    const targetYear = year ? parseInt(year) : now.getFullYear();
    const targetMonth = month ? parseInt(month) : now.getMonth() + 1;

    const startDate = new Date(targetYear, targetMonth - 1, 1);
    const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59);

    try {
        const user = await prisma.user.findUnique({
            where: { id: session.userId }
        });

        const where: any = {
            paidAt: { gte: startDate, lte: endDate },
        };

        if (user?.role !== 'ADMIN') {
            where.userId = session.userId;
        }

        const receipts = await prisma.receipt.findMany({
            where,
        });

        const totalAmount = receipts.reduce((sum: number, r: any) => sum + (r.amount || 0), 0);

        return NextResponse.json({
            year: targetYear,
            month: targetMonth,
            totalAmount,
            count: receipts.length,
            categorySummary: receipts.reduce((acc: Record<string, number>, r: any) => {
                const cat = r.category || '기타';
                acc[cat] = (acc[cat] || 0) + (r.amount || 0);
                return acc;
            }, {} as Record<string, number>),
            receipts: receipts.slice(0, 5),
        });
    } catch (error: any) {
        console.error('Failed to fetch stats:', error);
        return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
    }
}
