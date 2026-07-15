import { Injectable } from '@nestjs/common';
import type { RetrievalCandidate, RetrievalSource } from '../retrieval.types.js';

@Injectable()
export class RrfFusionService {
  fuse(resultSets: RetrievalCandidate[][], rrfK: number, limit: number): RetrievalCandidate[] {
    const merged = new Map<string, RetrievalCandidate>();
    for (const resultSet of resultSets) {
      for (const candidate of resultSet) {
        const contribution = this.contribution(candidate, rrfK);
        const current = merged.get(candidate.documentId);
        if (!current) {
          merged.set(candidate.documentId, {
            ...candidate,
            retrievalSources: [...candidate.retrievalSources],
            ranks: { ...candidate.ranks },
            scores: { ...candidate.scores, rrf: contribution },
          });
          continue;
        }
        current.retrievalSources = [...new Set<RetrievalSource>([
          ...current.retrievalSources,
          ...candidate.retrievalSources,
        ])];
        current.ranks = { ...current.ranks, ...candidate.ranks };
        current.scores = {
          ...current.scores,
          ...candidate.scores,
          rrf: (current.scores.rrf || 0) + contribution,
        };
        current.summary ||= candidate.summary;
        current.content ||= candidate.content;
        current.url ||= candidate.url;
        current.publishedAt ||= candidate.publishedAt;
        current.sourceName ||= candidate.sourceName;
      }
    }
    return [...merged.values()]
      .sort((left, right) => (right.scores.rrf || 0) - (left.scores.rrf || 0))
      .slice(0, Math.max(0, limit));
  }

  private contribution(candidate: RetrievalCandidate, rrfK: number): number {
    return candidate.retrievalSources.reduce((total, source) => {
      const rank = candidate.ranks[source];
      return total + (rank ? 1 / (rrfK + rank) : 0);
    }, 0);
  }
}
