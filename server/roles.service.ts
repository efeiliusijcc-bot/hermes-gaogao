import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { createAuthPool, type PgPool } from './auth-database.js';

export interface PermissionResponse {
  resource: string;
  action: string;
  permission: string;
  description: string;
}

export interface RoleResponse {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
}

interface CreateRoleInput {
  name?: string;
  description?: string;
  permissions?: unknown;
}

interface UpdateRoleInput {
  name?: string;
  description?: string;
  permissions?: unknown;
}

@Injectable()
export class RolesService implements OnModuleDestroy {
  private pool: PgPool | null = null;

  async onModuleDestroy() {
    if (this.pool) await this.pool.end();
  }

  async listRoles(): Promise<RoleResponse[]> {
    const pool = await this.getPool();
    const result = await pool.query(
      `SELECT r.id, r.name, r.description, r.is_system,
              COALESCE(
                array_agg(concat(p.resource, ':', p.action) ORDER BY p.resource, p.action)
                  FILTER (WHERE p.id IS NOT NULL),
                ARRAY[]::text[]
              ) AS permissions
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
         LEFT JOIN permissions p ON p.id = rp.permission_id
        GROUP BY r.id, r.name, r.description, r.is_system
        ORDER BY r.is_system DESC, r.name ASC`,
    );
    return result.rows.map((row) => this.toRoleResponse(row));
  }

  async listPermissions(): Promise<PermissionResponse[]> {
    const pool = await this.getPool();
    const result = await pool.query(
      `SELECT resource, action, description
         FROM permissions
        ORDER BY resource ASC, action ASC`,
    );
    return result.rows.map((row) => this.toPermissionResponse(row));
  }

  async createRole(input: CreateRoleInput): Promise<RoleResponse> {
    const name = this.normalizeRoleName(input.name);
    const description = this.normalizeDescription(input.description);
    const permissions = this.normalizePermissions(input.permissions);
    const pool = await this.getPool();

    try {
      await pool.query('BEGIN');
      const permissionRows = await this.resolvePermissionRows(permissions);
      const result = await pool.query(
        `INSERT INTO roles (name, description, is_system)
         VALUES ($1, $2, false)
         RETURNING id, name, description, is_system`,
        [name, description],
      );
      const role = result.rows[0];
      await this.replaceRolePermissions(String(role.id), permissionRows.map((row) => row.id));
      await pool.query('COMMIT');
      return this.toRoleResponse({ ...role, permissions });
    } catch (error) {
      await this.rollbackQuietly(pool);
      if (this.isUniqueViolation(error)) throw new ConflictException({ error: 'role name already exists' });
      throw error;
    }
  }

  async updateRole(id: string, input: UpdateRoleInput): Promise<RoleResponse> {
    const roleId = this.normalizeId(id);
    const pool = await this.getPool();

    try {
      await pool.query('BEGIN');
      const existing = await this.getRoleRow(roleId);
      const nextName = Object.prototype.hasOwnProperty.call(input, 'name')
        ? this.normalizeRoleName(input.name)
        : String(existing.name);
      if (existing.is_system === true && nextName !== existing.name) {
        throw new BadRequestException('System role name cannot be changed');
      }
      const nextDescription = Object.prototype.hasOwnProperty.call(input, 'description')
        ? this.normalizeDescription(input.description)
        : String(existing.description || '');
      const permissions = Object.prototype.hasOwnProperty.call(input, 'permissions')
        ? this.normalizePermissions(input.permissions)
        : await this.getRolePermissions(roleId);
      if (existing.name === 'admin' && permissions.length === 0) {
        throw new BadRequestException('Admin role permissions cannot be empty');
      }
      const permissionRows = await this.resolvePermissionRows(permissions);
      const result = await pool.query(
        `UPDATE roles
            SET name = $1, description = $2
          WHERE id = $3
          RETURNING id, name, description, is_system`,
        [nextName, nextDescription, roleId],
      );
      await this.replaceRolePermissions(roleId, permissionRows.map((row) => row.id));
      await pool.query('COMMIT');
      return this.toRoleResponse({ ...result.rows[0], permissions });
    } catch (error) {
      await this.rollbackQuietly(pool);
      if (this.isUniqueViolation(error)) throw new ConflictException({ error: 'role name already exists' });
      throw error;
    }
  }

