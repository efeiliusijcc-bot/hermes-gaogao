import { Injectable } from '@nestjs/common';
import dns from 'node:dns/promises';
import net from 'node:net';
import type {
  PublicUrlFetchFailure,
  PublicUrlFetchFailureCode,
  PublicUrlFetchItem,
  PublicUrlFetchOptions,
  PublicUrlFetchResult,
} from './crawler.types.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_URLS = 10;
const MAX_URLS_LIMIT = 50;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_CONTENT_CHARS = 30_000;
const DEFAULT_MAX_SUMMARY_CHARS = 1_000;
const ALLOWED_CONTENT_TYPE = /text\/html|text\/plain|application\/xhtml\+xml/i;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

class PublicUrlFetchError extends Error {
  constructor(
    readonly code: PublicUrlFetchFailureCode,
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
  }
}

@Injectable()
export class CrawlerService {
  async fetchPublicUrls(urls: string[], options: PublicUrlFetchOptions = {}): Promise<PublicUrlFetchResult> {
    const normalized = this.normalizeOptions(options);
    const uniqueUrls = Array.from(new Set(
      (Array.isArray(urls) ? urls : [])
        .map((url) => String(url || '').trim())
        .filter(Boolean),
    )).slice(0, normalized.maxUrls);
    const items: PublicUrlFetchItem[] = [];
    const failures: PublicUrlFetchFailure[] = [];

    for (const url of uniqueUrls) {
      try {
        items.push(await this.fetchPublicUrl(url, normalized));
      } catch (error) {
        failures.push(this.toFailure(url, error));
      }
    }

    return { items, failures };
  }

  private async fetchPublicUrl(
    requestedUrl: string,
    options: Required<PublicUrlFetchOptions>,
  ): Promise<PublicUrlFetchItem> {
    let currentUrl = requestedUrl;

    for (let redirectCount = 0; redirectCount <= options.maxRedirects; redirectCount += 1) {
      await this.assertSafeUrl(currentUrl);
      const response = await this.request(currentUrl, options.timeoutMs);

      if (REDIRECT_STATUS.has(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new PublicUrlFetchError('redirect_error', `HTTP ${response.status} redirect has no location`);
        if (redirectCount >= options.maxRedirects) {
          throw new PublicUrlFetchError('redirect_error', `Too many redirects (limit ${options.maxRedirects})`);
        }
        try {
          currentUrl = new URL(location, currentUrl).toString();
        } catch {
          throw new PublicUrlFetchError('redirect_error', 'Redirect target is not a valid URL');
        }
        continue;
      }

      if (!response.ok) {
        throw new PublicUrlFetchError('http_error', `HTTP ${response.status}`, response.status);
      }

      const contentType = response.headers.get('content-type') || '';
      if (!ALLOWED_CONTENT_TYPE.test(contentType)) {
        throw new PublicUrlFetchError(
          'unsupported_content_type',
          `Unsupported content type: ${contentType || 'unknown'}`,
        );
      }

      const rawContent = await response.text();
      const contentText = this.htmlToText(rawContent).slice(0, options.maxContentChars);
      const finalUrl = currentUrl;
      const parsed = new URL(finalUrl);
      return {
        requestedUrl,
        url: finalUrl,
        title: this.extractTitle(rawContent) || parsed.hostname,
        publisher: parsed.hostname,
        publishedAt: null,
        fetchedAt: new Date().toISOString(),
        contentText,
        contentSummary: contentText.slice(0, options.maxSummaryChars),
        retrievalMethod: 'controlled_fetch',
        metadata: {
          contentType,
          requestedUrl,
          finalUrl,
          redirectCount,
          fetchedBy: 'crawler-core',
        },
      };
    }

    throw new PublicUrlFetchError('redirect_error', 'Too many redirects');
  }

  private async request(url: string, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5',
          'User-Agent': 'HermesPublicUrlFetcher/1.0',
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new PublicUrlFetchError('timeout', `Request timed out after ${timeoutMs}ms`);
      }
      throw new PublicUrlFetchError('network_error', error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
    }
  }

