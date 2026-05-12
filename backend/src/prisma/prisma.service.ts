import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma/client';

/**
 * NestJS DI를 통해 PrismaClient 싱글턴을 관리하는 서비스.
 * 앱 라이프사이클에 연결해 DB 연결/해제를 자동으로 처리한다.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    // graceful shutdown 시 커넥션 풀을 명시적으로 해제한다.
    await this.$disconnect();
  }
}
