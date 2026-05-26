import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import {
  PrometheusModule,
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';
import {
  HTTP_REQUESTS_TOTAL,
  HTTP_REQUEST_DURATION_BUCKETS,
  HTTP_REQUEST_DURATION_SECONDS,
  HTTP_REQUESTS_IN_FLIGHT,
} from './http-observability.constants';
import { HttpObservabilityInterceptor } from './http-observability.interceptor';

@Module({
  imports: [
    // GET /metrics 엔드포인트 자동 등록.
    // defaultMetrics(Node.js 프로세스 CPU/메모리/이벤트루프/GC 등) 기본 활성화.
    PrometheusModule.register({
      defaultLabels: {
        app: 'pesticide-backend',
      },
    }),
  ],
  providers: [
    makeCounterProvider({
      name: HTTP_REQUESTS_TOTAL,
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
    }),
    makeHistogramProvider({
      name: HTTP_REQUEST_DURATION_SECONDS,
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: HTTP_REQUEST_DURATION_BUCKETS,
    }),
    makeGaugeProvider({
      name: HTTP_REQUESTS_IN_FLIGHT,
      help: 'Number of HTTP requests currently in flight',
      labelNames: ['method', 'route'],
    }),
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpObservabilityInterceptor,
    },
  ],
})
export class MetricsModule {}
