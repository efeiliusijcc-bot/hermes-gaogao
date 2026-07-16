import fs from 'fs';
import path from 'path';
import os from 'os';

const HERMES_CONFIG_PATH =
  process.env.HERMES_CONFIG_PATH || path.join(os.homedir(), '.hermes', 'hermes.json');

function readGatewayToken(): string | undefined {
  try {
    const raw = fs.readFileSync(HERMES_CONFIG_PATH, 'utf-8');
    return raw.match(/"token"\s*:\s*"([^"]+)"/)?.[1];
  } catch {
    return undefined;
  }
}

function readDeviceAuthToken(): string | undefined {
  try {
    const filePath = path.join(os.homedir(), '.hermes', 'identity', 'device-auth.json');
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
      tokens?: { operator?: { token?: string } };
    };
    return parsed.tokens?.operator?.token;
  } catch {
    return undefined;
  }
}

export const HERMES_BASE_URL = process.env.HERMES_BASE_URL || 'http://localhost:18789/v1';
export const HERMES_HEALTH_URL =
  process.env.HERMES_HEALTH_URL || HERMES_BASE_URL.replace(/\/v1\/?$/, '/health');
export const HERMES_RUNS_URL = process.env.HERMES_RUNS_URL || HERMES_BASE_URL.replace(/\/v1\/?$/, '/v1/runs');
export const HERMES_API_KEY = process.env.HERMES_API_KEY || readGatewayToken() || 'hermes-local';
export const HERMES_DEVICE_TOKEN = readDeviceAuthToken();
export const HERMES_MODEL = process.env.HERMES_MODEL || 'openclaw/report-agent';
export const HERMES_RUN_MODE = process.env.HERMES_RUN_MODE || 'http';
export const HERMES_QA_AGENT_ID = process.env.HERMES_QA_AGENT_ID || 'qa-agent';
export const HERMES_QA_MODEL = process.env.HERMES_QA_MODEL || 'openclaw/qa-agent';
export const HERMES_QA_MODE = process.env.HERMES_QA_MODE || 'direct_pg';
export const DIRECT_QA_BASE_URL = process.env.DIRECT_QA_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
export const DIRECT_QA_API_KEY = process.env.DIRECT_QA_API_KEY || process.env.OPENAI_API_KEY || '';
export const DIRECT_QA_MODEL = process.env.DIRECT_QA_MODEL || 'deepseek-v4-flash';
export const DIRECT_QA_EMBEDDING_MODEL = process.env.DIRECT_QA_EMBEDDING_MODEL || process.env.PGVECTOR_EMBEDDING_MODEL || 'text-embedding-v4';
export const DIRECT_QA_EMBEDDING_DIMENSIONS = Number(process.env.DIRECT_QA_EMBEDDING_DIMENSIONS || process.env.PGVECTOR_EMBEDDING_DIMENSIONS || 1024);
export const HERMES_QA_TIMEOUT_MS = Number(process.env.HERMES_QA_TIMEOUT_MS || 900000);
export const REPORT_TIMEOUT_MS = Number(process.env.HERMES_TIMEOUT_MS || 900000);
export const HEALTH_TIMEOUT_MS = Number(process.env.HERMES_HEALTH_TIMEOUT_MS || 30000);
export const HERMES_WS_URL =
  process.env.HERMES_WS_URL || HERMES_BASE_URL.replace(/^http/, 'ws').replace(/\/v1\/?$/, '');
export const HERMES_STATE_DIR = process.env.HERMES_STATE_DIR || path.join(os.homedir(), '.hermes');
export const HERMES_RESEARCH_KEYS_DIR =
  process.env.HERMES_RESEARCH_KEYS_DIR || path.join(HERMES_STATE_DIR, 'workspace', 'report-agent', 'config');
export const REPORT_OUTPUT_DIR =
  process.env.REPORT_OUTPUT_DIR || path.join(HERMES_STATE_DIR, 'workspace', 'report-agent', 'reports');
export const ARTIFACT_STORAGE_MODE = process.env.ARTIFACT_STORAGE_MODE || 'local';
export const ARTIFACT_LOCAL_ROOT =
  process.env.ARTIFACT_LOCAL_ROOT || REPORT_OUTPUT_DIR;
