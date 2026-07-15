import { EntityAliasService } from '../query/entity-alias.service.js';

const aliases = new EntityAliasService();

export const HYBRID_SIDECAR_SOURCE_TABLE = 'vector_materials_text_embedding_v4';

export function hybridSidecarsMatchSourceTable(sourceTable: string): boolean {
  return sourceTable === HYBRID_SIDECAR_SOURCE_TABLE;
}

export function assertHybridSidecarSourceTable(sourceTable: string): void {
  if (!hybridSidecarsMatchSourceTable(sourceTable)) {
    throw new Error(
      `Hybrid retrieval sidecars are bound to ${HYBRID_SIDECAR_SOURCE_TABLE}, received ${sourceTable}`,
    );
  }
}

export function tokenizeHybridSearchText(input: string, maxTerms = 96): string {
  const text = String(input || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const terms = new Set<string>();
  const add = (value: string) => {
    const term = value.trim().toLowerCase();
    if (term.length >= 2 && terms.size < maxTerms) terms.add(term);
  };

  for (const token of text.match(/[A-Za-z][A-Za-z0-9&.+/-]{1,}/g) || []) add(token);
  for (const run of text.match(/[\p{Script=Han}]{2,}/gu) || []) {
    if (run.length <= 24) add(run);
    for (let width = 2; width <= Math.min(4, run.length); width += 1) {
      for (let index = 0; index <= run.length - width && terms.size < maxTerms; index += 1) {
        add(run.slice(index, index + width));
      }
    }
    if (terms.size >= maxTerms) break;
  }
  return [...terms].join(' ');
}

export function extractHybridEntityIds(input: string): string[] {
  return aliases.extractFromText(String(input || ''), 'rule', 1)
    .map((entity) => entity.canonicalId);
}
