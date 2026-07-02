import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import bcrypt from 'bcrypt';
import type { AuthUser, UserRole } from './auth-user.interface.js';
import { createAuthPool, type PgPool } from './auth-database.js';

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  role: string;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface UserResponse {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CreateUserInput {
  username?: string;
  password?: string;
  displayName?: string;
  email?: string | null;
  role?: string;
}

interface UpdateUserInput {
  displayName?: string;
  email?: string | null;
  role?: string;
  isActive?: boolean;
}

const USER_ROLES: UserRole[] = ['admin', 'operator', 'viewer'];

@Injectable()
export class UsersService implements OnModuleDestroy {
  private pool: PgPool | null = null;

  async onModuleDestroy() {
    if (this.pool) await this.pool.end();
  }

  async listUsers(): Promise<UserResponse[]> {
    const pool = await this.getPool();
    const result = await pool.query(
      `SELECT id, username, display_name, email, role, is_active, created_at, updated_at
         FROM users
        ORDER BY created_at DESC, username ASC`,
    );
    return result.rows.map((row) => this.toUserResponse(row));
  }

  async createUser(input: CreateUserInput): Promise<UserResponse> {
    const username = this.normalizeUsername(input.username);
    const password = String(input.password || '');
    if (!username) throw new BadRequestException({ error: 'username is required' });
    if (!password) throw new BadRequestException({ error: 'password is required' });
    const role = this.normalizeRole(input.role || 'viewer');
    const passwordHash = await bcrypt.hash(password, 12);
    const pool = await this.getPool();

    try {
      const result = await pool.query(
        `INSERT INTO users (username, password_hash, display_name, email, role, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         RETURNING id, username, display_name, email, role, is_active, created_at, updated_at`,
        [
          username,
          passwordHash,
          this.normalizeDisplayName(input.displayName),
          this.normalizeEmail(input.email),
          role,
        ],
      );
      return this.toUserResponse(result.rows[0]);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException({ error: 'username already exists' });
      }
      throw error;
    }
  }

  async updateUser(id: string, input: UpdateUserInput, currentUser?: AuthUser): Promise<UserResponse> {
    const userId = this.normalizeId(id);
    const fields: string[] = [];
    const params: unknown[] = [];

    if (Object.prototype.hasOwnProperty.call(input, 'displayName')) {
      params.push(this.normalizeDisplayName(input.displayName));
      fields.push(`display_name = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'email')) {
      params.push(this.normalizeEmail(input.email));
      fields.push(`email = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'role')) {
      params.push(this.normalizeRole(input.role));
      fields.push(`role = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'isActive')) {
      const isActive = this.normalizeBoolean(input.isActive);
      if (currentUser?.id === userId && isActive === false) {
        throw new BadRequestException({ error: 'current admin cannot be disabled' });
      }
      params.push(isActive);
      fields.push(`is_active = $${params.length}`);
    }

    if (!fields.length) return this.getUserById(userId);

    params.push(userId);
    const pool = await this.getPool();
    const result = await pool.query(
      `UPDATE users
          SET ${fields.join(', ')}
        WHERE id = $${params.length}
        RETURNING id, username, display_name, email, role, is_active, created_at, updated_at`,
      params,
    );
    if (!result.rows[0]) throw new NotFoundException({ error: 'User not found' });
    return this.toUserResponse(result.rows[0]);
  }

  async resetPassword(id: string, password: string): Promise<UserResponse> {
    const userId = this.normalizeId(id);
    if (!password) throw new BadRequestException({ error: 'password is required' });
    const passwordHash = await bcrypt.hash(password, 12);
    const pool = await this.getPool();
    const result = await pool.query(
      `UPDATE users
          SET password_hash = $1
        WHERE id = $2
        RETURNING id, username, display_name, email, role, is_active, created_at, updated_at`,
      [passwordHash, userId],
    );
    if (!result.rows[0]) throw new NotFoundException({ error: 'User not found' });
    return this.toUserResponse(result.rows[0]);
  }

  async disableUser(id: string, currentUser: AuthUser): Promise<UserResponse> {
    const userId = this.normalizeId(id);
    if (currentUser.id === userId) {
      throw new BadRequestException({ error: 'current admin cannot be disabled' });
    }
    const pool = await this.getPool();
    const result = await pool.query(
      `UPDATE users
          SET is_active = false
        WHERE id = $1
        RETURNING id, username, display_name, email, role, is_active, created_at, updated_at`,
      [userId],
    );
    if (!result.rows[0]) throw new NotFoundException({ error: 'User not found' });
    return this.toUserResponse(result.rows[0]);
  }

  private async getUserById(id: string): Promise<UserResponse> {
    const pool = await this.getPool();
    const result = await pool.query(
      `SELECT id, username, display_name, email, role, is_active, created_at, updated_at
         FROM users
        WHERE id = $1
        LIMIT 1`,
      [id],
    );
    if (!result.rows[0]) throw new NotFoundException({ error: 'User not found' });
    return this.toUserResponse(result.rows[0]);
  }

  private toUserResponse(row: Record<string, unknown>): UserResponse {
    const role = this.isUserRole(row.role) ? row.role : 'viewer';
    return {
      id: String(row.id || ''),
      username: String(row.username || ''),
      displayName: String(row.display_name || ''),
      email: row.email ? String(row.email) : null,
      role,
      isActive: row.is_active === true || String(row.is_active).toLowerCase() === 'true',
      createdAt: this.dateString(row.created_at),
      updatedAt: this.dateString(row.updated_at),
    };
  }

  private normalizeUsername(value: unknown): string {
    const username = String(value || '').trim();
    if (!username) return '';
    if (username.length > 64) throw new BadRequestException({ error: 'username is too long' });
    return username;
  }

  private normalizeDisplayName(value: unknown): string {
    return String(value || '').trim().slice(0, 128);
  }

  private normalizeEmail(value: unknown): string | null {
    const email = String(value || '').trim();
    if (!email) return null;
    if (email.length > 255) throw new BadRequestException({ error: 'email is too long' });
    return email;
  }

  private normalizeRole(value: unknown): UserRole {
    if (this.isUserRole(value)) return value;
    throw new BadRequestException({ error: 'role must be admin, operator, or viewer' });
  }

  private isUserRole(value: unknown): value is UserRole {
    return USER_ROLES.includes(value as UserRole);
  }

  private normalizeBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (String(value).toLowerCase() === 'true') return true;
    if (String(value).toLowerCase() === 'false') return false;
    throw new BadRequestException({ error: 'isActive must be boolean' });
  }

  private normalizeId(id: string): string {
    const value = String(id || '').trim();
    if (!value) throw new BadRequestException({ error: 'id is required' });
    return value;
  }

  private dateString(value: unknown): string {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }

  private isUniqueViolation(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === '23505');
  }

  private async getPool(): Promise<PgPool> {
    if (this.pool) return this.pool;
    this.pool = createAuthPool();
    return this.pool;
  }
}
