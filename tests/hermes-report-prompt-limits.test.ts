import 'reflect-metadata';
import assert from 'node:assert/strict';
import { HermesService } from '../server/hermes.service.js';

function testWriteHbPromptUsesCurrentMinimumLength() {
  const hermes = new HermesService({} as never, {} as never) as HermesService & {
    getSkillRequirements: (input: Record<string, unknown>) => string[];
  };
  const requirements = hermes.getSkillRequirements({
    skill: 'write-hb',
    jobId: 'job-report-length-limit',
    payload: {
      topic: '测试主题',
      report_type: 'K报',
      known_context: '{}',
    },
  }).join('\n');

  assert.match(requirements, /最低不得低于 8000 个中文字符/);
  assert.doesNotMatch(requirements, /最低不得低于 8500 个中文字符/);
}

testWriteHbPromptUsesCurrentMinimumLength();
console.log('Hermes report prompt limit tests passed');
