import { Inject, Injectable } from '@nestjs/common';
import type { RetrievalConfig } from '../retrieval.tokens.js';
import { RETRIEVAL_CONFIG } from '../retrieval.tokens.js';
import type { QueryProfile, RetrievalCandidate } from '../retrieval.types.js';

@Injectable()
export class CandidateRerankerService {
  constructor(@Inject(RETRIEVAL_CONFIG) private readonly config: RetrievalConfig) {}

  rerank(candidates: RetrievalCandidate[], profile: QueryProfile): RetrievalCandidate[] {
    const maximumRrf = Math.max(...candidates.map((candidate) => candidate.scores.rrf || 0), 1e-9);
    return candidates.map((candidate) => {
      const text = [candidate.title, candidate.summary, candidate.content?.slice(0, 4000)].filter(Boolean).join('\n');
      const entityCoverage = this.coverage(
        profile.coreEntities.filter((entity) => entity.enforcement !== 'disabled')
          .map((entity) => [entity.canonicalName, ...entity.aliases]),
        text,
      );
      const topicCoverage = this.coverage(profile.coreTopics.map((topic) => [topic]), text);
      const titleCoverage = this.titleCoverage(candidate.title, profile);
      const semantic = this.clamp(candidate.scores.vector || 0);
      const normalizedRrf = this.clamp((candidate.scores.rrf || 0) / maximumRrf);
      const freshness = this.freshness(candidate.publishedAt);
      const sourceQuality = this.sourceQuality(candidate);
      const rerank = this.clamp(
        0.35 * semantic +
        0.25 * entityCoverage +
        0.25 * topicCoverage +
        0.15 * titleCoverage,
      );
      const final = this.clamp(
        0.55 * rerank + 0.25 * normalizedRrf + 0.1 * freshness + 0.1 * sourceQuality,
      );
      return {
        ...candidate,
        scores: {
          ...candidate.scores,
          entityCoverage,
          topicCoverage,
          titleCoverage,
          freshness,
          sourceQuality,
          rerank,
          final,
        },
      };
    }).sort((left, right) => (right.scores.final || 0) - (left.scores.final || 0));
  }

  private coverage(termGroups: string[][], text: string): number {
    if (!termGroups.length) return 1;
    const matched = termGroups.filter((terms) => terms.some((term) => term && text.includes(term))).length;
    return matched / termGroups.length;
  }

  private titleCoverage(title: string, profile: QueryProfile): number {
    const terms = [
      ...profile.coreEntities
        .filter((entity) => entity.enforcement !== 'disabled')
        .flatMap((entity) => [entity.canonicalName, ...entity.aliases]),
      ...profile.coreTopics,
    ].filter((term) => term.length >= 2);
    if (!terms.length) return 0;
    return this.clamp(terms.filter((term) => title.includes(term)).length / Math.min(terms.length, 5));
  }

  private freshness(publishedAt: string | undefined): number {
    if (!publishedAt) return 0.5;
    const timestamp = Date.parse(publishedAt);
    if (!Number.isFinite(timestamp)) return 0.5;
    const ageDays = Math.max(0, (Date.now() - timestamp) / 86_400_000);
    return Math.pow(0.5, ageDays / this.config.freshnessHalfLifeDays);
  }

  private sourceQuality(candidate: RetrievalCandidate): number {
    const value = `${candidate.sourceName || ''} ${candidate.url || ''}`.toLowerCase();
    if (/\.gov\b|\.edu\b|政府|议会|外交部|总统府|联合国/.test(value)) return 0.95;
    if (/reuters|associated press|ap news|新华社|bbc|financial times/.test(value)) return 0.85;
    return this.config.sourceQualityDefault;
  }

  private clamp(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  }
}
