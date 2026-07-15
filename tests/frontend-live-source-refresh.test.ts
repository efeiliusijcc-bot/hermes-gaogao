import assert from 'node:assert/strict';

const moduleUrl = new URL(
  '../b_k3ewYvsOEc1/src/lib/liveSourceRefresh.js',
  import.meta.url,
);
const liveSourceRefresh = await import(moduleUrl.href).catch(() => null);

assert.equal(
  typeof liveSourceRefresh?.createLiveSourceRefreshController,
  'function',
  'live source refresh controller must be exported',
);

const { createLiveSourceRefreshController } = liveSourceRefresh;

function createFakeTimers() {
  let nextId = 0;
  const timers = new Map();
  const cleared = [];
  const delays = [];

  return {
    setInterval(callback, delay) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { callback, delay });
      delays.push(delay);
      return id;
    },
    clearInterval(id) {
      cleared.push(id);
      timers.delete(id);
    },
    activeCount() {
      return timers.size;
    },
    runActive() {
      for (const timer of timers.values()) timer.callback();
    },
    cleared,
    delays,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function runningSourceContext(overrides = {}) {
  return {
    activeTab: 'sources',
    jobId: 'job-1',
    status: 'running',
    ...overrides,
  };
}

{
  const timers = createFakeTimers();
  let refreshCount = 0;
  const controller = createLiveSourceRefreshController({
    intervalMs: 5000,
    setIntervalFn: timers.setInterval,
    clearIntervalFn: timers.clearInterval,
    onRefresh: () => {
      refreshCount += 1;
    },
  });

  controller.sync(runningSourceContext({ activeTab: 'report' }));
  controller.sync(runningSourceContext({ status: 'succeeded' }));
  controller.sync(runningSourceContext({ jobId: '' }));
  assert.equal(timers.activeCount(), 0, 'polling starts only for a live Sources job');

  controller.sync(runningSourceContext({ status: 'queued' }));
  timers.runActive();
  assert.equal(refreshCount, 1, 'a queued Sources job refreshes on its timer');
  assert.deepEqual(timers.delays, [5000], 'polling keeps the five-second refresh interval');

  controller.sync(runningSourceContext());
  controller.sync(runningSourceContext());
  assert.equal(timers.activeCount(), 1, 're-syncing an unchanged live job does not duplicate its timer');

  controller.sync(runningSourceContext({ activeTab: 'report' }));
  assert.equal(timers.activeCount(), 0, 'leaving Sources stops polling');

  controller.sync(runningSourceContext());
  controller.sync(runningSourceContext({ status: 'succeeded' }));
  assert.equal(timers.activeCount(), 0, 'a terminal status stops polling');

  controller.sync(runningSourceContext());
  controller.sync(runningSourceContext({ jobId: 'job-2' }));
  assert.equal(timers.activeCount(), 1, 'a job change replaces the previous timer');
  assert.ok(timers.cleared.length >= 3, 'tab, status, and job changes clear their old timers');

  controller.stop();
  assert.equal(timers.activeCount(), 0, 'unmount cleanup stops polling');
}

{
  const timers = createFakeTimers();
  const controller = createLiveSourceRefreshController({
    intervalMs: 5000,
    setIntervalFn: timers.setInterval,
    clearIntervalFn: timers.clearInterval,
    onRefresh: () => {},
  });
  const request = deferred();

  controller.sync(runningSourceContext());
  const pending = controller.runRequest({
    request: () => request.promise,
    preserveOnError: true,
    hasExistingRows: true,
  });
  controller.stop();
  request.resolve({ items: ['late source'] });

  assert.deepEqual(
    await pending,
    { kind: 'stale' },
    'a response completed after unmount cannot update source refs',
  );
}

{
  const timers = createFakeTimers();
  const controller = createLiveSourceRefreshController({
    intervalMs: 5000,
    setIntervalFn: timers.setInterval,
    clearIntervalFn: timers.clearInterval,
    onRefresh: () => {},
  });
  controller.sync(runningSourceContext());

  const automaticRequest = deferred();
  const automaticPending = controller.runRequest({
    request: () => automaticRequest.promise,
    preserveOnError: true,
    hasExistingRows: true,
  });
  automaticRequest.reject(new Error('network unavailable'));
  const automaticFailure = await automaticPending;
  assert.equal(automaticFailure.kind, 'failure');
  assert.equal(automaticFailure.preserveExistingRows, true, 'automatic refresh keeps old rows on failure');
  assert.equal(automaticFailure.errorMessage, '');

  const manualRequest = deferred();
  const manualPending = controller.runRequest({
    request: () => manualRequest.promise,
    preserveOnError: false,
    hasExistingRows: true,
  });
  manualRequest.reject(new Error('network unavailable'));
  const manualFailure = await manualPending;
  assert.equal(manualFailure.kind, 'failure');
  assert.equal(manualFailure.preserveExistingRows, false);
  assert.equal(manualFailure.errorMessage, '信源加载失败，请稍后重试。', 'manual refresh failures remain visible');
}

console.log('frontend live source refresh tests passed');
