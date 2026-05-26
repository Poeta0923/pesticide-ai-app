import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { shouldBlockMetricsInProduction } from './common/metrics/metrics-production-access';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // 로거 준비 전 발생하는 시작 로그가 유실되지 않도록 버퍼에 저장
    bufferLogs: true,
  });

  // NestJS 내장 Logger를 Winston으로 교체 (Loki로 로그 push 포함)
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  app.use(
    helmet({
      contentSecurityPolicy:
        process.env.NODE_ENV === 'production' ? undefined : false,
    }),
  );

  // 운영에서는 METRICS_ENABLED_IN_PRODUCTION=true가 없으면 /metrics를 기본 차단한다.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (
      shouldBlockMetricsInProduction({
        nodeEnv: process.env.NODE_ENV,
        metricsEnabledInProduction: process.env.METRICS_ENABLED_IN_PRODUCTION,
        path: req.path,
      })
    ) {
      res.status(404).send('Not Found');
      return;
    }

    next();
  });

  app.enableCors({
    origin:
      process.env.NODE_ENV === 'production' ? process.env.FRONTEND_URL : true,
    credentials: true,
  });

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Pesticide API')
      .setDescription('Pesticide API 문서입니다.')
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'access-token',
          description: 'Enter access token',
          in: 'header',
        },
        'access-token',
      )
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 8000);
}
void bootstrap();