export const HERMES_ARTIFACT_TRANSPORT = process.env.HERMES_ARTIFACT_TRANSPORT || 'shared_volume';
export const HERMES_SHARED_REPORT_ROOT = process.env.HERMES_SHARED_REPORT_ROOT || '';
export const HERMES_REMOTE_REPORT_ROOT =
  process.env.HERMES_REMOTE_REPORT_ROOT || process.env.HERMES_REMOTE_OUTPUT_DIR || '/opt/data/workspace/report-agent/reports';
export const S3_ENDPOINT = process.env.S3_ENDPOINT || '';
export const S3_REGION = process.env.S3_REGION || '';
export const S3_BUCKET = process.env.S3_BUCKET || '';
export const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID || '';
export const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY || '';
export const S3_FORCE_PATH_STYLE = String(process.env.S3_FORCE_PATH_STYLE || '').toLowerCase() === 'true';
export const S3_ARTIFACT_PREFIX = process.env.S3_ARTIFACT_PREFIX || 'hermes-artifacts';
export const HERMES_QA_ARTIFACT_DIR =
  process.env.HERMES_QA_ARTIFACT_DIR || path.join(HERMES_STATE_DIR, 'workspace', HERMES_QA_AGENT_ID, 'sessions');
export const HERMES_REMOTE_HOST = process.env.HERMES_REMOTE_HOST || '';
export const HERMES_REMOTE_USER = process.env.HERMES_REMOTE_USER || 'root';
export const HERMES_REMOTE_SSH_KEY =
  process.env.HERMES_REMOTE_SSH_KEY || path.join(os.homedir(), '.ssh', 'id_ed25519');
export const HERMES_REMOTE_REPORT_DIR =
  process.env.HERMES_REMOTE_REPORT_DIR || '/opt/hermes/workspace/report-agent/reports';
export const HERMES_CONTAINER_REPORT_DIR =
  process.env.HERMES_CONTAINER_REPORT_DIR || '/opt/data/workspace/report-agent/reports';
export const HERMES_REMOTE_CONTAINER_REPORT_DIR =
  process.env.HERMES_REMOTE_CONTAINER_REPORT_DIR || '/opt/data/workspace/report-agent/reports';
export const HERMES_REMOTE_OUTPUT_DIR =
  process.env.HERMES_REMOTE_OUTPUT_DIR || HERMES_REMOTE_CONTAINER_REPORT_DIR;
export const HERMES_LOCAL_OUTPUT_DIR =
  process.env.HERMES_LOCAL_OUTPUT_DIR || REPORT_OUTPUT_DIR;
export const HERMES_ARTIFACT_BASE_URL = process.env.HERMES_ARTIFACT_BASE_URL || '';
export const HERMES_INTERNAL_TOKEN = process.env.HERMES_INTERNAL_TOKEN || '';
export const HERMES_REMOTE_CLI_CONTAINER = process.env.HERMES_REMOTE_CLI_CONTAINER || 'hermes';
export const HERMES_REMOTE_CLI_BINARY =
  process.env.HERMES_REMOTE_CLI_BINARY || '/opt/hermes/.venv/bin/hermes';
export const HERMES_REMOTE_CLI_HOME = process.env.HERMES_REMOTE_CLI_HOME || '/opt/data';
export const HERMES_REMOTE_CLI_PROVIDER = process.env.HERMES_REMOTE_CLI_PROVIDER || '';
export const HERMES_REMOTE_CLI_MODEL = process.env.HERMES_REMOTE_CLI_MODEL || '';
export const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';

export const REPORT_AGENT_PROVIDER = process.env.REPORT_AGENT_PROVIDER || 'hermes';
export const REPORT_AGENT_BASE_URL =
  process.env.REPORT_AGENT_BASE_URL || process.env.DIRECT_QA_BASE_URL || DIRECT_QA_BASE_URL;
export const REPORT_AGENT_API_KEY =
  process.env.REPORT_AGENT_API_KEY || process.env.DIRECT_QA_API_KEY || DIRECT_QA_API_KEY;
