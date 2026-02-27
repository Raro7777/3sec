import { Controller, Post, Get, Patch, Delete, Body, Param, UseInterceptors, UploadedFile, BadRequestException, Query, Res } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { NaverOcrProvider } from '@3sec/ocr';
import { parseReceiptText } from '@3sec/receipt-parser';
import { PrismaService } from './prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import * as archiver from 'archiver';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import type { Response } from 'express';

@Controller('receipts')
export class ReceiptsController {
    private ocrProvider: NaverOcrProvider;
    private supabase;

    constructor(
        private configService: ConfigService,
        private prisma: PrismaService,
    ) {
        const invokeUrl = this.configService.get<string>('NAVER_OCR_INVOKE_URL');
        const secretKey = this.configService.get<string>('NAVER_OCR_SECRET');

        if (invokeUrl && secretKey) {
            this.ocrProvider = new NaverOcrProvider(invokeUrl, secretKey);
        }

        // Supabase Client 초기화 (이미지 저장용)
        const supabaseUrl = this.configService.get<string>('SUPABASE_URL') || 'https://msqrlugbjpqvtswdcpql.supabase.co';
        const supabaseKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');
        if (supabaseUrl && supabaseKey) {
            this.supabase = createClient(supabaseUrl, supabaseKey);
        }
    }

    @Post('upload')
    @UseInterceptors(FileInterceptor('file'))
    async uploadReceipt(@UploadedFile() file: Express.Multer.File) {
        if (!file) {
            throw new BadRequestException('Image file is required');
        }

        if (!this.ocrProvider) {
            return {
                success: true,
                message: 'OCR provider not configured. Returning mock data.',
                data: {
                    merchantName: '테스트 상점',
                    amount: 15000,
                    paidAt: new Date(),
                    rawText: '테스트 영수증 텍스트입니다.',
                }
            };
        }

        try {
            // Supabase Storage에 이미지 업로드
            let imagePublicUrl = '';
            const fileName = `${Date.now()}-${file.originalname}`;

            if (this.supabase) {
                const { data: uploadData, error: uploadError } = await this.supabase
                    .storage
                    .from('receipts') // 버킷 이름
                    .upload(`uploads/${fileName}`, file.buffer, {
                        contentType: file.mimetype,
                        upsert: true
                    });

                if (uploadError) {
                    console.error('Supabase upload error:', uploadError);
                    throw new Error('Failed to upload image to storage');
                }

                const { data: { publicUrl } } = this.supabase
                    .storage
                    .from('receipts')
                    .getPublicUrl(`uploads/${fileName}`);

                imagePublicUrl = publicUrl;
            }

            const ocrResult = await this.ocrProvider.processImage(file.buffer, file.originalname);
            const parsedData = parseReceiptText(ocrResult.rawText);

            // DB 저장
            let company = await this.prisma.company.findFirst();
            if (!company) company = await this.prisma.company.create({ data: { name: 'Test Company' } });

            let user = await this.prisma.user.findFirst();
            if (!user) {
                user = await this.prisma.user.create({
                    data: {
                        email: 'test@example.com',
                        name: 'Test User',
                        passwordHash: 'hashed',
                        companyId: company.id
                    }
                });
            }

            const savedReceipt = await this.prisma.receipt.create({
                data: {
                    companyId: company.id,
                    userId: user.id,
                    imageOriginalUrl: imagePublicUrl || `/uploads/${fileName}`, // 클라우드 URL 우선 사용
                    ocrStatus: 'COMPLETED',
                    ocrTextRaw: ocrResult.rawText,
                    ocrResultJson: ocrResult.fullJson || {},
                    merchantName: parsedData.merchantName,
                    amount: parsedData.amount,
                    paidAt: parsedData.paidAt,
                    status: 'DRAFT',
                }
            });

            return {
                success: true,
                data: {
                    ...parsedData,
                    id: savedReceipt.id,
                    rawText: ocrResult.rawText,
                },
            };
        } catch (error: any) {
            console.error('Processing failed:', error.message);
            throw new BadRequestException(`Failed: ${error.message}`);
        }
    }

