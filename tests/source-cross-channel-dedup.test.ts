import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canonicalUrl, dedupeSupplementSources } from '../server/web-supplement.service.js';

const entityMatch = {
  status: 'accepted',
  finalScore: 0.9,
  matchedTopicTerms: ['中试', '量产'],
  matchedConfusions: [],
};

function source(overrides: Record<string, unknown>) {
  return {
    title: 'Magnequench pilot production update',
    url: 'https://example.com/story?utm_source=test',
    content: 'Magnequench pilot production and mass production process update with detailed official information. '.repeat(3),
    entityMatch,
    sourceQuality: { status: 'accepted', score: 0.7, tier: 'industry', reason: 'industry' },
    ...overrides,
  };
}

function testCanonicalUrlRemovesTracking() {
  assert.equal(canonicalUrl('https://EXAMPLE.com/story/?utm_source=test#part'), 'https://example.com/story');
}

function testSameUrlKeepsHigherQuality() {
  const deduped = dedupeSupplementSources([
    source({ sourceChannel: 'database', sourceQuality: { status: 'accepted', score: 0.65, tier: 'industry', reason: 'database' } }),
    source({ sourceChannel: 'web', url: 'https://example.com/story', sourceQuality: { status: 'accepted', score: 0.95, tier: 'official', reason: 'official' } }),
  ]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].sourceChannel, 'web');
}

function testExactRepostContentKeepsHigherQuality() {
  const content = 'Neo Performance Materials official Magnequench production process, pilot validation and mass production readiness. '.repeat(3);
  const deduped = dedupeSupplementSources([
    source({ sourceChannel: 'web', url: 'https://blog.example/a', content, sourceQuality: { status: 'uncertain', score: 0.45, tier: 'ordinary', reason: 'blog' } }),
    source({ sourceChannel: 'web', url: 'https://official.example/notice', content, sourceQuality: { status: 'accepted', score: 0.95, tier: 'official', reason: 'official' } }),
  ]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].sourceChannel, 'web');
}

function testFrontendDefaultsToCompositeAllSources() {
  const component = fs.readFileSync(new URL('../b_k3ewYvsOEc1/src/components/DataCanvas.vue', import.meta.url), 'utf8');
  assert.match(component, /const activeSourceType = ref\('all'\)/);
  assert.match(component, /source\?\.sourcePriority \?\? source\?\.source_priority/);
}

testCanonicalUrlRemovesTracking();
testSameUrlKeepsHigherQuality();
testExactRepostContentKeepsHigherQuality();
testFrontendDefaultsToCompositeAllSources();
console.log('source cross-channel dedup tests passed');