export const REPORT_AGENT_MODEL =
  process.env.REPORT_AGENT_MODEL || process.env.DIRECT_QA_MODEL || DIRECT_QA_MODEL;
export const REPORT_AGENT_CLI_COMMAND = process.env.REPORT_AGENT_CLI_COMMAND || '';
export const REPORT_AGENT_CLI_ARGS_JSON = process.env.REPORT_AGENT_CLI_ARGS_JSON || '[]';

export function dailyAwarenessInternalEventKey(): string {
  return String(process.env.DAILY_AWARENESS_INTERNAL_EVENT_KEY || '').trim();
}

export function dailyAwarenessWorkerPollMs(): number {
  return boundedInteger(process.env.DAILY_AWARENESS_WORKER_POLL_MS, 2000, 250, 300_000);
}

export function dailyAwarenessInboxLeaseSeconds(): number {
  return boundedInteger(process.env.DAILY_AWARENESS_INBOX_LEASE_SECONDS, 300, 30, 86_400);
}

export function dailyAwarenessInboxMaxAttempts(): number {
  return boundedInteger(process.env.DAILY_AWARENESS_INBOX_MAX_ATTEMPTS, 5, 1, 20);
}

export function dailyAwarenessRetryIntervalSeconds(): number {
  return boundedInteger(process.env.DAILY_AWARENESS_INBOX_RETRY_SECONDS, 30, 1, 3600);
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function assertArtifactStorageConfig(): void {
  const mode = ARTIFACT_STORAGE_MODE;
  const transport = HERMES_ARTIFACT_TRANSPORT;
  if (!['local', 's3'].includes(mode)) {
    throw new Error(`Invalid ARTIFACT_STORAGE_MODE: ${mode}. Expected "local" or "s3".`);
  }
  if (!['inline', 'shared_volume', 'remote_api'].includes(transport)) {
    throw new Error(`Invalid HERMES_ARTIFACT_TRANSPORT: ${transport}. Expected "inline", "shared_volume", or "remote_api".`);
  }
  if (process.env.NODE_ENV !== 'production') return;

  if (mode === 'local') {
    if (!process.env.ARTIFACT_LOCAL_ROOT) {
      throw new Error('ARTIFACT_LOCAL_ROOT is required in production when ARTIFACT_STORAGE_MODE=local.');
    }
    if (REPORT_AGENT_PROVIDER === 'hermes' && transport === 'shared_volume') {
      const missing = [
        ['HERMES_REMOTE_REPORT_ROOT', HERMES_REMOTE_REPORT_ROOT],
        ['HERMES_SHARED_REPORT_ROOT', HERMES_SHARED_REPORT_ROOT],
      ].filter(([, value]) => !value).map(([name]) => name);
      if (missing.length) {
        throw new Error(`Shared-volume artifact transport is missing required configuration: ${missing.join(', ')}`);
      }
    }
    if (REPORT_AGENT_PROVIDER === 'hermes' && transport === 'remote_api') {
      const missing = [
        ['HERMES_ARTIFACT_BASE_URL', HERMES_ARTIFACT_BASE_URL],
        ['HERMES_INTERNAL_TOKEN', HERMES_INTERNAL_TOKEN],
      ].filter(([, value]) => !value).map(([name]) => name);
      if (missing.length) {
        throw new Error(`Remote artifact API transport is missing required configuration: ${missing.join(', ')}`);
      }
    }
  }

  if (mode === 's3') {
    const missing = [
      ['S3_BUCKET', S3_BUCKET],
      ['S3_ACCESS_KEY_ID', S3_ACCESS_KEY_ID],
      ['S3_SECRET_ACCESS_KEY', S3_SECRET_ACCESS_KEY],
    ].filter(([, value]) => !value).map(([name]) => name);
    if (!S3_REGION && !S3_ENDPOINT) missing.push('S3_REGION or S3_ENDPOINT');
    if (missing.length) {
      throw new Error(`S3 artifact storage is missing required configuration: ${missing.join(', ')}`);
    }
  }
}
