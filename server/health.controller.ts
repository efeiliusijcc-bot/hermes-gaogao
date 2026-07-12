import { Controller, Get, HttpCode, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HermesGatewayDeviceService } from './hermes-gateway-device.service.js';
import { HermesService } from './hermes.service.js';

@Controller('/api/hermes')
export class HealthController {
  constructor(
    @Inject(HermesService) private readonly hermes: HermesService,
    @Inject(HermesGatewayDeviceService) private readonly gatewayDevice: HermesGatewayDeviceService,
  ) {}

  @Get('health')
  @HttpCode(200)
  async health(@Res() res: Response) {
    const health = await this.hermes.health();
    res.status(health.ok ? 200 : 503).json(health);
  }

  @Get('device-health')
  @HttpCode(200)
  async deviceHealth(@Res() res: Response) {
    const health = await this.gatewayDevice.health();
    res.status(health.ok ? 200 : 503).json(health);
  }
}
