import { Injectable } from '@nestjs/common';
import fs from 'fs/promises';
import path from 'path';
import {
  HERMES_CONTAINER_REPORT_DIR,
  HERMES_ARTIFACT_BASE_URL,
  HERMES_INTERNAL_TOKEN,
  HERMES_LOCAL_OUTPUT_DIR,
  HERMES_REMOTE_CONTAINER_REPORT_DIR,
  HERMES_REMOTE_OUTPUT_DIR,
  HERMES_REMOTE_REPORT_DIR,
  REPORT_OUTPUT_DIR,
} from './config.js';

export type ArtifactResolveStatus = 'local' | 'mapped' | 'downloaded' | 'missing' | 'rejected';

export interface ArtifactResolveInput {
  jobId: string;
  remotePath?: string | null;
  relativePath?: string | null;
  fileName?: string | null;
  artifactType: string;
}

export interface ArtifactResolveResult {
  status: ArtifactResolveStatus;
  localPath: string;
  remotePath: string;
  relativePath: string;
  exists: boolean;
  reason: string;
}

function normalizePathText(value: unknown): string {
  return String(value || '').trim().replace(/\\/g, '/');
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, '');
}

@Injectable()
export class ArtifactPathResolver {
  readonly reportOutputDir = path.resolve(HERMES_LOCAL_OUTPUT_DIR || REPORT_OUTPUT_DIR);

  async resolveHermesArtifactPath(input: ArtifactResolveInput): Promise<ArtifactResolveResult> {
    const jobId = normalizePathText(input.jobId);
    if (!/^[A-Za-z0-9_-]+$/.test(jobId)) return this.rejected(input, 'invalid jobId');

    const candidate = this.candidateLocalPath(input, jobId);
    if (!candidate.localPath) return candidate.status === 'missing' ? candidate : this.rejected(input, candidate.reason || 'artifact path is missing');

    const validation = await this.validateLocalPath(candidate.localPath, jobId);
    if (!validation.ok) {
      const staged = await this.stageLegacyRootMarkdown(candidate.localPath, jobId, validation.reason);
      if (staged) {
        return {
          ...candidate,
          localPath: staged,
          relativePath: this.relativeToOutput(staged),
          status: 'mapped',
          exists: true,
          reason: 'legacy root Markdown staged into job artifact directory',
        };
      }
      return { ...candidate, status: 'rejected', exists: false, reason: validation.reason };
    }

    const exists = await this.fileExists(validation.localPath);
    if (!exists) {
      const downloaded = await this.fetchRemoteArtifact(input, jobId);
      if (downloaded) {
        return {
          ...candidate,
          localPath: downloaded,
          relativePath: this.relativeToOutput(downloaded),
          status: 'downloaded',
          exists: true,
          reason: 'downloaded through configured Hermes artifact endpoint',
        };
      }
    }
    return {
      ...candidate,
      localPath: validation.localPath,
      status: exists ? candidate.status : 'missing',
      exists,
      reason: exists ? candidate.reason : candidate.reason || 'artifact does not exist after path mapping',
    };
  }

