import { Injectable } from '@nestjs/common';
import type { DailyAwarenessConfig, DailyAwarenessPreparedMaterials } from './daily-awareness.contracts.js';
import type { DailyAwarenessMaterial } from './daily-awareness.types.js';
import { buildEventCandidates, dedupeMaterials } from './daily-awareness.utils.js';
import { DailyAwarenessMysqlService } from './daily-awareness-mysql.service.js';
import { previousBusinessDate } from './daily-awareness-date.js';

export function prepareDailyAwarenessMaterials(
  input: DailyAwarenessMaterial[],
  _summaryMaxChars: number,
  diagnostics: Record<string, unknown> = {},
): DailyAwarenessPreparedMaterials {
  const usable: DailyAwarenessMaterial[] = [];
  let skippedCount = 0;

  for (const material of input) {
    const title = String(material.title || '').trim().slice(0, 512);
    if (!title) {
      skippedCount += 1;
      continue;
    }
    const summary = String(material.summary || '').trim();
    usable.push({
      ...material,
      title,
      summary,
      content: String(material.content || '').trim(),
    });
  }

  const materials = dedupeMaterials(usable);
  const summaryCount = materials.filter((material) => Boolean(String(material.summary || '').trim())).length;
  const titleOnlyCount = materials.length - summaryCount;
  const qualityStatus = !materials.length
    ? null
    : summaryCount === materials.length
      ? 'NORMAL'
      : summaryCount === 0
        ? 'TITLE_ONLY'
        : 'PARTIAL_SUMMARY';

  return {
    materials,
    candidates: buildEventCandidates(materials),
    sourceCount: materials.length,
    summaryCount,
    titleOnlyCount,
    skippedCount,
    qualityStatus,
    diagnostics,
  };
}

@Injectable()
export class DailyAwarenessMaterialService {
  constructor(private readonly mysql: DailyAwarenessMysqlService) {}

  async prepareForBusinessDate(
    businessDate: string,
    config: DailyAwarenessConfig,
    sourceBusinessDate = previousBusinessDate(businessDate),
  ): Promise<DailyAwarenessPreparedMaterials> {
    const rows = await this.mysql.listForBusinessDate(sourceBusinessDate, config.categoryScope);
    const materials: DailyAwarenessMaterial[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      summary: row.summary,
      content: row.summary,
      url: row.url,
      publisher: row.publisher,
      publishedAt: row.publishedAt,
      metadata: { dataType: row.dataType, designatedTag: row.designatedTag, tag: row.tag },
      designatedTag: row.designatedTag,
      tag: row.tag,
    }));
    return prepareDailyAwarenessMaterials(materials, config.summaryMaxChars, {
      source: 'mysql',
      businessDate,
      sourceBusinessDate,
      sourceTable: `data_${sourceBusinessDate.replaceAll('-', '')}`,
      categoryScope: config.categoryScope,
    });
  }
}
