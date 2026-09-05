import type { ServerEvent } from './types.js';

export interface HermesRunStreamEvent {
  event: string;
  run_id?: string;
  timestamp?: number | string;
  tool?: string;
  preview?: string;
  duration?: number;
  error?: boolean | string;
  text?: string;
  delta?: string;
  sequence?: number;
  usage?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

export interface ReadableToolSummary {
  phase: string;
  actor: string;
  label: string;
  summary: string;
  command?: string;
  detail?: string;
}

export interface ConsumeHermesRunEventStreamOptions {
  url: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  onEvent: (event: HermesRunStreamEvent) => void;
  fetchImpl?: typeof fetch;
  initialRetryCount?: number;
  retryDelayMs?: number;
}

export async function consumeHermesRunEventStream(
  options: ConsumeHermesRunEventStreamOptions,
): Promise<{ connected: true; eventCount: number }> {
  const fetchImpl = options.fetchImpl || fetch;
  const retries = Math.max(0, options.initialRetryCount ?? 2);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 250);
  let response: Response | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      response = await fetchImpl(options.url, {
        method: 'GET',
        headers: options.headers,
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted || attempt >= retries) throw error;
      if (retryDelayMs) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }
    if (response.ok && response.body) break;
    if (attempt >= retries) {
      throw new Error(`Hermes run event stream failed with status ${response.status}.`);
    }
    if (retryDelayMs) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }

  if (!response?.body) throw new Error('Hermes run event stream returned no response body.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new HermesRunEventStreamParser();
  let eventCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of parser.push(decoder.decode(value, { stream: true }))) {
        options.onEvent(event);
        eventCount += 1;
      }
    }
    for (const event of parser.push(decoder.decode())) {
      options.onEvent(event);
      eventCount += 1;
    }
    for (const event of parser.finish()) {
      options.onEvent(event);
      eventCount += 1;
    }
  } finally {
    reader.releaseLock();
  }

  return { connected: true, eventCount };
}

type ToolSummaryInput = {
  name: string;
  preview: string;
  status: 'started' | 'completed' | 'failed';
};

type ActiveToolCall = {
  id: string;
  preview: string;
};

export class HermesRunEventStreamParser {
  private buffer = '';

  push(chunk: string): HermesRunStreamEvent[] {
    this.buffer += chunk;
    const result: HermesRunStreamEvent[] = [];
    let boundary = this.buffer.match(/\r?\n\r?\n/);
    while (boundary?.index !== undefined) {
      const frame = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.index + boundary[0].length);
      const parsed = this.parseFrame(frame);
      if (parsed) result.push(parsed);
      boundary = this.buffer.match(/\r?\n\r?\n/);
    }
    return result;
  }

  finish(): HermesRunStreamEvent[] {
    const frame = this.buffer;
    this.buffer = '';
    const parsed = this.parseFrame(frame);
    return parsed ? [parsed] : [];
  }

  private parseFrame(frame: string): HermesRunStreamEvent | null {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
      .trim();
    if (!data) return null;
    try {
      const parsed = JSON.parse(data) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const event = parsed as HermesRunStreamEvent;
      return typeof event.event === 'string' && event.event ? event : null;
    } catch {
      return null;
    }
  }
}

export class HermesRunEventBridge {
  private toolSequence = 0;
  private eventSequence = 0;
  private readonly activeTools = new Map<string, ActiveToolCall[]>();

  constructor(private readonly describeTool: (input: ToolSummaryInput) => ReadableToolSummary) {}

  translate(event: HermesRunStreamEvent): ServerEvent[] {
    if (event.event === 'reasoning.available' || event.event === 'message.delta') return [];
    if (event.event === 'tool.started') return [this.toolStarted(event)];
    if (event.event === 'tool.completed') return [this.toolCompleted(event)];

    if (event.event === 'approval.request') {
      return [{ type: 'stage', stage: 'approval_required', message: '编报智能体正在等待必要的工具授权。', ...this.metadata(event) }];
    }
    if (event.event === 'run.completed') {
      return [{ type: 'stage', stage: 'hermes_run_completed', message: '编报智能体已完成核心执行，正在整理报告产物。', ...this.metadata(event) }];
    }
    if (event.event === 'run.cancelled') {
      return [{ type: 'stage', stage: 'hermes_run_cancelled', message: '编报智能体执行已取消。', ...this.metadata(event) }];
    }
    if (event.event === 'run.failed') {
      const message = typeof event.error === 'string' && event.error.trim()
        ? `编报智能体执行失败：${event.error.trim()}`
        : '编报智能体执行失败。';
      return [{ type: 'error', message, ...this.metadata(event) }];
    }
    return [];
  }

