import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  SourceRecallAccessService,
  SourceRecallRateLimitException,
  type SourceRecallAccessContext,
} from './source-recall-access.service.js';

export type SourceRecallRequestWithAccess = Request & { sourceRecallAccess?: SourceRecallAccessContext };

@Injectable()
export class SourceRecallGuard implements CanActivate {
  constructor(@Inject(SourceRecallAccessService) private readonly access: SourceRecallAccessService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<SourceRecallRequestWithAccess>();
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    const rawHeader = request.headers['x-hermes-recall-key'];
    const providedKey = Array.isArray(rawHeader) ? String(rawHeader[0] || '') : String(rawHeader || '');
    let authorized: SourceRecallAccessContext;
    try {
      authorized = this.access.authorize(providedKey);
    } catch (error) {
      if (error instanceof SourceRecallRateLimitException) {
        const resetSeconds = Math.max(1, Math.ceil((error.resetAt - Date.now()) / 1000));
        response.setHeader('RateLimit-Limit', String(error.limit));
        response.setHeader('RateLimit-Remaining', '0');
        response.setHeader('RateLimit-Reset', String(resetSeconds));
        response.setHeader('Retry-After', String(resetSeconds));
      }
      throw error;
    }
    request.sourceRecallAccess = authorized;
    response.setHeader('RateLimit-Limit', String(authorized.rateLimit));
    response.setHeader('RateLimit-Remaining', String(authorized.remaining));
    response.setHeader('RateLimit-Reset', String(Math.max(0, Math.ceil((authorized.resetAt - Date.now()) / 1000))));
    return true;
  }
}
