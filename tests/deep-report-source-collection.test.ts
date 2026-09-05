import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DeepReportSourceCollectionService } from '../server/deep-report-source-collection.service.js';
import { HermesService } from '../server/hermes.service.js';
import { ReportsService } from '../server/reports.service.js';

const root = new URL('..', import.meta.url);

function remoteFsStub() {
  return {
    remoteDir: '/tmp/hermes-reports',
    joinPath: (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
    mkdir: async () => undefined,
    writeFile: async () => undefined,
    readFile: async () => { throw new Error('missing'); },
    exists: async () => false,
    readdir: async () => [],
    stat: async () => ({ mtimeMs: Date.now() }),
    isInsideReportDir: () => true,
    remapToReportDir: (value: string) => value,
  };
}

function job(deepReportEnabled: boolean, skill = 'write-hb') {
  return {
    jobId: deepReportEnabled ? 'job-deep-report' : 'job-standard-report',
    skill,
    payload: {
      topic: deepReportEnabled ? '深度编报主题' : '普通编报主题',
      report_type: 'K报',
      deepReportEnabled,
      known_context: JSON.stringify({ selectedModules: [{ id: 'basic' }] }),
    },
    ownerUserId: 'user-1',
    ownerUsername: 'operator-1',
    ownerRole: 'operator',
    status: 'running',
    artifacts: {},
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
    events: [],
    eventLog: [],
  };
}

const acceptedSource = {
  title: '官方公告',
  url: 'https://example.com/notice',
  summary: '公告确认了核心事实。',
};

async function testServerGuardRejectsNonDeepReportContexts() {
  let calls = 0;
  const service = new DeepReportSourceCollectionService({
    runDeepReportSourceCollectionSkill: async () => {
      calls += 1;
      return {};
    },
  } as never);

  for (const input of [
    { workflow: 'chat', deepReportEnabled: true, stage: 'source_collection', planningSessionId: 'job-1', topic: '主题' },
    { workflow: 'deep_report', deepReportEnabled: false, stage: 'source_collection', planningSessionId: 'job-1', topic: '主题' },
    { workflow: 'deep_report', deepReportEnabled: true, stage: 'source_collection', planningSessionId: '', topic: '主题' },
    { workflow: 'deep_report', deepReportEnabled: true, stage: 'chat', planningSessionId: 'job-1', topic: '主题' },
  ]) {
    const result = await service.execute(input as never);
    assert.equal(result.status, 'not_available');
    assert.equal(result.reason, 'This skill is only available after Deep Report is enabled.');
  }
  assert.equal(calls, 0);
}

async function testValidDeepReportContextRunsSkillOnce() {
  const calls: Record<string, unknown>[] = [];
  const service = new DeepReportSourceCollectionService({
    runDeepReportSourceCollectionSkill: async (input: Record<string, unknown>) => {
      calls.push(input);
      return {
        acceptedSources: [acceptedSource],
        uncertainSources: [{ title: '待核验资料', url: 'https://example.org/pending' }],
        coveredGaps: ['项目真实性'],
        uncoveredGaps: ['投产时间'],
        summary: '已确认项目真实性，投产时间待核验。',
      };
    },
  } as never);

  const result = await service.execute({
    workflow: 'deep_report',
    deepReportEnabled: true,
    stage: 'source_collection',
    planningSessionId: 'job-deep-report',
    topic: '深度编报主题',
    plan: { selectedModules: [{ id: 'basic' }] },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].workflow, 'deep_report');
  assert.equal(calls[0].planningSessionId, 'job-deep-report');
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.acceptedSources, [acceptedSource]);
  assert.deepEqual(result.uncoveredGaps, ['投产时间']);
}

async function testSkillNotAvailableResponseIsNeverNormalizedAsSuccess() {
  const service = new DeepReportSourceCollectionService({
    runDeepReportSourceCollectionSkill: async () => ({
      status: 'not_available',
      reason: 'This skill is only available after Deep Report is enabled.',
    }),
  } as never);
  const result = await service.execute({
    workflow: 'deep_report',
    deepReportEnabled: true,
    stage: 'source_collection',
    planningSessionId: 'job-deep-report',
    topic: '深度编报主题',
  });

  assert.equal(result.status, 'not_available');
  assert.equal(result.reason, 'This skill is only available after Deep Report is enabled.');
}

async function testIncompleteSkillOutputFailsInsteadOfInventingEmptySuccess() {
  const service = new DeepReportSourceCollectionService({
    runDeepReportSourceCollectionSkill: async () => ({ summary: '缺少结构化数组。' }),
  } as never);
  await assert.rejects(
    service.execute({
      workflow: 'deep_report',
      deepReportEnabled: true,
      stage: 'source_collection',
      planningSessionId: 'job-deep-report',
      topic: '深度编报主题',
    }),
    /invalid structured output/i,
  );
}

