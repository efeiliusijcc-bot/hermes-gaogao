export interface DailyAwarenessSourceContext {
  sourceBusinessDate: string;
  sourceTable: string;
  dataWaitDeadline: string;
}

export function previousBusinessDate(businessDate: string): string {
  const date = requiredDate(businessDate);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

export function dailyAwarenessSourceContext(businessDate: string): DailyAwarenessSourceContext {
  const date = requiredDate(businessDate);
  const sourceBusinessDate = previousBusinessDate(date);
  return {
    sourceBusinessDate,
    sourceTable: `data_${sourceBusinessDate.replaceAll('-', '')}`,
    dataWaitDeadline: `${date}T08:00:00+08:00`,
  };
}

export function requiredDailyAwarenessDate(value: unknown): string {
  return requiredDate(value);
}

function requiredDate(value: unknown): string {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('businessDate must be YYYY-MM-DD');
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('businessDate must be a valid date');
  }
  return date;
}
