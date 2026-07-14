import { Injectable } from '@nestjs/common';
import type { CleanRetrievalInput, ParsedEntity, QueryProfile } from '../retrieval.types.js';
import { EntityAliasService } from './entity-alias.service.js';
import { QueryPolicyValidatorService } from './query-policy-validator.service.js';
import { RuleQueryAnalysisService } from './rule-query-analysis.service.js';

@Injectable()
export class QueryParserService {
  constructor(
    private readonly aliases: EntityAliasService,
    private readonly validator: QueryPolicyValidatorService,
    private readonly rules: RuleQueryAnalysisService,
  ) {}

  parse(input: CleanRetrievalInput): QueryProfile {
    const userText = [input.topic, input.supplement].filter(Boolean).join('\n');
    const explicit = input.explicitEntities.flatMap((entity) => this.explicitEntities(entity));
    const coreEntities = this.validator.validate([
      ...explicit,
      ...this.aliases.extractFromText(input.topic, 'topic', 0.98),
      ...this.aliases.extractFromText(input.supplement, 'supplement', 0.9),
    ], userText);
    const coreTopics = this.rules.extractTopics(userText);
    return {
      originalQuery: input.topic,
      supplement: input.supplement,
      coreEntities,
      coreTopics,
      eventType: this.rules.detectEventType(userText),
      timeRange: input.explicitTimeRange,
      queryVariants: this.queryVariants(input.topic, coreEntities, coreTopics),
    };
  }

  private explicitEntities(input: CleanRetrievalInput['explicitEntities'][number]): ParsedEntity[] {
    const enforcement = input.required ? 'hard' : 'soft';
    const resolved = input.canonicalId
      ? [this.aliases.resolveById(input.canonicalId, 'explicit', 1, enforcement)]
          .filter((entity): entity is ParsedEntity => Boolean(entity))
      : this.aliases.resolveAllByName(input.name, 'explicit', 1, enforcement);
    if (resolved.length) {
      return resolved.map((entity) => ({
        ...entity,
        aliases: [...new Set([...entity.aliases, ...(input.aliases || []), input.name])],
      }));
    }
    return [{
      canonicalId: input.canonicalId || `custom:${encodeURIComponent(input.name.toLowerCase())}`,
      canonicalName: input.name,
      type: input.type || 'organization',
      aliases: [...new Set([input.name, ...(input.aliases || [])])],
      source: 'explicit',
      confidence: 1,
      enforcement,
    }];
  }

  private queryVariants(topic: string, entities: ParsedEntity[], topics: string[]): string[] {
    const active = entities.filter((entity) => entity.enforcement !== 'disabled');
    const names = active.map((entity) => entity.canonicalName);
    const aliases = this.aliases.expandAliases(active.map((entity) => entity.canonicalId));
    return [...new Set([
      topic,
      [...names, ...topics].join(' '),
      [...aliases, ...topics].join(' '),
      [...names, ...topics.slice(0, 2), '最新进展'].join(' '),
    ].map((value) => value.trim()).filter(Boolean))];
  }
}
