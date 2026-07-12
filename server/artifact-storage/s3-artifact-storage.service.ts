import { Injectable } from '@nestjs/common';
import type { Readable } from 'stream';
import type { ArtifactMetadata, ArtifactStorageService, PutArtifactInput, StoredArtifact } from './artifact-storage.types.js';

@Injectable()
export class S3ArtifactStorageService implements ArtifactStorageService {
  async put(_input: PutArtifactInput): Promise<StoredArtifact> {
    throw new Error('S3 artifact storage requires installing and wiring an S3-compatible client for this deployment.');
  }
  async exists(_storageKey: string): Promise<boolean> {
    throw new Error('S3 artifact storage is not configured in this build.');
  }
  async getMetadata(_storageKey: string): Promise<ArtifactMetadata> {
    throw new Error('S3 artifact storage is not configured in this build.');
  }
  async createReadStream(_storageKey: string): Promise<Readable> {
    throw new Error('S3 artifact storage is not configured in this build.');
  }
  async delete(_storageKey: string): Promise<void> {
    throw new Error('S3 artifact storage is not configured in this build.');
  }
}
