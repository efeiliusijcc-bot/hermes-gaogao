import { Inject, Injectable } from '@nestjs/common';
import type { RetrievalConfig } from '../retrieval.tokens.js';
import { RETRIEVAL_CONFIG } from '../retrieval.tokens.js';
import type {
  CandidatePolicyMode,
  ParsedEntity,
  PolicyEvaluation,
  QueryProfile,
  RetrievalCandidate,
} from '../retrieval.types.js';
import { EntityMatchService } from './entity-match.service.js';

@Injectable()
export class CandidatePolicyService {
  constructor(
    @Inject(RETRIEVAL_CONFIG) private readonly config: RetrievalConfig,
    private readonly entityMatch: EntityMatchService,
  ) {}

  evaluate(
    candidates: RetrievalCandidate[],
    profile: QueryProfile,
    mode: CandidatePolicyMode,
  ): PolicyEvaluation {
    const hardEntities = this.hardEntities(profile, mode);
    const minimumScore = mode === 'score-only'
      ? this.config.emergencyMinimumFinalScore
      : this.config.minimumFinalScore;
    const evaluated = candidates.map((candidate) => {
      const missing = hardEntities.filter((entity) => !this.entityMatch.matches(candidate, entity));
      if (missing.length) {
        return {
          candidate,
          accepted: false,
          reason: `missing-hard-entity:${missing.map((entity) => entity.canonicalId).join(',')}`,
        };
      }
      if ((candidate.scores.final || 0) < minimumScore) {
        return { candidate, accepted: false, reason: 'below-minimum-score' };
      }
      return { candidate, accepted: true, reason: mode === 'score-only' ? 'accepted-score-only' : 'accepted' };
    });
    const selectedIds = new Set(evaluated
      .filter((decision) => decision.accepted)
      .slice(0, this.config.finalTopK)
      .map((decision) => decision.candidate.documentId));
    const decisions = evaluated.map((decision) =>
      decision.accepted && !selectedIds.has(decision.candidate.documentId)
        ? { ...decision, accepted: false, reason: 'outside-final-top-k' }
        : decision,
    );
    return {
      mode,
      accepted: decisions.filter((decision) => decision.accepted)
        .map((decision) => decision.candidate),
      decisions,
    };
  }

  private hardEntities(profile: QueryProfile, mode: CandidatePolicyMode): ParsedEntity[] {
    const hard = profile.coreEntities.filter((entity) => entity.enforcement === 'hard');
    if (mode === 'normal') return hard;
    if (mode === 'relax-derived') {
      return hard.filter((entity) => entity.source !== 'rule' && entity.source !== 'llm');
    }
    return hard.filter((entity) => entity.source === 'explicit');
  }
}
