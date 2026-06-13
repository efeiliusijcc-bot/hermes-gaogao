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
export const HERMES_API_KEY = process.env.HERMES_API_KEY || readGatewayToken() || 'hermes-local';
export const HERMES_DEVICE_TOKEN = readDeviceAuthToken();
export const HERMES_MODEL = process.env.HERMES_MODEL || 'openclaw/report-agent';
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
export const REPORT_OUTPUT_DIR =
  process.env.REPORT_OUTPUT_DIR || path.join(HERMES_STATE_DIR, 'workspace', 'report-agent', 'reports');
export const HERMES_QA_ARTIFACT_DIR =
  process.env.HERMES_QA_ARTIFACT_DIR || path.join(HERMES_STATE_DIR, 'workspace', HERMES_QA_AGENT_ID, 'sessions');
export const HERMES_REMOTE_HOST = process.env.HERMES_REMOTE_HOST || '';
export const HERMES_REMOTE_USER = process.env.HERMES_REMOTE_USER || 'root';
export const HERMES_REMOTE_SSH_KEY =
  process.env.HERMES_REMOTE_SSH_KEY || path.join(os.homedir(), '.ssh', 'id_ed25519');
export const HERMES_REMOTE_REPORT_DIR =
  process.env.HERMES_REMOTE_REPORT_DIR || '/usr/docker/hermes/workspace/report-agent/reports';
export const HERMES_CONTAINER_REPORT_DIR =
  '/home/node/.hermes/workspace/report-agent/reports';
export const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';
