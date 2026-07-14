import assert from 'node:assert/strict';
import { ReportsService } from '../server/reports.service.js';

const service = Object.create(ReportsService.prototype) as ReportsService & {
  parseReferenceEntriesRobust(markdown: string): Map<number, { title?: string; url?: string }>;
  buildReportReferenceItems(job: Record<string, unknown>, markdown: string): Promise<Array<Record<string, unknown>>>;
  structuredReportSources(job: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  toolSearchSources(job: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  crawlerReportSources(job: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  reportReferencesArtifactCandidatePaths(job: Record<string, unknown>): Promise<string[]>;
  readJsonFile(filePath: string): Promise<unknown>;
  readReportReferencesArtifact(job: Record<string, unknown>): Promise<Array<Record<string, unknown>> | null>;
  reportMarkdown(job: Record<string, unknown>): Promise<string>;
  readMarkdownFile(filePath: string | null, jobId?: string): Promise<{ filePath: string; markdown: string } | null>;
};

const markdown = `# Test report

Body claim [1].

## References

1. Example News. Verified source. https://example.com/source

**Source credibility assessment:**

The source above is independently published.

**Information gaps:**

1. Internal production data is not publicly available.
2. Project ownership remains unconfirmed.
`;

const references = service.parseReferenceEntriesRobust(markdown);

assert.equal(references.size, 1);
assert.equal(references.get(1)?.url, 'https://example.com/source');
assert.doesNotMatch(references.get(1)?.title || '', /Information gaps|Internal production data/);

service.structuredReportSources = async () => [];
service.toolSearchSources = async () => [{
  title: 'Example News verified source',
  url: 'https://example.com/source',
  sourceName: 'Example News',
  summary: 'Verified public evidence',
  sourceOrigin: 'tool_search',
  evidenceKind: 'research_source',
  matchStatus: 'matched',
}];
service.crawlerReportSources = async () => [];

const matchedReferences = await service.buildReportReferenceItems({ jobId: 'job-web-reference' }, markdown);

assert.equal(matchedReferences.length, 1);
assert.equal(matchedReferences[0].url, 'https://example.com/source');
assert.equal(matchedReferences[0].matchStatus, 'matched');
assert.equal(matchedReferences[0].sourceOrigin, 'tool_search');

const fullWidthMarkdown = `# 测试报告

正文事实〔1〕。

## 四、参考资料

〔1〕Example News. Verified source. https://example.com/source

**来源可信度评估：**

该来源已经交叉验证。
`;

const fullWidthReferences = service.parseReferenceEntriesRobust(fullWidthMarkdown);
assert.equal(fullWidthReferences.size, 1);
assert.equal(fullWidthReferences.get(1)?.url, 'https://example.com/source');

const fullWidthMatchedReferences = await service.buildReportReferenceItems(
  { jobId: 'job-full-width-reference' },
  fullWidthMarkdown,
);
assert.equal(fullWidthMatchedReferences.length, 1);
assert.equal(fullWidthMatchedReferences[0].citationNo, 1);
assert.equal(fullWidthMatchedReferences[0].matchStatus, 'matched');

let markdownReadArgs: [string | null, string | undefined] | null = null;
service.readMarkdownFile = async (filePath, jobId) => {
  markdownReadArgs = [filePath, jobId];
  return { filePath: '/app/storage/artifacts/reports/job-relative/final/report.md', markdown: fullWidthMarkdown };
};
const relativeReportMarkdown = await service.reportMarkdown({
  jobId: 'job-relative',
  resultPath: 'reports/job-relative/final/report.md',
});
assert.equal(relativeReportMarkdown, fullWidthMarkdown);
assert.deepEqual(markdownReadArgs, ['reports/job-relative/final/report.md', 'job-relative']);

const pathService = Object.create(ReportsService.prototype) as ReportsService;
let resolverInput: Record<string, unknown> | null = null;
const validResolvedMarkdown = `${fullWidthMarkdown}\n${'补充正文内容。'.repeat(400)}`;
Reflect.set(pathService, 'artifactResolver', {
  resolveHermesArtifactPath: async (input: Record<string, unknown>) => {
    resolverInput = input;
    return {
      status: 'local',
      localPath: '/app/storage/artifacts/reports/job-relative/final/report.md',
      remotePath: '',
      relativePath: 'reports/job-relative/final/report.md',
      exists: true,
      reason: 'resolved from relativePath',
    };
  },
});
Reflect.set(pathService, 'remoteFs', {
  stat: async () => ({ isFile: true, size: Buffer.byteLength(validResolvedMarkdown) }),
  readFile: async () => validResolvedMarkdown,
  isInsideReportDir: () => true,
});

const resolvedRelativeMarkdown = await (pathService as unknown as {
  readMarkdownFile(filePath: string | null, jobId?: string): Promise<{ markdown: string } | null>;
}).readMarkdownFile('reports/job-relative/final/report.md', 'job-relative');

assert.equal(resolverInput?.relativePath, 'reports/job-relative/final/report.md');
assert.equal(resolverInput?.remotePath, undefined);
assert.equal(resolvedRelativeMarkdown?.markdown, validResolvedMarkdown);

service.reportReferencesArtifactCandidatePaths = async () => ['/tmp/legacy-report-references.json'];
service.readJsonFile = async () => ({
  references: [{
    citationNo: 1,
    title: 'Internal production data remains unavailable',
    url: 'https://example.com/source',
    matchStatus: 'matched',
  }],
});

const legacyReferences = await service.readReportReferencesArtifact({ jobId: 'legacy-job' });
assert.equal(legacyReferences, null);

console.log('report reference section boundary tests passed');