  async deleteRole(id: string): Promise<{ id: string; deleted: true }> {
    const roleId = this.normalizeId(id);
    const pool = await this.getPool();
    await pool.query('BEGIN');
    try {
      const existing = await this.getRoleRow(roleId);
      if (existing.is_system === true) {
        throw new BadRequestException('System roles cannot be deleted');
      }
      const usage = await pool.query('SELECT 1 FROM user_roles WHERE role_id = $1 LIMIT 1', [roleId]);
      if (usage.rows.length) {
        throw new BadRequestException('该角色仍有用户使用');
      }
      await pool.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
      await pool.query('DELETE FROM roles WHERE id = $1', [roleId]);
      await pool.query('COMMIT');
      return { id: roleId, deleted: true };
    } catch (error) {
      await this.rollbackQuietly(pool);
      throw error;
    }
  }

  private async getRoleRow(roleId: string): Promise<Record<string, unknown>> {
    const pool = await this.getPool();
    const result = await pool.query(
      `SELECT id, name, description, is_system
         FROM roles
        WHERE id = $1
        LIMIT 1`,
      [roleId],
    );
    if (!result.rows[0]) throw new NotFoundException({ error: 'Role not found' });
    return result.rows[0];
  }

  private async getRolePermissions(roleId: string): Promise<string[]> {
    const pool = await this.getPool();
    const result = await pool.query(
      `SELECT p.resource, p.action
         FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = $1
        ORDER BY p.resource ASC, p.action ASC`,
      [roleId],
    );
    return result.rows.map((row) => `${String(row.resource)}:${String(row.action)}`);
  }

  private async resolvePermissionRows(permissions: string[]): Promise<Array<{ id: string; permission: string }>> {
    if (!permissions.length) return [];
    const pool = await this.getPool();
    const pairs = permissions.map((permission) => {
      const [resource, action] = permission.split(':');
      return { resource, action, permission };
    });
    const result = await pool.query(
      `SELECT id, resource, action
         FROM permissions
        WHERE concat(resource, ':', action) = ANY($1::text[])`,
      [permissions],
    );
    const rows = result.rows.map((row) => ({
      id: String(row.id),
      permission: `${String(row.resource)}:${String(row.action)}`,
    }));
    const found = new Set(rows.map((row) => row.permission));
    const missing = pairs.map((pair) => pair.permission).filter((permission) => !found.has(permission));
    if (missing.length) {
      throw new BadRequestException({ error: `Unknown permissions: ${missing.join(', ')}` });
    }
    return rows;
  }

  private async replaceRolePermissions(roleId: string, permissionIds: string[]): Promise<void> {
    const pool = await this.getPool();
    await pool.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    for (const permissionId of permissionIds) {
      await pool.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [roleId, permissionId],
      );
    }
  }

  private toRoleResponse(row: Record<string, unknown>): RoleResponse {
    const rawPermissions = Array.isArray(row.permissions) ? row.permissions : [];
    return {
      id: String(row.id || ''),
      name: String(row.name || ''),
      description: String(row.description || ''),
      isSystem: row.is_system === true || String(row.is_system).toLowerCase() === 'true',
      permissions: rawPermissions.map((permission) => String(permission)).filter(Boolean),
    };
  }

  private toPermissionResponse(row: Record<string, unknown>): PermissionResponse {
    const resource = String(row.resource || '');
    const action = String(row.action || '');
    return {
      resource,
      action,
      permission: `${resource}:${action}`,
      description: String(row.description || ''),
    };
  }

  private normalizeRoleName(value: unknown): string {
    const name = String(value || '').trim();
    if (!name) throw new BadRequestException({ error: 'role name is required' });
    if (name.length > 64) throw new BadRequestException({ error: 'role name is too long' });
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      throw new BadRequestException({ error: 'role name may only contain letters, numbers, underscores, and hyphens' });
    }
    return name;
  }

  private normalizeDescription(value: unknown): string {
    return String(value || '').trim();
  }

  private normalizePermissions(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)));
  }

  private normalizeId(id: string): string {
    const value = String(id || '').trim();
    if (!value) throw new BadRequestException({ error: 'id is required' });
    return value;
  }

  private isUniqueViolation(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === '23505');
  }

  private async rollbackQuietly(pool: PgPool): Promise<void> {
    try {
      await pool.query('ROLLBACK');
    } catch {
      // Ignore rollback failures; preserve the original error.
    }
  }

  private async getPool(): Promise<PgPool> {
    if (this.pool) return this.pool;
    this.pool = createAuthPool();
    return this.pool;
  }
}
