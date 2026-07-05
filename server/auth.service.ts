import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, InternalServerErrorException, OnModuleDestroy, Optional, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcrypt';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { AuthUser, JwtAuthPayload, UserRole } from './auth-user.interface.js';
import { createAuthPool, type PgPool } from './auth-database.js';
import { AuditLogService } from './audit-log.service.js';

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  email: string | null;
  role: string;
  is_active: boolean;
}

interface UserAccess {
  roles: string[];
  permissions: string[];
}

interface AuthContext {
  ip?: string;
  userAgent?: string;
}

const DEFAULT_JWT_SECRET = 'dev-only-hermes-auth-secret-change-me';
let warnedDefaultJwtSecret = false;
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';
const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_LOCK_MS = 10 * 60 * 1000;
const loginFailures = new Map<string, { count: number; lockedUntil: number }>();

const FALLBACK_ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  admin: [
    'report:create',
    'report:read',
    'report:update',
    'report:delete',
    'chat:execute',
    'chat:read',
    'research_key:read',
    'research_key:update',
    'vector_source:read',
    'vector_source:update',
    'user:manage',
    'role:manage',
    'draft_assistant:create',
    'draft_assistant:read',
    'draft_assistant:update',
    'daily_awareness:create',
    'daily_awareness:read',
    'daily_awareness:import',
    'preference:read',
    'preference:update',
    'template:create',
    'template:read',
    'template:update',
    'template:delete',
  ],
  operator: [
    'report:create',
    'report:read',
    'report:update',
    'chat:execute',
    'chat:read',
    'research_key:read',
    'vector_source:read',
    'draft_assistant:create',
    'draft_assistant:read',
    'draft_assistant:update',
    'daily_awareness:create',
    'daily_awareness:read',
    'daily_awareness:import',
    'preference:read',
    'preference:update',
    'template:create',
    'template:read',
    'template:update',
    'template:delete',
  ],
  viewer: [
    'report:read',
    'chat:execute',
    'chat:read',
    'research_key:read',
    'vector_source:read',
    'draft_assistant:create',
    'draft_assistant:read',
    'draft_assistant:update',
    'daily_awareness:read',
    'preference:read',
    'preference:update',
    'template:create',
    'template:read',
    'template:update',
    'template:delete',
  ],
};

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET || '';
  if (secret) return secret;
  if (!warnedDefaultJwtSecret) {
    warnedDefaultJwtSecret = true;
    console.warn('JWT_SECRET is not configured; using an insecure development default.');
  }
  return DEFAULT_JWT_SECRET;
}

@Injectable()
export class AuthService implements OnModuleDestroy {
  private pool: PgPool | null = null;

  constructor(@Optional() @Inject(AuditLogService) private readonly audit?: AuditLogService) {}

  async onModuleDestroy() {
    if (this.pool) await this.pool.end();
  }

  async login(username: string, password: string, context: AuthContext = {}): Promise<{ access_token: string; refresh_token: string; user: AuthUser }> {
    const normalizedUsername = String(username || '').trim();
    if (!normalizedUsername || !password) {
      throw new UnauthorizedException('Invalid username or password');
    }
    this.assertLoginAllowed(normalizedUsername, context.ip);

    const row = await this.findUserByUsername(normalizedUsername);
    if (!row || !row.is_active) {
      await this.recordLoginFailure(normalizedUsername, context, 'unknown_or_inactive_user');
      throw new UnauthorizedException('Invalid username or password');
    }

    const passwordOk = await bcrypt.compare(password, row.password_hash);
    if (!passwordOk) {
      await this.recordLoginFailure(normalizedUsername, context, 'bad_password', row);
      throw new UnauthorizedException('Invalid username or password');
    }

    const user = await this.toAuthUser(row);
    this.clearLoginFailures(normalizedUsername, context.ip);
    await this.audit?.log({
      actor: user,
      action: 'login_success',
      resource: 'auth',
      ipAddress: context.ip || null,
      userAgent: context.userAgent || null,
      detail: { username: normalizedUsername },
    });
    return {
      access_token: this.signAccessToken(user),
      refresh_token: this.signRefreshToken(user),
      user,
    };
  }

