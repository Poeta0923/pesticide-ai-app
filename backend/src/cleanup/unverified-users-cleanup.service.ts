import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

const UNVERIFIED_USER_RETENTION_DAYS = 7;
const UNVERIFIED_USER_RETENTION_MS =
  UNVERIFIED_USER_RETENTION_DAYS * 24 * 60 * 60 * 1000;

@Injectable()
export class UnverifiedUsersCleanupService {
  private readonly logger = new Logger(UnverifiedUsersCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 0 3 * * *', {
    name: 'cleanup-unverified-users',
    timeZone: 'Asia/Seoul',
    waitForCompletion: true,
  })
  async handleCron() {
    await this.cleanupUnverifiedUsers();
  }

  async cleanupUnverifiedUsers(now = new Date()) {
    const cutoff = new Date(now.getTime() - UNVERIFIED_USER_RETENTION_MS);

    const deletedCount = await this.prisma.$transaction(async (tx) => {
      const targets = await tx.user.findMany({
        where: {
          emailVerified: null,
          createdAt: { lt: cutoff },
        },
        select: { id: true, email: true },
      });

      if (targets.length === 0) {
        return 0;
      }

      const targetsWithoutEmail = targets.filter((user) => user.email === null);
      if (targetsWithoutEmail.length > 0) {
        this.logger.error(
          `cleanup-unverified-users found ${targetsWithoutEmail.length} unverified users without email: ${targetsWithoutEmail
            .map((user) => user.id)
            .join(', ')}`,
        );
      }

      const validTargets = targets.filter(
        (user): user is typeof user & { email: string } => user.email !== null,
      );

      if (validTargets.length === 0) {
        return 0;
      }

      const targetIds = validTargets.map((user) => user.id);
      const targetEmails = validTargets.map((user) => user.email);

      await tx.verificationToken.deleteMany({
        where: { identifier: { in: targetEmails } },
      });

      const result = await tx.user.deleteMany({
        where: {
          id: { in: targetIds },
          emailVerified: null,
          createdAt: { lt: cutoff },
        },
      });

      return result.count;
    });

    this.logger.log(
      `cleanup-unverified-users deleted ${deletedCount} users older than ${cutoff.toISOString()}`,
    );

    return deletedCount;
  }
}
