import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import type { AuthUser } from './auth-user.interface.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = request.headers.authorization || '';
    const match = String(header).match(/^Bearer\s+(.+)$/i);
    const queryToken = this.allowsQueryToken(request)
      ? this.firstQueryValue((request.query as Record<string, unknown> | undefined)?.access_token)
      : '';
    const token = match?.[1] || queryToken;
    if (!token) {
      throw new UnauthorizedException({ error: 'Authorization bearer token is required' });
    }

    request.user = await this.auth.verifyAccessToken(token.trim());
    return true;
  }

  private allowsQueryToken(request: Request): boolean {
    const path = request.path || request.url.split('?')[0] || '';
    return /^\/api\/report-jobs\/[^/]+\/events\/?$/.test(path) || /^\/api\/chat\/streams\/[^/]+\/?$/.test(path);
  }

  private firstQueryValue(value: unknown): string {
    if (Array.isArray(value)) return String(value[0] || '');
    return String(value || '');
  }
}