  async verifyAccessToken(token: string): Promise<AuthUser> {
    let decoded: JwtAuthPayload;
    try {
      decoded = jwt.verify(token, jwtSecret()) as JwtAuthPayload;
    } catch {
      throw new UnauthorizedException({ error: 'Invalid or expired token' });
    }
    if (!decoded?.sub || !decoded.username || !this.isUserRole(decoded.role) || decoded.typ === 'refresh') {
      throw new UnauthorizedException({ error: 'Invalid or expired token' });
    }

    const row = await this.findUserById(decoded.sub);
    if (!row || !row.is_active) {
      throw new UnauthorizedException({ error: 'Invalid or expired token' });
    }
    return this.toAuthUser(row);
  }

  async refreshAccessToken(refreshToken: string): Promise<{ access_token: string; refresh_token: string; user: AuthUser }> {
    let decoded: JwtAuthPayload;
    try {
      decoded = jwt.verify(String(refreshToken || ''), jwtSecret()) as JwtAuthPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (!decoded?.sub || decoded.typ !== 'refresh' || !this.isUserRole(decoded.role)) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const row = await this.findUserById(decoded.sub);
    if (!row || !row.is_active) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    const user = await this.toAuthUser(row);
    return {
      access_token: this.signAccessToken(user),
      refresh_token: this.signRefreshToken(user),
      user,
    };
  }

  async changePassword(user: AuthUser, oldPassword: string, newPassword: string, context: AuthContext = {}): Promise<{ success: true }> {
    this.validatePasswordStrength(newPassword);
    if (oldPassword === newPassword) throw new BadRequestException('New password must be different from old password');
    const row = await this.findUserById(user.id);
    if (!row || !row.is_active) throw new UnauthorizedException({ error: 'Invalid or expired token' });
    const oldPasswordOk = await bcrypt.compare(String(oldPassword || ''), row.password_hash);
    if (!oldPasswordOk) throw new UnauthorizedException('old password is incorrect');
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const pool = await this.getPool();
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, user.id]);
    await this.audit?.log({
      actor: user,
      action: 'password_change',
      resource: 'user',
      resourceId: user.id,
      ipAddress: context.ip || null,
      userAgent: context.userAgent || null,
      detail: { userId: user.id },
    });
    return { success: true };
  }

  clearLoginFailuresForTest(username: string, ip?: string): void {
    this.clearLoginFailures(username, ip);
  }

  private async findUserByUsername(username: string): Promise<UserRow | null> {
    const pool = await this.getPool();
    const result = await pool.query(
      `SELECT id, username, password_hash, display_name, email, role, is_active
         FROM users
        WHERE username = $1
        LIMIT 1`,
      [username],
    );
    return this.toUserRow(result.rows[0]);
  }

  private async findUserById(id: string): Promise<UserRow | null> {
    const pool = await this.getPool();
    const result = await pool.query(
      `SELECT id, username, password_hash, display_name, email, role, is_active
         FROM users
        WHERE id = $1
        LIMIT 1`,
      [id],
    );
    return this.toUserRow(result.rows[0]);
  }

  private signAccessToken(user: AuthUser): string {
    const payload: JwtAuthPayload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      roles: user.roles,
      permissions: user.permissions,
      typ: 'access',
    };
    const options: SignOptions = { expiresIn: ACCESS_TOKEN_TTL };
    return jwt.sign(payload, jwtSecret(), options);
  }

  private signRefreshToken(user: AuthUser): string {
    const payload: JwtAuthPayload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      typ: 'refresh',
    };
    const options: SignOptions = { expiresIn: REFRESH_TOKEN_TTL };
    return jwt.sign(payload, jwtSecret(), options);
  }

  private async toAuthUser(row: UserRow): Promise<AuthUser> {
    const role = this.isUserRole(row.role) ? row.role : 'viewer';
    const access = await this.resolveUserAccess(row.id, role);
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name || '',
      email: row.email || null,
      role,
      roles: access.roles,
      permissions: access.permissions,
    };
  }

  private async resolveUserAccess(userId: string, fallbackRole: UserRole): Promise<UserAccess> {
    try {
      const pool = await this.getPool();
      const result = await pool.query(
        `SELECT r.name AS role_name, p.resource, p.action
           FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id
           LEFT JOIN role_permissions rp ON rp.role_id = r.id
           LEFT JOIN permissions p ON p.id = rp.permission_id
          WHERE ur.user_id = $1
          ORDER BY r.name ASC, p.resource ASC, p.action ASC`,
        [userId],
      );
      const roles = this.uniqueStrings(result.rows.map((row) => row.role_name));
      const permissions = this.uniqueStrings(
        result.rows
          .map((row) => {
            const resource = String(row.resource || '').trim();
            const action = String(row.action || '').trim();
            return resource && action ? `${resource}:${action}` : '';
          }),
      );
      if (roles.length) {
        return { roles, permissions };
      }
      return this.fallbackAccess(fallbackRole);
    } catch (error) {
      if (this.isMissingRbacTable(error)) {
        return this.fallbackAccess(fallbackRole);
      }
      throw new InternalServerErrorException({ error: 'Failed to load user permissions' });
    }
  }

  private fallbackAccess(role: UserRole): UserAccess {
    return {
      roles: [role],
      permissions: FALLBACK_ROLE_PERMISSIONS[role],
    };
  }

  private uniqueStrings(values: unknown[]): string[] {
    return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
  }

  private isMissingRbacTable(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === '42P01');
  }

  private toUserRow(row: Record<string, unknown> | undefined): UserRow | null {
    if (!row) return null;
    return {
      id: String(row.id || ''),
      username: String(row.username || ''),
      password_hash: String(row.password_hash || ''),
      display_name: String(row.display_name || ''),
      email: row.email ? String(row.email) : null,
      role: String(row.role || 'viewer'),
      is_active: row.is_active === true || String(row.is_active).toLowerCase() === 'true',
    };
  }

  private isUserRole(value: unknown): value is UserRole {
    return value === 'admin' || value === 'operator' || value === 'viewer';
  }

  private validatePasswordStrength(password: string): void {
    const value = String(password || '');
    if (value.trim().length < 8) throw new BadRequestException('Password must be at least 8 characters');
    if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
      throw new BadRequestException('Password must include letters and numbers');
    }
  }

  private assertLoginAllowed(username: string, ip?: string): void {
    const keys = this.loginFailureKeys(username, ip);
    const now = Date.now();
    for (const key of keys) {
      const state = loginFailures.get(key);
      if (state?.lockedUntil && state.lockedUntil > now) {
        throw new HttpException('登录失败次数过多，请稍后再试。', HttpStatus.TOO_MANY_REQUESTS);
      }
    }
  }

  private async recordLoginFailure(username: string, context: AuthContext, reason: string, row?: UserRow): Promise<void> {
    const now = Date.now();
    for (const key of this.loginFailureKeys(username, context.ip)) {
      const current = loginFailures.get(key);
      const count = (current?.lockedUntil && current.lockedUntil > now ? current.count : current?.count || 0) + 1;
      loginFailures.set(key, {
        count,
        lockedUntil: count >= LOGIN_FAILURE_LIMIT ? now + LOGIN_LOCK_MS : 0,
      });
    }
    await this.audit?.log({
      actorId: row?.id || null,
      actorUsername: row?.username || username,
      action: 'login_failure',
      resource: 'auth',
      result: 'failure',
      ipAddress: context.ip || null,
      userAgent: context.userAgent || null,
      detail: { username, reason },
    });
  }

  private clearLoginFailures(username: string, ip?: string): void {
    for (const key of this.loginFailureKeys(username, ip)) loginFailures.delete(key);
  }

  private loginFailureKeys(username: string, ip?: string): string[] {
    const keys = [`username:${String(username || '').trim().toLowerCase()}`];
    if (ip) keys.push(`ip:${ip}`);
    return keys;
  }

  private async getPool(): Promise<PgPool> {
    if (this.pool) return this.pool;
    this.pool = createAuthPool();
    return this.pool;
  }
}
