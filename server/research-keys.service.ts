import { Injectable } from '@nestjs/common';
import fs from 'fs/promises';
import path from 'path';
import { HERMES_STATE_DIR } from './config.js';

type ResearchKeyName = 'tavilyApiKey' | 'exaApiKey' | 'firecrawlApiKey' | 'openaiEmbeddingApiKey';
type ResearchKeyArrayName = `${ResearchKeyName}s`;

interface ResearchKeysFile {
  tavilyApiKey?: string;
  tavilyApiKeys?: string[];
  exaApiKey?: string;
  exaApiKeys?: string[];
  firecrawlApiKey?: string;
  firecrawlApiKeys?: string[];
  openaiEmbeddingApiKey?: string;
  openaiEmbeddingApiKeys?: string[];
  updatedAt?: string;
}

export interface ResearchKeysStatus {
  tavilyApiKey: { configured: boolean; configuredCount: number };
  exaApiKey: { configured: boolean; configuredCount: number };
  firecrawlApiKey: { configured: boolean; configuredCount: number };
  openaiEmbeddingApiKey: { configured: boolean; configuredCount: number };
  updatedAt: string | null;
}

export interface UpdateResearchKeysInput {
  tavilyApiKey?: string | string[] | null;
  tavilyApiKeys?: string | string[] | null;
  exaApiKey?: string | string[] | null;
  exaApiKeys?: string | string[] | null;
  firecrawlApiKey?: string | string[] | null;
  firecrawlApiKeys?: string | string[] | null;
  openaiEmbeddingApiKey?: string | string[] | null;
  openaiEmbeddingApiKeys?: string | string[] | null;
}

const CONFIG_DIR = path.join(HERMES_STATE_DIR, 'workspace', 'report-agent', 'config');
const KEYS_JSON_PATH = path.join(CONFIG_DIR, 'research-keys.json');
const KEYS_ENV_PATH = path.join(CONFIG_DIR, 'research-keys.env');

const ENV_NAMES: Record<ResearchKeyName, string> = {
  tavilyApiKey: 'TAVILY_API_KEY',
  exaApiKey: 'EXA_API_KEY',
  firecrawlApiKey: 'FIRECRAWL_API_KEY',
  openaiEmbeddingApiKey: 'OPENAI_API_KEY',
};

const ENV_LIST_NAMES: Record<ResearchKeyName, string> = {
  tavilyApiKey: 'TAVILY_API_KEYS',
  exaApiKey: 'EXA_API_KEYS',
  firecrawlApiKey: 'FIRECRAWL_API_KEYS',
  openaiEmbeddingApiKey: 'OPENAI_API_KEYS',
};

const ARRAY_NAMES: Record<ResearchKeyName, ResearchKeyArrayName> = {
  tavilyApiKey: 'tavilyApiKeys',
  exaApiKey: 'exaApiKeys',
  firecrawlApiKey: 'firecrawlApiKeys',
  openaiEmbeddingApiKey: 'openaiEmbeddingApiKeys',
};

const FAILOVER_ERROR_PATTERN = /429|quota|insufficient_quota|rate.?limit|too many requests|billing|credit|balance|exhausted|额度|余额|欠费|限流/i;

@Injectable()
export class ResearchKeysService {
  async getStatus(): Promise<ResearchKeysStatus> {
    return this.toStatus(await this.readKeys());
  }

  async updateKeys(input: UpdateResearchKeysInput): Promise<ResearchKeysStatus> {
    const current = await this.readKeys();
    const next: ResearchKeysFile = { ...current };
    let changed = false;

    for (const key of Object.keys(ENV_NAMES) as ResearchKeyName[]) {
      const arrayKey = ARRAY_NAMES[key];
      if (!Object.prototype.hasOwnProperty.call(input, key) && !Object.prototype.hasOwnProperty.call(input, arrayKey)) continue;
      const value = Object.prototype.hasOwnProperty.call(input, arrayKey) ? input[arrayKey] : input[key];
      if (value === null) {
        if (next[key] || next[arrayKey]?.length) changed = true;
        delete next[key];
        delete next[arrayKey];
      } else if (typeof value === 'string') {
        const values = this.parseKeyList(value);
        if (values.length) changed = this.applyKeyList(next, key, values) || changed;
      } else if (Array.isArray(value)) {
        const values = this.parseKeyList(value);
        if (values.length) changed = this.applyKeyList(next, key, values) || changed;
      }
    }

    if (changed) next.updatedAt = new Date().toISOString();
    await this.writeKeys(next);
    return this.toStatus(next);
  }

  async getEffectiveKey(name: ResearchKeyName): Promise<string> {
    return (await this.getEffectiveKeys(name))[0] || '';
  }

