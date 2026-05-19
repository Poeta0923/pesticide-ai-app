import { Module } from '@nestjs/common';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';

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
})
export class MetricsModule {}
