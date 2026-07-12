import type { Readable } from 'stream';

export type ArtifactStorageProvider = 'local' | 's3';
export type ArtifactType =
  | 'report_markdown'
  | 'report_references'
  | 'context'
  | 'entity_policy'
  | 'database_sources'
  | 'database_sources_diagnostics'
  | 'web_sources'
  | 'web_supplement_diagnostics'
  | 'crawler_sources'
  | 'crawler_sources_diagnostics';

export interface PutArtifactInput {
  jobId: string;
  artifactType: ArtifactType;
  storageKey: string;
  fileName: string;
  mimeType: string;
  content: Buffer | string;
}

export interface ArtifactMetadata {
  storageProvider: ArtifactStorageProvider;
  storageKey: string;
  fileName: string;
  artifactType: ArtifactType;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export type StoredArtifact = ArtifactMetadata;

export interface ArtifactStorageService {
  put(input: PutArtifactInput): Promise<StoredArtifact>;
  exists(storageKey: string): Promise<boolean>;
  getMetadata(storageKey: string): Promise<ArtifactMetadata>;
  createReadStream(storageKey: string): Promise<Readable>;
  delete(storageKey: string): Promise<void>;
}
