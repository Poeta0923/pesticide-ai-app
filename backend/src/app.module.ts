import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import LokiTransport from 'winston-loki';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // GET /metrics 엔드포인트 자동 등록.
    // defaultMetrics(Node.js 프로세스 CPU/메모리/이벤트루프/GC 등) 기본 활성화.
    PrometheusModule.register({
      defaultLabels: {
        app: 'pesticide-backend',
      },
    }),
    WinstonModule.forRoot({
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.colorize(),
            winston.format.printf(
              ({ timestamp, level, message, context }) =>
                `${timestamp} [${context ?? 'App'}] ${level}: ${message}`,
            ),
          ),
        }),
        new LokiTransport({
          // localhost:3100 = monitoring/docker-compose.yml 의 Loki 노출 포트
          host: 'http://localhost:3100',
          labels: {
            app: 'pesticide-backend',
            env: process.env.NODE_ENV ?? 'development',
          },
          json: true,
          format: winston.format.json(),
          replaceTimestamp: true,
          // Loki가 아직 안 뜬 경우에도 앱 크래시 방지
          onConnectionError: (err) =>
            console.error('Loki connection error:', err),
        }),
      ],
    }),
    PrismaModule,
    MailModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