  private async assertSafeUrl(rawUrl: string): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new PublicUrlFetchError('invalid_url', 'Invalid URL');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new PublicUrlFetchError('invalid_protocol', 'Only http/https URLs are allowed');
    }

    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === 'localhost.localdomain') {
      throw new PublicUrlFetchError('blocked_url', 'Localhost is not allowed');
    }
    if (this.isPrivateIp(hostname)) {
      throw new PublicUrlFetchError('blocked_url', 'Private or reserved network URL is not allowed');
    }

    const records = await this.resolveHostname(hostname);
    if (!records.length) throw new PublicUrlFetchError('network_error', 'Hostname could not be resolved');
    if (records.some((address) => this.isPrivateIp(address))) {
      throw new PublicUrlFetchError('blocked_url', 'Hostname resolves to a private or reserved network');
    }
  }

  protected async resolveHostname(hostname: string): Promise<string[]> {
    if (net.isIP(hostname)) return [hostname];
    try {
      const results = await dns.lookup(hostname, { all: true, verbatim: true });
      return results.map((item) => item.address);
    } catch {
      return [];
    }
  }

  private isPrivateIp(value: string): boolean {
    const normalized = value.replace(/^\[|\]$/g, '').toLowerCase();
    const ipType = net.isIP(normalized);
    if (ipType === 4) {
      const [a, b] = normalized.split('.').map(Number);
      return a === 0 ||
        a === 10 ||
        a === 127 ||
        a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && (b === 0 || b === 168)) ||
        (a === 198 && (b === 18 || b === 19));
    }
    if (ipType === 6) {
      return normalized === '::' ||
        normalized === '::1' ||
        normalized.startsWith('fc') ||
        normalized.startsWith('fd') ||
        /^fe[89ab]/.test(normalized) ||
        normalized.startsWith('::ffff:127.') ||
        normalized.startsWith('::ffff:10.') ||
        normalized.startsWith('::ffff:192.168.');
    }
    return false;
  }

  private htmlToText(html: string): string {
    return this.decodeHtmlEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<[^>]+>/g, ' '),
    )
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractTitle(html: string): string {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match ? this.htmlToText(match[1]).slice(0, 500) : '';
  }

  private decodeHtmlEntities(value: string): string {
    const named: Record<string, string> = {
      amp: '&',
      apos: "'",
      gt: '>',
      lt: '<',
      nbsp: ' ',
      quot: '"',
    };
    return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, token: string) => {
      if (token.startsWith('#x')) return String.fromCodePoint(Number.parseInt(token.slice(2), 16));
      if (token.startsWith('#')) return String.fromCodePoint(Number.parseInt(token.slice(1), 10));
      return named[token.toLowerCase()] ?? entity;
    });
  }

  private normalizeOptions(options: PublicUrlFetchOptions): Required<PublicUrlFetchOptions> {
    const maxContentChars = this.boundInt(options.maxContentChars, DEFAULT_MAX_CONTENT_CHARS, 1, 100_000);
    return {
      maxUrls: this.boundInt(options.maxUrls, DEFAULT_MAX_URLS, 1, MAX_URLS_LIMIT),
      timeoutMs: this.boundInt(options.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 60_000),
      maxRedirects: this.boundInt(options.maxRedirects, DEFAULT_MAX_REDIRECTS, 0, 10),
      maxContentChars,
      maxSummaryChars: this.boundInt(options.maxSummaryChars, DEFAULT_MAX_SUMMARY_CHARS, 1, maxContentChars),
    };
  }

  private boundInt(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
  }

  private toFailure(url: string, error: unknown): PublicUrlFetchFailure {
    if (error instanceof PublicUrlFetchError) {
      return {
        url,
        code: error.code,
        message: error.message,
        ...(error.statusCode === undefined ? {} : { statusCode: error.statusCode }),
      };
    }
    return {
      url,
      code: 'network_error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
