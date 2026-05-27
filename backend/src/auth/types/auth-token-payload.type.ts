import type { Role } from '../../../generated/prisma/client';

export type AuthTokenType = 'access' | 'refresh';

export type AuthTokenPayload = {
  sub: string;
  email: string;
  role: Role;
  jti: string;
  tokenType: AuthTokenType;
};
