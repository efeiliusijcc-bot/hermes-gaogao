import { Inject, Injectable } from '@nestjs/common';
import type { RetrievalConfig } from '../retrieval.tokens.js';
import { RETRIEVAL_CONFIG } from '../retrieval.tokens.js';
import type { CandidateDecision, FallbackSelection, QueryProfile, RetrievalCandidate } from '../retrieval.types.js';
import { CandidatePolicyService } from './candidate-policy.service.js';

@Injectable()
export class FallbackPolicyService {
  constructor(
    @Inject(RETRIEVAL_CONFIG) private readonly config: RetrievalConfig,
    private readonly policy: CandidatePolicyService,
  ) {}

  select(candidates: RetrievalCandidate[], profile: QueryProfile): FallbackSelection {
    const normal = this.policy.evaluate(candidates, profile, 'normal');
    if (normal.accepted.length) return this.result(normal.accepted, normal.decisions, 0, false, false, 'normal-policy');

    const suspicious = this.isSuspiciousDerivedEntityPolicy(candidates, normal.decisions, profile);
    const relaxDerived = this.policy.evaluate(candidates, profile, 'relax-derived');
    if (relaxDerived.accepted.length) {
      return this.result(
        relaxDerived.accepted,
        relaxDerived.decisions,
        1,
        false,
        suspicious,
        suspicious ? 'suspicious-derived-entity-policy:relaxed-rule-and-llm' : 'relaxed-rule-and-llm',
      );
    }

    const explicitOnly = this.policy.evaluate(candidates, profile, 'explicit-only');
    if (explicitOnly.accepted.length) {
      return this.result(explicitOnly.accepted, explicitOnly.decisions, 2, false, suspicious, 'kept-only-explicit-hard-entities');
    }

    const scoreOnly = this.policy.evaluate(candidates, profile, 'score-only');
    if (scoreOnly.accepted.length) {
      return this.result(scoreOnly.accepted, scoreOnly.decisions, 3, false, suspicious, 'score-only-fallback');
    }

    return this.result(
      [],
      scoreOnly.decisions,
      4,
      true,
      suspicious,
      suspicious ? 'suspicious-derived-entity-policy:expanded-retrieval-required' : 'expanded-retrieval-required',
    );
  }

  private result(
    accepted: RetrievalCandidate[],
    decisions: CandidateDecision[],
    fallbackLevel: 0 | 1 | 2 | 3 | 4,
    needsExpandedRetrieval: boolean,
    suspiciousEntityPolicy: boolean,
    reason: string,
  ): FallbackSelection {
    return { accepted, decisions, fallbackLevel, needsExpandedRetrieval, suspiciousEntityPolicy, reason };
  }

  private isSuspiciousDerivedEntityPolicy(
    candidates: RetrievalCandidate[],
    decisions: CandidateDecision[],
    profile: QueryProfile,
  ): boolean {
    if (candidates.length < this.config.minimumCandidateCountForFallback) return false;
    if (decisions.some((decision) => decision.accepted)) return false;
    const derivedHardIds = new Set(profile.coreEntities
      .filter((entity) => entity.enforcement === 'hard' && entity.source !== 'explicit')
      .map((entity) => entity.canonicalId));
    if (!derivedHardIds.size) return false;
    const reasons = decisions.map((decision) => decision.reason);
    const dominantCount = Math.max(...[...derivedHardIds].map(
      (id) => reasons.filter((reason) => reason.includes(`missing-hard-entity:${id}`)).length,
    ));
    return dominantCount >= this.config.minimumCandidateCountForFallback;
  }
}
