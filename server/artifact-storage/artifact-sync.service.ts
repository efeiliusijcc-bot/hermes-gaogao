import { Inject, Injectable } from '@nestjs/common';
import fs from 'fs/promises';
import path from 'path';
import { HERMES_ARTIFACT_BASE_URL, HERMES_ARTIFACT_TRANSPORT, HERMES_INTERNAL_TOKEN, HERMES_REMOTE_REPORT_ROOT, HERMES_SHARED_REPORT_ROOT } from '../config.js';
import { ArtifactPathResolver } from '../artifact-path-resolver.service.js';
import { ArtifactStorageFacade } from './artifact-storage.service.js';
import type { ArtifactMetadata, ArtifactType } from './artifact-storage.types.js';

export interface SyncReportInput {
  jobId: string;
  reportPointer?: string | null;
  localPath?: string | null;
  markdown?: string | null;
}

export interface ArtifactSyncResult {
  status: 'completed' | 'failed';
  code?: string;
  message?: string;
  artifacts: Record<string, ArtifactMetadata>;
  diagnostics: Record<string, unknown>;
}

const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;

@Injectable()
export class ArtifactSyncService {
  constructor(
    @Inject(ArtifactStorageFacade) private readonly storage: ArtifactStorageFacade,
    @Inject(ArtifactPathResolver) private readonly resolver: ArtifactPathResolver,
  ) {}

  async syncReportMarkdown(input: SyncReportInput): Promise<ArtifactSyncResult> {
    const source = await this.readReportSource(input);
    if (!source.content) {
      return {
        status: 'failed',
        code: 'ARTIFACT_TRANSPORT_UNAVAILABLE',
        message: '报告已在 Hermes 侧生成，但当前部署未配置共享卷、远程 Artifact API 或对象存储传输。',
        artifacts: {},
        diagnostics: source.diagnostics,
      };
    }
    const stored = await this.storage.put({
      jobId: input.jobId,
      artifactType: 'report_markdown',
      storageKey: this.storageKey(input.jobId, 'final/report.md'),
      fileName: 'report.md',
      mimeType: 'text/markdown; charset=utf-8',
      content: source.content,
    });
    return {
      status: 'completed',
      artifacts: { reportMarkdown: stored },
      diagnostics: { ...source.diagnostics, reportMarkdown: { status: 'completed', storageKey: stored.storageKey, sizeBytes: stored.sizeBytes, sha256: stored.sha256 } },
    };
  }

  async syncJsonArtifact(jobId: string, artifactType: ArtifactType, relativeFile: string, content: unknown): Promise<ArtifactMetadata> {
    return this.storage.put({
      jobId,
      artifactType,
      storageKey: this.storageKey(jobId, relativeFile),
      fileName: path.basename(relativeFile),
      mimeType: 'application/json; charset=utf-8',
      content: `${JSON.stringify(content, null, 2)}\n`,
    });
  }

