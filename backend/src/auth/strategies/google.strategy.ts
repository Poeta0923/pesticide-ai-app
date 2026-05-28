import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import {
  Strategy,
  type GoogleCallbackParameters,
  type Profile,
} from 'passport-google-oauth20';
import { AuthService } from '../auth.service';
import type { AuthenticatedUser } from '../types/authenticated-user.type';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    private readonly authService: AuthService,
    config: ConfigService,
  ) {
    super({
      clientID: config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      clientSecret: config.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL: config.getOrThrow<string>('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    params: GoogleCallbackParameters,
    profile: Profile,
  ): Promise<AuthenticatedUser> {
    const email = profile.emails?.[0];

    return this.authService.validateOAuthLogin({
      provider: 'google',
      providerAccountId: profile.id,
      email: email?.value ?? profile._json.email ?? null,
      emailVerified: email?.verified ?? profile._json.email_verified ?? false,
      name: profile.displayName || profile._json.name || 'Google User',
      accessToken,
      refreshToken: refreshToken || params.refresh_token,
      expiresAt: params.expires_in
        ? Math.floor(Date.now() / 1000) + params.expires_in
        : undefined,
      tokenType: params.token_type,
      scope: params.scope,
      idToken: params.id_token,
    });
  }
}
