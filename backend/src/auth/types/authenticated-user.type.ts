import type { Role } from '../../../generated/prisma/client';

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};
