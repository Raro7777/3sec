import { NextRequest, NextResponse } from 'next/server';
import { NaverOcrProvider } from '@3sec/ocr';
import { parseReceiptText } from '@3sec/receipt-parser';
import { createClient } from '@supabase/supabase-js';
import { prisma } from '@/lib/prisma';
import { decrypt } from '@/lib/auth';

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ success: false, message: 'Image file is required' }, { status: 400 });
        }

        const invokeUrl = process.env.NAVER_OCR_INVOKE_URL;
        const secretKey = process.env.NAVER_OCR_SECRET;

        let ocrProvider: NaverOcrProvider | null = null;
        if (invokeUrl && secretKey) {
            ocrProvider = new NaverOcrProvider(invokeUrl, secretKey);
        }

        const supabaseUrl = process.env.SUPABASE_URL || 'https://msqrlugbjpqvtswdcpql.supabase.co';
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        let supabase: any = null;
        if (supabaseUrl && supabaseKey) {
            supabase = createClient(supabaseUrl, supabaseKey);
        }

        if (!ocrProvider) {
            return NextResponse.json({
                success: true,
                message: 'OCR provider not configured. Returning mock data.',
                data: {
                    merchantName: '테스트 상점',
                    amount: 15000,
                    paidAt: new Date(),
                    rawText: '테스트 영수증 텍스트입니다.',
                }
            });
        }

        // Supabase Upload
        let imagePublicUrl = '';
        const fileName = `${Date.now()}-${file.name}`;
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (supabase) {
            const { error: uploadError } = await supabase
                .storage
                .from('receipts')
                .upload(`uploads/${fileName}`, buffer, {
                    contentType: file.type,
                    upsert: true
                });

            if (uploadError) {
                console.error('Supabase upload error:', uploadError);
                throw new Error('Failed to upload image to storage');
            }

            const { data: { publicUrl } } = supabase
                .storage
                .from('receipts')
                .getPublicUrl(`uploads/${fileName}`);

            imagePublicUrl = publicUrl;
        } else {
            // Vercel Fallback: Convert to Base64 data URL
            const base64Str = buffer.toString('base64');
            imagePublicUrl = `data:${file.type || 'image/jpeg'};base64,${base64Str}`;
        }

        // Process OCR
        const ocrResult = await ocrProvider.processImage(buffer, file.name);
        const parsedData = parseReceiptText(ocrResult.rawText);

        // Get user session
        const cookie = request.cookies.get('auth_token')?.value;
        const session = await decrypt(cookie);

        if (!session) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({ where: { id: session.userId } });
        if (!user) {
            return NextResponse.json({ success: false, message: 'User not found in DB' }, { status: 404 });
        }

        const savedReceipt = await prisma.receipt.create({
            data: {
                companyId: user.companyId,
                userId: user.id,
                imageOriginalUrl: imagePublicUrl,
                ocrStatus: 'COMPLETED',
                ocrTextRaw: ocrResult.rawText,
                ocrResultJson: ocrResult.fullJson || {},
                merchantName: parsedData.merchantName,
                amount: parsedData.amount,
                paidAt: parsedData.paidAt,
                category: parsedData.category,
                status: 'DRAFT',
            }
        });

        return NextResponse.json({
            success: true,
            data: {
                ...parsedData,
                id: savedReceipt.id,
                rawText: ocrResult.rawText,
            },
        });

    } catch (error: any) {
        console.error('Processing failed:', error.message);
        return NextResponse.json({ success: false, message: `Failed: ${error.message}` }, { status: 500 });
    }
}
