import type {
  EventIntentKind,
  EventTask,
  EventTaskId,
  EventTaskPlan,
  IntentRecognition,
} from './types.js';

interface EventTaskDefinition {
  id: EventTaskId;
  dimension: string;
  title: string;
  objectiveSuffix: string;
  querySuffixes: string[];
}

export const EVENT_TASK_DEFINITIONS: readonly EventTaskDefinition[] = [
  {
    id: 'event_time',
    dimension: '发生时间',
    title: '核实事件时间',
    objectiveSuffix: '核实事件发生时间、关键节点、先后顺序和最新进展。',
    querySuffixes: ['发生时间 时间线 最新进展', '关键节点 进程'],
  },
  {
    id: 'participants',
    dimension: '参与方',
    title: '识别事件参与方',
    objectiveSuffix: '识别直接参与方、相关机构及其角色、立场和行动。',
    querySuffixes: ['参与方 相关机构 角色', '各方立场 回应'],
  },
  {
    id: 'event_causes',
    dimension: '事件原因',
    title: '梳理事件原因',
    objectiveSuffix: '梳理事件背景、直接诱因、深层原因和触发因素。',
    querySuffixes: ['事件原因 背景 诱因', '触发因素 深层原因'],
  },
  {
    id: 'event_content',
    dimension: '具体内容',
    title: '核实事件具体内容',
    objectiveSuffix: '核实事件经过、主要措施、关键事实、结果和影响。',
    querySuffixes: ['具体内容 事件经过 关键事实', '措施 结果 影响'],
  },
  {
    id: 'event_location',
    dimension: '发生地点',
    title: '核实事件地点',
    objectiveSuffix: '核实事件发生地点、涉及区域及地理范围。',
    querySuffixes: ['发生地点 涉及地区', '地点 区域范围'],
  },
] as const;

const EVENT_TASK_IDS = new Set<EventTaskId>(EVENT_TASK_DEFINITIONS.map((item) => item.id));
const INTENT_KINDS = new Set<EventIntentKind>(['event_timeline', 'other', 'uncertain']);

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeQueries(value: unknown, fallback: string[]): string[] {
  const values = Array.isArray(value) ? value : [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const query = cleanText(raw, 80);
    const key = query.toLowerCase();
    if (!query || seen.has(key)) continue;
    seen.add(key);
    result.push(query);
    if (result.length >= 3) break;
  }
  return result.length ? result : fallback.slice(0, 3);
}

function defaultTask(definition: EventTaskDefinition, topic: string, enabled: boolean): EventTask {
  const subject = cleanText(topic, 180) || '当前事件';
  return {
    id: definition.id,
    dimension: definition.dimension,
    title: definition.title,
    objective: `围绕“${subject}”，${definition.objectiveSuffix}`,
    searchQueries: definition.querySuffixes.map((suffix) => `${subject} ${suffix}`.slice(0, 80)),
    enabled,
  };
}

export function fallbackIntentRecognition(reason = '模型未能可靠判断当前主题是否属于事件脉络梳理，请用户确认。'): IntentRecognition {
  return {
    detected: 'uncertain',
    resolved: null,
    reason: cleanText(reason, 500),
    source: 'fallback',
  };
}

export function normalizeIntentRecognition(
  value: unknown,
  options: {
    source?: 'model' | 'fallback';
    fallbackReason?: string;
    allowUncertainResolution?: boolean;
  } = {},
): IntentRecognition {
  const raw = objectValue(value);
  const detectedValue = cleanText(raw.detected, 32) as EventIntentKind;
  if (!INTENT_KINDS.has(detectedValue)) return fallbackIntentRecognition(options.fallbackReason);
  const detected = detectedValue;
  const rawResolved = cleanText(raw.resolved, 32);
  const resolved = detected === 'uncertain' && options.allowUncertainResolution === false
    ? null
    : rawResolved === 'event_timeline' || rawResolved === 'other'
    ? rawResolved
    : detected === 'uncertain'
      ? null
      : detected;
  return {
    detected,
    resolved,
    reason: cleanText(raw.reason, 500) || (detected === 'event_timeline'
      ? '当前主题需要按时间、参与方、原因、内容和地点梳理事件脉络。'
      : detected === 'other'
        ? '当前主题不属于事件脉络梳理场景。'
        : '当前材料不足以可靠判断意图，请用户确认。'),
    source: options.source || (raw.source === 'model' ? 'model' : 'fallback'),
  };
}

export function buildEventTaskPlan(topic: string, enabled = true): EventTaskPlan {
  return {
    version: 1,
    tasks: EVENT_TASK_DEFINITIONS.map((definition) => defaultTask(definition, topic, enabled)),
  };
}

