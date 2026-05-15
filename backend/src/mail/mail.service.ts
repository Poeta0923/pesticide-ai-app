import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private resend = new Resend(process.env.RESEND_API_KEY);

  async sendVerificationEmail(to: string, name: string, token: string) {
    const url = `${process.env.APP_URL}/verify-email?token=${token}`;
    await this.resend.emails.send({
      from: `${process.env.EMAIL}`,
      to,
      subject: '이메일 인증을 완료해주세요.',
      html: `<p>${name}님, <a href="${url}">여기를 클릭</a>해 인증해주세요.</p>`,
    });
  }
}
