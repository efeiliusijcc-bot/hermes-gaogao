import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  dailyAwarenessAutoEnabled,
  dailyAwarenessAutoTime,
  dailyAwarenessSchedulerPollMs,
} from './config.js';
import {
  dailyAwarenessShanghaiClock,
  dailyAwarenessSourceContext,
} from './daily-awareness-date.js';
import { DailyAwarenessGenerationStore } from './daily-awareness-generation.store.js';
import { DailyAwarenessInboxService } from './daily-awareness-inbox.service.js';

export type DailyAwarenessScheduleResult = {
  scheduled: boolean;
  reason: 'DISABLED' | 'BEFORE_TIME' | 'SUCCESS_EXISTS' | 'ACCEPTED';
  businessDate: string;
};

@Injectable()
export class DailyAwarenessSchedulerService implements OnModuleInit, OnModuleDestroy {
  private interval: NodeJS.Timeout | null = null;
  private running: Promise<DailyAwarenessScheduleResult> | null = null;

  constructor(
    @Inject(DailyAwarenessInboxService) private readonly inbox: DailyAwarenessInboxService,
    @Inject(DailyAwarenessGenerationStore) private readonly store: DailyAwarenessGenerationStore,
  ) {}

  onModuleInit(): void {
    if (!dailyAwarenessAutoEnabled()) return;
    this.interval = setInterval(() => this.schedule(), dailyAwarenessSchedulerPollMs());
    this.interval.unref();
    this.schedule();
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  async ensureScheduled(now = new Date()): Promise<DailyAwarenessScheduleResult> {
    const clock = dailyAwarenessShanghaiClock(now);
    if (!dailyAwarenessAutoEnabled()) {
      return { scheduled: false, reason: 'DISABLED', businessDate: clock.businessDate };
    }
    if (clock.minutesAfterMidnight < this.scheduledMinutes()) {
      return { scheduled: false, reason: 'BEFORE_TIME', businessDate: clock.businessDate };
    }
    if (await this.store.hasSuccessfulGlobalBrief(clock.businessDate)) {
      return { scheduled: false, reason: 'SUCCESS_EXISTS', businessDate: clock.businessDate };
    }
    const source = dailyAwarenessSourceContext(clock.businessDate);
    await this.inbox.acceptScheduled({
      eventId: `daily-awareness:auto:${clock.businessDate}`,
      eventType: 'DAILY_DATA_FINISHED',
      businessDate: clock.businessDate,
      batchId: `scheduler:${source.sourceTable}`,
      completedAt: now.toISOString(),
    }, { triggerSource: 'AUTO_SCHEDULER', ...source });
    return { scheduled: true, reason: 'ACCEPTED', businessDate: clock.businessDate };
  }

  private schedule(): void {
    if (this.running) return;
    this.running = this.ensureScheduled();
    void this.running.catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Daily awareness scheduler failed: ${message.slice(0, 300)}`);
    }).finally(() => {
      this.running = null;
    });
  }

  private scheduledMinutes(): number {
    const [hour, minute] = dailyAwarenessAutoTime().split(':').map(Number);
    return hour * 60 + minute;
  }
}
