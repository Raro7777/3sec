import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import archiver from 'archiver';
import axios from 'axios';
import path from 'path';

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
        if (endDate) where.paidAt.lte = new Date(endDate);
    }

    try {
        const receipts = await prisma.receipt.findMany({ where });

        // Using a Web Streams API approach for Next.js App Router Response
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();

        const archive = archiver('zip', { zlib: { level: 9 } });

        // Pipe archiver output to the writable stream
        archive.on('data', (chunk: any) => writer.write(chunk));
        archive.on('end', () => writer.close());
        archive.on('error', (err: any) => {
            console.error('Archive error:', err);
            writer.abort(err);
        });

        let csvContent = '\uFEFFID,상호명,금액,날짜,용도,메모,이미지파일명\n';

        const imagePromises = receipts.map(async (r: any) => {
            const imgName = path.basename(r.imageOriginalUrl || '');
            csvContent += `${r.id},"${r.merchantName || ''}",${r.amount || 0},${r.paidAt?.toISOString() || ''},"${r.category || ''}","${r.memo || ''}",${imgName}\n`;

            if (r.imageOriginalUrl && r.imageOriginalUrl.startsWith('http')) {
                try {
                    const response = await axios.get(r.imageOriginalUrl, { responseType: 'stream' });
                    archive.append(response.data, { name: `images/${imgName}` });
                } catch (err) {
                    console.error(`Failed to add image to archive: ${imgName}`, err);
                }
            }
        });

        // Initialize background generation
        Promise.all(imagePromises).then(() => {
            archive.append(csvContent, { name: 'receipts_list.csv' });
            archive.finalize();
        });

        return new NextResponse(readable, {
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': 'attachment; filename="receipts-export.zip"',
            },
        });
    } catch (error: any) {
        console.error('Export failed:', error);
        return NextResponse.json({ error: 'Failed to export receipts' }, { status: 500 });
    }
}
