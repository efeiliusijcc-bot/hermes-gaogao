export type EntityType =
  | 'company'
  | 'person'
  | 'location'
  | 'product'
  | 'technology'
  | 'policy'
  | 'event'
  | 'organization'
  | 'project';

export type EntityImportance = 'primary' | 'secondary' | 'parent' | 'subsidiary' | 'context';

export interface CoreEntity {
  canonical: string;
  type: EntityType;
  aliases: string[];
  importance: EntityImportance;
}

export interface EntityRelation {
  subject: string;
  relation: 'subsidiary_of' | 'parent_of' | 'located_in' | 'related_to' | 'competitor_of' | 'supplier_of' | 'customer_of';
  object: string;
}

export interface AmbiguousTerm {
  term: string;
  reason: string;
  requiresContext: string[];
}

export interface PossibleConfusion {
  entity: string;
  aliases: string[];
  reason: string;
}

export interface EntityPolicy {
  coreEntities: CoreEntity[];
  entityRelations: EntityRelation[];
  topicTerms: string[];
  actionTerms: string[];
  timeConstraints: string[];
  locationConstraints: string[];
  ambiguousTerms: AmbiguousTerm[];
  possibleConfusions: PossibleConfusion[];
  requiredEntityMatch: boolean;
  searchQueries: string[];
  confidence: number;
  generatedBy?: 'llm' | 'rules' | 'existing' | 'parsed';
  fallbackReason?: string;
}

export interface ExtractEntityPolicyInput {
  topic?: unknown;
  userSupplement?: unknown;
  reportPlan?: unknown;
  databaseQueryIntent?: unknown;
  selectedSearchQueries?: unknown;
  selectedSources?: unknown;
  draftAssistantContext?: unknown;
}

export const ENTITY_POLICY_PROMPT = [
  '你是一个开源情报检索规划助手。',
  '你的任务不是写报告，而是为后续数据库检索生成实体识别策略。',
  '请识别用户主题中的核心实体、别名、实体关系、主题词、动作词、时间约束、地点约束、短词缩写、可能混淆对象和检索查询词。',
  '不要臆造不存在的别名。',
  '如果不确定，请放入 ambiguousTerms，而不是写入 coreEntities。',
  'possibleConfusions 用于标记可能被误召回但不应作为核心信源的实体。',
  '输出必须是 JSON。',
  '不要输出解释性文本。',
  '输出格式必须符合 EntityPolicy。',
].join('\n');

const EMPTY_POLICY: EntityPolicy = {
  coreEntities: [],
  entityRelations: [],
  topicTerms: [],
  actionTerms: [],
  timeConstraints: [],
  locationConstraints: [],
  ambiguousTerms: [],
  possibleConfusions: [],
  requiredEntityMatch: false,
  searchQueries: [],
  confidence: 0,
};

const ACTION_TERMS = [
  '生产工艺', '中试', '量产', '投产', '扩产', '建设', '制裁', '并购', '收购', '会晤', '表态',
  '授权', '模式', '变化', '进展', '动向', '安全', '局势', '近期',
];

const LOCATION_TERMS = [
  '中国', '美国', '英国', '法国', '德国', '波兰', '欧洲', '欧盟', '日本', '韩国', '印度',
  '台湾', '香港', '墨西哥', '边境',
];

export function normalizePolicyText(value: unknown, maxLength = 400): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[“”"‘’'`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function parseEntityPolicy(value: unknown): EntityPolicy | null {
  const raw = typeof value === 'string' ? parseJson(value) : value;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return normalizeEntityPolicy(raw as Record<string, unknown>, 'parsed');
}

export async function extractEntityPolicy(
  input: ExtractEntityPolicyInput,
  llmExtractor?: (prompt: string, input: ExtractEntityPolicyInput) => Promise<unknown>,
): Promise<EntityPolicy> {
  if (llmExtractor) {
    try {
      const parsed = parseEntityPolicy(await llmExtractor(ENTITY_POLICY_PROMPT, input));
      if (parsed) {
        const fallback = buildRuleBasedEntityPolicy(input);
        // A syntactically valid but entity-empty model reply must not disable the deterministic guard.
        if (parsed.coreEntities.length === 0 && fallback.coreEntities.length > 0) return fallback;
        return { ...parsed, generatedBy: 'llm' };
      }
    } catch {
      // Fall through to deterministic extraction.
    }
  }
  return buildRuleBasedEntityPolicy(input);
}

