import fs from 'node:fs/promises';
import path from 'node:path';

if (process.env.RUN_LIVE_REPORT_E2E_TESTS !== 'true') {
  console.log('Live report E2E validation is disabled.\nSet RUN_LIVE_REPORT_E2E_TESTS=true to run.');
  process.exit(0);
}

const baseUrl = String(process.env.E2E_BASE_URL || 'http://127.0.0.1:3101').replace(/\/$/, '');
const timeoutMs = Math.max(10 * 60_000, Number(process.env.E2E_REPORT_TIMEOUT_MS || 15 * 60_000));
const pollIntervalMs = Math.max(3_000, Number(process.env.E2E_POLL_INTERVAL_MS || 5_000));
const username = requiredEnv('E2E_TEST_USERNAME');
const password = requiredEnv('E2E_TEST_PASSWORD');
const peerUsername = requiredEnv('E2E_PEER_USERNAME');
const peerPassword = requiredEnv('E2E_PEER_PASSWORD');
const adminUsername = requiredEnv('E2E_ADMIN_USERNAME');
const adminPassword = requiredEnv('E2E_ADMIN_PASSWORD');

type Session = { token: string; refreshCookie: string; user: { id: string; username: string } };
type Json = Record<string, unknown>;
type Scenario = { id: string; topic: string; expectWeb: boolean; confusion?: string[]; insufficient?: boolean; entityPolicy?: Json };

const scenarios: Scenario[] = [
  { id: 'magnequench', topic: 'NEO下属子公司麦格昆磁近期在生产工艺、中试、量产的主要动向', expectWeb: true, confusion: ['Micron', '美光'] },
  {
    id: 'database-sufficient',
    topic: '普京宣布俄罗斯国家杜马选举日期及选举安排',
    expectWeb: false,
    entityPolicy: {
      coreEntities: [{ canonical: '俄罗斯国家杜马', type: 'organization', aliases: ['国家杜马', 'State Duma', 'Gosduma', 'Государственная Дума'], importance: 'primary' }],
      entityRelations: [],
      topicTerms: ['选举', '投票', '中央选举委员会', '2026年9月20日'],
      actionTerms: ['宣布', '签署', '举行', '邀请观察员'],
      timeConstraints: ['2026'],
      locationConstraints: ['俄罗斯'],
      ambiguousTerms: [],
      possibleConfusions: [{ entity: '俄罗斯联邦委员会', aliases: ['Federation Council', '俄联邦委员会'], reason: '上议院并非国家杜马' }],
      requiredEntityMatch: true,
      searchQueries: ['普京 俄罗斯国家杜马 选举 2026', '俄罗斯国家杜马 选举日期 选举安排', 'Putin State Duma election date 2026', 'Выборы в Государственную Думу 2026'],
      confidence: 0.99,
      generatedBy: 'existing',
    },
  },
  { id: 'arm-confusion', topic: 'Arm Holdings近期芯片授权与业绩变化', expectWeb: true, confusion: ['army', 'military', '军队'] },
  { id: 'insufficient', topic: '未公开的北极小型稀土磁体试验项目2026年7月内部量产数据', expectWeb: true, insufficient: true },
];