async function testSnakeCaseCollectionResultIsNormalized() {
  const service = new DeepReportSourceCollectionService({
    runDeepReportSourceCollectionSkill: async () => ({
      status: 'partial',
      accepted_sources: [acceptedSource],
      uncertain_sources: [],
      covered_gaps: ['项目真实性'],
      uncovered_gaps: ['投产时间'],
      resultSummary: '字段使用蛇形命名，但结构有效。',
    }),
  } as never);
  const result = await service.execute({
    workflow: 'deep_report',
    deepReportEnabled: true,
    stage: 'source_collection',
    planningSessionId: 'job-deep-report',
    topic: '深度编报主题',
  });

  assert.equal(result.status, 'partial');
  assert.deepEqual(result.acceptedSources, [acceptedSource]);
  assert.deepEqual(result.uncoveredGaps, ['投产时间']);
  assert.equal(result.summary, '字段使用蛇形命名，但结构有效。');
}

function testNestedCollectionResultIsParsed() {
  const hermes = new HermesService({} as never, {} as never) as HermesService & {
    parseDeepReportSourceCollectionResult: (text: string) => Record<string, unknown> | null;
  };
  const parsed = hermes.parseDeepReportSourceCollectionResult(JSON.stringify({
    sourceCollectionResult: {
      status: 'completed',
      acceptedSources: [acceptedSource],
      uncertainSources: [],
      coveredGaps: ['项目真实性'],
      uncoveredGaps: [],
      summary: '已补充核验资料。',
    },
  }));

  assert.deepEqual(parsed?.acceptedSources, [acceptedSource]);
}

function testArbitraryJsonRunEnvelopeIsNotAcceptedAsCollectionResult() {
  const hermes = new HermesService({} as never, {} as never) as HermesService & {
    parseDeepReportSourceCollectionResult: (text: string) => Record<string, unknown> | null;
  };
  assert.equal(hermes.parseDeepReportSourceCollectionResult('{"id":"run_1","status":"completed"}'), null);
}