export function buildRuleBasedEntityPolicy(input: ExtractEntityPolicyInput): EntityPolicy {
  const topic = normalizePolicyText(input.topic, 240);
  const queryTerms = stringArray(input.selectedSearchQueries, 12);
  const supplement = normalizePolicyText(input.userSupplement, 1000);
  const intent = plainObject(input.databaseQueryIntent);
  const intentEntities = stringArray(intent.entityTerms, 20);
  const intentTopics = [
    ...stringArray(intent.topicTerms, 20),
    ...stringArray(intent.domainTerms, 20),
    ...stringArray(intent.ngrams, 20),
  ];
  const draft = plainObject(input.draftAssistantContext);
  const draftText = JSON.stringify(draft || {}).slice(0, 3000);
  const sourceText = [topic, ...queryTerms, supplement, draftText].filter(Boolean).join('\n');

  const entities = new Map<string, CoreEntity>();
  const addEntity = (canonical: string, type: EntityType, aliases: string[] = [], importance: EntityImportance = 'primary') => {
    const clean = normalizePolicyText(canonical, 120);
    if (!clean || clean.length < 2) return;
    const key = clean.toLowerCase();
    const existing = entities.get(key);
    const nextAliases = uniqueStrings([clean, ...aliases]);
    if (existing) {
      existing.aliases = uniqueStrings([...existing.aliases, ...nextAliases]);
      if (importance === 'primary') existing.importance = importance;
      return;
    }
    entities.set(key, { canonical: clean, type, aliases: nextAliases, importance });
  };

  addKnownEntities(sourceText, addEntity);
  for (const term of intentEntities) addEntity(term, inferEntityType(term), [], 'secondary');
  for (const term of extractQuotedTerms(sourceText)) addEntity(term, inferEntityType(term), [], 'primary');
  for (const term of extractOrganizationTerms(sourceText)) addEntity(term, inferEntityType(term), [], 'primary');
  for (const term of extractEnglishEntities(sourceText)) addEntity(term, inferEntityType(term), [], term.length <= 4 ? 'secondary' : 'primary');

  const topicTerms = uniqueStrings([
    ...ACTION_TERMS.filter((term) => sourceText.includes(term)),
    ...intentTopics,
    ...extractChineseNgrams(topic).filter((term) => !isWeakTopicTerm(term)),
  ]).slice(0, 40);
  const actionTerms = uniqueStrings(ACTION_TERMS.filter((term) => sourceText.includes(term))).slice(0, 24);
  const locationConstraints = uniqueStrings(LOCATION_TERMS.filter((term) => sourceText.includes(term))).slice(0, 12);
  const timeConstraints = uniqueStrings(sourceText.match(/\b(?:19|20)\d{2}(?:[-年]\d{1,2})?(?:[-月]\d{1,2})?/g) || []).slice(0, 12);
  const ambiguousTerms = buildAmbiguousTerms(Array.from(entities.values()), sourceText);
  const possibleConfusions = buildPossibleConfusions(Array.from(entities.values()), sourceText);
  const coreEntities = Array.from(entities.values()).slice(0, 16);
  const searchQueries = uniqueStrings([
    topic,
    ...queryTerms,
    ...coreEntities.flatMap((entity) => entity.aliases.slice(0, 3).map((alias) => [alias, ...actionTerms.slice(0, 3)].filter(Boolean).join(' '))),
  ]).filter(Boolean).slice(0, 20);

  const requiredEntityMatch = coreEntities.length > 0;
  return {
    ...EMPTY_POLICY,
    coreEntities,
    topicTerms,
    actionTerms,
    timeConstraints,
    locationConstraints,
    ambiguousTerms,
    possibleConfusions,
    requiredEntityMatch,
    searchQueries,
    confidence: requiredEntityMatch ? 0.58 : 0.28,
    generatedBy: 'rules',
    fallbackReason: requiredEntityMatch ? '规则兜底生成 entityPolicy。' : '规则兜底未识别明确核心实体，降级为弱主题校验。',
  };
}

