import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { AuditLogService } from './audit-log.service.js';
import { ArtifactPathResolver } from './artifact-path-resolver.service.js';
import { ArtifactStorageFacade } from './artifact-storage/artifact-storage.service.js';
import { ArtifactSyncService } from './artifact-storage/artifact-sync.service.js';
import { LocalArtifactStorageService } from './artifact-storage/local-artifact-storage.service.js';
import { S3ArtifactStorageService } from './artifact-storage/s3-artifact-storage.service.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { CrawlerService } from './crawler.service.js';
import { DailyAwarenessController } from './daily-awareness.controller.js';
import { DailyAwarenessAdminController } from './daily-awareness-admin.controller.js';
import { DailyAwarenessAdminService } from './daily-awareness-admin.service.js';
import { DailyAwarenessConfigService } from './daily-awareness-config.service.js';
import { DailyAwarenessInternalController } from './daily-awareness.internal.controller.js';
import { DailyAwarenessInboxService } from './daily-awareness-inbox.service.js';
import { DailyAwarenessGenerationService } from './daily-awareness-generation.service.js';
import { DailyAwarenessGenerationStore } from './daily-awareness-generation.store.js';
import { DailyAwarenessLockService } from './daily-awareness-lock.service.js';
import { DailyAwarenessMaterialService } from './daily-awareness-material.service.js';
import { DailyAwarenessMysqlService } from './daily-awareness-mysql.service.js';
import { DailyAwarenessQueryService } from './daily-awareness-query.service.js';
import { DailyAwarenessSchedulerService } from './daily-awareness-scheduler.service.js';
import { DailyAwarenessService } from './daily-awareness.service.js';
import { DailyAwarenessWorkerService } from './daily-awareness-worker.service.js';
import { DeepReportSourceCollectionService } from './deep-report-source-collection.service.js';
import { DraftAssistantController } from './draft-assistant.controller.js';
import { DraftAssistantService } from './draft-assistant.service.js';
import { HealthController } from './health.controller.js';
import { HermesGatewayDeviceService } from './hermes-gateway-device.service.js';
import { HermesService } from './hermes.service.js';
import { InternalEventKeyGuard } from './internal-event-key.guard.js';
import { PermissionsGuard } from './permissions.guard.js';
import { QaSessionSourcesService } from './qa-session-sources.service.js';
import { RemoteFileService } from './remote-file.service.js';
import { ReportPlansController } from './report-plans.controller.js';
import { ResearchKeysController } from './research-keys.controller.js';
import { ResearchKeysService } from './research-keys.service.js';
import { RolesController } from './roles.controller.js';
import { RolesService } from './roles.service.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { RolesGuard } from './roles.guard.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';
import { UserPreferencesController } from './user-preferences.controller.js';
import { UserPreferencesService } from './user-preferences.service.js';
import { VectorSourcesController } from './vector-sources.controller.js';
import { VectorSourceService } from './vector-source.service.js';
import { WebSupplementService } from './web-supplement.service.js';
import { RetrievalModule } from './reports/retrieval/retrieval.module.js';

@Module({
  imports: [RetrievalModule],
  controllers: [
    HealthController,
    AuthController,
    UsersController,
    UserPreferencesController,
    RolesController,
    ReportsController,
    ReportPlansController,
    ResearchKeysController,
    VectorSourcesController,
    ChatController,
    DailyAwarenessAdminController,
    DailyAwarenessInternalController,
    DailyAwarenessController,
    DraftAssistantController,
  ],
  providers: [
    AuthService,
    AuditLogService,
    ArtifactPathResolver,
    ArtifactStorageFacade,
    ArtifactSyncService,
    LocalArtifactStorageService,
    S3ArtifactStorageService,
    AuthGuard,
    RolesGuard,
    PermissionsGuard,
    InternalEventKeyGuard,
    UsersService,
    UserPreferencesService,
    ResearchKeysService,
    RolesService,
    HermesService,
    HermesGatewayDeviceService,
    RemoteFileService,
    QaSessionSourcesService,
    ReportsService,
    WebSupplementService,
    CrawlerService,
    ChatService,
    DailyAwarenessService,
    DailyAwarenessInboxService,
    DailyAwarenessAdminService,
    DailyAwarenessConfigService,
    DailyAwarenessGenerationStore,
    DailyAwarenessGenerationService,
    DailyAwarenessLockService,
    DailyAwarenessMaterialService,
    DailyAwarenessMysqlService,
    DailyAwarenessQueryService,
    DailyAwarenessSchedulerService,
    DailyAwarenessWorkerService,
    DeepReportSourceCollectionService,
    DraftAssistantService,
    VectorSourceService,
  ],
})
export class AppModule {}