export function normalizeEventTaskPlan(value: unknown, topic: string, enabledByDefault = true): EventTaskPlan {
  const raw = objectValue(value);
  const rawTasks = Array.isArray(raw.tasks) ? raw.tasks : [];
  const candidates = new Map<EventTaskId, Record<string, unknown>>();
  for (const item of rawTasks) {
    const candidate = objectValue(item);
    const id = cleanText(candidate.id, 40) as EventTaskId;
    if (EVENT_TASK_IDS.has(id) && !candidates.has(id)) candidates.set(id, candidate);
  }

  return {
    version: 1,
    tasks: EVENT_TASK_DEFINITIONS.map((definition) => {
      const fallback = defaultTask(definition, topic, enabledByDefault);
      const candidate = candidates.get(definition.id);
      if (!candidate) return fallback;
      return {
        ...fallback,
        objective: cleanText(candidate.objective, 500) || fallback.objective,
        searchQueries: normalizeQueries(candidate.searchQueries, fallback.searchQueries),
        enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : fallback.enabled,
      };
    }),
  };
}

export function eventPlanningValidationError(intent: IntentRecognition, plan: EventTaskPlan): string {
  if (intent.detected === 'uncertain' && intent.resolved === null) {
    return '请先确认按事件脉络规划，或沿用普通规划。';
  }
  if (intent.resolved === 'event_timeline' && !plan.tasks.some((task) => task.enabled)) {
    return '事件脉络规划至少需要保留一个启用任务。';
  }
  return '';
}

export function submittedEventTaskPlanValidationError(value: unknown): string {
  const raw = objectValue(value);
  const rawTasks = Array.isArray(raw.tasks) ? raw.tasks : [];
  const tasks = new Map<EventTaskId, Record<string, unknown>>();
  for (const item of rawTasks) {
    const candidate = objectValue(item);
    const id = cleanText(candidate.id, 40) as EventTaskId;
    if (!EVENT_TASK_IDS.has(id) || tasks.has(id)) {
      return '五维任务必须使用固定的五项任务记录。';
    }
    tasks.set(id, candidate);
  }
  if (rawTasks.length !== EVENT_TASK_DEFINITIONS.length || tasks.size !== EVENT_TASK_DEFINITIONS.length) {
    return '五维任务必须完整保留发生时间、参与方、事件原因、具体内容和发生地点五项记录。';
  }

  for (const definition of EVENT_TASK_DEFINITIONS) {
    const task = tasks.get(definition.id);
    if (!task) return `五维任务缺少“${definition.dimension}”记录。`;
    const rawObjective = String(task.objective ?? '').trim();
    if (!cleanText(rawObjective, 500)) return `请填写“${definition.dimension}”的任务描述。`;
    if (rawObjective.length > 500) return `“${definition.dimension}”的任务描述不能超过 500 字。`;
    if (typeof task.enabled !== 'boolean') return `“${definition.dimension}”的启用状态无效。`;
    if (!Array.isArray(task.searchQueries) || task.searchQueries.length < 1 || task.searchQueries.length > 3) {
      return `“${definition.dimension}”需要保留 1–3 个检索词。`;
    }
    const normalizedQueries = normalizeQueries(task.searchQueries, []);
    if (!normalizedQueries.length) return `请填写“${definition.dimension}”的检索词。`;
    if (task.searchQueries.some((query) => String(query ?? '').trim().length > 80)) {
      return `“${definition.dimension}”的每个检索词不能超过 80 字。`;
    }
  }
  return '';
}

export function normalizeSubmittedEventPlanning(
  storedIntentValue: unknown,
  submittedIntentValue: unknown,
  submittedPlanValue: unknown,
  topic: string,
): { intentRecognition: IntentRecognition; eventTaskPlan: EventTaskPlan } {
  const storedIntent = normalizeIntentRecognition(storedIntentValue);
  const submittedIntent = objectValue(submittedIntentValue);
  const requestedResolution = cleanText(submittedIntent.resolved, 32);
  const resolved = storedIntent.detected === 'uncertain'
    ? requestedResolution === 'event_timeline' || requestedResolution === 'other'
      ? requestedResolution
      : null
    : storedIntent.detected;
  const intentRecognition: IntentRecognition = { ...storedIntent, resolved };
  if (intentRecognition.resolved === 'event_timeline') {
    const submissionError = submittedEventTaskPlanValidationError(submittedPlanValue);
    if (submissionError) throw new Error(submissionError);
  }
  let eventTaskPlan = normalizeEventTaskPlan(
    submittedPlanValue,
    topic,
    intentRecognition.resolved !== 'other',
  );
  if (intentRecognition.resolved === 'other') {
    eventTaskPlan = {
      ...eventTaskPlan,
      tasks: eventTaskPlan.tasks.map((task) => ({ ...task, enabled: false })),
    };
  }
  const error = eventPlanningValidationError(intentRecognition, eventTaskPlan);
  if (error) throw new Error(error);
  return { intentRecognition, eventTaskPlan };
}
