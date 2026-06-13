import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import {
  HEALTH_TIMEOUT_MS,
  HERMES_BASE_URL,
  HERMES_HEALTH_URL,
  HERMES_MODEL,
  REPORT_TIMEOUT_MS,
} from './config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.enableCors();

  const port = Number(process.env.PORT || 3001);
  await app.listen(port);

  console.log(`Report API server running on http://localhost:${port}`);
  console.log(`Hermes HTTP base URL: ${HERMES_BASE_URL}`);
  console.log(`Hermes health URL: ${HERMES_HEALTH_URL}`);
  console.log(`Hermes model/agent: ${HERMES_MODEL}`);
  console.log(`Hermes timeouts: health=${HEALTH_TIMEOUT_MS}ms, run=${REPORT_TIMEOUT_MS}ms`);
}

void bootstrap();
