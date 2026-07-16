import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type {
  DailyAwarenessComposedBrief,
  DailyAwarenessInboxRecord,
  DailyAwarenessTerminalResult,
} from './daily-awareness.contracts.js';
import type { DailyAwarenessTriggerType } from './daily-awareness.constants.js';
import { DailyAwarenessGenerationStore } from './daily-awareness-generation.store.js';
import { DailyAwarenessInboxService } from './daily-awareness-inbox.service.js';
import { DailyAwarenessLockService } from './daily-awareness-lock.service.js';
import { DailyAwarenessMaterialService } from './daily-awareness-material.service.js';
import { DailyAwarenessService } from './daily-awareness.service.js';

@Injectable()
export class DailyAwarenessGenerationService implements OnModuleDestroy {
  private readonly unregisterProcessor: () => void;

  constructor(
    @Inject(DailyAwarenessMaterialService) private readonly materials: DailyAwarenessMaterialService,
    @Inject(DailyAwarenessLockService) private readonly locks: DailyAwarenessLockService,
    @Inject(DailyAwarenessService) private readonly composer: DailyAwarenessService,
    @Inject(DailyAwarenessInboxService) private readonly inbox: DailyAwarenessInboxService,
    @Inject(DailyAwarenessGenerationStore) private readonly store: DailyAwarenessGenerationStore,
  ) {
    this.unregisterProcessor = this.inbox.registerProcessor((item) => this.processEvent(item));
  }

  async processEvent(item: DailyAwarenessInboxRecord): Promise<DailyAwarenessTerminalResult> {
    const triggerType: DailyAwarenessTriggerType = item.payload.reprocessRequested === true ? 'INBOX_REPROCESS' : 'EVENT';
    const locked = await this.locks.withBusinessDateLock(
      item.businessDate,
      triggerType,
      () => this.processLocked(item, triggerType),
    );
    return locked.acquired && locked.value
      ? locked.value
      : { terminal: true, generationStatus: 'WAITING' };
  }

  onModuleDestroy(): void {
    this.unregisterProcessor();
  }

  private async processLocked(
    item: DailyAwarenessInboxRecord,
    triggerType: DailyAwarenessTriggerType,
  ): Promise<DailyAwarenessTerminalResult> {
    if (await this.store.hasSuccessfulGlobalBrief(item.businessDate)) {
      await this.store.recordIgnored(item, triggerType);
      return { terminal: true, generationStatus: 'SUCCESS' };
    }

    const config = await this.store.loadConfig();
    let attemptNo = 1;
    let runId = await this.store.startRun(item, triggerType, attemptNo);
    let prepared;
    try {
      prepared = await this.materials.prepareForBusinessDate(item.businessDate, config);
    } catch (error) {
      await this.store.failRun(runId, error, false);
      throw error;
    }

    if (!prepared.sourceCount) {
      await this.store.completeNoData(runId, item, prepared);
      return { terminal: true, generationStatus: 'NOT_REQUIRED' };
    }

    while (true) {
      let composed: DailyAwarenessComposedBrief;
      try {
        composed = await this.composer.composeGlobalBrief(item.businessDate, prepared, config);
        this.assertUsable(composed);
      } catch (error) {
        const retry = this.isRetryableModelError(error) && attemptNo <= config.maxRetryCount;
        await this.store.failRun(runId, error, !retry);
        if (!retry) return { terminal: true, generationStatus: 'GENERATION_FAILED' };
        await this.sleep(config.retryIntervalSeconds * 1000);
        attemptNo += 1;
        runId = await this.store.startRun(item, 'AUTO_RETRY', attemptNo);
        continue;
      }

      await this.store.saveSuccess(runId, item, prepared, composed, 'SYSTEM');
      return { terminal: true, generationStatus: 'SUCCESS' };
    }
  }

  private assertUsable(composed: DailyAwarenessComposedBrief): void {
    const markdown = String(composed.reportMarkdown || '').trim();
    if (!markdown || markdown.length < 40 || !composed.title.trim()) {
      throw new Error('Daily awareness model returned unusable content');
    }
  }

  private isRetryableModelError(error: unknown): boolean {
    const status = Number((error as { status?: unknown })?.status || 0);
    const code = String((error as { code?: unknown })?.code || '');
    const message = error instanceof Error ? error.message : String(error);
    return status === 429
      || status >= 500
      || ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED'].includes(code)
      || /timeout|timed out|rate limit|temporarily unavailable/i.test(message);
  }

  private async sleep(milliseconds: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)));
  }
}
