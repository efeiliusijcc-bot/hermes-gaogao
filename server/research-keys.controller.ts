import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard.js';
import { ResearchKeysService, type UpdateResearchKeysInput } from './research-keys.service.js';
import { Roles, RolesGuard } from './roles.guard.js';

@Controller('/api/research-keys')
@UseGuards(AuthGuard, RolesGuard)
export class ResearchKeysController {
  constructor(private readonly researchKeys: ResearchKeysService) {}

  @Get()
  @Roles('admin', 'operator', 'viewer')
  getStatus() {
    return this.researchKeys.getStatus();
  }

  @Put()
  @Roles('admin')
  update(@Body() body: UpdateResearchKeysInput) {
    return this.researchKeys.updateKeys(body || {});
  }
}
