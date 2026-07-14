import { Injectable } from '@nestjs/common';
import type { ParsedEntity } from '../retrieval.types.js';
import { EntityAliasService } from './entity-alias.service.js';

const FORBIDDEN_ENTITY_NAMES = new Set([
  '政府与机构', '覆盖政府', '监管机构', '智库研判', '专业机构', 'PG',
  '数据库信源', '信源类型', '检索方向', '采集方向', '联网信源', '补充信源',
  'workflow', 'stage', 'sourceScope', 'sourceTypes',
  '政府', '机构', '专家', '媒体', '智库', '数据库',
]);

@Injectable()
export class QueryPolicyValidatorService {
  constructor(private readonly aliases: EntityAliasService) {}

  validate(entities: ParsedEntity[], userText: string): ParsedEntity[] {
    const result = new Map<string, ParsedEntity>();
    for (const entity of entities) {
      if (FORBIDDEN_ENTITY_NAMES.has(entity.canonicalName)) continue;
      const validated = this.enforcement(entity, userText);
      const current = result.get(validated.canonicalId);
      if (!current || this.priority(validated) > this.priority(current)) {
        result.set(validated.canonicalId, validated);
      }
    }
    return [...result.values()];
  }

  private enforcement(entity: ParsedEntity, userText: string): ParsedEntity {
    let enforcement = entity.enforcement;
    if (entity.source !== 'explicit') {
      enforcement = enforcement === 'disabled' ? 'disabled' : 'soft';
      if (!this.aliases.appearsInText(entity, userText)) enforcement = 'disabled';
    } else if (enforcement === 'hard' && entity.confidence < 1) {
      enforcement = 'soft';
    }
    return { ...entity, enforcement };
  }

  private priority(entity: ParsedEntity): number {
    const source = { explicit: 5, topic: 4, supplement: 3, llm: 2, rule: 1 }[entity.source];
    const enforcement = { hard: 3, soft: 2, disabled: 1 }[entity.enforcement];
    return source * 100 + enforcement * 10 + entity.confidence;
  }
}
