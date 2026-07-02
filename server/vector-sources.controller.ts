import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard.js';
import { Roles, RolesGuard } from './roles.guard.js';
import { VectorSourceService } from './vector-source.service.js';

@Controller('/api/vector-sources')
@UseGuards(AuthGuard, RolesGuard)
export class VectorSourcesController {
  constructor(private readonly vectorSources: VectorSourceService) {}

  @Get('status')
  @Roles('admin', 'operator', 'viewer')
  status() {
    return this.vectorSources.status();
  }

  @Get('profiles')
  @Roles('admin', 'operator', 'viewer')
  profiles() {
    return this.vectorSources.profiles();
  }

  @Post('profile')
  @Roles('admin')
  switchProfile(@Body() body: { profile?: string } = {}) {
    return this.vectorSources.switchProfile(String(body?.profile || ''));
  }

  @Post('reindex')
  @Roles('admin')
  reindex(@Body() body: { limit?: number } = {}) {
    return this.vectorSources.reindex(Number(body?.limit || 100));
  }
}
