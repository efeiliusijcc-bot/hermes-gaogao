import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildReadableExecutionLogs,
  sanitizeReportExecutionText,
  translateHermesExecutionLog,
} from '../b_k3ewYvsOEc1/src/lib/reportExecutionLogs.js'
import { buildReportTechnicalTimeline } from '../b_k3ewYvsOEc1/src/lib/reportTechnicalTimeline.js'

test('translates database, public research and unknown tools into readable Chinese actions', () => {
  const database = translateHermesExecutionLog({
    id: 'db',
    type: 'tool_start',
    status: 'started',
    phase: 'research_collecting',
    toolName: 'pg-sources__query',
    summary: 'PG向量信源召回进行中。',
  })
  const research = translateHermesExecutionLog({
    id: 'web',
    type: 'tool_end',
    status: 'completed',
    toolName: 'web_search',
    summary: 'Search completed.',
  })
  const unknown = translateHermesExecutionLog({
    id: 'unknown',
    type: 'tool_start',
    status: 'started',
    toolName: 'custom_internal_tool',
  })

  assert.equal(database.stage, 'PG_RECALL')
  assert.match(database.description, /PG 向量库|数据库信源/)
  assert.equal(research.stage, 'SEARCHING')
  assert.match(research.description, /公开资料|检索/)
  assert.equal(unknown.title, '正在推进编报任务')
  assert.equal(unknown.description, '系统正在执行当前编报步骤。')
})

test('maps Hermes collection, synthesis, writing and review tools to report stages', () => {
  const cases = [
    ['web_fetch', 'EXTRACTING'],
    ['sessions_spawn research-group', 'RESEARCHING'],
    ['write consolidated.json', 'CONSOLIDATE'],
    ['write final/report.md', 'SAVING'],
    ['quality_review', 'QUALITY_REVIEW'],
  ]

  for (const [toolName, expectedStage] of cases) {
    const translated = translateHermesExecutionLog({
      type: 'tool_end',
      status: 'completed',
      toolName,
      summary: `${toolName} completed`,
    })
    assert.equal(translated.stage, expectedStage, toolName)
  }
})

test('sanitizes credentials, absolute paths and internal provider names', () => {
  const sanitized = sanitizeReportExecutionText([
    'Authorization: Bearer secret-token-value',
    'OPENAI_API_KEY=sk-test-secret',
    '/opt/data/workspace/report-agent/reports/job-1/final/report.md',
    '/app/storage/artifacts/job-1/context.json',
    'Hermes report-agent via Gateway',
  ].join('\n'))

  assert.doesNotMatch(sanitized, /secret-token-value|sk-test-secret|\/opt\/data|\/app\/storage/)
  assert.doesNotMatch(sanitized, /Hermes|Gateway|report-agent/i)
  assert.match(sanitized, /\[已隐藏\]|\.\.\./)
})

test('keeps a readable tool duration on completed events', () => {
  const translated = translateHermesExecutionLog({
    type: 'tool_end',
    status: 'completed',
    toolName: 'web_search',
    summary: '公开资料检索已完成。',
    detail: '耗时 1.5 秒',
  })

  assert.equal(translated.durationLabel, '1.5 秒')
})

test('fills only started empty stages with marked reconstructed summaries', () => {
  const stages = [
    { key: 'plan', title: '任务规划', desc: '规划', status: 'done', evidence: [{ message: '调研计划文件已生成。', time: '2026-07-15T01:00:00.000Z' }] },
    { key: 'database', title: '数据库检索', desc: '数据库', status: 'done', evidence: [] },
    { key: 'research', title: '资料采集', desc: '采集', status: 'current', evidence: [{ message: '公开信源采集中。', time: '2026-07-15T01:02:00.000Z' }] },
    { key: 'report', title: '报告撰写', desc: '撰写', status: 'waiting', evidence: [] },
  ]
  const realDatabaseLog = {
    id: 'real-db',
    stage: 'PG_RECALL',
    status: 'done',
    title: '数据库检索',
    description: '数据库检索完成。',
  }
  const result = buildReadableExecutionLogs({ stages, logs: [realDatabaseLog] })

  assert.ok(result.some((item) => item.id === 'real-db' && !item.reconstructed))
  assert.ok(result.some((item) => item.id === 'reconstructed-plan' && item.reconstructed === true))
  assert.ok(result.some((item) => item.id === 'reconstructed-research' && item.reconstructed === true))
  assert.ok(!result.some((item) => item.id === 'reconstructed-database'))
  assert.ok(!result.some((item) => item.id === 'reconstructed-report'))
  assert.match(result.find((item) => item.id === 'reconstructed-plan').description, /调研计划文件已生成/)
})