function requiredEnv(name: string): string {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required for live report E2E validation.`);
  return value;
}

async function login(loginUsername: string, loginPassword: string): Promise<Session> {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: loginUsername, password: loginPassword }) });
  const body = await response.json().catch(() => ({})) as Json;
  if (!response.ok || !body.access_token || !body.user) throw new Error(`login failed (${response.status})`);
  const refreshCookie = response.headers.get('set-cookie')?.split(';')[0] || '';
  if (!refreshCookie) throw new Error('login did not return a refresh cookie');
  return { token: String(body.access_token), refreshCookie, user: body.user as Session['user'] };
}

async function refresh(session: Session): Promise<void> {
  const response = await fetch(`${baseUrl}/api/auth/refresh`, { method: 'POST', headers: { Cookie: session.refreshCookie } });
  const body = await response.json().catch(() => ({})) as Json;
  if (!response.ok || !body.access_token) throw new Error(`token refresh failed (${response.status})`);
  session.token = String(body.access_token);
  session.refreshCookie = response.headers.get('set-cookie')?.split(';')[0] || session.refreshCookie;
}

async function request(session: Session, pathname: string, init: RequestInit = {}): Promise<{ status: number; body: Json | string }> {
  let response = await fetch(`${baseUrl}${pathname}`, { ...init, headers: { Authorization: `Bearer ${session.token}`, ...(init.headers || {}) } });
  if (response.status === 401) {
    await refresh(session);
    response = await fetch(`${baseUrl}${pathname}`, { ...init, headers: { Authorization: `Bearer ${session.token}`, ...(init.headers || {}) } });
  }
  const text = await response.text();
  let body: Json | string = text;
  try { body = JSON.parse(text) as Json; } catch { /* markdown download */ }
  return { status: response.status, body };
}

function context(scenario: Scenario) {
  return JSON.stringify({ topic: scenario.topic, entityPolicy: scenario.entityPolicy, databaseSourceOptions: { enabled: true }, webSearchOptions: { enabled: true }, sourceSupplementOptions: { enabled: true, minimumAcceptedDatabaseSources: 3 } });
}

async function waitForTerminal(session: Session, jobId: string): Promise<Json> {
  const deadline = Date.now() + timeoutMs;
  let last: Json = {};
  while (Date.now() < deadline) {
    const response = await request(session, `/api/report-jobs/${encodeURIComponent(jobId)}`);
    if (response.status !== 200 || typeof response.body === 'string') throw new Error(`job detail failed (${response.status})`);
    last = response.body;
    if (['succeeded', 'failed', 'cancelled'].includes(String(last.status))) return last;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return { ...last, status: 'timeout', errorMessage: 'E2E polling timeout' };
}

function urls(items: unknown): Set<string> {
  return new Set((Array.isArray(items) ? items : []).map((item) => String((item as Json).url || '')).filter(Boolean));
}

async function validateScenario(session: Session, scenario: Scenario) {
  const created = await request(session, '/api/report-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skill: 'write-hb', payload: { topic: scenario.topic, report_type: 'HB报', known_context: context(scenario) } }) });
  if (created.status !== 201 || typeof created.body === 'string') throw new Error(`${scenario.id}: create failed (${created.status})`);
  const jobId = String(created.body.jobId || '');
  const startedAt = Date.now();
  const job = await waitForTerminal(session, jobId);
  const [result, artifacts, database, all, web, refs, candidates, eventLog, download] = await Promise.all([
    request(session, `/api/report-jobs/${jobId}/result`), request(session, `/api/report-jobs/${jobId}/artifacts`), request(session, `/api/report-jobs/${jobId}/database-sources`), request(session, `/api/report-jobs/${jobId}/sources?type=all&pageSize=100`), request(session, `/api/report-jobs/${jobId}/sources?type=tool_search&pageSize=100`), request(session, `/api/report-jobs/${jobId}/sources?type=report_refs&pageSize=100`), request(session, `/api/report-jobs/${jobId}/sources?type=candidate_hits&pageSize=100`), request(session, `/api/report-jobs/${jobId}/event-log`), request(session, `/api/report-jobs/${jobId}/download?format=md`),
  ]);
  const databaseBody = typeof database.body === 'string' ? {} : database.body;
  const allBody = typeof all.body === 'string' ? {} : all.body;
  const webBody = typeof web.body === 'string' ? {} : web.body;
  const refsBody = typeof refs.body === 'string' ? {} : refs.body;
  const acceptedUrls = new Set([...urls(databaseBody.sources), ...urls(webBody.items)]);
  const refItems = Array.isArray(refsBody.items) ? refsBody.items as Json[] : [];
  const invalidReferences = refItems.filter((item) => String(item.url || '') && !acceptedUrls.has(String(item.url)));
  const markdown = typeof download.body === 'string' ? download.body : '';
  const confusionMentioned = (scenario.confusion || []).filter((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(markdown));
  const diagnostics = ((allBody.meta as Json | undefined)?.sourceDiagnostics || {}) as Json;
  const supplement = (diagnostics.supplement || {}) as Json;
  const metrics = (supplement.retrievalMetrics || {}) as Json;
  const finalMetrics = (metrics.final || {}) as Json;
  const rejectedCount = Number(supplement.rejectedCount || 0);
  const resultSummary = {
    id: scenario.id, jobId, topic: scenario.topic, ownerUserId: session.user.id, status: String(job.status || ''), error: String(job.errorMessage || ''), totalDurationMs: Date.now() - startedAt,
    webTriggered: supplement.triggered === true, expectedWeb: scenario.expectWeb,
    databaseAccepted: Number((diagnostics.database as Json | undefined)?.acceptedCount || 0), webAccepted: Number((diagnostics.web as Json | undefined)?.acceptedCount || 0),
    finalAccepted: Number(finalMetrics.acceptedSourceCount || 0), referenceCount: refItems.length, referenceCoverageRate: Number(finalMetrics.acceptedSourceCount || 0) ? refItems.length / Number(finalMetrics.acceptedSourceCount || 0) : 0,
    rejectedCount, rejectedInMainList: (Array.isArray(allBody.items) ? allBody.items : []).some((item) => String((item as Json).status || '').match(/rejected|uncertain/i)), rejectedInReferences: invalidReferences.length > 0,
    acceptedWebUsed: refItems.some((item) => urls(webBody.items).has(String(item.url || ''))), markdownLength: markdown.length,
    confusionMentioned, apiStatuses: { result: result.status, artifacts: artifacts.status, database: database.status, all: all.status, web: web.status, refs: refs.status, candidates: candidates.status, eventLog: eventLog.status, download: download.status },
    sourceOrdering: (Array.isArray(allBody.items) ? allBody.items : []).map((item) => Number((item as Json).relevanceScore || (item as Json).sourcePriority || 0)).every((value, index, values) => index === 0 || value <= values[index - 1]),
  };
  return resultSummary;
}

const main = async () => {
  const [owner, peer, admin] = await Promise.all([login(username, password), login(peerUsername, peerPassword), login(adminUsername, adminPassword)]);
  const results: Json[] = [];
  for (const scenario of scenarios) {
    try { results.push(await validateScenario(owner, scenario)); }
    catch (error) { results.push({ id: scenario.id, status: 'validation_error', error: String(error instanceof Error ? error.message : error) }); }
  }
  const ownerJobId = String(results.find((item) => item.jobId)?.jobId || '');
  const isolationPaths = ownerJobId ? [`/api/report-jobs/${ownerJobId}`, `/api/report-jobs/${ownerJobId}/result`, `/api/report-jobs/${ownerJobId}/artifacts`, `/api/report-jobs/${ownerJobId}/sources?type=all`, `/api/report-jobs/${ownerJobId}/download?format=md`] : [];
  const peerStatuses = await Promise.all(isolationPaths.map(async (pathname) => (await request(peer, pathname)).status));
  const adminStatuses = await Promise.all(isolationPaths.map(async (pathname) => (await request(admin, pathname)).status));
  const report = { generatedAt: new Date().toISOString(), baseUrl, validationUser: owner.user.username, scenarioResults: results, ownerIsolation: { peerStatuses, peerPass: peerStatuses.every((status) => status === 403 || status === 404), adminStatuses, adminPass: adminStatuses.every((status) => status === 200 || status === 409) } };
  const outputPath = path.join(process.cwd(), 'report-e2e-production-validation.json');
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ outputPath, scenarios: results.map((item) => ({ id: item.id, jobId: item.jobId, status: item.status, webTriggered: item.webTriggered })), ownerIsolation: report.ownerIsolation }, null, 2));
};

void main();