  async readText(storageKey: string): Promise<string> {
    const stream = await this.storage.createReadStream(storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
  }

  private async readReportSource(input: SyncReportInput): Promise<{ content: Buffer | null; diagnostics: Record<string, unknown> }> {
    if (input.markdown && !this.isReportPointer(input.markdown)) {
      return { content: Buffer.from(input.markdown, 'utf8'), diagnostics: { mode: 'inline_markdown' } };
    }
    const pointer = input.reportPointer || this.extractReportPath(input.markdown || '') || input.localPath || '';
    if (pointer && HERMES_ARTIFACT_TRANSPORT === 'shared_volume') {
      const shared = await this.readFromSharedVolume(input.jobId, pointer);
      if (shared.content) return shared;
      const resolved = await this.resolver.resolveHermesArtifactPath({ jobId: input.jobId, remotePath: pointer, artifactType: 'reportMarkdown' });
      if (resolved.exists) {
        const content = await this.readSafeLocalFile(resolved.localPath);
        if (content) return { content, diagnostics: { mode: resolved.status, pointerPresent: true, resolvedPath: resolved.relativePath } };
      }
    }
    const fetched = HERMES_ARTIFACT_TRANSPORT === 'remote_api'
      ? await this.fetchArtifactApi(input.jobId, 'report.md')
      : null;
    if (fetched) return { content: fetched, diagnostics: { mode: 'artifact_api' } };
    return {
      content: null,
      diagnostics: {
        transport: HERMES_ARTIFACT_TRANSPORT,
        pointerPresent: Boolean(pointer),
        sharedRootConfigured: Boolean(HERMES_SHARED_REPORT_ROOT),
        artifactApiConfigured: Boolean(HERMES_ARTIFACT_BASE_URL),
      },
    };
  }

  private async readFromSharedVolume(jobId: string, remotePath: string): Promise<{ content: Buffer | null; diagnostics: Record<string, unknown> }> {
    const remoteRoot = this.cleanRoot(HERMES_REMOTE_REPORT_ROOT);
    const sharedRoot = this.cleanRoot(HERMES_SHARED_REPORT_ROOT);
    if (!remoteRoot || !sharedRoot) return { content: null, diagnostics: { mode: 'shared_volume', configured: false } };
    if (/^[a-z][a-z0-9+.-]*:/i.test(remotePath)) return { content: null, diagnostics: { mode: 'shared_volume', rejected: 'uri_path' } };
    const normalized = remotePath.replace(/\\/g, '/');
    if (normalized.includes('..')) return { content: null, diagnostics: { mode: 'shared_volume', rejected: 'path_traversal' } };
    if (normalized !== remoteRoot && !normalized.startsWith(`${remoteRoot}/`)) {
      return { content: null, diagnostics: { mode: 'shared_volume', rejected: 'outside_remote_root' } };
    }
    const relative = normalized.slice(remoteRoot.length).replace(/^\/+/, '');
    const candidate = path.resolve(sharedRoot, relative);
    const sharedReal = await fs.realpath(sharedRoot).catch(() => sharedRoot);
    const real = await fs.realpath(candidate).catch(() => '');
    if (!real || !this.isInside(real, sharedReal)) return { content: null, diagnostics: { mode: 'shared_volume', rejected: 'realpath_escape' } };
    const content = await this.readSafeLocalFile(real);
    return { content, diagnostics: { mode: 'shared_volume', relative, jobId } };
  }

  private async readSafeLocalFile(filePath: string): Promise<Buffer | null> {
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size > MAX_ARTIFACT_BYTES) return null;
      return fs.readFile(filePath);
    } catch {
      return null;
    }
  }

  private async fetchArtifactApi(jobId: string, artifactName: string): Promise<Buffer | null> {
    const baseUrl = String(HERMES_ARTIFACT_BASE_URL || '').replace(/\/+$/, '');
    if (!baseUrl) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`${baseUrl}/internal/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifactName)}`, {
        headers: HERMES_INTERNAL_TOKEN ? { 'x-internal-skill-token': HERMES_INTERNAL_TOKEN } : {},
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const content = Buffer.from(await response.arrayBuffer());
      return content.byteLength <= MAX_ARTIFACT_BYTES ? content : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private extractReportPath(text: string): string {
    return text.replaceAll('\\', '/').match(/^\s*REPORT_FILE\s*:\s*(\/[^\r\n`"'<>|?*]+?\.md)\s*$/im)?.[1]?.trim() || '';
  }

  private isReportPointer(text: string): boolean {
    return /^\s*REPORT_FILE\s*:/im.test(String(text || ''));
  }

  private storageKey(jobId: string, relative: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(jobId)) throw new Error('Invalid jobId for artifact storage');
    return `reports/${jobId}/${relative.replace(/^\/+/, '')}`;
  }

  private cleanRoot(value: string): string {
    return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
  }

  private isInside(candidate: string, root: string): boolean {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }
}
