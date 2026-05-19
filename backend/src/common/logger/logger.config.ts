import { ConfigService } from '@nestjs/config';
import { WinstonModuleOptions } from 'nest-winston';
import * as winston from 'winston';
import LokiTransport from 'winston-loki';

export const createLoggerOptions = (
  config: ConfigService,
): WinstonModuleOptions => ({
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
      // LOKI_URL 미설정 시 로컬 dev 기본값으로 fallback
      host: config.get<string>('LOKI_URL') ?? 'http://localhost:3100',
      labels: {
        app: 'pesticide-backend',
        env: config.get<string>('NODE_ENV') ?? 'development',
      },
      json: true,
      format: winston.format.json(),
      replaceTimestamp: true,
      // Loki가 아직 안 뜬 경우에도 앱 크래시 방지
      onConnectionError: (err) =>
        console.error('Loki connection error:', err),
    }),
  ],
});
