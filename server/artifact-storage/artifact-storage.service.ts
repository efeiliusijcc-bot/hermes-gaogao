import { Inject, Injectable, Optional } from '@nestjs/common';
import { ARTIFACT_STORAGE_MODE } from '../config.js';
import { LocalArtifactStorageService } from './local-artifact-storage.service.js';
import { S3ArtifactStorageService } from './s3-artifact-storage.service.js';
import type { ArtifactStorageService, PutArtifactInput, StoredArtifact } from './artifact-storage.types.js';

@Injectable()
export class ArtifactStorageFacade implements ArtifactStorageService {
  constructor(
    @Inject(LocalArtifactStorageService) private readonly local: LocalArtifactStorageService,
    @Optional() @Inject(S3ArtifactStorageService) private readonly s3?: S3ArtifactStorageService,
  ) {}

  private provider(): ArtifactStorageService {
    if (ARTIFACT_STORAGE_MODE === 's3') {
      if (!this.s3) throw new Error('S3 artifact storage provider is not available.');
      return this.s3;
    }
    return this.local;
  }

  put(input: PutArtifactInput): Promise<StoredArtifact> { return this.provider().put(input); }
  exists(storageKey: string) { return this.provider().exists(storageKey); }
  getMetadata(storageKey: string) { return this.provider().getMetadata(storageKey); }
  createReadStream(storageKey: string) { return this.provider().createReadStream(storageKey); }
  delete(storageKey: string) { return this.provider().delete(storageKey); }
}