  async getEffectiveKeys(name: ResearchKeyName): Promise<string[]> {
    const keys = await this.readKeys();
    return this.resolveKeys(keys, name);
  }

  isFailoverError(error: unknown): boolean {
    if (!error) return false;
    const status = typeof error === 'object' && 'status' in error ? Number((error as { status?: unknown }).status) : 0;
    const message = error instanceof Error ? error.message : String(error);
    return status === 429 || FAILOVER_ERROR_PATTERN.test(message);
  }

  async withKeyFailover<T>(
    name: ResearchKeyName,
    handler: (apiKey: string, index: number) => Promise<T>,
  ): Promise<T> {
    const keys = await this.getEffectiveKeys(name);
    if (!keys.length) throw new Error(`${ENV_NAMES[name]} is not configured`);
    let lastError: unknown;
    for (let index = 0; index < keys.length; index += 1) {
      try {
        return await handler(keys[index], index);
      } catch (error) {
        lastError = error;
        if (index >= keys.length - 1 || !this.isFailoverError(error)) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError || 'All API keys failed'));
  }

  private async readKeys(): Promise<ResearchKeysFile> {
    try {
      const raw = await fs.readFile(KEYS_JSON_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as ResearchKeysFile;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private async writeKeys(keys: ResearchKeysFile): Promise<void> {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(KEYS_JSON_PATH, JSON.stringify(keys, null, 2), { encoding: 'utf-8', mode: 0o600 });
    await fs.writeFile(KEYS_ENV_PATH, this.toEnvFile(keys), { encoding: 'utf-8', mode: 0o600 });
    await Promise.allSettled([fs.chmod(KEYS_JSON_PATH, 0o600), fs.chmod(KEYS_ENV_PATH, 0o600)]);
  }

  private toEnvFile(keys: ResearchKeysFile): string {
    const lines = ['# Generated by gaogao-api. Do not commit this file.'];
    for (const key of Object.keys(ENV_NAMES) as ResearchKeyName[]) {
      const values = this.resolveKeys(keys, key, false);
      if (values[0]) lines.push(`export ${ENV_NAMES[key]}=${this.shellQuote(values[0])}`);
      if (values.length) lines.push(`export ${ENV_LIST_NAMES[key]}=${this.shellQuote(values.join(','))}`);
    }
    return `${lines.join('\n')}\n`;
  }

  private shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }

  private toStatus(keys: ResearchKeysFile): ResearchKeysStatus {
    const tavilyKeys = this.resolveKeys(keys, 'tavilyApiKey');
    const exaKeys = this.resolveKeys(keys, 'exaApiKey');
    const firecrawlKeys = this.resolveKeys(keys, 'firecrawlApiKey');
    const embeddingKeys = this.resolveKeys(keys, 'openaiEmbeddingApiKey');
    return {
      tavilyApiKey: { configured: tavilyKeys.length > 0, configuredCount: tavilyKeys.length },
      exaApiKey: { configured: exaKeys.length > 0, configuredCount: exaKeys.length },
      firecrawlApiKey: { configured: firecrawlKeys.length > 0, configuredCount: firecrawlKeys.length },
      openaiEmbeddingApiKey: { configured: embeddingKeys.length > 0, configuredCount: embeddingKeys.length },
      updatedAt: keys.updatedAt || null,
    };
  }

  private applyKeyList(keys: ResearchKeysFile, name: ResearchKeyName, values: string[]): boolean {
    const arrayKey = ARRAY_NAMES[name];
    const previous = this.resolveKeys(keys, name, false);
    keys[name] = values[0];
    keys[arrayKey] = values;
    return previous.join('\n') !== values.join('\n');
  }

  private resolveKeys(keys: ResearchKeysFile, name: ResearchKeyName, includeProcessEnv = true): string[] {
    const arrayKey = ARRAY_NAMES[name];
    return this.uniqueKeys([
      ...(Array.isArray(keys[arrayKey]) ? keys[arrayKey] || [] : []),
      keys[name] || '',
      ...(includeProcessEnv ? this.parseKeyList(process.env[ENV_LIST_NAMES[name]] || '') : []),
      includeProcessEnv ? process.env[ENV_NAMES[name]] || '' : '',
    ]);
  }

  private parseKeyList(value: string | string[] | undefined): string[] {
    if (!value) return [];
    const values = Array.isArray(value) ? value : value.split(/[\n,;]+/);
    return this.uniqueKeys(values);
  }

  private uniqueKeys(values: Array<string | undefined>): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
      const trimmed = String(value || '').trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      result.push(trimmed);
    }
    return result;
  }
}