  private toolStarted(event: HermesRunStreamEvent): ServerEvent {
    const name = String(event.tool || 'tool').trim() || 'tool';
    const preview = String(event.preview || '').trim();
    const id = `${event.run_id || 'run'}:tool:${++this.toolSequence}`;
    const queue = this.activeTools.get(name) || [];
    queue.push({ id, preview });
    this.activeTools.set(name, queue);
    const summary = this.describeTool({ name, preview, status: 'started' });
    return {
      type: 'tool_start',
      id,
      name,
      raw: this.rawSummary(summary, 'started'),
      ...this.metadata(event),
    };
  }

  private toolCompleted(event: HermesRunStreamEvent): ServerEvent {
    const name = String(event.tool || 'tool').trim() || 'tool';
    const queue = this.activeTools.get(name) || [];
    const active = queue.shift();
    if (queue.length) this.activeTools.set(name, queue);
    else this.activeTools.delete(name);
    const id = active?.id || `${event.run_id || 'run'}:tool:${++this.toolSequence}`;
    const failed = event.error === true || (typeof event.error === 'string' && Boolean(event.error.trim()));
    const status = failed ? 'failed' : 'completed';
    const summary = this.describeTool({ name, preview: active?.preview || '', status });
    const duration = Number(event.duration);
    const durationDetail = Number.isFinite(duration) && duration >= 0 ? `耗时 ${duration} 秒` : '';
    const raw = this.rawSummary({
      ...summary,
      detail: [summary.detail, durationDetail].filter(Boolean).join('；'),
    }, status);
    return failed
      ? { type: 'tool_error', id, name, message: summary.summary, raw, ...this.metadata(event) }
      : { type: 'tool_end', id, name, raw, ...this.metadata(event) };
  }

  private rawSummary(summary: ReadableToolSummary, status: string): Record<string, string> {
    return {
      phase: summary.phase,
      actor: summary.actor,
      label: summary.label,
      summary: summary.summary,
      status,
      ...(summary.command ? { command: summary.command } : {}),
      ...(summary.detail ? { detail: summary.detail } : {}),
    };
  }

  private metadata(event: HermesRunStreamEvent) {
    const rawTimestamp = event.timestamp;
    const numericTimestamp = typeof rawTimestamp === 'number'
      ? rawTimestamp
      : typeof rawTimestamp === 'string' && /^-?\d+(?:\.\d+)?$/.test(rawTimestamp.trim())
        ? Number(rawTimestamp)
        : Number.NaN;
    const timestampMs = Number.isFinite(numericTimestamp)
      ? numericTimestamp < 1_000_000_000_000 ? numericTimestamp * 1000 : numericTimestamp
      : typeof rawTimestamp === 'string'
        ? Date.parse(rawTimestamp)
        : Number.NaN;
    const occurredAt = Number.isFinite(timestampMs) && Number.isFinite(new Date(timestampMs).getTime())
      ? new Date(timestampMs).toISOString()
      : undefined;
    const durationSeconds = Number(event.duration);
    const usageSource = event.usage && typeof event.usage === 'object'
      ? event.usage
      : event.data?.usage && typeof event.data.usage === 'object'
        ? event.data.usage as Record<string, unknown>
        : undefined;
    const usage = usageSource
      ? Object.fromEntries(
          Object.entries(usageSource)
            .filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value >= 0)
            .slice(0, 12),
        ) as Record<string, number>
      : undefined;
    const rawSequence = Number(event.sequence);
    const sequence = Number.isFinite(rawSequence) && rawSequence >= 0
      ? Math.round(rawSequence)
      : this.eventSequence + 1;
    this.eventSequence = Math.max(this.eventSequence, sequence);
    return {
      ...(occurredAt ? { occurredAt } : {}),
      origin: 'hermes_agent' as const,
      ...(Number.isFinite(durationSeconds) && durationSeconds >= 0 ? { durationMs: Math.round(durationSeconds * 1000) } : {}),
      sequence,
      runEvent: event.event,
      ...(usage && Object.keys(usage).length ? { usage } : {}),
    };
  }
}
