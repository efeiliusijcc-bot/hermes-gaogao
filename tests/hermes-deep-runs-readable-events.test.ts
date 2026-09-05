import assert from 'node:assert/strict';

process.env.HERMES_RUNS_POLL_INTERVAL_MS = '1';

const { HermesService } = await import('../server/hermes.service.js');

type TestHermesService = HermesService & {
  fetchHermesRunsJson: (url: string, init?: RequestInit) => Promise<Record<string, unknown>>;
  runStructuredSkillViaRunsApi: (input: Record<string, unknown>, prompt: string) => Promise<string>;
};

function validCollectionResult() {
  return JSON.stringify({
    acceptedSources: [{ title: '官方来源', url: 'https://example.com/source' }],
    uncertainSources: [],
    coveredGaps: ['核心事实'],
    uncoveredGaps: [],
    summary: '深度资料采集完成。'.padEnd(1100, '。'),
  });
}

async function testDeepCollectionStreamsHermesToolEvents() {
  const service = new HermesService({} as never, {} as never) as TestHermesService;
  service.fetchHermesRunsJson = async (_url, init) => {
    if (init?.method === 'POST') return { run_id: 'run-deep-readable', status: 'started' };
    return { run_id: 'run-deep-readable', status: 'completed', output_text: validCollectionResult() };
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.match(String(input), /\/v1\/runs\/run-deep-readable\/events$/);
    const frames = [
      { event: 'reasoning.available', run_id: 'run-deep-readable', text: 'private reasoning' },
      { event: 'message.delta', run_id: 'run-deep-readable', delta: 'private draft text' },
      { event: 'tool.started', run_id: 'run-deep-readable', tool: 'skill_view', preview: 'OPENAI_API_KEY=sk-test-secret' },
      { event: 'tool.completed', run_id: 'run-deep-readable', tool: 'skill_view', duration: 0.2, error: false },
      { event: 'tool.started', run_id: 'run-deep-readable', tool: 'execute_code', preview: 'run collection pipeline' },
      { event: 'tool.completed', run_id: 'run-deep-readable', tool: 'execute_code', duration: 1.4, error: true },
      { event: 'run.completed', run_id: 'run-deep-readable' },
    ];
    return new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };

  try {
    const events: Array<Record<string, unknown>> = [];
    const result = await service.runStructuredSkillViaRunsApi({
      workflow: 'deep_report',
      deepReportEnabled: true,
      stage: 'source_collection',
      planningSessionId: 'job-deep-readable',
      topic: '测试主题',
      onEvent: (event: Record<string, unknown>) => events.push(event),
    }, 'collect sources');

    assert.match(result, /acceptedSources/);
    assert.ok(events.some((event) => event.type === 'tool_start' && event.name === 'skill_view'));
    assert.ok(events.some((event) => event.type === 'tool_end' && event.name === 'skill_view'));
    assert.ok(events.some((event) => event.type === 'tool_error' && event.name === 'execute_code'));
    const toolEvents = events.filter((event) => String(event.type).startsWith('tool_'));
    assert.ok(toolEvents.every((event) => (event.raw as Record<string, unknown>)?.phase === 'deep_source_collection'));
    assert.ok(toolEvents.every((event) => (event.raw as Record<string, unknown>)?.actor === 'research-agent'));
    assert.ok(events.some((event) => event.type === 'stage' && event.stage === 'deep_source_collection_validating'));
    assert.ok(!events.some((event) => event.type === 'stage' && event.stage === 'hermes_run_completed'));
    assert.doesNotMatch(JSON.stringify(events), /private reasoning|private draft text|sk-test-secret/);
    assert.match(JSON.stringify(events), /耗时 1\.4 秒/);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testDeepCollectionAlwaysFinishesEventStream() {
  const service = new HermesService({} as never, {} as never) as unknown as TestHermesService & {
    startRunsEventStream: () => Record<string, unknown>;
    finishRunsEventStream: (stream: Record<string, unknown> | null) => Promise<void>;
  };
  const marker = { stream: true };
  let finishCalls = 0;
  service.startRunsEventStream = () => marker;
  service.finishRunsEventStream = async (stream) => {
    assert.equal(stream, marker);
    finishCalls += 1;
  };
  service.fetchHermesRunsJson = async (_url, init) => {
    if (init?.method === 'POST') return { run_id: 'run-deep-failed', status: 'started' };
    return { run_id: 'run-deep-failed', status: 'failed', error: { message: 'provider unavailable' } };
  };

  await assert.rejects(
    service.runStructuredSkillViaRunsApi({
      workflow: 'deep_report',
      deepReportEnabled: true,
      stage: 'source_collection',
      planningSessionId: 'job-deep-failed',
      topic: '测试主题',
      onEvent: () => undefined,
    }, 'collect sources'),
    /provider unavailable/,
  );
  assert.equal(finishCalls, 1);
}

await testDeepCollectionStreamsHermesToolEvents();
await testDeepCollectionAlwaysFinishesEventStream();
console.log('Hermes deep collection readable event tests passed');
