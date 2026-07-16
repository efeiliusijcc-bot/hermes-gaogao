import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  dailyAwarenessInboxLeaseSeconds,
  dailyAwarenessWorkerPollMs,
} from './config.js';
import { DailyAwarenessInboxService } from './daily-awareness-inbox.service.js';

@Injectable()
export class DailyAwarenessWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly workerId = `daily-awareness-${process.pid}-${randomUUID()}`;
  private running: Promise<number> | null = null;
  private interval: NodeJS.Timeout | null = null;
  private unregisterWakeHandler: (() => void) | null = null;

  constructor(@Inject(DailyAwarenessInboxService) private readonly inbox: DailyAwarenessInboxService) {}

  onModuleInit(): void {
    this.unregisterWakeHandler = this.inbox.registerWakeHandler(() => this.schedule());
    this.interval = setInterval(() => this.schedule(), dailyAwarenessWorkerPollMs());
    this.interval.unref();
    this.schedule();
  }

  async processAvailable(): Promise<number> {
    if (this.running) return this.running;
    this.running = this.processLoop();
    try {
      return await this.running;
    } finally {
      this.running = null;
    }
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.unregisterWakeHandler?.();
    this.unregisterWakeHandler = null;
  }

  private schedule(): void {
    void this.processAvailable().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Daily awareness worker polling failed: ${message.slice(0, 300)}`);
    });
  }

  private async processLoop(): Promise<number> {
    await this.inbox.recoverStaleProcessing(dailyAwarenessInboxLeaseSeconds());
    let processed = 0;
    for (let index = 0; index < 20; index += 1) {
      const item = await this.inbox.claimNext(this.workerId);
      if (!item) break;
      processed += 1;
      try {
        await this.inbox.process(item);
        await this.inbox.markProcessed(item.eventId);
      } catch (error) {
        await this.inbox.markInfrastructureFailure(item, error);
      }
    }
    return processed;
  }
}
