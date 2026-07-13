const LEGACY_PLANNING_CONTEXT_FIELDS = new Set([
  'planningCollection',
  'planning_collection',
  'planningCollectionStatus',
  'selectedCrawlerItemIds',
  'selectedPlanningSources',
  'planningCollectionTaskId',
  'collectionTasks',
  'collectionDiagnostics',
  'planningCoverage',
  'crawlerTaskIds',
  'crawlerPlan',
  'crawlerSourceContext',
  'allowFurtherCollectionInResearch',
  'autoGapFilling',
  'collectionMode',
  'planningSessionId',
]);

export function sanitizeLegacyPlanningContext(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !LEGACY_PLANNING_CONTEXT_FIELDS.has(key)),
  );
}

export function sanitizeReportPayload(value: Record<string, unknown>): Record<string, unknown> {
  const payload = sanitizeLegacyPlanningContext(value);
  if (typeof payload.known_context !== 'string') return payload;
  const parsed = parseJsonObject(payload.known_context);
  if (!parsed) return payload;
  return {
    ...payload,
    known_context: JSON.stringify(sanitizeLegacyPlanningContext(parsed)),
  };
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
