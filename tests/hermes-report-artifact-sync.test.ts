import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-report-sync-'));
process.env.REPORT_OUTPUT_DIR = root;
process.env.HERMES_LOCAL_OUTPUT_DIR = root;
process.env.HERMES_REMOTE_OUTPUT_DIR = '/workspace/reports';
process.env.HERMES_REMOTE_CONTAINER_REPORT_DIR = '/workspace/reports';

const { ArtifactPathResolver } = await import('../server/artifact-path-resolver.service.js');
const { ReportsService } = await import('../server/reports.service.js');

const markdown = ['# Report', '', '正文内容。'.repeat(500)].join('\n');
fs.writeFileSync(path.join(root, 'legacy-report.md'), markdown, 'utf8');

const remoteFs = {
  remoteDir: root,
  joinPath: (...parts: string[]) => path.join(...parts),
  mkdir: async (dir: string) => fs.promises.mkdir(dir, { recursive: true }),
  writeFile: async (file: string, content: string) => {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, content, 'utf8');
  },
  readFile: async (file: string) => fs.promises.readFile(file, 'utf8'),
  exists: async (file: string) => {
    try { return (await fs.promises.stat(file)).isFile(); } catch { return false; }
  },
  readdir: async () => [],
  stat: async (file: string) => {
    const stat = await fs.promises.stat(file);
    return { size: stat.size, mtimeMs: stat.mtimeMs, isFile: stat.isFile() };
  },
  isInsideReportDir: (file: string) => {
    const relative = path.relative(root, path.resolve(file));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  },
  remapToReportDir: (value: string) => value,
};

const service = new ReportsService({} as never, remoteFs as never, {} as never, undefined, undefined, undefined, new ArtifactPathResolver()) as unknown as {
  resolveHermesReportFile(markdown: string, startedAtMs: number, jobId?: string): Promise<{ filePath: string; markdown: string } | null>;
};

const result = await service.resolveHermesReportFile('REPORT_FILE: /workspace/reports/legacy-report.md', Date.now() - 1000, 'job-1');
assert.ok(result);
assert.equal(result?.filePath, fs.realpathSync(path.join(root, 'job-1', 'final', 'report.md')));
assert.equal(result?.markdown, markdown);
console.log('hermes report artifact sync tests passed');
