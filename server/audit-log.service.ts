import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from './auth-user.interface.js';
import { createAuthPool, type PgPool } from './auth-database.js';

export interface AuditLogEntry {
  actor?: AuthUser | null;
  actorId?: string | null;
  actorUsername?: string | null;
  action: string;
  resource?: string | null;
  resourceId?: string | null;
  result?: string;
  request?: Request;
  ipAddress?: string | null;
  userAgent?: string | null;
  detail?: Record<string, unknown>;
}

@Injectable()
export class AuditLogService implements OnModuleDestroy {
  private pool: PgPool | null = null;

  async onModuleDestroy() {
    if (this.pool) await this.pool.end();
  }

  async log(entry: AuditLogEntry): Promise<void> {
    try {
      const pool = await this.getPool();
      const actorId = entry.actorId ?? entry.actor?.id ?? null;
      const actorUsername = entry.actorUsername ?? entry.actor?.username ?? null;
      await pool.query(
        `INSERT INTO audit_logs
          (actor_id, actor_username, action, resource, resource_id, result, ip_address, user_agent, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
          actorId || null,
          actorUsername || null,
          entry.action,
          entry.resource || null,
          entry.resourceId || null,
          entry.result || 'success',
          entry.ipAddress || this.requestIp(entry.request) || null,
          entry.userAgent || this.requestUserAgent(entry.request) || null,
          JSON.stringify(this.sanitizeDetail(entry.detail || {})),
        ],
      );
    } catch {
      // Audit logging must never break primary application flows.
    }
  }

  private requestIp(request?: Request): string {
    if (!request) return '';
    const forwarded = request.headers['x-forwarded-for'];
    if (Array.isArray(forwarded)) return String(forwarded[0] || '').split(',')[0].trim();
    if (forwarded) return String(forwarded).split(',')[0].trim();
    return request.ip || request.socket?.remoteAddress || '';
  }

  private requestUserAgent(request?: Request): string {
    if (!request) return '';
    return String(request.headers['user-agent'] || '');
  }

  private sanitizeDetail(value: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value)) {
      if (/password|token|secret|key/i.test(key)) {
        sanitized[key] = '[redacted]';
      } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        sanitized[key] = this.sanitizeDetail(raw as Record<string, unknown>);
      } else {
        sanitized[key] = raw;
      }
    }
    return sanitized;
  }

  private async getPool(): Promise<PgPool> {
    if (this.pool) return this.pool;
    this.pool = createAuthPool();
    return this.pool;
  }
}
