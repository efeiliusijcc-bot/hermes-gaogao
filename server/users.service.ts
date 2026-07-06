import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import bcrypt from 'bcrypt';
import type { AuthUser, UserRole } from './auth-user.interface.js';
import { createAuthPool, type PgPool } from './auth-database.js';
import { modulesFromPermissions, SYSTEM_ROLE_PERMISSIONS } from './permission-modules.js';

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

interface RoleRow {
  id: string;
  name: string;
}

export interface UserResponse {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: UserRole;
  roles: string[];
  modules: string[];
  permissions: string[];
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
  roles?: string[];
}

interface UpdateUserInput {
  displayName?: string;
  email?: string | null;
  role?: string;
  roles?: string[];
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
    try {
      const result = await pool.query(
        `SELECT u.id, u.username, u.display_name, u.email, u.role, u.is_active, u.created_at, u.updated_at,
                COALESCE(
                  array_agg(DISTINCT r.name ORDER BY r.name) FILTER (WHERE r.name IS NOT NULL),
                  ARRAY[]::text[]
                ) AS roles,
                COALESCE(
                  array_agg(DISTINCT concat(p.resource, ':', p.action) ORDER BY concat(p.resource, ':', p.action))
                    FILTER (WHERE p.id IS NOT NULL),
                  ARRAY[]::text[]
                ) AS permissions
           FROM users u
           LEFT JOIN user_roles ur ON ur.user_id = u.id
           LEFT JOIN roles r ON r.id = ur.role_id
           LEFT JOIN role_permissions rp ON rp.role_id = r.id
           LEFT JOIN permissions p ON p.id = rp.permission_id
          GROUP BY u.id, u.username, u.display_name, u.email, u.role, u.is_active, u.created_at, u.updated_at
          ORDER BY u.created_at DESC, u.username ASC`,
      );
      return result.rows.map((row) => this.toUserResponse(row));
    } catch (error) {
      if (!this.isMissingRbacTable(error)) throw error;
      const result = await pool.query(
        `SELECT id, username, display_name, email, role, is_active, created_at, updated_at
           FROM users
          ORDER BY created_at DESC, username ASC`,
      );
      return result.rows.map((row) => this.toUserResponse(row));
    }
  }

  async createUser(input: CreateUserInput): Promise<UserResponse> {
    const username = this.normalizeUsername(input.username);
    const password = String(input.password || '');
    if (!username) throw new BadRequestException({ error: 'username is required' });
    this.validatePasswordStrength(password);
    const roleNames = this.resolveRequestedRoles(input, 'viewer');
    const roleRows = await this.resolveRoleRows(roleNames);
    const role = this.compatRole(roleNames, input.role);
    const passwordHash = await bcrypt.hash(password, 12);
    const pool = await this.getPool();

    try {
      await pool.query('BEGIN');
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
      const userId = String(result.rows[0].id);
      await this.replaceUserRoles(userId, roleRows);
      await pool.query('COMMIT');
      return this.getUserById(userId);
    } catch (error) {
      await this.rollbackQuietly(pool);
      if (this.isUniqueViolation(error)) {
        throw new ConflictException({ error: 'username already exists' });
      }
      throw error;
    }
  }

  async updateUser(id: string, input: UpdateUserInput, currentUser?: AuthUser): Promise<UserResponse> {
    const userId = this.normalizeId(id);
    const current = await this.getUserById(userId);
    const fields: string[] = [];
    const params: unknown[] = [];
    const hasRoles = Object.prototype.hasOwnProperty.call(input, 'roles') || Object.prototype.hasOwnProperty.call(input, 'role');
    const roleNames = hasRoles ? this.resolveRequestedRoles(input, current.role) : current.roles;
    const roleRows = hasRoles ? await this.resolveRoleRows(roleNames) : [];
    const nextLegacyRole = hasRoles ? this.compatRole(roleNames, input.role) : current.role;
    const nextIsActive = Object.prototype.hasOwnProperty.call(input, 'isActive')
      ? this.normalizeBoolean(input.isActive)
      : current.isActive;

    if ((current.role === 'admin' || current.roles.includes('admin')) && (!roleNames.includes('admin') || !nextIsActive)) {
      await this.assertNotLastAdmin(userId);
    }

    if (Object.prototype.hasOwnProperty.call(input, 'displayName')) {
      params.push(this.normalizeDisplayName(input.displayName));
      fields.push(`display_name = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'email')) {
      params.push(this.normalizeEmail(input.email));
      fields.push(`email = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'role')) {
      params.push(nextLegacyRole);
      fields.push(`role = $${params.length}`);
    } else if (hasRoles) {
      params.push(nextLegacyRole);
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

    if (!fields.length && !hasRoles) return this.getUserById(userId);

    params.push(userId);
    const pool = await this.getPool();
    await pool.query('BEGIN');
    try {
      if (fields.length) {
        const result = await pool.query(
          `UPDATE users
              SET ${fields.join(', ')}
            WHERE id = $${params.length}
            RETURNING id, username, display_name, email, role, is_active, created_at, updated_at`,
          params,
        );
        if (!result.rows[0]) throw new NotFoundException({ error: 'User not found' });
      }
      if (hasRoles) await this.replaceUserRoles(userId, roleRows);
      await pool.query('COMMIT');
      return this.getUserById(userId);
    } catch (error) {
      await this.rollbackQuietly(pool);
      throw error;
    }
  }

  async resetPassword(id: string, password: string): Promise<UserResponse> {
    const userId = this.normalizeId(id);
    this.validatePasswordStrength(password);
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
    let result;
    try {
      result = await pool.query(
        `SELECT u.id, u.username, u.display_name, u.email, u.role, u.is_active, u.created_at, u.updated_at,
                COALESCE(
                  array_agg(DISTINCT r.name ORDER BY r.name) FILTER (WHERE r.name IS NOT NULL),
                  ARRAY[]::text[]
                ) AS roles,
                COALESCE(
                  array_agg(DISTINCT concat(p.resource, ':', p.action) ORDER BY concat(p.resource, ':', p.action))
                    FILTER (WHERE p.id IS NOT NULL),
                  ARRAY[]::text[]
                ) AS permissions
           FROM users u
           LEFT JOIN user_roles ur ON ur.user_id = u.id
           LEFT JOIN roles r ON r.id = ur.role_id
           LEFT JOIN role_permissions rp ON rp.role_id = r.id
           LEFT JOIN permissions p ON p.id = rp.permission_id
          WHERE u.id = $1
          GROUP BY u.id, u.username, u.display_name, u.email, u.role, u.is_active, u.created_at, u.updated_at
          LIMIT 1`,
        [id],
      );
    } catch (error) {
      if (!this.isMissingRbacTable(error)) throw error;
      result = await pool.query(
        `SELECT id, username, display_name, email, role, is_active, created_at, updated_at
           FROM users
          WHERE id = $1
          LIMIT 1`,
        [id],
      );
    }
    if (!result.rows[0]) throw new NotFoundException({ error: 'User not found' });
    return this.toUserResponse(result.rows[0]);
  }

  private toUserResponse(row: Record<string, unknown>): UserResponse {
    const role = this.isUserRole(row.role) ? row.role : 'viewer';
    const roles = Array.isArray(row.roles) && row.roles.length ? row.roles.map((item) => String(item)) : [role];
    const rawPermissions = Array.isArray(row.permissions) ? row.permissions.map((item) => String(item)).filter(Boolean) : [];
    const permissions = rawPermissions.length || !roles.includes(role) ? rawPermissions : SYSTEM_ROLE_PERMISSIONS[role];
    return {
      id: String(row.id || ''),
      username: String(row.username || ''),
      displayName: String(row.display_name || ''),
      email: row.email ? String(row.email) : null,
      role,
      roles,
      modules: modulesFromPermissions(permissions),
      permissions,
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

  private validatePasswordStrength(password: string): void {
    const value = String(password || '');
    if (value.trim().length < 8) throw new BadRequestException('Password must be at least 8 characters');
    if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
      throw new BadRequestException('Password must include letters and numbers');
    }
  }

  private resolveRequestedRoles(input: { role?: string; roles?: string[] }, fallback: string): string[] {
    const raw = Array.isArray(input.roles) && input.roles.length ? input.roles : [input.role || fallback];
    const roles = Array.from(new Set(raw.map((item) => String(item || '').trim()).filter(Boolean)));
    if (!roles.length) return ['viewer'];
    roles.forEach((role) => {
      if (role.length > 64 || !/^[A-Za-z0-9_-]+$/.test(role)) {
        throw new BadRequestException({ error: 'roles contain invalid role name' });
      }
    });
    return roles;
  }

  private compatRole(roleNames: string[], requestedRole?: string): UserRole {
    if (this.isUserRole(requestedRole)) return requestedRole;
    const firstSystemRole = roleNames.find((role) => this.isUserRole(role));
    return this.isUserRole(firstSystemRole) ? firstSystemRole : 'viewer';
  }

  private async resolveRoleRows(roleNames: string[]): Promise<RoleRow[]> {
    const pool = await this.getPool();
    const result = await pool.query(
      `SELECT id, name
         FROM roles
        WHERE name = ANY($1::text[])
        ORDER BY name ASC`,
      [roleNames],
    );
    const rows = result.rows.map((row) => ({ id: String(row.id), name: String(row.name) }));
    const found = new Set(rows.map((row) => row.name));
    const missing = roleNames.filter((role) => !found.has(role));
    if (missing.length) throw new BadRequestException({ error: `Unknown roles: ${missing.join(', ')}` });
    return rows;
  }

  private async replaceUserRoles(userId: string, roles: RoleRow[]): Promise<void> {
    const pool = await this.getPool();
    await pool.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    for (const role of roles) {
      await pool.query(
        `INSERT INTO user_roles (user_id, role_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [userId, role.id],
      );
    }
  }

  private async assertNotLastAdmin(userId: string): Promise<void> {
    const pool = await this.getPool();
    const result = await pool.query(
      `SELECT COUNT(*) AS count
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
        WHERE u.is_active = true
          AND (u.role = 'admin' OR r.name = 'admin')`,
    );
    const adminCount = Number(result.rows[0]?.count || 0);
    if (adminCount <= 1) {
      void userId;
      throw new BadRequestException('Cannot remove last admin');
    }
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

  private isMissingRbacTable(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === '42P01');
  }

  private async rollbackQuietly(pool: PgPool): Promise<void> {
    try {
      await pool.query('ROLLBACK');
    } catch {
      // Preserve the original failure.
    }
  }

  private async getPool(): Promise<PgPool> {
    if (this.pool) return this.pool;
    this.pool = createAuthPool();
    return this.pool;
  }
}
