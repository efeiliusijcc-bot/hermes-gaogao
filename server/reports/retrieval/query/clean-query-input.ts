import type {
  CleanRetrievalInput,
  EntityType,
  ExplicitEntityInput,
  RawRetrievalRequest,
  TimeRange,
} from '../retrieval.types.js';

const ENTITY_TYPES = new Set<EntityType>([
  'country',
  'organization',
  'region',
  'person',
  'location',
  'event',
]);

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function explicitEntities(value: unknown): ExplicitEntityInput[] {
  if (!Array.isArray(value)) return [];
  const result: ExplicitEntityInput[] = [];
  for (const raw of value) {
    if (typeof raw === 'string') {
      const name = raw.trim();
      if (name) result.push({ name, required: false });
      continue;
    }
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const name = trimmedString(item.name);
    if (!name) continue;
    const type = typeof item.type === 'string' && ENTITY_TYPES.has(item.type as EntityType)
      ? item.type as EntityType
      : undefined;
    const aliases = Array.isArray(item.aliases)
      ? item.aliases
          .filter((alias): alias is string => typeof alias === 'string')
          .map((alias) => alias.trim())
          .filter(Boolean)
      : undefined;
    const canonicalId = trimmedString(item.canonicalId);
    result.push({
      name,
      ...(canonicalId ? { canonicalId } : {}),
      ...(type ? { type } : {}),
      ...(aliases?.length ? { aliases } : {}),
      required: item.required === true,
    });
  }
  return result;
}

function timeRange(value: unknown): TimeRange | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  const start = trimmedString(item.start);
  const end = trimmedString(item.end);
  if (!start && !end) return undefined;
  return { start: start || undefined, end: end || undefined };
}

export function buildCleanRetrievalInput(request: RawRetrievalRequest): CleanRetrievalInput {
  const topic = trimmedString(request.topic);
  if (!topic) throw new Error('Retrieval topic is required');
  return {
    reportJobId: trimmedString(request.reportJobId),
    topic,
    supplement: trimmedString(request.supplement),
    explicitEntities: explicitEntities(request.explicitEntities),
    explicitTimeRange: timeRange(request.explicitTimeRange),
  };
}
