export type UserRole = 'admin' | 'operator' | 'viewer';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: UserRole;
  roles: string[];
  permissions: string[];
}

export interface JwtAuthPayload {
  sub: string;
  username: string;
  role: UserRole;
  roles?: string[];
  permissions?: string[];
  typ?: 'access' | 'refresh';
}
