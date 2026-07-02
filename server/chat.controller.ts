import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Put, Sse, UseGuards } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AuthGuard } from './auth.guard.js';
import type { AuthUser } from './auth-user.interface.js';
import { ChatService } from './chat.service.js';
import { CurrentUser } from './current-user.decorator.js';
import { QaSessionSourcesService } from './qa-session-sources.service.js';
import type { ServerEvent } from './types.js';

@Controller('/api/chat')
@UseGuards(AuthGuard)
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly qaSources: QaSessionSourcesService,
  ) {}

  @Post('completions')
  completions(
    @Body() body: { messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>; stream?: boolean; sessionId?: string },
    @CurrentUser() user: AuthUser,
  ) {
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      throw new HttpException({ error: 'messages is required' }, HttpStatus.BAD_REQUEST);
    }
    return this.chat.complete({ messages: body.messages, stream: body.stream, sessionId: body.sessionId }, user);
  }

  @Sse('streams/:streamId')
  stream(@Param('streamId') streamId: string, @CurrentUser() user: AuthUser): Observable<MessageEvent> {
    const { events, subject } = this.chat.stream(streamId, user);

    return new Observable((subscriber) => {
      if (!events || !subject) {
        subscriber.next({ data: { type: 'error', message: 'Stream not found' } as ServerEvent } as MessageEvent);
        subscriber.complete();
        return undefined;
      }

      for (const event of events) {
        subscriber.next({ data: event } as MessageEvent);
      }

      const subscription = subject.subscribe({
        next: (event) => subscriber.next({ data: event } as MessageEvent),
        complete: () => subscriber.complete(),
      });
      return () => subscription.unsubscribe();
    });
  }

  @Get('sessions/:sessionId/sources')
  sources(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthUser) {
    return this.qaSources.getSources(sessionId, user);
  }

  @Put('sessions/:sessionId/sources')
  upsertSources(
    @Param('sessionId') sessionId: string,
    @Body() body: { sources?: unknown; merge?: boolean },
    @CurrentUser() user: AuthUser,
  ) {
    return this.qaSources.upsertSources(sessionId, body || {}, user);
  }
}