    @Get()
    async getReceipts(
        @Query('category') category?: string,
        @Query('q') q?: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string
    ) {
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

        return (this.prisma as any).receipt.findMany({
            where,
            orderBy: { paidAt: 'desc' },
        });
    }

    @Get('stats')
    async getStats(@Query('month') month?: string, @Query('year') year?: string) {
        const now = new Date();
        const targetYear = year ? parseInt(year) : now.getFullYear();
        const targetMonth = month ? parseInt(month) : now.getMonth() + 1;

        const startDate = new Date(targetYear, targetMonth - 1, 1);
        const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59);

        const receipts = await (this.prisma as any).receipt.findMany({
            where: {
                paidAt: { gte: startDate, lte: endDate },
            },
        });

        const totalAmount = (receipts as any[]).reduce((sum, r) => sum + (r.amount || 0), 0);
        return {
            year: targetYear,
            month: targetMonth,
            totalAmount,
            count: receipts.length,
            categorySummary: (receipts as any[]).reduce((acc, r) => {
                const cat = r.category || '기타';
                acc[cat] = (acc[cat] || 0) + (r.amount || 0);
                return acc;
            }, {} as Record<string, number>),
            receipts: receipts.slice(0, 5),
        };
    }

    @Get('export')
    async exportReceipts(
        @Query('category') category: string,
        @Query('q') q: string,
        @Query('startDate') startDate: string,
        @Query('endDate') endDate: string,
        @Res() res: Response
    ) {
        const where: any = {};
        if (category) where.category = category;
        if (q) where.merchantName = { contains: q, mode: 'insensitive' };
        if (startDate || endDate) {
            where.paidAt = {};
            if (startDate) where.paidAt.gte = new Date(startDate);
            if (endDate) where.paidAt.lte = new Date(endDate);
        }

        const receipts = await (this.prisma as any).receipt.findMany({ where });
        const archive = (archiver as any)('zip', { zlib: { level: 9 } });
        res.attachment('receipts-export.zip');
        archive.pipe(res);

        let csvContent = '\uFEFFID,상호명,금액,날짜,용도,메모,이미지파일명\n';

        // 이미지 다운로드를 위한 배열 생성
        const imagePromises = receipts.map(async (r: any) => {
            const imgName = path.basename(r.imageOriginalUrl || '');
            csvContent += `${r.id},"${r.merchantName || ''}",${r.amount || 0},${r.paidAt?.toISOString() || ''},"${r.category || ''}","${r.memo || ''}",${imgName}\n`;

            if (r.imageOriginalUrl) {
                try {
                    if (r.imageOriginalUrl.startsWith('http')) {
                        // 외부 URL인 경우 axios로 스트림 확보
                        const response = await axios.get(r.imageOriginalUrl, { responseType: 'stream' });
                        archive.append(response.data, { name: `images/${imgName}` });
                    } else {
                        // 로컬 파일인 경우 (기존 방식 유지)
                        const imgPath = path.resolve(process.cwd(), 'public', r.imageOriginalUrl.startsWith('/') ? r.imageOriginalUrl.slice(1) : r.imageOriginalUrl);
                        if (fs.existsSync(imgPath)) {
                            archive.file(imgPath, { name: `images/${imgName}` });
                        }
                    }
                } catch (err) {
                    console.error(`Failed to add image to archive: ${imgName}`, err);
                }
            }
        });

        // 모든 이미지 처리가 대기열에 들어간 후 CSV 추가 및 종료
        await Promise.all(imagePromises);
        archive.append(csvContent, { name: 'receipts_list.csv' });
        await archive.finalize();
    }

    @Get(':id')
    async getReceipt(@Param('id') id: string) {
        return (this.prisma as any).receipt.findUnique({ where: { id } });
    }

    @Patch(':id')
    async updateReceipt(@Param('id') id: string, @Body() data: any) {
        const { id: _, companyId, userId, createdAt, updatedAt, ...safeData } = data;
        if (safeData.paidAt) safeData.paidAt = new Date(safeData.paidAt);
        return (this.prisma as any).receipt.update({
            where: { id },
            data: { ...safeData, status: data.status || 'SUBMITTED' },
        });
    }

    @Delete(':id')
    async deleteReceipt(@Param('id') id: string) {
        return (this.prisma as any).receipt.delete({ where: { id } });
    }
}
