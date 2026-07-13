import assert from 'node:assert/strict';
import { ReportsService } from '../server/reports.service.js';

const service = Object.create(ReportsService.prototype) as ReportsService & {
  parseReferenceEntriesRobust(markdown: string): Map<number, { title?: string; url?: string }>;
  buildReportReferenceItems(job: Record<string, unknown>, markdown: string): Promise<Array<Record<string, unknown>>>;
  structuredReportSources(job: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  toolSearchSources(job: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  reportReferencesArtifactCandidatePaths(job: Record<string, unknown>): Promise<string[]>;
  readJsonFile(filePath: string): Promise<unknown>;
  readReportReferencesArtifact(job: Record<string, unknown>): Promise<Array<Record<string, unknown>> | null>;
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

const matchedReferences = await service.buildReportReferenceItems({ jobId: 'job-web-reference' }, markdown);

assert.equal(matchedReferences.length, 1);
assert.equal(matchedReferences[0].url, 'https://example.com/source');
assert.equal(matchedReferences[0].matchStatus, 'matched');
assert.equal(matchedReferences[0].sourceOrigin, 'tool_search');

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
