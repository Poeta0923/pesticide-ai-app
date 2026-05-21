import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UnverifiedUsersCleanupService } from './unverified-users-cleanup.service';

@Module({
  imports: [PrismaModule],
  providers: [UnverifiedUsersCleanupService],
})
export class CleanupModule {}
