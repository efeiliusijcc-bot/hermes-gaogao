import {
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';

interface RateWindow {
  startedAt: number;
  count: number;
}

export interface SourceRecallAccessContext {
  clientId: string;
  rateLimit: number;
  remaining: number;
  resetAt: number;
}

export class SourceRecallRateLimitException extends HttpException {
  constructor(readonly limit: number, readonly resetAt: number) {
    super(
      { error: 'Source recall rate limit exceeded', code: 'SOURCE_RECALL_RATE_LIMITED' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

@Injectable()
export class SourceRecallAccessService {
  private readonly windows = new Map<string, RateWindow>();
  private activeRequests = 0;

  authorize(providedKey: string): SourceRecallAccessContext {
    if (!this.enabled()) {
      throw new ServiceUnavailableException({ error: 'Source recall API is disabled', code: 'SOURCE_RECALL_DISABLED' });
    }
    const configuredKey = String(process.env.SOURCE_RECALL_API_KEY || '');
    if (!configuredKey) {
      throw new ServiceUnavailableException({ error: 'Source recall API key is not configured', code: 'SOURCE_RECALL_KEY_MISSING' });
    }
    if (!providedKey || !timingSafeEqual(this.digest(providedKey), this.digest(configuredKey))) {
      throw new UnauthorizedException({ error: 'Invalid source recall API key', code: 'SOURCE_RECALL_UNAUTHORIZED' });
    }

    const now = Date.now();
    const fingerprint = this.digest(configuredKey).toString('hex');
    const limit = this.integerEnv('SOURCE_RECALL_RATE_LIMIT_PER_MINUTE', 60, 1, 10_000);
    let window = this.windows.get(fingerprint);
    if (!window || now - window.startedAt >= 60_000) {
      window = { startedAt: now, count: 0 };
      this.windows.set(fingerprint, window);
    }
    if (window.count >= limit) {
      throw new SourceRecallRateLimitException(limit, window.startedAt + 60_000);
    }
    window.count += 1;
    return {
      clientId: String(process.env.SOURCE_RECALL_CLIENT_ID || 'other-project').slice(0, 100),
      rateLimit: limit,
      remaining: Math.max(0, limit - window.count),
      resetAt: window.startedAt + 60_000,
    };
  }

  async withConcurrency<T>(operation: () => Promise<T>): Promise<T> {
    const maximum = this.integerEnv('SOURCE_RECALL_MAX_CONCURRENCY', 4, 1, 100);
    if (this.activeRequests >= maximum) {
      throw new HttpException(
        { error: 'Source recall concurrency limit exceeded', code: 'SOURCE_RECALL_CONCURRENCY_LIMITED' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.activeRequests += 1;
    try {
      return await operation();
    } finally {
      this.activeRequests -= 1;
    }
  }

  private enabled(): boolean {
    return ['1', 'true', 'on'].includes(String(process.env.SOURCE_RECALL_API_ENABLED || '').trim().toLowerCase());
  }

  private digest(value: string): Buffer {
    return createHash('sha256').update(value, 'utf8').digest();
  }

  private integerEnv(name: string, fallback: number, min: number, max: number): number {
    const value = Math.floor(Number(process.env[name]));
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  }
}
