import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import type { AuthUser } from './auth-user.interface.js';
import { createAuthPool, type PgPool } from './auth-database.js';
import type {
  ListQuery,
  PromptSnippetResponse,
  UserPreferenceContext,
  UserPreferenceResponse,
  UserTemplateResponse,
} from './user-preferences.types.js';

interface PreferenceInput {
  defaultReportType?: unknown;
  defaultRegion?: unknown;
  defaultLanguage?: unknown;
  writingStyle?: unknown;
  tone?: unknown;
  defaultSourceOptions?: unknown;
  defaultOutlineOptions?: unknown;
  preferenceJson?: unknown;
}

interface TemplateInput {
  templateName?: unknown;
  templateType?: unknown;
  description?: unknown;
  templateJson?: unknown;
  isDefault?: unknown;
  isShared?: unknown;
}

interface SnippetInput {
  snippetName?: unknown;
  snippetType?: unknown;
  content?: unknown;
  tags?: unknown;
}

@Injectable()
export class UserPreferencesService implements OnModuleDestroy {
  private pool: PgPool | null = null;

  async onModuleDestroy() {
    if (this.pool) await this.pool.end();
  }

  async getMyPreferences(user: AuthUser): Promise<UserPreferenceResponse> {
    const pool = await this.getPool();
    const result = await pool.query(
      `SELECT preference_id, owner_id, default_report_type, default_region, default_language,
              writing_style, tone, default_source_options, default_outline_options,
              preference_json, created_at, updated_at
         FROM user_preferences
        WHERE owner_id = $1
        LIMIT 1`,
      [user.id],
    );
    return result.rows[0] ? this.toPreference(result.rows[0]) : this.defaultPreference(user.id);
  }

  async updateMyPreferences(user: AuthUser, input: PreferenceInput): Promise<UserPreferenceResponse> {
    const value = this.normalizePreferenceInput(input);
    const pool = await this.getPool();
    const result = await pool.query(
      `INSERT INTO user_preferences (
         owner_id, default_report_type, default_region, default_language, writing_style,
         tone, default_source_options, default_outline_options, preference_json
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)
       ON CONFLICT (owner_id) DO UPDATE
       SET default_report_type = EXCLUDED.default_report_type,
           default_region = EXCLUDED.default_region,
           default_language = EXCLUDED.default_language,
           writing_style = EXCLUDED.writing_style,
           tone = EXCLUDED.tone,
           default_source_options = EXCLUDED.default_source_options,
           default_outline_options = EXCLUDED.default_outline_options,
           preference_json = EXCLUDED.preference_json,
           updated_at = now()
       RETURNING preference_id, owner_id, default_report_type, default_region, default_language,
                 writing_style, tone, default_source_options, default_outline_options,
                 preference_json, created_at, updated_at`,
      [
        user.id,
        value.defaultReportType,
        value.defaultRegion,
        value.defaultLanguage,
        value.writingStyle,
        value.tone,
        JSON.stringify(value.defaultSourceOptions),
        JSON.stringify(value.defaultOutlineOptions),
        JSON.stringify(value.preferenceJson),
      ],
    );
    return this.toPreference(result.rows[0]);
  }

