import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.REPORT_OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-runs-recovery-'));
process.env.HERMES_LOCAL_OUTPUT_DIR = process.env.REPORT_OUTPUT_DIR;

const { ReportsService } = await import('../server/reports.service.js');

const root = process.env.REPORT_OUTPUT_DIR;
const jobId = 'late-report-job';
const markdown = ['# Late Report', '', '这是一份延迟写入的有效编报。'.repeat(500)].join('\n');

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
  readdir: async (dir: string) => {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isFile: entry.isFile(),
      isDirectory: entry.isDirectory(),
    }));
  },
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

const service = new ReportsService({} as never, remoteFs as never, {} as never) as unknown as {
  waitForRecoverableRunsReport(job: {
    jobId: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    artifacts: Record<string, unknown>;
    events: unknown[];
    eventLog: unknown[];
  }, waitMs: number): Promise<{ filePath: string; markdown: string } | null>;
  recoverJobFromExistingReport(job: {
    jobId: string;
    status: string;
    stage?: string;
    createdAt: string;
    updatedAt: string;
    errorMessage?: string;
    markdown?: string;
    resultPath?: string;
    payload?: Record<string, unknown>;
    artifacts: Record<string, unknown>;
    events: unknown[];
    eventLog: unknown[];
  }, reason: string): Promise<boolean>;
  sleep(ms: number): Promise<void>;
};

service.sleep = async () => {
  await new Promise((resolve) => setTimeout(resolve, 5));
};

const reportPath = path.join(root, jobId, 'final', 'report.md');
setTimeout(() => {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, markdown, 'utf8');
}, 20);

const job = {
  jobId,
  status: 'running',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  artifacts: {},
  events: [],
  eventLog: [],
};

const recovered = await service.waitForRecoverableRunsReport(job, 250);
assert.ok(recovered);
assert.equal(recovered.filePath, reportPath);
assert.equal(recovered.markdown, markdown);
assert.equal(job.eventLog.some((entry) => JSON.stringify(entry).includes('runs_recovery_waiting')), true);

const failedJobId = 'failed-late-report-job';
const failedReportPath = path.join(root, failedJobId, 'final', 'report.md');
fs.mkdirSync(path.dirname(failedReportPath), { recursive: true });
fs.writeFileSync(failedReportPath, markdown, 'utf8');

const failedJob = {
  jobId: failedJobId,
  status: 'failed',
  stage: 'failed',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  errorMessage: 'Hermes runs API failed and no final report file was recovered. run_abc timed out.',
  payload: {},
  artifacts: {},
  events: [],
  eventLog: [],
};

const restored = await service.recoverJobFromExistingReport(failedJob, 'detail_lookup');
assert.equal(restored, true);
assert.equal(failedJob.status, 'succeeded');
assert.equal(failedJob.stage, 'done');
assert.equal(failedJob.resultPath, failedReportPath);
assert.equal(failedJob.errorMessage, undefined);

console.log('report runs late artifact recovery tests passed');
