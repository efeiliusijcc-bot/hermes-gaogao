import { Injectable } from '@nestjs/common';
import type { ParsedEntity, RetrievalCandidate } from '../retrieval.types.js';

@Injectable()
export class EntityMatchService {
  matches(candidate: RetrievalCandidate, entity: ParsedEntity): boolean {
    const text = [candidate.title, candidate.summary, candidate.content?.slice(0, 4000)].filter(Boolean).join('\n');
    return [entity.canonicalName, ...entity.aliases].some((alias) => alias && text.includes(alias));
  }
}
