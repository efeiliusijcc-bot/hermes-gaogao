import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { HERMES_QA_ARTIFACT_DIR } from './config.js';
import type { AuthUser } from './auth-user.interface.js';
import { RemoteFileService } from './remote-file.service.js';
import { createAuthPool, type PgPool } from './auth-database.js';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface QaSessionSourcesRecord {
  sessionId: string;
  updatedAt: string | null;
  sourceCount: number;
  sources: Record<string, JsonValue>[];
}

export interface QaSessionSummary {
  sessionId: string;
  ownerUserId: string;
  ownerUsername: string | null;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

interface UpsertSourcesInput {
  sources?: unknown;
  merge?: boolean;
}

interface ChatSessionOwner {
  sessionId: string;
  ownerUserId: string;
  ownerUsername: string | null;
}

const MAX_SESSION_ID_LENGTH = 120;
const MAX_SOURCES = 100;
const MAX_STRING_LENGTH = 2000;
const MAX_OBJECT_KEYS = 80;
const MAX_ARRAY_ITEMS = 50;
const MAX_DEPTH = 4;

@Injectable()
export class QaSessionSourcesService implements OnModuleDestroy {
  private pool: PgPool | null = null;

  constructor(private readonly remoteFs: RemoteFileService) {}

  async onModuleDestroy() {
    if (this.pool) await this.pool.end();
  }

  async listSessions(user: AuthUser): Promise<{ items: QaSessionSummary[] }> {
    const pool = await this.getPool();
    const params: unknown[] = [];
    const where = user.role === 'admin' ? '' : 'WHERE owner_id = $1';
    if (user.role !== 'admin') params.push(user.id);
    const result = await pool.query(
      `SELECT session_id, owner_id, owner_username, title, created_at, updated_at
         FROM chat_sessions
         ${where}
        ORDER BY updated_at DESC
        LIMIT 100`,
      params,
    );
    return { items: result.rows.map((row) => this.toSessionSummary(row)) };
  }

  async getSources(sessionId: string, user: AuthUser): Promise<QaSessionSourcesRecord> {
    const safeSessionId = this.safeSessionId(sessionId);
    const owner = await this.assertCanAccessSession(safeSessionId, user, { allowAdminLegacy: true });
    if (!owner) {
      const legacyPath = this.legacySourcesFilePath(safeSessionId);
      if (user.role === 'admin' && await this.remoteFs.exists(legacyPath)) return this.readSourcesFile(safeSessionId, legacyPath);
      throw new NotFoundException({ error: 'Chat session not found' });
    }
    const filePath = this.sourcesFilePath(owner.ownerUserId, safeSessionId);
    const exists = await this.remoteFs.exists(filePath);
    if (!exists) return this.emptyRecord(safeSessionId);

    return this.readSourcesFile(safeSessionId, filePath);
  }

  async upsertSources(sessionId: string, input: UpsertSourcesInput, user: AuthUser): Promise<QaSessionSourcesRecord> {
    const safeSessionId = this.safeSessionId(sessionId);
    const owner = await this.ensureSessionOwner(safeSessionId, user);
    const incoming = this.normalizeSources(input.sources);
    const merge = input.merge !== false;
    const current = merge ? await this.getSources(safeSessionId, user) : this.emptyRecord(safeSessionId);
    const sources = this.dedupeSources([...(merge ? current.sources : []), ...incoming]).slice(0, MAX_SOURCES);
    const record: QaSessionSourcesRecord = {
      sessionId: safeSessionId,
      updatedAt: new Date().toISOString(),
      sourceCount: sources.length,
      sources,
    };

    const dirPath = this.sessionDirPath(owner.ownerUserId, safeSessionId);
    await this.remoteFs.mkdir(dirPath);
    await this.remoteFs.writeFile(this.sourcesFilePath(owner.ownerUserId, safeSessionId), `${JSON.stringify(record, null, 2)}\n`);
    return record;
  }

  async ensureSessionOwner(sessionId: string, user: AuthUser, title = ''): Promise<ChatSessionOwner> {
    const safeSessionId = this.safeSessionId(sessionId);
    const existing = await this.findSessionOwner(safeSessionId);
    if (existing) {
      this.assertOwner(existing, user);
      await this.touchSession(safeSessionId, title);
      return existing;
    }

    const pool = await this.getPool();
    try {
      await pool.query(
        `INSERT INTO chat_sessions (session_id, owner_id, owner_username, title, created_at, updated_at)
         VALUES ($1, $2, $3, $4, now(), now())`,
        [safeSessionId, user.id, user.username, title.slice(0, 256) || null],
      );
    } catch (error) {
      const raced = await this.findSessionOwner(safeSessionId);
      if (raced) {
        this.assertOwner(raced, user);
        return raced;
      }
      throw error;
    }
    return { sessionId: safeSessionId, ownerUserId: user.id, ownerUsername: user.username };
  }

  async assertCanAccessSession(sessionId: string, user: AuthUser, options: { allowAdminLegacy?: boolean } = {}): Promise<ChatSessionOwner | null> {
    const safeSessionId = this.safeSessionId(sessionId);
    const owner = await this.findSessionOwner(safeSessionId);
    if (!owner) {
      if (options.allowAdminLegacy && user.role === 'admin') return null;
      throw new NotFoundException({ error: 'Chat session not found' });
    }
    this.assertOwner(owner, user);
    return owner;
  }

