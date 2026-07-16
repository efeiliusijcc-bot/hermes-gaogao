import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { dailyAwarenessInternalEventKey } from './config.js';

@Injectable()
export class InternalEventKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const configuredKey = dailyAwarenessInternalEventKey();
    if (!configuredKey) {
      throw new ServiceUnavailableException({
        error: 'Daily awareness internal event key is not configured',
        code: 'DAILY_AWARENESS_INTERNAL_KEY_MISSING',
      });
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['x-hermes-internal-key'];
    const suppliedKey = Array.isArray(header) ? header[0] : String(header || '');
    if (!this.matches(configuredKey, suppliedKey)) {
      throw new UnauthorizedException({
        error: 'Invalid internal event credential',
        code: 'DAILY_AWARENESS_INTERNAL_KEY_INVALID',
      });
    }
    return true;
  }

  private matches(expected: string, supplied: string): boolean {
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const suppliedBuffer = Buffer.from(supplied, 'utf8');
    if (expectedBuffer.length !== suppliedBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, suppliedBuffer);
  }
}