  private candidateLocalPath(input: ArtifactResolveInput, jobId: string): ArtifactResolveResult {
    const relativePath = normalizePathText(input.relativePath);
    if (relativePath) {
      if (this.isUnsafeRelativePath(relativePath)) {
        return this.rejected(input, 'relative path is unsafe');
      }
      return {
        status: 'local',
        localPath: path.resolve(this.reportOutputDir, relativePath),
        remotePath: normalizePathText(input.remotePath),
        relativePath,
        exists: false,
        reason: 'resolved from relativePath',
      };
    }

    const remotePath = normalizePathText(input.remotePath);
    if (remotePath) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(remotePath)) return this.rejected(input, 'URI paths are not allowed');
      const mapped = this.mapRemotePath(remotePath);
      if (mapped) {
        return {
          status: mapped === remotePath ? 'local' : 'mapped',
          localPath: mapped,
          remotePath,
          relativePath: this.relativeToOutput(mapped),
          exists: false,
          reason: mapped === remotePath ? 'remotePath already local' : 'mapped by configured remote/local prefix',
        };
      }
      return { status: 'missing', localPath: '', remotePath, relativePath: '', exists: false, reason: 'remote path cannot be mapped' };
    }

    const fileName = normalizePathText(input.fileName);
    if (fileName) {
      if (this.isUnsafeRelativePath(fileName) || fileName.includes('/')) return this.rejected(input, 'fileName is unsafe');
      const localPath = path.resolve(this.reportOutputDir, jobId, fileName);
      return { status: 'local', localPath, remotePath: '', relativePath: this.relativeToOutput(localPath), exists: false, reason: 'resolved from fileName' };
    }

    return this.rejected(input, 'no path candidate provided');
  }

  private mapRemotePath(remotePath: string): string | null {
    const absolute = path.resolve(remotePath);
    if (this.isInside(absolute, this.reportOutputDir)) return absolute;

    for (const prefix of this.remotePrefixes()) {
      const cleanPrefix = stripTrailingSlash(prefix);
      if (!cleanPrefix) continue;
      if (remotePath === cleanPrefix || remotePath.startsWith(`${cleanPrefix}/`)) {
        const suffix = remotePath.slice(cleanPrefix.length).replace(/^\/+/, '');
        return path.resolve(this.reportOutputDir, suffix);
      }
    }
    return null;
  }

  private remotePrefixes(): string[] {
    return Array.from(new Set([
      HERMES_REMOTE_OUTPUT_DIR,
      HERMES_REMOTE_CONTAINER_REPORT_DIR,
      HERMES_CONTAINER_REPORT_DIR,
      HERMES_REMOTE_REPORT_DIR,
    ].map(normalizePathText).filter(Boolean)));
  }

  private async validateLocalPath(localPath: string, jobId: string): Promise<{ ok: boolean; localPath: string; reason: string }> {
    const resolved = path.resolve(localPath);
    if (!this.isInside(resolved, this.reportOutputDir)) {
      return { ok: false, localPath: resolved, reason: 'resolved path escapes REPORT_OUTPUT_DIR' };
    }
    if (!resolved.split(path.sep).includes(jobId)) {
      return { ok: false, localPath: resolved, reason: 'artifact path does not belong to the requested jobId' };
    }
    try {
      const real = await fs.realpath(resolved);
      const realRoot = await fs.realpath(this.reportOutputDir).catch(() => this.reportOutputDir);
      if (!this.isInside(real, realRoot)) return { ok: false, localPath: real, reason: 'realpath escapes REPORT_OUTPUT_DIR' };
      if (!real.split(path.sep).includes(jobId)) return { ok: false, localPath: real, reason: 'realpath does not belong to the requested jobId' };
      return { ok: true, localPath: real, reason: '' };
    } catch {
      return { ok: true, localPath: resolved, reason: '' };
    }
  }

  private async stageLegacyRootMarkdown(localPath: string, jobId: string, reason: string): Promise<string | null> {
    if (reason !== 'artifact path does not belong to the requested jobId' && reason !== 'realpath does not belong to the requested jobId') return null;
    if (path.extname(localPath).toLowerCase() !== '.md') return null;
    const resolved = path.resolve(localPath);
    const outputRoot = await fs.realpath(this.reportOutputDir).catch(() => this.reportOutputDir);
    const real = await fs.realpath(resolved).catch(() => '');
    if (!real || !this.isInside(real, outputRoot)) return null;
    if (path.dirname(real) !== outputRoot) return null;
    const stat = await fs.stat(real).catch(() => null);
    if (!stat?.isFile() || stat.size > 10 * 1024 * 1024) return null;
    const target = path.resolve(this.reportOutputDir, jobId, 'final', 'report.md');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(real, target);
    return fs.realpath(target).catch(() => target);
  }

  private async fetchRemoteArtifact(input: ArtifactResolveInput, jobId: string): Promise<string | null> {
    const baseUrl = String(HERMES_ARTIFACT_BASE_URL || '').replace(/\/+$/, '');
    if (!baseUrl) return null;
    const artifactName = this.artifactName(input);
    if (!artifactName) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`${baseUrl}/internal/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifactName)}`, {
        headers: HERMES_INTERNAL_TOKEN ? { 'x-internal-skill-token': HERMES_INTERNAL_TOKEN } : {},
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const length = Number(response.headers.get('content-length') || 0);
      if (length > 10 * 1024 * 1024) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 10 * 1024 * 1024) return null;
      const target = path.resolve(this.reportOutputDir, jobId, this.localArtifactRelativePath(artifactName));
      const validation = await this.validateLocalPath(target, jobId);
      if (!validation.ok) return null;
      await fs.mkdir(path.dirname(validation.localPath), { recursive: true });
      await fs.writeFile(validation.localPath, bytes);
      return fs.realpath(validation.localPath).catch(() => validation.localPath);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private artifactName(input: ArtifactResolveInput): string {
    const fromFileName = normalizePathText(input.fileName);
    const fromPath = path.basename(normalizePathText(input.remotePath || input.relativePath));
    const name = fromFileName || fromPath || this.defaultArtifactName(input.artifactType);
    return this.allowedArtifactNames().has(name) ? name : '';
  }

  private defaultArtifactName(type: string): string {
    if (type === 'reportMarkdown') return 'report.md';
    if (type === 'references') return 'report_references.json';
    if (type === 'context') return 'context.json';
    return '';
  }

  private allowedArtifactNames(): Set<string> {
    return new Set([
      'report.md',
      'report_references.json',
      'context.json',
      'database_sources.json',
      'database_sources_diagnostics.json',
      'web_sources.json',
      'web_supplement_diagnostics.json',
      'crawler_sources.json',
      'crawler_sources_diagnostics.json',
    ]);
  }

  private localArtifactRelativePath(artifactName: string): string {
    if (artifactName === 'report.md') return path.join('final', 'report.md');
    if (artifactName === 'report_references.json') return path.join('references', 'report_references.json');
    if (artifactName.startsWith('database_')) return path.join('database', artifactName);
    if (artifactName.startsWith('web_')) return path.join('research', artifactName);
    if (artifactName.startsWith('crawler_')) return path.join('crawler', artifactName);
    return artifactName;
  }

  private isUnsafeRelativePath(value: string): boolean {
    return path.isAbsolute(value) || value.split('/').some((part) => part === '..') || /^[a-z][a-z0-9+.-]*:/i.test(value);
  }

  private isInside(candidate: string, root: string): boolean {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(filePath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  private relativeToOutput(localPath: string): string {
    return path.relative(this.reportOutputDir, path.resolve(localPath)).replace(/\\/g, '/');
  }

  private rejected(input: ArtifactResolveInput, reason: string): ArtifactResolveResult {
    return {
      status: 'rejected',
      localPath: '',
      remotePath: normalizePathText(input.remotePath),
      relativePath: normalizePathText(input.relativePath),
      exists: false,
      reason,
    };
  }
}