  private async readSourcesFile(sessionId: string, filePath: string): Promise<QaSessionSourcesRecord> {
    try {
      const parsed = JSON.parse(await this.remoteFs.readFile(filePath)) as Partial<QaSessionSourcesRecord>;
      const sources = Array.isArray(parsed.sources) ? this.normalizeSources(parsed.sources) : [];
      const updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null;
      return {
        sessionId,
        updatedAt,
        sourceCount: sources.length,
        sources,
      };
    } catch {
      return this.emptyRecord(sessionId);
    }
  }

  private safeSessionId(sessionId: string): string {
    const safe = String(sessionId || '')
      .trim()
      .replace(/[^a-zA-Z0-9_.:-]/g, '_')
      .slice(0, MAX_SESSION_ID_LENGTH);
    if (!safe || safe === '.' || safe === '..') throw new BadRequestException({ error: 'sessionId is required' });
    return safe;
  }

  private safeOwnerId(ownerUserId: string): string {
    const safe = String(ownerUserId || '').trim().replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 80);
    if (!safe || safe === '.' || safe === '..') throw new BadRequestException({ error: 'ownerUserId is required' });
    return safe;
  }

  private sessionDirPath(ownerUserId: string, safeSessionId: string): string {
    return this.remoteFs.joinPath(HERMES_QA_ARTIFACT_DIR, this.safeOwnerId(ownerUserId), safeSessionId);
  }

  private sourcesFilePath(ownerUserId: string, safeSessionId: string): string {
    return this.remoteFs.joinPath(this.sessionDirPath(ownerUserId, safeSessionId), 'sources.json');
  }

  private legacySourcesFilePath(safeSessionId: string): string {
    return this.remoteFs.joinPath(HERMES_QA_ARTIFACT_DIR, safeSessionId, 'sources.json');
  }

  private emptyRecord(sessionId: string): QaSessionSourcesRecord {
    return {
      sessionId,
      updatedAt: null,
      sourceCount: 0,
      sources: [],
    };
  }

  private toSessionSummary(row: Record<string, unknown>): QaSessionSummary {
    return {
      sessionId: String(row.session_id || ''),
      ownerUserId: String(row.owner_id || ''),
      ownerUsername: row.owner_username ? String(row.owner_username) : null,
      title: row.title ? String(row.title) : null,
      createdAt: this.dateString(row.created_at),
      updatedAt: this.dateString(row.updated_at),
    };
  }

  private dateString(value: unknown): string {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }

  private normalizeSources(value: unknown): Record<string, JsonValue>[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => this.sanitizeSource(item))
      .filter((item): item is Record<string, JsonValue> => item !== null)
      .slice(0, MAX_SOURCES);
  }

  private sanitizeSource(value: unknown): Record<string, JsonValue> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const sanitized = this.sanitizeJson(value, 0);
    if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) return null;
    return sanitized;
  }

  private sanitizeJson(value: unknown, depth: number): JsonValue | undefined {
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.slice(0, MAX_STRING_LENGTH);
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (depth >= MAX_DEPTH) return undefined;

    if (Array.isArray(value)) {
      const items = value
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item) => this.sanitizeJson(item, depth + 1))
        .filter((item): item is JsonValue => item !== undefined);
      return items;
    }

    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS);
      const result: Record<string, JsonValue> = {};
      for (const [key, item] of entries) {
        const safeKey = key.slice(0, 120);
        const sanitized = this.sanitizeJson(item, depth + 1);
        if (safeKey && sanitized !== undefined) result[safeKey] = sanitized;
      }
      return result;
    }

    return undefined;
  }

  private dedupeSources(sources: Record<string, JsonValue>[]): Record<string, JsonValue>[] {
    const seen = new Set<string>();
    const result: Record<string, JsonValue>[] = [];

    for (const source of sources) {
      const key = this.sourceDedupeKey(source);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(source);
    }

    return result;
  }

  private sourceDedupeKey(source: Record<string, JsonValue>): string {
    const url = this.firstString(source, ['url', 'source_url', 'data_source_url']);
    if (url) return `url:${url}`;

    const title = this.firstString(source, ['title', 'ch_title', 'headline', 'sourceTitle']);
    const publisher = this.firstString(source, ['publisher', 'website_name', 'source_name', 'site_name']);
    const fallback = JSON.stringify(source).slice(0, 300);
    return `meta:${title}|${publisher}|${fallback}`;
  }

  private firstString(source: Record<string, JsonValue>, keys: string[]): string {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) return value.trim().toLowerCase();
    }
    return '';
  }

  private assertOwner(owner: ChatSessionOwner, user: AuthUser): void {
    if (user.role === 'admin' || owner.ownerUserId === user.id) return;
    throw new ForbiddenException({ error: 'Insufficient chat session permissions' });
  }

  private async findSessionOwner(sessionId: string): Promise<ChatSessionOwner | null> {
    const pool = await this.getPool();
    const result = await pool.query(
      `SELECT session_id, owner_id, owner_username
         FROM chat_sessions
        WHERE session_id = $1
        LIMIT 1`,
      [sessionId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      sessionId: String(row.session_id || ''),
      ownerUserId: String(row.owner_id || ''),
      ownerUsername: row.owner_username ? String(row.owner_username) : null,
    };
  }

  private async touchSession(sessionId: string, title = ''): Promise<void> {
    const pool = await this.getPool();
    await pool.query(
      `UPDATE chat_sessions
          SET updated_at = now(),
              title = COALESCE(NULLIF($2, ''), title)
        WHERE session_id = $1`,
      [sessionId, title.slice(0, 256)],
    );
  }

  private async getPool(): Promise<PgPool> {
    if (this.pool) return this.pool;
    this.pool = createAuthPool();
    return this.pool;
  }
}
