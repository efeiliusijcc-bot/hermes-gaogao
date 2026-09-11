import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthUser } from '../server/auth-user.interface.js';
import { DraftAssistantService } from '../server/draft-assistant.service.js';
import { buildEventTaskPlan } from '../server/event-task-plan.js';
import { ReportsService } from '../server/reports.service.js';

const operator: AuthUser = {
  id: 'user-event-plan',
  username: 'operator-event-plan',
  displayName: '',
  email: null,
  role: 'operator',
  roles: ['operator'],
  modules: ['report', 'draft'],
  permissions: ['report:create', 'draft_assistant:create'],
};

function eventPlanning(topic = '测试事件') {
  return {
    intentRecognition: {
      detected: 'event_timeline' as const,
      resolved: 'event_timeline' as const,
      reason: '需要梳理事件脉络',
      source: 'model' as const,
    },
    eventTaskPlan: buildEventTaskPlan(topic),
  };
}

function remoteFsStub() {
  const files = new Map<string, string>();
  return {
    files,
    remoteDir: '/tmp/hermes-reports',
    joinPath: (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
    mkdir: async () => undefined,
    writeFile: async (path: string, content: string) => { files.set(path, content); },
    readFile: async (path: string) => {
      const content = files.get(path);
      if (content === undefined) throw new Error('missing');
      return content;
    },
    exists: async (path: string) => files.has(path),
    readdir: async () => [],
    stat: async () => ({ mtimeMs: Date.now() }),
    isInsideReportDir: () => true,
    remapToReportDir: (value: string) => value,
  };
}

function createReportsService() {
  const remoteFs = remoteFsStub();
  const service = new ReportsService({} as never, remoteFs as never, {} as never) as unknown as {
    jobs: Map<string, Record<string, unknown>>;
    createJob: ReportsService['createJob'];
    runJob: (job: unknown) => Promise<void>;
    writeJobState: (job: unknown) => Promise<void>;
    loadDraftAssistantPlanBundle: (planId: string, user: AuthUser) => Promise<Record<string, unknown>>;
    enrichPayloadWithDraftAssistantContext: (job: Record<string, unknown>, payload: Record<string, unknown>, user: AuthUser) => Promise<Record<string, unknown>>;
  };
  service.runJob = async () => undefined;
  service.writeJobState = async () => undefined;
  return { service, remoteFs };
}

function draftBundle(reportPlan: Record<string, unknown>) {
  return {
    planId: 'plan-authoritative',
    outlineId: 'outline-authoritative',
    eventId: 'event-authoritative',
    ownerId: operator.id,
    reportPlan,
    event: { eventId: 'event-authoritative', title: '测试事件' },
    sources: [],
    attitudes: [],
  };
}

test('direct report creation validates and persists the confirmed five-dimensional snapshot', async () => {
  const { service } = createReportsService();
  const planning = eventPlanning();
  const created = await service.createJob.call(service, {
    skill: 'write-hb',
    payload: {
      topic: '测试事件',
      report_type: 'K报',
      known_context: JSON.stringify({ kind: 'structured_report_context', topic: '测试事件', ...planning }),
    },
  }, operator);
  const stored = service.jobs.get(created.jobId);
  assert.ok(stored);
  const context = JSON.parse(String((stored.payload as Record<string, unknown>).known_context));
  assert.deepEqual(context.eventTaskPlan.tasks.map((task: { id: string }) => task.id), planning.eventTaskPlan.tasks.map((task) => task.id));
  assert.equal(context.intentRecognition.resolved, 'event_timeline');

  const invalid = {
    ...planning,
    eventTaskPlan: {
      ...planning.eventTaskPlan,
      tasks: planning.eventTaskPlan.tasks.map((task) => task.id === 'event_time' ? { ...task, searchQueries: [] } : task),
    },
  };
  await assert.rejects(
    () => service.createJob.call(service, {
      skill: 'write-hb',
      payload: { topic: '测试事件', report_type: 'K报', known_context: JSON.stringify(invalid) },
    }, operator),
    (error) => /发生时间.*1–3/.test(JSON.stringify((error as { response?: unknown }).response)),
  );
});

test('draft planId overrides or removes client-provided event planning fields', async () => {
  const { service } = createReportsService();
  const authoritative = eventPlanning('权威事件');
  authoritative.eventTaskPlan.tasks[1] = {
    ...authoritative.eventTaskPlan.tasks[1],
    objective: '数据库确认的参与方任务',
    searchQueries: ['权威事件 参与方'],
  };
  service.loadDraftAssistantPlanBundle = async () => draftBundle({ reportTitle: '权威事件', ...authoritative });
  const forged = eventPlanning('客户端伪造事件');
  const created = await service.createJob.call(service, {
    skill: 'write-hb',
    payload: {
      topic: '权威事件',
      report_type: 'K报',
      planId: 'plan-authoritative',
      known_context: JSON.stringify({ ...forged, clientNote: '保留普通客户端上下文' }),
    },
  }, operator);
  const stored = service.jobs.get(created.jobId);
  assert.ok(stored);
  const storedContext = JSON.parse(String((stored.payload as Record<string, unknown>).known_context));
  assert.equal(storedContext.clientNote, '保留普通客户端上下文');
  assert.equal(storedContext.eventTaskPlan.tasks[1].objective, '数据库确认的参与方任务');
  assert.doesNotMatch(JSON.stringify(storedContext), /客户端伪造事件/);

  service.loadDraftAssistantPlanBundle = async () => draftBundle({ reportTitle: '历史计划' });
  const historical = await service.createJob.call(service, {
    skill: 'write-hb',
    payload: {
      topic: '历史计划',
      report_type: 'K报',
      planId: 'plan-authoritative',
      known_context: JSON.stringify({ ...forged, clientNote: '历史任务' }),
    },
  }, operator);
  const historicalContext = JSON.parse(String((service.jobs.get(historical.jobId)!.payload as Record<string, unknown>).known_context));
  assert.equal(historicalContext.clientNote, '历史任务');
  assert.equal(historicalContext.intentRecognition, undefined);
  assert.equal(historicalContext.eventTaskPlan, undefined);
});

test('draft analysis confirmation flows into report_plans and report artifacts', async () => {
  const draft = new DraftAssistantService({} as never) as unknown as {
    generateOutline: DraftAssistantService['generateOutline'];
    importOutlineToReportPlan: DraftAssistantService['importOutlineToReportPlan'];
    loadEventForUser: () => Promise<Record<string, unknown>>;
    updateEventAnalysis: (eventId: string, analysis: Record<string, unknown>) => Promise<void>;
    listSources: () => Promise<unknown[]>;
    listAttitudes: () => Promise<unknown[]>;
    outlineUserPreferenceText: () => Promise<string>;
    generateOutlineJson: () => Promise<Record<string, unknown>>;
    insertOutline: () => Promise<Record<string, unknown>>;
    loadOutlineForUser: () => Promise<Record<string, unknown>>;
    getPool: () => Promise<{ query: (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }>;
  };
  const initial = eventPlanning('拟稿事件');
  const event: Record<string, unknown> = {
    eventId: 'event-draft',
    ownerId: operator.id,
    title: '拟稿事件',
    summary: '摘要',
    basicFacts: [],
    timeline: [],
    actors: [],
    category: '',
    region: '',
    rawInput: {},
    analysis: { oneSentenceSummary: '摘要', mainFacts: [], riskToUs: [], attitudes: [], ...initial },
  };
  let savedAnalysis: Record<string, unknown> | null = null;
  draft.loadEventForUser = async () => event;
  draft.updateEventAnalysis = async (_eventId, analysis) => {
    savedAnalysis = analysis;
    event.analysis = analysis;
  };
  draft.listSources = async () => [];
  draft.listAttitudes = async () => [];
  draft.outlineUserPreferenceText = async () => '';
  const outline = {
    reportTitle: '拟稿事件编报',
    reportTheme: '事件脉络',
    coreArgument: '核实事件发展',
    outlineItems: [{ level: 1, title: '主要内容', summary: '梳理事件', children: [] }],
    writingFocus: [],
    sourceRequirements: [],
    uncertaintiesToVerify: [],
  };
  draft.generateOutlineJson = async () => outline;
  draft.insertOutline = async () => ({ outlineId: 'outline-draft', eventId: 'event-draft', ownerId: operator.id, outline });
  const editedPlan = buildEventTaskPlan('拟稿事件');
  editedPlan.tasks[2] = { ...editedPlan.tasks[2], objective: '用户确认的事件原因任务', searchQueries: ['拟稿事件 原因核实'] };
  await draft.generateOutline.call(draft, {
    eventId: 'event-draft',
    intentRecognition: initial.intentRecognition,
    eventTaskPlan: editedPlan,
  }, operator);
  assert.ok(savedAnalysis);
  assert.equal((savedAnalysis!.eventTaskPlan as { tasks: Array<{ objective: string }> }).tasks[2].objective, '用户确认的事件原因任务');

  draft.loadOutlineForUser = async () => ({ outlineId: 'outline-draft', eventId: 'event-draft', ownerId: operator.id, outline });
  let insertedPlan: Record<string, unknown> | null = null;
  draft.getPool = async () => ({
    query: async (_sql, params) => {
      insertedPlan = JSON.parse(String(params[3]));
      return { rows: [{ plan_id: 'plan-draft', outline_id: 'outline-draft', event_id: 'event-draft', plan_json: insertedPlan, created_at: new Date() }] };
    },
  });
  const imported = await draft.importOutlineToReportPlan.call(draft, { outlineId: 'outline-draft' }, operator);
  assert.equal((insertedPlan!.eventTaskPlan as { tasks: Array<{ objective: string }> }).tasks[2].objective, '用户确认的事件原因任务');
  assert.deepEqual(imported.plan.eventTaskPlan, insertedPlan!.eventTaskPlan);

  const { service, remoteFs } = createReportsService();
  const bundle = draftBundle(insertedPlan!);
  service.loadDraftAssistantPlanBundle = async () => bundle;
  const job = {
    jobId: 'job-artifact',
    skill: 'write-hb',
    planId: bundle.planId,
    artifacts: {},
    events: [],
    eventLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'running',
  };
  const enriched = await service.enrichPayloadWithDraftAssistantContext(
    job,
    { topic: '拟稿事件', report_type: 'K报', planId: bundle.planId, known_context: JSON.stringify(eventPlanning('伪造事件')) },
    operator,
  );
  const enrichedContext = JSON.parse(String(enriched.known_context));
  assert.equal(enrichedContext.eventTaskPlan.tasks[2].objective, '用户确认的事件原因任务');
  const artifactContext = JSON.parse(remoteFs.files.get('/tmp/hermes-reports/job-artifact/context.json') || '{}');
  const reportPlanArtifact = JSON.parse(remoteFs.files.get('/tmp/hermes-reports/job-artifact/database/report_plan.json') || '{}');
  assert.equal(artifactContext.eventTaskPlan.tasks[2].objective, '用户确认的事件原因任务');
  assert.equal(reportPlanArtifact.eventTaskPlan.tasks[2].objective, '用户确认的事件原因任务');
});

test('draft outline generation blocks unresolved stored intent even when a rolling client omits new fields', async () => {
  const draft = new DraftAssistantService({} as never) as unknown as {
    generateOutline: DraftAssistantService['generateOutline'];
    loadEventForUser: () => Promise<Record<string, unknown>>;
  };
  draft.loadEventForUser = async () => ({
    eventId: 'event-uncertain',
    ownerId: operator.id,
    title: '信息不足主题',
    analysis: {
      intentRecognition: { detected: 'uncertain', resolved: null, reason: '信息不足', source: 'fallback' },
      eventTaskPlan: buildEventTaskPlan('信息不足主题'),
    },
  });
  await assert.rejects(
    () => draft.generateOutline.call(draft, { eventId: 'event-uncertain' }, operator),
    (error) => /请先确认/.test(JSON.stringify((error as { response?: unknown }).response)),
  );
});
