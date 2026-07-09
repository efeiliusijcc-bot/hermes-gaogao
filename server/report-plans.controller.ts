import { Body, Controller, HttpException, HttpStatus, Inject, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard.js';
import { HermesService } from './hermes.service.js';
import { PermissionsGuard } from './permissions.guard.js';
import { RequirePermissions } from './require-permissions.decorator.js';
import type { ReportPlanRequest } from './types.js';

@Controller('/api/report-plans')
@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermissions('report:create')
export class ReportPlansController {
  constructor(@Inject(HermesService) private readonly hermes: HermesService) {}

  @Post()
  async create(@Body() body: ReportPlanRequest) {
    if (!body?.topic || !body?.reportType) {
      throw new HttpException({ error: 'Missing topic or reportType' }, HttpStatus.BAD_REQUEST);
    }

    return this.hermes.planReport({
      topic: String(body.topic).trim(),
      reportType: String(body.reportType).trim(),
      context: typeof body.context === 'string' ? body.context : '',
      parameters: body.parameters && typeof body.parameters === 'object' ? body.parameters : {},
    });
  }
}
