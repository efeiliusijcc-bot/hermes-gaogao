import { Body, Controller, Header, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { SourceRecallRequestWithAccess } from './source-recall.guard.js';
import { SourceRecallGuard } from './source-recall.guard.js';
import { SourceRecallService } from './source-recall.service.js';
import type { SourceRecallRequest } from './source-recall.types.js';

@Controller('/api/external/source-recall')
@UseGuards(SourceRecallGuard)
export class SourceRecallController {
  constructor(@Inject(SourceRecallService) private readonly recallService: SourceRecallService) {}

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  recall(@Body() body: SourceRecallRequest, @Req() request: SourceRecallRequestWithAccess) {
    const clientId = request.sourceRecallAccess?.clientId || 'other-project';
    const ip = request.ip || request.socket?.remoteAddress || '';
    return this.recallService.recall(body, clientId, ip);
  }
}