export function normalizeEntityPolicy(raw: Record<string, unknown>, generatedBy: EntityPolicy['generatedBy'] = 'existing'): EntityPolicy {
  const coreEntities = arrayOfObjects(raw.coreEntities).map((item) => ({
    canonical: normalizePolicyText(item.canonical, 120),
    type: normalizeEntityType(item.type),
    aliases: uniqueStrings(stringArray(item.aliases, 30).concat(normalizePolicyText(item.canonical, 120))).slice(0, 30),
    importance: normalizeImportance(item.importance),
  })).filter((item) => item.canonical);
  const policy: EntityPolicy = {
    coreEntities,
    entityRelations: arrayOfObjects(raw.entityRelations).map((item) => ({
      subject: normalizePolicyText(item.subject, 120),
      relation: normalizeRelation(item.relation),
      object: normalizePolicyText(item.object, 120),
    })).filter((item) => item.subject && item.object),
    topicTerms: uniqueStrings(stringArray(raw.topicTerms, 80)).slice(0, 80),
    actionTerms: uniqueStrings(stringArray(raw.actionTerms, 40)).slice(0, 40),
    timeConstraints: uniqueStrings(stringArray(raw.timeConstraints, 20)).slice(0, 20),
    locationConstraints: uniqueStrings(stringArray(raw.locationConstraints, 20)).slice(0, 20),
    ambiguousTerms: arrayOfObjects(raw.ambiguousTerms).map((item) => ({
      term: normalizePolicyText(item.term, 80),
      reason: normalizePolicyText(item.reason, 240),
      requiresContext: stringArray(item.requiresContext, 20),
    })).filter((item) => item.term),
    possibleConfusions: arrayOfObjects(raw.possibleConfusions).map((item) => ({
      entity: normalizePolicyText(item.entity, 120),
      aliases: uniqueStrings(stringArray(item.aliases, 30).concat(normalizePolicyText(item.entity, 120))).slice(0, 30),
      reason: normalizePolicyText(item.reason, 240),
    })).filter((item) => item.entity),
    requiredEntityMatch: raw.requiredEntityMatch !== false && coreEntities.length > 0,
    searchQueries: uniqueStrings(stringArray(raw.searchQueries, 30)).slice(0, 30),
    confidence: clamp01(Number(raw.confidence ?? (coreEntities.length ? 0.5 : 0.2))),
    generatedBy,
    fallbackReason: normalizePolicyText(raw.fallbackReason, 240),
  };
  return policy;
}

function parseJson(value: string): unknown {
  try {
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    return JSON.parse(fenced || value);
  } catch {
    return null;
  }
}

function addKnownEntities(sourceText: string, addEntity: (canonical: string, type: EntityType, aliases?: string[], importance?: EntityImportance) => void): void {
  if (/麦格昆磁|magnequench/i.test(sourceText)) {
    addEntity('麦格昆磁', 'company', ['Magnequench'], 'subsidiary');
    addEntity('Neo Performance Materials', 'company', ['NEO', 'Neo Materials'], 'parent');
  }
  if (/宁德时代|catl/i.test(sourceText)) addEntity('宁德时代', 'company', ['CATL', 'Contemporary Amperex Technology'], 'primary');
  if (/\bARM\b|Arm Holdings|ARM公司/i.test(sourceText)) addEntity('Arm Holdings', 'company', ['ARM', 'Arm'], 'primary');
}

function buildPossibleConfusions(coreEntities: CoreEntity[], sourceText: string): PossibleConfusion[] {
  const confusions: PossibleConfusion[] = [];
  const hasAlias = (pattern: RegExp) => coreEntities.some((entity) => entity.aliases.some((alias) => pattern.test(alias)));
  if (hasAlias(/麦格昆磁|magnequench/i)) {
    confusions.push({ entity: '美光科技', aliases: ['美光', 'Micron', 'Micron Technology', 'DRAM', 'NAND'], reason: '中英文名称和半导体语义相近，但不是麦格昆磁/NEO 主题实体。' });
  }
  if (hasAlias(/宁德时代|catl/i)) {
    confusions.push({ entity: '其他电池企业', aliases: ['比亚迪', 'BYD', 'LG Energy Solution', 'LG新能源', '松下'], reason: '同行业企业可能被语义召回，但不是本主题核心公司。' });
  }
  if (hasAlias(/\barm\b|arm holdings/i)) {
    confusions.push({ entity: '军事/肢体 arm 语义', aliases: ['army', 'armed forces', 'military exercise', 'arms control'], reason: 'ARM 缩写容易与军事或普通英文 arm 语义混淆。' });
  }
  if (/波兰.*边境|边境.*波兰/.test(sourceText)) {
    confusions.push({ entity: '非波兰边境', aliases: ['美国南部边境', '墨西哥边境', 'US southern border', 'Mexico border'], reason: '同为边境安全，但地点不符。' });
  }
  return confusions;
}

