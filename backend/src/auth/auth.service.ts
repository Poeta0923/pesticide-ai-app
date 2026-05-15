import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      if (existing.emailVerified) {
        throw new ConflictException({
          message: '이미 가입된 이메일입니다.',
          code: 'EMAIL_ALREADY_VERIFIED',
        });
      }

      throw new ConflictException({
        message: '이미 가입 신청된 이메일입니다. 인증 메일을 재발송하시겠습니까?',
        code: 'EMAIL_PENDING_VERIFICATION',
        action: 'RESEND_VERIFICATION',
      });
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        name: dto.name,
      },
    });

    try {
      await this.sendVerificationEmail(user.email!, user.name);
    } catch (error) {
      this.logger.error(
        `Verification email failed for ${user.email}`,
        error instanceof Error ? error.stack : error,
      );
      return {
        message:
          '회원가입은 완료되었으나 이메일 발송에 실패했습니다. 인증 메일 재발송을 요청해주세요.',
        action: 'RESEND_VERIFICATION',
      };
    }

    return {
      message: '회원가입이 완료되었습니다. 이메일을 확인해 인증을 완료해주세요.',
    };
  }

  private async sendVerificationEmail(email: string, name: string) {
    const token = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000);

    await this.prisma.verificationToken.deleteMany({
      where: { identifier: email, type: 'EMAIL_VERIFICATION' },
    });

    await this.prisma.verificationToken.create({
      data: { identifier: email, token, expires, type: 'EMAIL_VERIFICATION' },
    });

    await this.mail.sendVerificationEmail(email, name, token);
  }

  async verifyEmail(token: string) {
    const record = await this.prisma.verificationToken.findFirst({
      where: { token, type: 'EMAIL_VERIFICATION' },
    });

    if (!record) {
      throw new BadRequestException('유효하지 않은 토큰입니다.');
    }

    if (record.expires < new Date()) {
      await this.prisma.verificationToken.delete({
        where: { identifier_token: { identifier: record.identifier, token } },
      });
      throw new BadRequestException(
        '만료된 토큰입니다. 인증 메일을 재발송해주세요.',
      );
    }

    await this.prisma.user.update({
      where: { email: record.identifier },
      data: { emailVerified: new Date() },
    });

    await this.prisma.verificationToken.delete({
      where: { identifier_token: { identifier: record.identifier, token } },
    });

    return { message: '이메일 인증이 완료되었습니다.' };
  }

  async resendVerification(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      return { message: '인증 메일이 재발송되었습니다.' };
    }

    if (user.emailVerified) {
      throw new BadRequestException('이미 인증된 계정입니다.');
    }

    try {
      await this.sendVerificationEmail(user.email!, user.name);
    } catch (error) {
      this.logger.error(
        `Verification email resend failed for ${user.email}`,
        error instanceof Error ? error.stack : error,
      );
      throw new InternalServerErrorException(
        '인증 메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.',
      );
    }

    return { message: '인증 메일이 재발송되었습니다.' };
  }
}