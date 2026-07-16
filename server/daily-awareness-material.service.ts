import { Inject, Injectable } from '@nestjs/common';
import type { DailyAwarenessConfig, DailyAwarenessPreparedMaterials } from './daily-awareness.contracts.js';
import type { DailyAwarenessMaterial } from './daily-awareness.types.js';
import { buildEventCandidates, dedupeMaterials } from './daily-awareness.utils.js';
import { VectorSourceService } from './vector-source.service.js';

export function prepareDailyAwarenessMaterials(
  input: DailyAwarenessMaterial[],
  summaryMaxChars: number,
  diagnostics: Record<string, unknown> = {},
): DailyAwarenessPreparedMaterials {
  const maxChars = Math.max(100, Math.min(10_000, Math.floor(Number(summaryMaxChars) || 1200)));
  const usable: DailyAwarenessMaterial[] = [];
  let skippedCount = 0;

  for (const material of input) {
    const title = String(material.title || '').trim().slice(0, 512);
    if (!title) {
      skippedCount += 1;
      continue;
    }
    const summary = String(material.summary || '').trim().slice(0, maxChars);
    usable.push({
      ...material,
      title,
      summary,
      content: String(material.content || '').trim().slice(0, maxChars),
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
  constructor(@Inject(VectorSourceService) private readonly vectorSources: VectorSourceService) {}

  async prepareForBusinessDate(
    businessDate: string,
    config: DailyAwarenessConfig,
  ): Promise<DailyAwarenessPreparedMaterials> {
    const result = await this.vectorSources.listDailyMaterials({
      targetDate: businessDate,
      lookbackHours: config.lookbackHours,
      limit: config.maxArticles,
      categories: config.categoryScope,
      allowFallback: false,
    });
    return prepareDailyAwarenessMaterials(result.materials, config.summaryMaxChars, result.diagnostics);
  }
}
