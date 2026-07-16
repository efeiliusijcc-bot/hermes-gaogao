import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { DAILY_DATA_FINISHED_EVENT_TYPE } from './daily-awareness.constants.js';
import type { DailyDataFinishedEvent } from './daily-awareness.contracts.js';
import { DailyAwarenessInboxService } from './daily-awareness-inbox.service.js';
import { InternalEventKeyGuard } from './internal-event-key.guard.js';

@Controller('/internal/events')
@UseGuards(InternalEventKeyGuard)
export class DailyAwarenessInternalController {
  constructor(@Inject(DailyAwarenessInboxService) private readonly inbox: DailyAwarenessInboxService) {}

  @Post('daily-data-finished')
  @HttpCode(HttpStatus.ACCEPTED)
  acceptDailyDataFinished(@Body() body: unknown) {
    return this.inbox.accept(this.parseEvent(body));
  }

  private parseEvent(value: unknown): DailyDataFinishedEvent {
    const body = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const eventId = this.requiredText(body.eventId, 'eventId', 256);
    const eventType = this.requiredText(body.eventType, 'eventType', 64);
    const businessDate = this.requiredText(body.businessDate, 'businessDate', 10);
    const batchId = this.requiredText(body.batchId, 'batchId', 256);
    const completedAt = this.requiredText(body.completedAt, 'completedAt', 128);

    if (eventType !== DAILY_DATA_FINISHED_EVENT_TYPE) this.invalid('eventType must be DAILY_DATA_FINISHED');
    if (!this.isDateOnly(businessDate)) this.invalid('businessDate must be a valid YYYY-MM-DD date');
    if (!Number.isFinite(new Date(completedAt).getTime())) this.invalid('completedAt must be a valid ISO timestamp');

    let totalCount: number | undefined;
    if (body.totalCount !== undefined && body.totalCount !== null) {
      totalCount = Number(body.totalCount);
      if (!Number.isInteger(totalCount) || totalCount < 0) this.invalid('totalCount must be a non-negative integer');
    }

    return { eventId, eventType: DAILY_DATA_FINISHED_EVENT_TYPE, businessDate, batchId, completedAt, totalCount };
  }

  private requiredText(value: unknown, field: string, maxLength: number): string {
    const text = String(value || '').trim();
    if (!text || text.length > maxLength) this.invalid(`${field} is required and must not exceed ${maxLength} characters`);
    return text;
  }

  private isDateOnly(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  private invalid(message: string): never {
    throw new BadRequestException({ error: message, code: 'DAILY_AWARENESS_INVALID_EVENT' });
  }
}