test('uses truthful generic copy when a completed stage has no saved evidence', () => {
  const result = buildReadableExecutionLogs({
    stages: [{ key: 'quality', title: '成稿自检', desc: '检查质量', status: 'done', evidence: [] }],
    logs: [],
  })

  assert.equal(result.length, 1)
  assert.equal(result[0].reconstructed, true)
  assert.equal(result[0].occurredAt, '')
  assert.match(result[0].description, /详细执行事件未保存/)
})

test('turns legacy runs lifecycle records into a truthful completed timeline', () => {
  const stages = [
    { key: 'plan', title: '任务规划', status: 'done', evidence: [{ source: 'job_status', message: '任务已成功完成。', time: '2026-07-15T06:19:49.216Z' }] },
    { key: 'database', title: '数据库检索', status: 'done', evidence: [{ source: 'event', message: 'PG hybrid sources recalled: 12 items.', time: '2026-07-15T06:10:13.480Z' }, { source: 'job_status', message: '任务已成功完成。', time: '2026-07-15T06:19:49.216Z' }] },
    { key: 'research', title: '资料采集', status: 'done', evidence: [{ source: 'job_status', message: '任务已成功完成。', time: '2026-07-15T06:19:49.216Z' }] },
    { key: 'consolidate', title: '素材整合', status: 'done', evidence: [{ source: 'job_status', message: '任务已成功完成。', time: '2026-07-15T06:19:49.216Z' }] },
    { key: 'report', title: '报告撰写', status: 'done', evidence: [{ source: 'report_file', message: '最终报告已确认生成。', time: '2026-07-15T06:19:49.216Z' }] },
    { key: 'quality', title: '成稿自检', status: 'done', evidence: [{ source: 'event', message: '成稿自检：完成，综合评分 85。', time: '2026-07-15T06:19:49.376Z' }] },
  ]
  const rawLogs = [
    { id: 'database', type: 'stage', status: 'database_sources', phase: 'database_sources', summary: 'PG hybrid sources recalled: 12 items.', time: '2026-07-15T06:10:13.480Z' },
    { id: 'start', type: 'stage', status: 'start', phase: 'start', summary: 'Preparing runs API request...', time: '2026-07-15T06:10:13.514Z' },
    { id: 'running', type: 'stage', status: 'running', phase: 'running', summary: 'Running report agent...', time: '2026-07-15T06:10:13.515Z' },
    { id: 'waiting', type: 'stage', status: 'waiting_final_report', phase: 'waiting_final_report', summary: 'Run is still running.', time: '2026-07-15T06:10:13.538Z' },
    { id: 'received', type: 'stage', status: 'received', phase: 'received', summary: 'Run completed and returned REPORT_FILE.', time: '2026-07-15T06:19:49.125Z' },
    { id: 'quality-start', type: 'stage', status: 'quality_review', phase: 'quality_review', summary: '成稿自检：开始检查报告质量。', time: '2026-07-15T06:19:49.218Z' },
    { id: 'done-stage', type: 'stage', status: 'done', phase: 'done', summary: 'Report generation completed and saved to disk.', time: '2026-07-15T06:19:49.219Z' },
    { id: 'done', type: 'done', status: 'completed', phase: 'done', summary: '后端任务已结束。', time: '2026-07-15T06:19:49.220Z' },
    { id: 'quality-done', type: 'stage', status: 'quality_review_done', phase: 'quality_review_done', summary: '成稿自检：完成，综合评分 85。', time: '2026-07-15T06:19:49.376Z' },
  ]
  const translated = rawLogs.map((log) => ({
    ...log,
    ...translateHermesExecutionLog(log),
    occurredAt: log.time,
  }))
  const readable = buildReadableExecutionLogs({ stages, logs: translated })
  const groups = buildReportTechnicalTimeline({ stages, logs: readable })
  const byKey = new Map(groups.map((group) => [group.key, group]))

  assert.equal(byKey.has('other'), false)
  assert.equal(byKey.get('plan').eventCount, 1)
  assert.equal(byKey.get('database').eventCount, 1)
  assert.match(byKey.get('database').events[0].description, /12 条/)
  assert.equal(byKey.get('database').events[0].status, 'done')
  assert.equal(byKey.get('research').events[0].reconstructed, true)
  assert.match(byKey.get('research').events[0].description, /详细执行事件未保存/)
  assert.doesNotMatch(byKey.get('research').events[0].description, /任务已成功完成/)
  assert.equal(byKey.get('report').status, 'done')
  assert.equal(byKey.get('report').eventCount, 3)
  assert.ok(byKey.get('report').events.some((event) => event.status === 'running'))
  assert.equal(byKey.get('report').events.at(-1).status, 'done')
  assert.equal(byKey.get('quality').events.at(-1).status, 'done')
})
