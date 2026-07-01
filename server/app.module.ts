import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { HealthController } from './health.controller.js';
import { HermesGatewayDeviceService } from './hermes-gateway-device.service.js';
import { HermesService } from './hermes.service.js';
import { QaSessionSourcesService } from './qa-session-sources.service.js';
import { RemoteFileService } from './remote-file.service.js';
import { ReportPlansController } from './report-plans.controller.js';
import { ResearchKeysController } from './research-keys.controller.js';
import { ResearchKeysService } from './research-keys.service.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { VectorSourcesController } from './vector-sources.controller.js';
import { VectorSourceService } from './vector-source.service.js';

@Module({
  controllers: [HealthController, AuthController, ReportsController, ReportPlansController, ResearchKeysController, VectorSourcesController, ChatController],
  providers: [
    AuthService,
    AuthGuard,
    HermesService,
    HermesGatewayDeviceService,
    RemoteFileService,
    QaSessionSourcesService,
    ReportsService,
    ResearchKeysService,
    VectorSourceService,
    ChatService,
  ],
})
export class AppModule {}
