import { Body, Controller, Get, Inject, Optional, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CurrentUser } from './current-user.decorator.js';
import type { AuthUser } from './auth-user.interface.js';
import { AuditLogService } from './audit-log.service.js';

@Controller('/api/auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Optional() @Inject(AuditLogService) private readonly audit?: AuditLogService,
  ) {}

  @Post('login')
  async login(
    @Body() body: { username?: string; password?: string },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(String(body?.username || ''), String(body?.password || ''), this.context(request));
    this.setRefreshCookie(response, result.refresh_token);
    return { access_token: result.access_token, user: result.user };
  }

  @Post('refresh')
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.refreshAccessToken(this.readCookie(request, 'refresh_token'));
    this.setRefreshCookie(response, result.refresh_token);
    return { access_token: result.access_token, user: result.user };
  }

  @Post('logout')
  async logout(@CurrentUser() user: AuthUser | undefined, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.clearRefreshCookie(response);
    await this.audit?.log({
      actor: user || null,
      action: 'logout',
      resource: 'auth',
      request,
    });
    return { success: true };
  }

  @Put('password')
  @UseGuards(AuthGuard)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() body: { oldPassword?: string; newPassword?: string },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.changePassword(user, String(body?.oldPassword || ''), String(body?.newPassword || ''), this.context(request));
    this.clearRefreshCookie(response);
    return result;
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  private context(request: Request) {
    return {
      ip: this.requestIp(request),
      userAgent: String(request.headers['user-agent'] || ''),
    };
  }

  private requestIp(request: Request): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (Array.isArray(forwarded)) return String(forwarded[0] || '').split(',')[0].trim();
    if (forwarded) return String(forwarded).split(',')[0].trim();
    return request.ip || request.socket?.remoteAddress || '';
  }

  private readCookie(request: Request, name: string): string {
    const header = String(request.headers.cookie || '');
    const item = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
    return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
  }

  private setRefreshCookie(response: Response, token: string): void {
    response.cookie('refresh_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/auth',
    });
  }

  private clearRefreshCookie(response: Response): void {
    response.clearCookie('refresh_token', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/api/auth',
    });
  }
}
