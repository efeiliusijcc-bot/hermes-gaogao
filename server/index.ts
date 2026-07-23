import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';
import { json, urlencoded, type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { pathToFileURL } from 'url';
import { AppModule } from './app.module.js';
import { assertProductionJwtSecret } from './auth.service.js';
import {
  HEALTH_TIMEOUT_MS,
  HERMES_BASE_URL,
  HERMES_HEALTH_URL,
  HERMES_MODEL,
  HERMES_RUN_MODE,
  HERMES_RUNS_URL,
  REPORT_AGENT_BASE_URL,
  REPORT_AGENT_MODEL,
  REPORT_AGENT_PROVIDER,
  REPORT_TIMEOUT_MS,
  assertArtifactStorageConfig,
} from './config.js';

function isClientDisconnectError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === 'EOF' ||
    code === 'EPIPE' ||
    code === 'ECONNRESET' ||
    /write EOF|socket hang up|client disconnected/i.test(error.message)
  );
}

process.on('uncaughtException', (error) => {
  if (isClientDisconnectError(error)) {
    console.warn(`Ignored client disconnect while streaming: ${error.message}`);
    return;
  }
  throw error;
});

export function buildCorsOptions(): CorsOptions {
  const configuredOrigins = String(process.env.FRONTEND_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const isProduction = process.env.NODE_ENV === 'production';
  const allowedOrigins = new Set([
    ...configuredOrigins,
    ...(isProduction ? [] : ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:3000']),
  ]);
  if (isProduction && configuredOrigins.length === 0) {
    console.warn('FRONTEND_ORIGINS is not configured in production; browser cross-origin requests will be rejected.');
  }
  return {
    credentials: true,
    exposedHeaders: ['Content-Disposition', 'Content-Length', 'ETag', 'X-Artifact-SHA256'],
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('CORS origin is not allowed'));
    },
  };
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function requestStructureGuard(request: Request, response: Response, next: NextFunction): void {
  const root = request.body;
  if (root === undefined || root === null) {
    next();
    return;
  }

  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let fields = 0;
  while (stack.length) {
    const current = stack.pop();
    if (!current || current.value === null || typeof current.value !== 'object') continue;
    if (current.depth > 12) {
      response.status(400).json({ error: 'Request body nesting is too deep' });
      return;
    }
    for (const [key, value] of Object.entries(current.value)) {
      fields += 1;
      if (fields > 2000) {
        response.status(400).json({ error: 'Request body contains too many fields' });
        return;
      }
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        response.status(400).json({ error: 'Request body contains a forbidden field' });
        return;
      }
      if (value !== null && typeof value === 'object') stack.push({ value, depth: current.depth + 1 });
    }
  }
  next();
}

async function bootstrap() {
  assertProductionJwtSecret();
  assertArtifactStorageConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
    bodyParser: false,
  });
  const trustProxyHops = boundedInteger(process.env.TRUST_PROXY_HOPS, 0, 0, 10);
  if (trustProxyHops > 0) app.set('trust proxy', trustProxyHops);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(rateLimit({
    windowMs: boundedInteger(process.env.API_RATE_LIMIT_WINDOW_MS, 60_000, 1000, 3_600_000),
    limit: boundedInteger(process.env.API_RATE_LIMIT_MAX, 300, 10, 10_000),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (request) => request.path === '/api/hermes/health',
  }));
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '100kb', parameterLimit: 2000 }));
  app.use(requestStructureGuard);
  app.enableCors(buildCorsOptions());

  const port = Number(process.env.PORT || 3001);
  await app.listen(port);

  console.log(`Report API server running on http://localhost:${port}`);
  console.log(`Hermes run mode: ${HERMES_RUN_MODE}`);
  console.log(`Hermes HTTP base URL: ${HERMES_BASE_URL}`);
  console.log(`Hermes health URL: ${HERMES_HEALTH_URL}`);
  console.log(`Hermes runs URL: ${HERMES_RUNS_URL}`);
  console.log(`Hermes model/agent: ${HERMES_MODEL}`);
  console.log(`Report agent provider: ${REPORT_AGENT_PROVIDER}`);
  console.log(`Report agent base URL: ${REPORT_AGENT_BASE_URL}`);
  console.log(`Report agent model: ${REPORT_AGENT_MODEL}`);
  console.log(`Hermes timeouts: health=${HEALTH_TIMEOUT_MS}ms, run=${REPORT_TIMEOUT_MS}ms`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void bootstrap();
}
