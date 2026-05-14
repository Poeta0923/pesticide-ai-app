import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private mail: MailService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      if (existing.emailVerified) {
        throw new ConflictException('이미 가입된 이메일입니다.');
      }

      return {
        message: '이미 가입된 이메일입니다. 인증 메일을 재발송하시겠습니까?',
        requireResend: true,
      };
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        name: dto.name,
      },
    });

    await this.sendVerificationEmail(user.email!, user.name);

    return {
      message:
        '회원가입이 완료되었습니다. 이메일을 확인해 인증을 완료해주세요.',
    };
  }

  private async sendVerificationEmail(email: string, name: string) {
    const token = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000);

    await this.prisma.verificationToken.deleteMany({
      where: { identifier: email, type: 'EMAIL_VERIFICATION' },
    });

    await this.prisma.verificationToken.create({
      data: {
        identifier: email,
        token,
        expires,
        type: 'EMAIL_VERIFICATION',
      },
    });

    await this.mail.sendVerificationEmail(email, name, token);
  }

  async verifyModel(token: string) {
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

    await this.sendVerificationEmail(user.email!, user.name);

    return { message: '인증 메일이 재발송되었습니다.' };
  }
}
