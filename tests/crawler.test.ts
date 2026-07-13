import assert from 'node:assert/strict';
import { CrawlerService } from '../server/crawler.service.js';

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>;

async function withFetch(handler: FetchHandler, run: () => Promise<void>) {
  const previous = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => handler(String(input), init)) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = previous;
  }
}

function htmlResponse(html: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });
}

async function testPureFetcherHasNoTaskLifecycle() {
  const crawler = new CrawlerService() as unknown as Record<string, unknown>;
  assert.equal(typeof crawler.fetchPublicUrls, 'function');
  for (const method of ['createTask', 'runTask', 'listTasks', 'getTask', 'deleteTask', 'listItems']) {
    assert.equal(crawler[method], undefined, `${method} must not remain on the pure fetch core`);
  }
}

async function testExtractsSafePublicHtmlAndAppliesLimits() {
  const crawler = new CrawlerService();
  const requested: Array<{ url: string; redirect?: RequestRedirect }> = [];
  await withFetch(async (url, init) => {
    requested.push({ url, redirect: init?.redirect });
    return htmlResponse(`
      <html><head><title>Example &amp; Brief</title><style>.x{color:red}</style></head>
      <body><h1>Public report</h1><script>doNotKeep()</script><p>${'evidence '.repeat(30)}</p></body></html>
    `);
  }, async () => {
    const result = await crawler.fetchPublicUrls([
      'https://93.184.216.34/report',
      'https://93.184.216.34/report',
      'https://93.184.216.35/ignored',
    ], { maxUrls: 1, maxContentChars: 80, maxSummaryChars: 30 });

    assert.equal(result.items.length, 1);
    assert.equal(result.failures.length, 0);
    assert.equal(requested.length, 1);
    assert.equal(requested[0].redirect, 'manual');
    assert.equal(result.items[0].title, 'Example & Brief');
    assert.match(result.items[0].contentText, /Public report/);
    assert.doesNotMatch(result.items[0].contentText, /doNotKeep|color:red/);
    assert.ok(result.items[0].contentText.length <= 80);
    assert.ok(result.items[0].contentSummary.length <= 30);
    assert.equal(result.items[0].retrievalMethod, 'controlled_fetch');
    assert.equal(result.items[0].metadata.contentType, 'text/html; charset=utf-8');
  });
}

async function testRejectsUnsafeAndUnsupportedUrlsWithoutFailingBatch() {
  const crawler = new CrawlerService();
  await withFetch(async (url) => {
    if (url.endsWith('/pdf')) {
      return new Response('binary', { status: 200, headers: { 'content-type': 'application/pdf' } });
    }
    if (url.endsWith('/error')) return htmlResponse('nope', 503);
    return new Response('plain evidence', { status: 200, headers: { 'content-type': 'text/plain' } });
  }, async () => {
    const result = await crawler.fetchPublicUrls([
      'http://127.0.0.1/private',
      'ftp://93.184.216.34/file',
      'https://93.184.216.34/pdf',
      'https://93.184.216.34/error',
      'https://93.184.216.34/ok',
    ]);

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].url, 'https://93.184.216.34/ok');
    assert.equal(result.failures.length, 4);
    assert.ok(result.failures.some((item) => item.url.includes('127.0.0.1') && item.code === 'blocked_url'));
    assert.ok(result.failures.some((item) => item.url.startsWith('ftp:') && item.code === 'invalid_protocol'));
    assert.ok(result.failures.some((item) => item.url.endsWith('/pdf') && item.code === 'unsupported_content_type'));
    assert.ok(result.failures.some((item) => item.url.endsWith('/error') && item.code === 'http_error'));
  });
}

async function testRevalidatesEveryRedirectTarget() {
  const crawler = new CrawlerService();
  let requests = 0;
  await withFetch(async () => {
    requests += 1;
    return htmlResponse('', 302, { location: 'http://127.0.0.1/admin' });
  }, async () => {
    const result = await crawler.fetchPublicUrls(['https://93.184.216.34/redirect']);
    assert.equal(result.items.length, 0);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].code, 'blocked_url');
    assert.equal(requests, 1, 'private redirect target must be rejected before a second request');
  });
}

await testPureFetcherHasNoTaskLifecycle();
await testExtractsSafePublicHtmlAndAppliesLimits();
await testRejectsUnsafeAndUnsupportedUrlsWithoutFailingBatch();
await testRevalidatesEveryRedirectTarget();
console.log('crawler core tests passed');
