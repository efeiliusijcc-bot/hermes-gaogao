import { Injectable } from '@nestjs/common';
import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { ARTIFACT_LOCAL_ROOT } from '../config.js';
import type { ArtifactMetadata, ArtifactStorageService, PutArtifactInput, StoredArtifact } from './artifact-storage.types.js';

function sha256(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

@Injectable()
export class LocalArtifactStorageService implements ArtifactStorageService {
  readonly provider = 'local' as const;
  readonly root = path.resolve(ARTIFACT_LOCAL_ROOT);

  async put(input: PutArtifactInput): Promise<StoredArtifact> {
    const content = Buffer.isBuffer(input.content) ? input.content : Buffer.from(input.content, 'utf8');
    const filePath = this.pathFor(input.storageKey);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, content);
    const metadata: StoredArtifact = {
      storageProvider: this.provider,
      storageKey: this.normalizeStorageKey(input.storageKey),
      fileName: input.fileName,
      artifactType: input.artifactType,
      mimeType: input.mimeType,
      sizeBytes: content.byteLength,
      sha256: sha256(content),
      createdAt: new Date().toISOString(),
    };
    await fsp.writeFile(`${filePath}.metadata.json`, JSON.stringify(metadata, null, 2), 'utf8');
    return metadata;
  }

  async exists(storageKey: string): Promise<boolean> {
    const filePath = this.pathFor(storageKey);
    try { return (await fsp.stat(filePath)).isFile(); } catch { return false; }
  }

  async getMetadata(storageKey: string): Promise<ArtifactMetadata> {
    const raw = await fsp.readFile(`${this.pathFor(storageKey)}.metadata.json`, 'utf8');
    return JSON.parse(raw) as ArtifactMetadata;
  }

  async createReadStream(storageKey: string): Promise<Readable> {
    return fs.createReadStream(this.pathFor(storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    const filePath = this.pathFor(storageKey);
    await fsp.rm(filePath, { force: true });
    await fsp.rm(`${filePath}.metadata.json`, { force: true });
  }

  async readText(storageKey: string): Promise<string> {
    return fsp.readFile(this.pathFor(storageKey), 'utf8');
  }

  private pathFor(storageKey: string): string {
    const clean = this.normalizeStorageKey(storageKey);
    const resolved = path.resolve(this.root, clean);
    const relative = path.relative(this.root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Artifact storage key escapes local root');
    return resolved;
  }

  private normalizeStorageKey(storageKey: string): string {
    const clean = String(storageKey || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!clean || clean.split('/').some((part) => part === '..') || /^[a-z][a-z0-9+.-]*:/i.test(clean)) {
      throw new Error('Invalid artifact storage key');
    }
    return clean;
  }
}
