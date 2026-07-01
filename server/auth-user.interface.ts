export type UserRole = 'admin' | 'user';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: UserRole;
}

export interface JwtAuthPayload {
  sub: string;
  username: string;
  role: UserRole;
}
