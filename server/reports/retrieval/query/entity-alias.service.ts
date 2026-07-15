import { Injectable } from '@nestjs/common';
import type { EntityEnforcement, EntitySource, EntityType, ParsedEntity } from '../retrieval.types.js';

interface EntityDefinition {
  canonicalId: string;
  canonicalName: string;
  type: EntityType;
  aliases: string[];
}

const DEFINITIONS: EntityDefinition[] = [
  { canonicalId: 'country:us', canonicalName: '美国', type: 'country', aliases: ['美国', '美方', '华盛顿', '美伊', '伊美'] },
  { canonicalId: 'country:iran', canonicalName: '伊朗', type: 'country', aliases: ['伊朗', '伊方', '德黑兰', '美伊', '伊美'] },
  { canonicalId: 'organization:eu', canonicalName: '欧盟', type: 'organization', aliases: ['欧盟', '欧方', '布鲁塞尔'] },
  { canonicalId: 'region:europe', canonicalName: '欧洲', type: 'region', aliases: ['欧洲', '欧陆'] },
  { canonicalId: 'country:uk', canonicalName: '英国', type: 'country', aliases: ['英国', '英方', '伦敦'] },
  { canonicalId: 'country:france', canonicalName: '法国', type: 'country', aliases: ['法国', '法方', '巴黎'] },
  { canonicalId: 'country:germany', canonicalName: '德国', type: 'country', aliases: ['德国', '德方', '柏林'] },
  { canonicalId: 'country:italy', canonicalName: '意大利', type: 'country', aliases: ['意大利', '意方', '罗马'] },
  { canonicalId: 'country:spain', canonicalName: '西班牙', type: 'country', aliases: ['西班牙', '马德里'] },
  { canonicalId: 'country:netherlands', canonicalName: '荷兰', type: 'country', aliases: ['荷兰', '阿姆斯特丹'] },
  { canonicalId: 'country:belgium', canonicalName: '比利时', type: 'country', aliases: ['比利时'] },
  { canonicalId: 'country:poland', canonicalName: '波兰', type: 'country', aliases: ['波兰'] },
  { canonicalId: 'country:ukraine', canonicalName: '乌克兰', type: 'country', aliases: ['乌克兰', '基辅'] },
  { canonicalId: 'country:russia', canonicalName: '俄罗斯', type: 'country', aliases: ['俄罗斯', '俄方', '莫斯科'] },
  { canonicalId: 'organization:nato', canonicalName: '北约', type: 'organization', aliases: ['北约'] },
];

const BILATERAL_ALIASES: Record<string, string[]> = {
  美伊: ['country:us', 'country:iran'],
  伊美: ['country:iran', 'country:us'],
};

@Injectable()
export class EntityAliasService {
  private readonly definitions = new Map(DEFINITIONS.map((item) => [item.canonicalId, item]));
  private readonly aliasIds = this.buildAliasIds();

  extractFromText(text: string, source: EntitySource, confidence: number): ParsedEntity[] {
    const ids = new Set<string>();
    for (const [alias, entityIds] of this.aliasIds) {
      if (!text.includes(alias)) continue;
      for (const entityId of entityIds) ids.add(entityId);
    }
    return [...ids]
      .map((id) => this.resolveById(id, source, confidence, 'soft'))
      .filter((entity): entity is ParsedEntity => Boolean(entity));
  }

  resolveByName(
    name: string,
    source: EntitySource,
    confidence: number,
    enforcement: EntityEnforcement,
  ): ParsedEntity | undefined {
    const ids = this.aliasIds.get(name);
    return ids?.length === 1 && ids[0]
      ? this.resolveById(ids[0], source, confidence, enforcement)
      : undefined;
  }

  resolveAllByName(
    name: string,
    source: EntitySource,
    confidence: number,
    enforcement: EntityEnforcement,
  ): ParsedEntity[] {
    return (this.aliasIds.get(name) || [])
      .map((id) => this.resolveById(id, source, confidence, enforcement))
      .filter((entity): entity is ParsedEntity => Boolean(entity));
  }

  resolveById(
    canonicalId: string,
    source: EntitySource,
    confidence: number,
    enforcement: EntityEnforcement,
  ): ParsedEntity | undefined {
    const definition = this.definitions.get(canonicalId);
    if (!definition) return undefined;
    return {
      canonicalId: definition.canonicalId,
      canonicalName: definition.canonicalName,
      type: definition.type,
      aliases: [...definition.aliases],
      source,
      confidence,
      enforcement,
    };
  }

  appearsInText(entity: ParsedEntity, text: string): boolean {
    if ([entity.canonicalName, ...entity.aliases].some((alias) => text.includes(alias))) return true;
    return Object.entries(BILATERAL_ALIASES).some(
      ([alias, ids]) => ids.includes(entity.canonicalId) && text.includes(alias),
    );
  }

  expandAliases(entityIds: string[]): string[] {
    const result = new Set<string>();
    for (const entityId of entityIds) {
      const definition = this.definitions.get(entityId);
      if (!definition) continue;
      for (const alias of [definition.canonicalName, ...definition.aliases]) result.add(alias);
      for (const [alias, ids] of Object.entries(BILATERAL_ALIASES)) {
        if (ids.includes(entityId)) result.add(alias);
      }
    }
    return [...result];
  }

  private buildAliasIds(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const definition of DEFINITIONS) {
      for (const alias of [definition.canonicalName, ...definition.aliases]) {
        result.set(alias, [definition.canonicalId]);
      }
    }
    for (const [alias, ids] of Object.entries(BILATERAL_ALIASES)) result.set(alias, ids);
    return result;
  }
}