function buildAmbiguousTerms(coreEntities: CoreEntity[], sourceText: string): AmbiguousTerm[] {
  const terms = new Set<string>();
  for (const entity of coreEntities) {
    for (const alias of entity.aliases) {
      if (/^[A-Z0-9]{2,6}$/.test(alias)) terms.add(alias);
    }
  }
  for (const match of sourceText.match(/\b[A-Z]{2,6}\b/g) || []) terms.add(match);
  return Array.from(terms).slice(0, 20).map((term) => ({
    term,
    reason: '短词、缩写或股票代码需要结合全称和上下文消歧。',
    requiresContext: coreEntities.flatMap((entity) => entity.aliases).filter((alias) => alias !== term).slice(0, 8),
  }));
}

function extractQuotedTerms(text: string): string[] {
  return uniqueStrings(Array.from(text.matchAll(/[“"']([^“”"'\n]{2,80})[”"']/g)).map((match) => match[1] || ''));
}

function extractOrganizationTerms(text: string): string[] {
  const terms = new Set<string>();
  for (const match of text.match(/[\p{Script=Han}A-Za-z0-9&.+/-]{2,40}(?:公司|集团|大学|政府|委员会|研究院|研究所|实验室|子公司|母公司|机构|协会|联盟|工厂|边境)/gu) || []) {
    terms.add(match.replace(/^[和与对在由向从及、]+/, ''));
  }
  return Array.from(terms);
}

function extractEnglishEntities(text: string): string[] {
  const suffix = '(?:Inc|Ltd|Group|Corporation|Corp|Materials|Technology|Technologies|Energy|Agency|Holdings|University|Commission|Committee|Institute|Laboratory|Labs)';
  const terms = new Set<string>();
  const suffixRegex = new RegExp(`\\b[A-Z][A-Za-z0-9&.+/-]*(?:\\s+[A-Z][A-Za-z0-9&.+/-]*){0,5}\\s+${suffix}\\b`, 'g');
  for (const match of text.match(suffixRegex) || []) terms.add(match);
  for (const match of text.match(/\b[A-Z][A-Z0-9&.+/-]{1,8}\b/g) || []) terms.add(match);
  return Array.from(terms);
}

function extractChineseNgrams(text: string): string[] {
  const normalized = normalizePolicyText(text, 200);
  const chunks = normalized.match(/[\p{Script=Han}]{2,}/gu) || [];
  const terms = new Set<string>();
  for (const chunk of chunks) {
    if (chunk.length <= 8) terms.add(chunk);
    for (const size of [4, 3, 2]) {
      for (let i = 0; i <= chunk.length - size; i += 1) terms.add(chunk.slice(i, i + size));
    }
  }
  return Array.from(terms);
}

function isWeakTopicTerm(term: string): boolean {
  return ['近期', '主要', '动向', '进展', '情况', '相关', '公司', '集团', '下属', '子公司'].includes(term);
}

function inferEntityType(value: string): EntityType {
  if (/边境|波兰|中国|美国|英国|欧洲|欧盟|墨西哥/.test(value)) return 'location';
  if (/政策|法案|禁令|条例|办法/.test(value)) return 'policy';
  if (/工厂|项目|工程/.test(value)) return 'project';
  if (/技术|芯片|AI|人工智能|授权/i.test(value)) return 'technology';
  if (/公司|集团|Inc|Ltd|Corporation|Corp|Materials|Technology|Energy|Holdings|CATL|ARM|NEO/i.test(value)) return 'company';
  return 'organization';
}

function normalizeEntityType(value: unknown): EntityType {
  const text = String(value || '');
  const allowed: EntityType[] = ['company', 'person', 'location', 'product', 'technology', 'policy', 'event', 'organization', 'project'];
  return allowed.includes(text as EntityType) ? text as EntityType : 'organization';
}

function normalizeImportance(value: unknown): EntityImportance {
  const text = String(value || '');
  const allowed: EntityImportance[] = ['primary', 'secondary', 'parent', 'subsidiary', 'context'];
  return allowed.includes(text as EntityImportance) ? text as EntityImportance : 'primary';
}

function normalizeRelation(value: unknown): EntityRelation['relation'] {
  const text = String(value || '');
  const allowed: EntityRelation['relation'][] = ['subsidiary_of', 'parent_of', 'located_in', 'related_to', 'competitor_of', 'supplier_of', 'customer_of'];
  return allowed.includes(text as EntityRelation['relation']) ? text as EntityRelation['relation'] : 'related_to';
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayOfObjects(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];
}

function stringArray(value: unknown, limit = 40): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizePolicyText(item, 160)).filter(Boolean).slice(0, limit);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const clean = normalizePolicyText(value, 160);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
