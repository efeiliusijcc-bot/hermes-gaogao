export interface PublicUrlFetchOptions {
  maxUrls?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  maxContentChars?: number;
  maxSummaryChars?: number;
}

export type PublicUrlFetchFailureCode =
  | 'invalid_url'
  | 'invalid_protocol'
  | 'blocked_url'
  | 'redirect_error'
  | 'http_error'
  | 'unsupported_content_type'
  | 'timeout'
  | 'network_error';

export interface PublicUrlFetchFailure {
  url: string;
  code: PublicUrlFetchFailureCode;
  message: string;
  statusCode?: number;
}

export interface PublicUrlFetchItem {
  requestedUrl: string;
  url: string;
  title: string;
  publisher: string;
  publishedAt: null;
  fetchedAt: string;
  contentText: string;
  contentSummary: string;
  retrievalMethod: 'controlled_fetch';
  metadata: {
    contentType: string;
    requestedUrl: string;
    finalUrl: string;
    redirectCount: number;
    fetchedBy: 'crawler-core';
  };
}

export interface PublicUrlFetchResult {
  items: PublicUrlFetchItem[];
  failures: PublicUrlFetchFailure[];
}
