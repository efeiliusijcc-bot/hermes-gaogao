import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import helmet from 'helmet';
import { SourceRecallModule } from './source-recall.module.js';

export async function createSourceRecallApp() {
  const app = await NestFactory.create(SourceRecallModule, { bodyParser: false, abortOnError: false });
  const express = app.getHttpAdapter().getInstance();
  express.disable('x-powered-by');
  // Only the loopback-bound host proxy can reach this listener from outside Docker.
  express.set('trust proxy', 1);
  app.use(helmet());
  app.use(json({ limit: '64kb' }));
  app.enableShutdownHooks();
  return app;
}