  async listTemplates(user: AuthUser, query: ListQuery): Promise<{ items: UserTemplateResponse[]; total: number; page: number; pageSize: number }> {
    const page = this.positiveInt(query.page, 1);
    const pageSize = Math.min(this.positiveInt(query.pageSize, 50), 100);
    const params: unknown[] = [];
    const where: string[] = [];
    if (this.isAdmin(user) && query.ownerId) {
      params.push(String(query.ownerId));
      where.push(`owner_id = $${params.length}`);
    } else if (!this.isAdmin(user)) {
      params.push(user.id);
      where.push(`(owner_id = $${params.length} OR is_shared = true)`);
    }
    if (query.templateType) {
      params.push(String(query.templateType).trim());
      where.push(`template_type = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const count = await (await this.getPool()).query(`SELECT COUNT(*) AS count FROM user_report_templates ${whereSql}`, params);
    params.push(pageSize, (page - 1) * pageSize);
    const result = await (await this.getPool()).query(
      `SELECT template_id, owner_id, template_name, template_type, description,
              template_json, is_default, is_shared, created_at, updated_at
         FROM user_report_templates
         ${whereSql}
        ORDER BY updated_at DESC, created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      items: result.rows.map((row) => this.toTemplate(row)),
      total: Number(count.rows[0]?.count || 0),
      page,
      pageSize,
    };
  }

  async createTemplate(user: AuthUser, input: TemplateInput): Promise<UserTemplateResponse> {
    const value = this.normalizeTemplateInput(input, true);
    const pool = await this.getPool();
    await pool.query('BEGIN');
    try {
      if (value.isDefault) await this.clearDefaultTemplates(user.id, value.templateType);
      const result = await pool.query(
        `INSERT INTO user_report_templates (
           owner_id, template_name, template_type, description, template_json, is_default, is_shared
         )
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         RETURNING template_id, owner_id, template_name, template_type, description,
                   template_json, is_default, is_shared, created_at, updated_at`,
        [user.id, value.templateName, value.templateType, value.description, JSON.stringify(value.templateJson), value.isDefault, value.isShared],
      );
      await pool.query('COMMIT');
      return this.toTemplate(result.rows[0]);
    } catch (error) {
      await this.rollbackQuietly(pool);
      throw error;
    }
  }

  async updateTemplate(user: AuthUser, templateId: string, input: TemplateInput): Promise<UserTemplateResponse> {
    const existing = await this.getTemplateForAccess(user, templateId, true);
    const value = this.normalizeTemplateInput(input, false, existing);
    const pool = await this.getPool();
    await pool.query('BEGIN');
    try {
      if (value.isDefault) await this.clearDefaultTemplates(String(existing.owner_id), value.templateType, templateId);
      const result = await pool.query(
        `UPDATE user_report_templates
            SET template_name = $1,
                template_type = $2,
                description = $3,
                template_json = $4::jsonb,
                is_default = $5,
                is_shared = $6,
                updated_at = now()
          WHERE template_id = $7
          RETURNING template_id, owner_id, template_name, template_type, description,
                    template_json, is_default, is_shared, created_at, updated_at`,
        [value.templateName, value.templateType, value.description, JSON.stringify(value.templateJson), value.isDefault, value.isShared, templateId],
      );
      await pool.query('COMMIT');
      return this.toTemplate(result.rows[0]);
    } catch (error) {
      await this.rollbackQuietly(pool);
      throw error;
    }
  }

  async deleteTemplate(user: AuthUser, templateId: string): Promise<{ templateId: string; deleted: true }> {
    await this.getTemplateForAccess(user, templateId, true);
    const pool = await this.getPool();
    await pool.query('DELETE FROM user_report_templates WHERE template_id = $1', [templateId]);
    return { templateId, deleted: true };
  }

  async applyTemplate(user: AuthUser, templateId: string): Promise<{ templateId: string; templateJson: Record<string, unknown>; appliedOptions: Record<string, unknown> }> {
    const row = await this.getTemplateForAccess(user, templateId, false);
    const template = this.toTemplate(row);
    return {
      templateId: template.templateId,
      templateJson: template.templateJson,
      appliedOptions: {
        templateType: template.templateType,
        writingConstraints: Array.isArray(template.templateJson.writingConstraints) ? template.templateJson.writingConstraints : [],
        sourceRequirements: Array.isArray(template.templateJson.sourceRequirements) ? template.templateJson.sourceRequirements : [],
      },
    };
  }

  async listPromptSnippets(user: AuthUser, query: ListQuery): Promise<{ items: PromptSnippetResponse[]; total: number; page: number; pageSize: number }> {
    const page = this.positiveInt(query.page, 1);
    const pageSize = Math.min(this.positiveInt(query.pageSize, 50), 100);
    const params: unknown[] = [user.id];
    const where = ['owner_id = $1'];
    if (query.snippetType) {
      params.push(String(query.snippetType).trim());
      where.push(`snippet_type = $${params.length}`);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const count = await (await this.getPool()).query(`SELECT COUNT(*) AS count FROM user_prompt_snippets ${whereSql}`, params);
    params.push(pageSize, (page - 1) * pageSize);
    const result = await (await this.getPool()).query(
      `SELECT snippet_id, owner_id, snippet_name, snippet_type, content, tags,
              usage_count, created_at, updated_at
         FROM user_prompt_snippets
         ${whereSql}
        ORDER BY updated_at DESC, created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: result.rows.map((row) => this.toSnippet(row)), total: Number(count.rows[0]?.count || 0), page, pageSize };
  }

  async createPromptSnippet(user: AuthUser, input: SnippetInput): Promise<PromptSnippetResponse> {
    const value = this.normalizeSnippetInput(input, true);
    const result = await (await this.getPool()).query(
      `INSERT INTO user_prompt_snippets (owner_id, snippet_name, snippet_type, content, tags)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING snippet_id, owner_id, snippet_name, snippet_type, content, tags,
                 usage_count, created_at, updated_at`,
      [user.id, value.snippetName, value.snippetType, value.content, JSON.stringify(value.tags)],
    );
    return this.toSnippet(result.rows[0]);
  }

  async updatePromptSnippet(user: AuthUser, snippetId: string, input: SnippetInput): Promise<PromptSnippetResponse> {
    const existing = await this.getSnippetForAccess(user, snippetId);
    const value = this.normalizeSnippetInput(input, false, existing);
    const result = await (await this.getPool()).query(
      `UPDATE user_prompt_snippets
          SET snippet_name = $1,
              snippet_type = $2,
              content = $3,
              tags = $4::jsonb,
              updated_at = now()
        WHERE snippet_id = $5
        RETURNING snippet_id, owner_id, snippet_name, snippet_type, content, tags,
                  usage_count, created_at, updated_at`,
      [value.snippetName, value.snippetType, value.content, JSON.stringify(value.tags), snippetId],
    );
    return this.toSnippet(result.rows[0]);
  }

  async deletePromptSnippet(user: AuthUser, snippetId: string): Promise<{ snippetId: string; deleted: true }> {
    await this.getSnippetForAccess(user, snippetId);
    await (await this.getPool()).query('DELETE FROM user_prompt_snippets WHERE snippet_id = $1', [snippetId]);
    return { snippetId, deleted: true };
  }

  async buildUserPreferenceContext(user: AuthUser, templateId?: string): Promise<UserPreferenceContext> {
    const preferences = await this.getMyPreferences(user);
    const template = templateId
      ? this.templateToContext(await this.getTemplateForAccess(user, templateId, false))
      : await this.loadDefaultTemplateContext(user.id);
    const snippets = await this.listPromptSnippets(user, { pageSize: 20 });
    return {
      ownerId: user.id,
      preferences: this.preferenceToContext(preferences),
      template,
      promptSnippets: snippets.items.map((item) => ({
        snippetId: item.snippetId,
        snippetName: item.snippetName,
        snippetType: item.snippetType,
        content: item.content,
        tags: item.tags,
      })),
    };
  }

  private async getTemplateForAccess(user: AuthUser, templateId: string, write: boolean): Promise<Record<string, unknown>> {
    const result = await (await this.getPool()).query(
      `SELECT template_id, owner_id, template_name, template_type, description,
              template_json, is_default, is_shared, created_at, updated_at
         FROM user_report_templates
        WHERE template_id = $1
        LIMIT 1`,
      [String(templateId || '').trim()],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException({ error: 'Template not found' });
    const owns = String(row.owner_id) === user.id;
    if (this.isAdmin(user)) return row;
    if (!write && (owns || row.is_shared === true)) return row;
    if (write && owns) return row;
    throw new NotFoundException({ error: 'Template not found' });
  }

  private async getSnippetForAccess(user: AuthUser, snippetId: string): Promise<Record<string, unknown>> {
    const result = await (await this.getPool()).query(
      `SELECT snippet_id, owner_id, snippet_name, snippet_type, content, tags,
              usage_count, created_at, updated_at
         FROM user_prompt_snippets
        WHERE snippet_id = $1
        LIMIT 1`,
      [String(snippetId || '').trim()],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException({ error: 'Prompt snippet not found' });
    if (String(row.owner_id) !== user.id && !this.isAdmin(user)) throw new NotFoundException({ error: 'Prompt snippet not found' });
    return row;
  }

  private async clearDefaultTemplates(ownerId: string, templateType: string | null, exceptTemplateId?: string): Promise<void> {
    const params: unknown[] = [ownerId, templateType];
    let exceptSql = '';
    if (exceptTemplateId) {
      params.push(exceptTemplateId);
      exceptSql = `AND template_id <> $${params.length}`;
    }
    await (await this.getPool()).query(
      `UPDATE user_report_templates
          SET is_default = false, updated_at = now()
        WHERE owner_id = $1
          AND COALESCE(template_type, '') = COALESCE($2, '')
          ${exceptSql}`,
      params,
    );
  }

  private async loadDefaultTemplateContext(ownerId: string): Promise<Record<string, unknown> | null> {
    const result = await (await this.getPool()).query(
      `SELECT template_id, owner_id, template_name, template_type, description,
              template_json, is_default, is_shared, created_at, updated_at
         FROM user_report_templates
        WHERE owner_id = $1 AND is_default = true
        ORDER BY updated_at DESC
        LIMIT 1`,
      [ownerId],
    );
    return result.rows[0] ? this.templateToContext(result.rows[0]) : null;
  }

  private templateToContext(row: Record<string, unknown>): Record<string, unknown> {
    const template = this.toTemplate(row);
    return {
      templateId: template.templateId,
      templateName: template.templateName,
      templateType: template.templateType,
      description: template.description,
      templateJson: template.templateJson,
      isDefault: template.isDefault,
    };
  }

  private preferenceToContext(preference: UserPreferenceResponse): Record<string, unknown> {
    return {
      defaultReportType: preference.defaultReportType,
      defaultRegion: preference.defaultRegion,
      defaultLanguage: preference.defaultLanguage,
      writingStyle: preference.writingStyle,
      tone: preference.tone,
      defaultSourceOptions: preference.defaultSourceOptions,
      defaultOutlineOptions: preference.defaultOutlineOptions,
      preferenceJson: preference.preferenceJson,
    };
  }

  private normalizePreferenceInput(input: PreferenceInput) {
    return {
      defaultReportType: this.optionalText(input.defaultReportType, 128),
      defaultRegion: this.optionalText(input.defaultRegion, 128),
      defaultLanguage: this.optionalText(input.defaultLanguage, 32) || 'zh-CN',
      writingStyle: this.optionalText(input.writingStyle, 128),
      tone: this.optionalText(input.tone, 128),
      defaultSourceOptions: this.jsonObject(input.defaultSourceOptions, 'defaultSourceOptions'),
      defaultOutlineOptions: this.jsonObject(input.defaultOutlineOptions, 'defaultOutlineOptions'),
      preferenceJson: this.jsonObject(input.preferenceJson, 'preferenceJson'),
    };
  }

  private normalizeTemplateInput(input: TemplateInput, requireName: boolean, existing?: Record<string, unknown>) {
    const name = Object.prototype.hasOwnProperty.call(input, 'templateName')
      ? this.requiredText(input.templateName, 'templateName', 255)
      : String(existing?.template_name || '');
    if (requireName && !name) throw new BadRequestException({ error: 'templateName is required' });
    const templateJson = Object.prototype.hasOwnProperty.call(input, 'templateJson')
      ? this.jsonObject(input.templateJson, 'templateJson')
      : this.jsonObject(existing?.template_json || {}, 'templateJson');
    return {
      templateName: name,
      templateType: Object.prototype.hasOwnProperty.call(input, 'templateType') ? this.optionalText(input.templateType, 128) : this.optionalText(existing?.template_type, 128),
      description: Object.prototype.hasOwnProperty.call(input, 'description') ? this.optionalText(input.description, 10000) || '' : String(existing?.description || ''),
      templateJson,
      isDefault: Object.prototype.hasOwnProperty.call(input, 'isDefault') ? input.isDefault === true : existing?.is_default === true,
      isShared: Object.prototype.hasOwnProperty.call(input, 'isShared') ? input.isShared === true : existing?.is_shared === true,
    };
  }

  private normalizeSnippetInput(input: SnippetInput, requireName: boolean, existing?: Record<string, unknown>) {
    const name = Object.prototype.hasOwnProperty.call(input, 'snippetName')
      ? this.requiredText(input.snippetName, 'snippetName', 255)
      : String(existing?.snippet_name || '');
    if (requireName && !name) throw new BadRequestException({ error: 'snippetName is required' });
    const content = Object.prototype.hasOwnProperty.call(input, 'content')
      ? this.requiredText(input.content, 'content', 20000)
      : String(existing?.content || '');
    return {
      snippetName: name,
      snippetType: Object.prototype.hasOwnProperty.call(input, 'snippetType') ? this.optionalText(input.snippetType, 128) : this.optionalText(existing?.snippet_type, 128),
      content,
      tags: Object.prototype.hasOwnProperty.call(input, 'tags') ? this.stringArray(input.tags, 'tags') : this.stringArray(existing?.tags || [], 'tags'),
    };
  }

  private toPreference(row: Record<string, unknown>): UserPreferenceResponse {
    return {
      preferenceId: row.preference_id ? String(row.preference_id) : null,
      ownerId: String(row.owner_id || ''),
      defaultReportType: row.default_report_type ? String(row.default_report_type) : null,
      defaultRegion: row.default_region ? String(row.default_region) : null,
      defaultLanguage: String(row.default_language || 'zh-CN'),
      writingStyle: row.writing_style ? String(row.writing_style) : null,
      tone: row.tone ? String(row.tone) : null,
      defaultSourceOptions: this.jsonObject(row.default_source_options || {}, 'defaultSourceOptions'),
      defaultOutlineOptions: this.jsonObject(row.default_outline_options || {}, 'defaultOutlineOptions'),
      preferenceJson: this.jsonObject(row.preference_json || {}, 'preferenceJson'),
      createdAt: this.isoString(row.created_at),
      updatedAt: this.isoString(row.updated_at),
    };
  }

  private toTemplate(row: Record<string, unknown>): UserTemplateResponse {
    return {
      templateId: String(row.template_id || ''),
      ownerId: String(row.owner_id || ''),
      templateName: String(row.template_name || ''),
      templateType: row.template_type ? String(row.template_type) : null,
      description: String(row.description || ''),
      templateJson: this.jsonObject(row.template_json || {}, 'templateJson'),
      isDefault: row.is_default === true || String(row.is_default).toLowerCase() === 'true',
      isShared: row.is_shared === true || String(row.is_shared).toLowerCase() === 'true',
      createdAt: this.isoString(row.created_at),
      updatedAt: this.isoString(row.updated_at),
    };
  }

  private toSnippet(row: Record<string, unknown>): PromptSnippetResponse {
    return {
      snippetId: String(row.snippet_id || ''),
      ownerId: String(row.owner_id || ''),
      snippetName: String(row.snippet_name || ''),
      snippetType: row.snippet_type ? String(row.snippet_type) : null,
      content: String(row.content || ''),
      tags: this.stringArray(row.tags || [], 'tags'),
      usageCount: Number(row.usage_count || 0),
      createdAt: this.isoString(row.created_at),
      updatedAt: this.isoString(row.updated_at),
    };
  }

  private defaultPreference(ownerId: string): UserPreferenceResponse {
    return {
      preferenceId: null,
      ownerId,
      defaultReportType: null,
      defaultRegion: null,
      defaultLanguage: 'zh-CN',
      writingStyle: null,
      tone: null,
      defaultSourceOptions: {},
      defaultOutlineOptions: {},
      preferenceJson: {},
      createdAt: null,
      updatedAt: null,
    };
  }

  private isAdmin(user: AuthUser): boolean {
    return user.role === 'admin' || user.roles?.includes('admin');
  }

  private optionalText(value: unknown, max: number): string | null {
    const text = String(value ?? '').trim();
    return text ? text.slice(0, max) : null;
  }

  private requiredText(value: unknown, field: string, max: number): string {
    const text = String(value ?? '').trim();
    if (!text) throw new BadRequestException({ error: `${field} is required` });
    return text.slice(0, max);
  }

  private jsonObject(value: unknown, field: string): Record<string, unknown> {
    if (value === undefined || value === null || value === '') return {};
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
      } catch {
        throw new BadRequestException({ error: `${field} must be a JSON object` });
      }
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    throw new BadRequestException({ error: `${field} must be an object` });
  }

  private stringArray(value: unknown, field: string): string[] {
    if (typeof value === 'string') {
      try {
        return this.stringArray(JSON.parse(value), field);
      } catch {
        throw new BadRequestException({ error: `${field} must be an array` });
      }
    }
    if (!Array.isArray(value)) throw new BadRequestException({ error: `${field} must be an array` });
    return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean))).slice(0, 50);
  }

  private positiveInt(value: unknown, fallback: number): number {
    const parsed = Number(value || fallback);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  }

  private isoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }

  private async rollbackQuietly(pool: PgPool): Promise<void> {
    try {
      await pool.query('ROLLBACK');
    } catch {
      // Ignore rollback failures so the original error is preserved.
    }
  }

  private async getPool(): Promise<PgPool> {
    if (this.pool) return this.pool;
    this.pool = createAuthPool();
    return this.pool;
  }
}
