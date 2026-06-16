import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
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

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.enableCors();

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

void bootstrap();
