import { ConfigService } from '@nestjs/config';
import { WinstonModuleOptions } from 'nest-winston';
import * as winston from 'winston';
import LokiTransport from 'winston-loki';

const stringifyLogValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    typeof value === 'symbol'
  ) {
    return value.toString();
  }

  if (value instanceof Error) {
    return value.stack ?? value.message;
  }

  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '[Unserializable log value]';
  }
};

export const createLoggerOptions = (
  config: ConfigService,
): WinstonModuleOptions => ({
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, context }) => {
          const logTimestamp = stringifyLogValue(timestamp);
          const logContext =
            context === null || context === undefined
              ? 'App'
              : stringifyLogValue(context);
          const logLevel = stringifyLogValue(level);
          const logMessage = stringifyLogValue(message);

          return `${logTimestamp} [${logContext}] ${logLevel}: ${logMessage}`;
        }),
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
      onConnectionError: (err) => console.error('Loki connection error:', err),
    }),
  ],
});