function reportsService(collector: { execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>> }) {
  return new ReportsService(
    {} as never,
    remoteFsStub() as never,
    {} as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    collector as never,
  ) as ReportsService & {
    enrichPayloadWithDeepReportSources: (
      reportJob: ReturnType<typeof job>,
      payload: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
    buildInitialProgressState: (reportJob: ReturnType<typeof job>) => { stages: Array<{ key: string; title: string }> };
  };
}

async function testNormalReportSkipsSkillAndKeepsProgressUnchanged() {
  let calls = 0;
  const service = reportsService({
    execute: async () => {
      calls += 1;
      return { status: 'completed' };
    },
  });
  const normalJob = job(false);
  const payload = normalJob.payload as Record<string, unknown>;
  const result = await service.enrichPayloadWithDeepReportSources(normalJob, payload);

  assert.equal(calls, 0);
  assert.equal(result, payload);
  assert.equal(result.deepReportSources, undefined);
  assert.equal(service.buildInitialProgressState(normalJob).stages.some((stage) => stage.key === 'deep_collection'), false);
}

async function testWriteHbUsesIntegratedResearchWorkflowWithoutDuplicateCollection() {
  const calls: Record<string, unknown>[] = [];
  const service = reportsService({
    execute: async (input) => {
      calls.push(input);
      return {
        status: 'completed',
        acceptedSources: [acceptedSource],
        uncertainSources: [],
        coveredGaps: ['项目真实性'],
        uncoveredGaps: [],
        summary: '核心事实已覆盖。',
      };
    },
  });
  const deepJob = job(true);
  const result = await service.enrichPayloadWithDeepReportSources(deepJob, deepJob.payload as Record<string, unknown>);

  assert.equal(calls.length, 0);
  assert.equal(result, deepJob.payload);
  assert.deepEqual((deepJob.artifacts as Record<string, unknown>).deepReportSourceCollection, {
    status: 'integrated',
    workflow: 'research_harness_orchestrate',
  });
  const stages = service.buildInitialProgressState(deepJob).stages;
  assert.equal(stages.some((stage) => stage.key === 'research'), false);
  assert.equal(stages.filter((stage) => stage.title === '资料深度采集').length, 1);
}

async function testWriteHbAlwaysGetsBackendPreparedContext() {
  const writes = new Map<string, string>();
  const remoteFs = {
    ...remoteFsStub(),
    writeFile: async (file: string, content: string) => { writes.set(file, content); },
  };
  const service = new ReportsService(
    {} as never,
    remoteFs as never,
    {} as never,
  ) as unknown as {
    ensureBackendReportContextArtifact: (
      reportJob: ReturnType<typeof job>,
      payload: Record<string, unknown>,
    ) => Promise<void>;
  };
  const reportJob = job(true);

  await service.ensureBackendReportContextArtifact(reportJob, reportJob.payload as Record<string, unknown>);

  const contextText = writes.get('/tmp/hermes-reports/job-deep-report/context.json');
  assert.ok(contextText);
  const context = JSON.parse(contextText);
  assert.equal(context.job_id, 'job-deep-report');
  assert.equal(context.topic, '深度编报主题');
  assert.equal(context.report_type, 'K报');
  assert.equal(context.deepReportEnabled, true);
  assert.deepEqual(context.selectedModules, [{ id: 'basic' }]);
}

async function testDeepReportCollectionFailureIsExplicitAndDoesNotCreateResults() {
  const service = reportsService({
    execute: async () => { throw new Error('provider unavailable'); },
  });
  const failedJob = job(true, 'risk-assessment-reports');
  await assert.rejects(
    service.enrichPayloadWithDeepReportSources(failedJob, failedJob.payload as Record<string, unknown>),
    /深度资料采集失败：provider unavailable/,
  );
  assert.equal((failedJob.artifacts as Record<string, unknown>).deepReportSourceCollection, undefined);
  assert.ok(failedJob.events.some((event: Record<string, unknown>) => (
    event.stage === 'deep_source_collection_failed'
    && String(event.message).includes('深度资料采集失败')
  )));
}

async function testNonWriteHbDeepReportStillUsesSeparateCollection() {
  const calls: Record<string, unknown>[] = [];
  const service = reportsService({
    execute: async (input) => {
      calls.push(input);
      return {
        status: 'completed',
        acceptedSources: [acceptedSource],
        uncertainSources: [],
        coveredGaps: [],
        uncoveredGaps: [],
        summary: '人物或风险报告仍保留独立采集。',
      };
    },
  });
  const separateJob = job(true, 'risk-assessment-reports');
  const result = await service.enrichPayloadWithDeepReportSources(separateJob, separateJob.payload as Record<string, unknown>);
  assert.equal(calls.length, 1);
  assert.deepEqual((result.deepReportSources as Record<string, unknown>).acceptedSources, [acceptedSource]);
}

async function testFrontendHidesReportModeOptionsAndDefaultsToDeepReport() {
  const [canvas, app, jobs, draft, deploy, hermes, reports, appModule, skill, runtimeWriteHb] = await Promise.all([
    readFile(new URL('b_k3ewYvsOEc1/src/components/DataCanvas.vue', root), 'utf8'),
    readFile(new URL('b_k3ewYvsOEc1/src/App.vue', root), 'utf8'),
    readFile(new URL('b_k3ewYvsOEc1/src/composables/useReportJobs.js', root), 'utf8'),
    readFile(new URL('b_k3ewYvsOEc1/src/components/DraftAssistant.vue', root), 'utf8'),
    readFile(new URL('deploy.sh', root), 'utf8'),
    readFile(new URL('server/hermes.service.ts', root), 'utf8'),
    readFile(new URL('server/reports.service.ts', root), 'utf8'),
    readFile(new URL('server/app.module.ts', root), 'utf8'),
    readFile(new URL('skills/planning-source-collection/SKILL.md', root), 'utf8'),
    readFile(new URL('deploy/runtime-skills/write-hb/SKILL.md', root), 'utf8'),
  ]);

  assert.doesNotMatch(canvas, /使用个人偏好和默认模板/);
  assert.doesNotMatch(canvas, /:checked="(?:useMyPreferences|deepReportEnabled)"/);
  assert.match(canvas, /key: 'deep_collection'/);
  assert.match(app, /v-model:deepReportEnabled="deepReportEnabled"/);
  assert.match(jobs, /const deepReportEnabled = ref\(true\)/);
  assert.doesNotMatch(jobs, /deepReportEnabled:\s*deepReportEnabled\.value === true/);
  assert.match(jobs, /useMyPreferences:\s*false/);
  assert.match(jobs, /deepReportEnabled:\s*true/);
  assert.match(draft, /deepReportEnabled:\s*true/);
  assert.doesNotMatch(`${canvas}\n${app}\n${jobs}`, /标准采集|Skill采集|采集执行方式/);
  assert.match(deploy, /SKILLS_ROOT\/planning-source-collection/);
  assert.match(hermes, /runDeepReportSourceCollectionSkill/);
  assert.match(hermes, /orchestrate --job-id/);
  assert.doesNotMatch(hermes, /harness_cli\.py plan --job-dir/);
  const preparationIndex = reports.indexOf('enrichPayloadWithDraftAssistantContext(job');
  const deepCollectionIndex = reports.indexOf('enrichPayloadWithDeepReportSources(job');
  const generationIndex = reports.indexOf('const runInput: RunInput');
  assert.ok(preparationIndex >= 0 && preparationIndex < deepCollectionIndex && deepCollectionIndex < generationIndex);
  assert.doesNotMatch(appModule, /PlanningCollectionController|CrawlerController/);
  assert.match(skill, /workflow.*deep_report/si);
  assert.match(skill, /deepReportEnabled.*true/si);
  assert.match(skill, /This skill is only available after Deep Report is enabled\./);
  assert.match(runtimeWriteHb, /harness_cli\.py orchestrate --job-id \{jobId\}/);
  assert.match(runtimeWriteHb, /不得再次调用 `pg-sources__query`/);
  assert.match(runtimeWriteHb, /chmod 0644 \/opt\/data\/workspace\/report-agent\/reports\/\{jobId\}\/final\/report\.md/);
  assert.match(runtimeWriteHb, /test -r \/opt\/data\/workspace\/report-agent\/reports\/\{jobId\}\/final\/report\.md/);
  assert.match(runtimeWriteHb, /chown 1000:1000 .*references\/report_references\.json/);
  assert.match(runtimeWriteHb, /test -w \/opt\/data\/workspace\/report-agent\/reports\/\{jobId\}\/references\/report_references\.json/);
  assert.match(runtimeWriteHb, /锚点在目标文件中只出现一次/);
  assert.doesNotMatch(runtimeWriteHb, /必须启动 .*Sub-Agent/);
}

function testOrdinaryReportPromptIsByteForByteUnchangedByFalseFlag() {
  const hermes = new HermesService({} as never, {} as never) as HermesService & {
    buildReportPrompt: (input: Record<string, unknown>) => string;
    buildContextJsonPayload: (input: Record<string, unknown>) => Record<string, unknown>;
  };
  const base = {
    skill: 'write-hb',
    jobId: 'job-prompt',
    payload: {
      topic: '普通编报主题',
      report_type: 'K报',
      known_context: JSON.stringify({ selectedModules: [] }),
    },
  };
  assert.equal(
    hermes.buildReportPrompt(base),
    hermes.buildReportPrompt({ ...base, payload: { ...base.payload, deepReportEnabled: false } }),
  );

  const deepInput = {
    ...base,
    payload: {
      ...base.payload,
      deepReportEnabled: true,
      deepReportSources: {
        acceptedSources: [acceptedSource],
        uncertainSources: [],
        coveredGaps: ['项目真实性'],
        uncoveredGaps: [],
        summary: '核心事实已覆盖。',
      },
    },
  };
  const context = hermes.buildContextJsonPayload(deepInput).context_json as Record<string, unknown>;
  assert.equal(context.deepReportEnabled, true);
  assert.deepEqual((context.deepReportSources as Record<string, unknown>).acceptedSources, [acceptedSource]);
  const prompt = hermes.buildReportPrompt(deepInput);
  assert.match(prompt, /orchestrate --job-id job-prompt/);
  assert.match(prompt, /REPORT_FILE: \/opt\/data\/workspace\/report-agent\/reports\/job-prompt\/final\/report\.md/);
  assert.doesNotMatch(prompt, /REPORT_FILE: \/opt\/data\/workspace\/report-agent\/reports\/实际文件名\.md/);
  assert.doesNotMatch(prompt, /在公开检索前调用 MCP 工具 pg-sources__query/);
  assert.doesNotMatch(prompt, /deepReportSources/);
  assert.doesNotMatch(prompt, /context_json_serialized/);

  const databasePrompt = hermes.buildReportPrompt({
    ...deepInput,
    payload: {
      ...deepInput.payload,
      known_context: JSON.stringify({ databaseSourceOptions: { enabled: true } }),
    },
  });
  assert.match(databasePrompt, /读取后端已生成的 database\/database_query_plan\.json/);
  assert.match(databasePrompt, /不得再次调用 pg-sources__query/);
  assert.match(databasePrompt, /"referenceGuardVersion":2/);
}

await testServerGuardRejectsNonDeepReportContexts();
await testValidDeepReportContextRunsSkillOnce();
await testSkillNotAvailableResponseIsNeverNormalizedAsSuccess();
await testIncompleteSkillOutputFailsInsteadOfInventingEmptySuccess();
await testSnakeCaseCollectionResultIsNormalized();
testNestedCollectionResultIsParsed();
testArbitraryJsonRunEnvelopeIsNotAcceptedAsCollectionResult();
await testNormalReportSkipsSkillAndKeepsProgressUnchanged();
await testWriteHbUsesIntegratedResearchWorkflowWithoutDuplicateCollection();
await testWriteHbAlwaysGetsBackendPreparedContext();
await testDeepReportCollectionFailureIsExplicitAndDoesNotCreateResults();
await testNonWriteHbDeepReportStillUsesSeparateCollection();
await testFrontendHidesReportModeOptionsAndDefaultsToDeepReport();
testOrdinaryReportPromptIsByteForByteUnchangedByFalseFlag();
console.log('deep report source collection tests passed');
