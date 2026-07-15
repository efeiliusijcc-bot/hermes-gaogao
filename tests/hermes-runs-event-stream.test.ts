import assert from 'node:assert/strict';

import {
  consumeHermesRunEventStream,
  HermesRunEventBridge,
  HermesRunEventStreamParser,
  type ReadableToolSummary,
} from '../server/hermes-run-events.js';

function describeTool(input: { name: string; preview: string; status: string }): ReadableToolSummary {
  const database = /pg|database/i.test(`${input.name} ${input.preview}`);
  const label = database ? 'PG向量信源检索' : '执行编报步骤';
  const action = input.status === 'started' ? '正在执行' : input.status === 'failed' ? '执行失败' : '执行完成';
  return {
    phase: database ? 'research_collecting' : 'technical_detail',
    actor: 'main-agent',
    label,
    summary: `${label}${action}。`,
    detail: input.preview,
  };
}

function testSseChunkParsing() {
  const parser = new HermesRunEventStreamParser();
  const first = parser.push(': keepalive\r\n\r\ndata: {"event":"tool.started","run_id":"run-1",');
  assert.deepEqual(first, []);

  const second = parser.push('"timestamp":1,"tool":"pg-sources__query","preview":"query"}\r\n\r\n');
  assert.equal(second.length, 1);
  assert.equal(second[0].event, 'tool.started');
  assert.equal(second[0].tool, 'pg-sources__query');

  assert.deepEqual(parser.push('data: not-json\n\n'), []);
  assert.deepEqual(parser.finish(), []);

  const splitBoundary = new HermesRunEventStreamParser();
  assert.deepEqual(splitBoundary.push('data: {"event":"run.completed"}\r'), []);
  assert.equal(splitBoundary.push('\n\r\n').at(0)?.event, 'run.completed');
}

function testToolPairingAndIgnoredContent() {
  const bridge = new HermesRunEventBridge(describeTool);
  const secretReasoning = 'private chain of thought';
  const reportFragment = 'classified report paragraph';

  assert.deepEqual(bridge.translate({ event: 'reasoning.available', run_id: 'run-1', text: secretReasoning }), []);
  assert.deepEqual(bridge.translate({ event: 'message.delta', run_id: 'run-1', delta: reportFragment }), []);

  const firstStart = bridge.translate({
    event: 'tool.started',
    run_id: 'run-1',
    timestamp: 1,
    tool: 'pg-sources__query',
    preview: 'query one',
  });
  const secondStart = bridge.translate({
    event: 'tool.started',
    run_id: 'run-1',
    timestamp: 2,
    tool: 'pg-sources__query',
    preview: 'query two',
  });
  const firstEnd = bridge.translate({
    event: 'tool.completed',
    run_id: 'run-1',
    timestamp: 3,
    tool: 'pg-sources__query',
    duration: 1.25,
    error: false,
  });
  const secondEnd = bridge.translate({
    event: 'tool.completed',
    run_id: 'run-1',
    timestamp: 4,
    tool: 'pg-sources__query',
    duration: 2.5,
    error: true,
  });
  const emptyErrorEnd = bridge.translate({
    event: 'tool.completed',
    run_id: 'run-1',
    timestamp: 5,
    tool: 'web_search',
    duration: 0.2,
    error: '',
  });

  assert.equal(firstStart[0].type, 'tool_start');
  assert.equal(secondStart[0].type, 'tool_start');
  assert.notEqual(firstStart[0].id, secondStart[0].id);
  assert.equal(firstEnd[0].id, firstStart[0].id);
  assert.equal(secondEnd[0].id, secondStart[0].id);
  assert.equal(firstEnd[0].type, 'tool_end');
  assert.equal(secondEnd[0].type, 'tool_error');
  assert.equal(emptyErrorEnd[0].type, 'tool_end');
  assert.match(JSON.stringify(firstEnd[0]), /耗时 1\.25 秒/);
  assert.doesNotMatch(JSON.stringify([...firstStart, ...secondStart, ...firstEnd, ...secondEnd]), /chain of thought|classified report/);
}

function testLifecycleEvents() {
  const bridge = new HermesRunEventBridge(describeTool);
  const approval = bridge.translate({ event: 'approval.request', run_id: 'run-1', timestamp: 5 });
  const complete = bridge.translate({ event: 'run.completed', run_id: 'run-1', timestamp: 6 });
  const failed = bridge.translate({ event: 'run.failed', run_id: 'run-2', timestamp: 7, error: 'provider unavailable' });

  assert.deepEqual(approval, [{
    type: 'stage',
    stage: 'approval_required',
    message: '编报智能体正在等待必要的工具授权。',
  }]);
  assert.deepEqual(complete, [{
    type: 'stage',
    stage: 'hermes_run_completed',
    message: '编报智能体已完成核心执行，正在整理报告产物。',
  }]);
  assert.equal(failed[0].type, 'error');
  assert.match(failed[0].message, /provider unavailable/);
}

async function testStreamConsumptionAndInitialRetry() {
  let attempts = 0;
  const chunks = [
    'data: {"event":"tool.started","run_id":"run-1","tool":"web_search"}\n\n',
    ': keepalive\n\ndata: {"event":"tool.completed","run_id":"run-1","tool":"web_search","duration":2}\n\n',
  ];
  const fetchImpl: typeof fetch = async () => {
    attempts += 1;
    if (attempts < 3) return new Response('not ready', { status: 404 });
    return new Response(new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  const received: string[] = [];
  const result = await consumeHermesRunEventStream({
    url: 'http://hermes/v1/runs/run-1/events',
    headers: { Authorization: 'Bearer hidden' },
    fetchImpl,
    initialRetryCount: 2,
    retryDelayMs: 0,
    onEvent: (event) => received.push(event.event),
  });

  assert.equal(attempts, 3);
  assert.deepEqual(received, ['tool.started', 'tool.completed']);
  assert.deepEqual(result, { connected: true, eventCount: 2 });
}

async function testStreamConnectionFailure() {
  await assert.rejects(
    consumeHermesRunEventStream({
      url: 'http://hermes/v1/runs/run-2/events',
      fetchImpl: async () => new Response('unavailable', { status: 503 }),
      initialRetryCount: 0,
      retryDelayMs: 0,
      onEvent: () => undefined,
    }),
    /status 503/,
  );
}

async function testStreamRetriesThrownConnectionErrors() {
  let attempts = 0;
  const result = await consumeHermesRunEventStream({
    url: 'http://hermes/v1/runs/run-network-retry/events',
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('connection reset');
      return new Response('data: {"event":"run.completed"}\n\n', { status: 200 });
    },
    initialRetryCount: 1,
    retryDelayMs: 0,
    onEvent: () => undefined,
  });

  assert.equal(attempts, 2);
  assert.equal(result.eventCount, 1);
}

testSseChunkParsing();
testToolPairingAndIgnoredContent();
testLifecycleEvents();
await testStreamConsumptionAndInitialRetry();
await testStreamConnectionFailure();
await testStreamRetriesThrownConnectionErrors();
console.log('Hermes runs event stream tests passed');
