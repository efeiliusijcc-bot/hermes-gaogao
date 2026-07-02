import { Injectable, OnModuleDestroy, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { createRequire } from 'module';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { AuthUser, JwtAuthPayload, UserRole } from './auth-user.interface.js';

type PgPool = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  end: () => Promise<void>;
};

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  email: string | null;
  role: string;
  is_active: boolean;
}

const require = createRequire(import.meta.url);
const DEFAULT_JWT_SECRET = 'dev-only-hermes-auth-secret-change-me';
let warnedDefaultJwtSecret = false;

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

  async onModuleDestroy() {
    if (this.pool) await this.pool.end();
  }

  async login(username: string, password: string): Promise<{ access_token: string; user: AuthUser }> {
    const normalizedUsername = String(username || '').trim();
    if (!normalizedUsername || !password) {
      throw new UnauthorizedException({ error: 'Invalid username or password' });
    }

    const row = await this.findUserByUsername(normalizedUsername);
    if (!row || !row.is_active) {
      throw new UnauthorizedException({ error: 'Invalid username or password' });
    }

    const passwordOk = await bcrypt.compare(password, row.password_hash);
    if (!passwordOk) {
      throw new UnauthorizedException({ error: 'Invalid username or password' });
    }

    const user = this.toAuthUser(row);
    return {
      access_token: this.signAccessToken(user),
      user,
    };
  }

  async verifyAccessToken(token: string): Promise<AuthUser> {
    try {
      const decoded = jwt.verify(token, jwtSecret()) as JwtAuthPayload;
      if (!decoded?.sub || !decoded.username || !this.isUserRole(decoded.role)) {
        throw new Error('Invalid token payload');
      }
      const row = await this.findUserById(decoded.sub);
      if (!row || !row.is_active) throw new Error('User is inactive');
      return this.toAuthUser(row);
    } catch {
      throw new UnauthorizedException({ error: 'Invalid or expired token' });
    }
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
    };
    const options: SignOptions = { expiresIn: '24h' };
    return jwt.sign(payload, jwtSecret(), options);
  }

  private toAuthUser(row: UserRow): AuthUser {
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name || '',
      email: row.email || null,
      role: this.isUserRole(row.role) ? row.role : 'viewer',
    };
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

  private async getPool(): Promise<PgPool> {
    if (this.pool) return this.pool;
    const connectionString = process.env.PGVECTOR_DATABASE_URL || process.env.POSTGRES_DATABASE_URL || process.env.DATABASE_URL;
    if (!connectionString) throw new Error('PGVECTOR_DATABASE_URL is not configured');
    const { Pool } = require('pg') as { Pool: new (config: Record<string, unknown>) => PgPool };
    this.pool = new Pool({
      connectionString,
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5000,
    });
    return this.pool;
  }
}
