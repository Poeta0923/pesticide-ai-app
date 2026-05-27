import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcrypt';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { RegisterDto } from './dto/register.dto';
import type { AuthenticatedUser } from './types/authenticated-user.type';
import type {
  AuthTokenPayload,
  AuthTokenType,
} from './types/auth-token-payload.type';

const ACCESS_TOKEN_EXPIRES_IN = '1h';
const REFRESH_TOKEN_EXPIRES_IN = '7d';

type LoginResult = {
  accessToken: string;
  refreshToken: string;
  user: AuthenticatedUser;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly accessTokenSecret: string;
  private readonly refreshTokenSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    this.accessTokenSecret =
      this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
    this.refreshTokenSecret =
      this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
  }

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
        message:
          '이미 가입 신청된 이메일입니다. 인증 메일을 재발송하시겠습니까?',
        code: 'EMAIL_PENDING_VERIFICATION',
        action: 'RESEND_VERIFICATION',
      });
    }

    const hashedPassword = await hash(dto.password, 10);

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

  async validateCredentials(
    email: string,
    password: string,
  ): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        password: true,
        role: true,
        emailVerified: true,
      },
    });

    if (!user?.email || !user.password) {
      this.throwInvalidCredentials();
    }

    const passwordMatches = await compare(password, user.password);
    if (!passwordMatches) {
      this.throwInvalidCredentials();
    }

    if (!user.emailVerified) {
      throw new ForbiddenException({
        message: '이메일 인증이 필요합니다.',
        code: 'EMAIL_NOT_VERIFIED',
        action: 'RESEND_VERIFICATION',
      });
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }

  async login(user: AuthenticatedUser): Promise<LoginResult> {
    const [accessToken, refreshToken] = await Promise.all([
      this.signToken(user, 'access'),
      this.signToken(user, 'refresh'),
    ]);

    return { accessToken, refreshToken, user };
  }

  private async signToken(user: AuthenticatedUser, tokenType: AuthTokenType) {
    const payload: AuthTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      jti: randomUUID(),
      tokenType,
    };

    return this.jwt.signAsync(payload, {
      secret:
        tokenType === 'access'
          ? this.accessTokenSecret
          : this.refreshTokenSecret,
      expiresIn:
        tokenType === 'access'
          ? ACCESS_TOKEN_EXPIRES_IN
          : REFRESH_TOKEN_EXPIRES_IN,
    });
  }

  private throwInvalidCredentials(): never {
    throw new UnauthorizedException(
      '이메일 또는 비밀번호가 올바르지 않습니다.',
    );
  }
}
