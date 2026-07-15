import assert from 'node:assert/strict';

process.env.HERMES_RUNS_POLL_INTERVAL_MS = '1';

const { HermesService } = await import('../server/hermes.service.js');
const { ReportsService } = await import('../server/reports.service.js');
const service = new HermesService({} as never, {} as never) as HermesService & {
  fetchHermesRunsJson: (url: string, init?: RequestInit) => Promise<Record<string, unknown>>;
};

let runsRequests = 0;
service.fetchHermesRunsJson = async (_url: string, init?: RequestInit) => {
  runsRequests += 1;
  if (init?.method === 'POST') return { run_id: 'run-readable', status: 'started' };
  return {
    run_id: 'run-readable',
    status: 'completed',
    output: 'REPORT_FILE: /opt/data/workspace/report-agent/reports/job-readable/final/report.md',
  };
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  assert.match(String(input), /\/v1\/runs\/run-readable\/events$/);
  const frames = [
    { event: 'reasoning.available', run_id: 'run-readable', text: 'private reasoning must not surface' },
    { event: 'message.delta', run_id: 'run-readable', delta: 'private report fragment' },
    { event: 'tool.started', run_id: 'run-readable', tool: 'pg-sources__query', preview: 'lookup vector sources' },
    { event: 'tool.completed', run_id: 'run-readable', tool: 'pg-sources__query', duration: 1.5, error: false },
    { event: 'tool.started', run_id: 'run-readable', tool: 'web_search', preview: 'find current policy updates' },
    { event: 'tool.completed', run_id: 'run-readable', tool: 'web_search', duration: 0.5, error: false },
    { event: 'tool.started', run_id: 'run-readable', tool: 'custom_internal_tool', preview: 'internal --secret-operation' },
    { event: 'tool.completed', run_id: 'run-readable', tool: 'custom_internal_tool', duration: 0.2, error: false },
    { event: 'run.completed', run_id: 'run-readable' },
  ];
  return new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
};

try {
  const events: Array<Record<string, unknown>> = [];
  const result = await service.runReportViaRunsApi({
    skill: 'write-hb',
    payload: { topic: '测试报告' },
    jobId: 'job-readable',
    onEvent: (event) => events.push(event as unknown as Record<string, unknown>),
  });

  assert.match(result.markdown, /REPORT_FILE/);
  assert.equal(runsRequests, 2);
  assert.ok(events.some((event) => event.type === 'tool_start'));
  assert.ok(events.some((event) => event.type === 'tool_end'));
  assert.ok(events.some((event) => /PG向量信源召回.*(?:进行中|正在召回)/.test(JSON.stringify(event))));
  assert.ok(events.some((event) => /公开资料检索/.test(JSON.stringify(event))));
  assert.ok(events.some((event) => /执行编报步骤/.test(JSON.stringify(event))));
  assert.doesNotMatch(JSON.stringify(events.filter((event) => JSON.stringify(event).includes('custom_internal_tool'))), /secret-operation/);
  assert.ok(events.some((event) => JSON.stringify(event).includes('耗时 1.5 秒')));
  assert.doesNotMatch(JSON.stringify(events), /private reasoning|private report fragment/);

  const reportsPrototype = ReportsService.prototype as unknown as {
    sanitizeUserVisibleText: (value: string, maxLength: number) => string;
  };
  const sanitized = reportsPrototype.sanitizeUserVisibleText(
    'Bearer secret-token OPENAI_API_KEY=sk-abcdefghijklmnop /opt/data/workspace/report.md /app/storage/job/context.json',
    500,
  );
  assert.doesNotMatch(sanitized, /secret-token|sk-abcdefghijklmnop|\/opt\/data|\/app\/storage/);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Hermes runs readable event integration tests passed');
