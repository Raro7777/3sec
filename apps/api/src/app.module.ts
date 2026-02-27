import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as path from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ReceiptsController } from './receipts.controller';

import { PrismaService } from './prisma.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(process.cwd(), '../../.env'), // 루트 디렉토리의 .env 로드
    }),
  ],
  controllers: [AppController, ReceiptsController],
  providers: [AppService, PrismaService],
})
export class AppModule { }
