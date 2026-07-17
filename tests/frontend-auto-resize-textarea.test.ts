import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resizeTextareaElement } from '../b_k3ewYvsOEc1/src/lib/autoResizeTextarea.js';

const element = {
  style: { height: '96px' },
  scrollHeight: 168,
};
assert.equal(resizeTextareaElement(element), 168);
assert.equal(element.style.height, '168px');

element.scrollHeight = 80;
assert.equal(resizeTextareaElement(element), 80);
assert.equal(element.style.height, '80px');

const componentSource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/common/AutoResizeTextarea.vue', import.meta.url),
  'utf8',
);
assert.match(componentSource, /onMounted\(resize\)/);
assert.match(componentSource, /watch\([\s\S]*props\.modelValue[\s\S]*nextTick[\s\S]*resize/);
assert.match(componentSource, /watch\([\s\S]*props\.minHeight[\s\S]*nextTick[\s\S]*resize/);
assert.match(componentSource, /ResizeObserver/);
assert.match(componentSource, /contentRect\.width/);
assert.match(componentSource, /emit\('update:modelValue'/);
assert.match(componentSource, /rows="1"/);
assert.match(componentSource, /overflow-y:\s*hidden/);
assert.match(componentSource, /resize:\s*none/);
assert.doesNotMatch(componentSource, /max-height/);
assert.doesNotMatch(componentSource, /manualUpdateDraftOutline|saveManualOutline|confirmCurrentVersion/);

const assistantSource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/DraftAssistant.vue', import.meta.url),
  'utf8',
);
const sourceComposer = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/DraftSourceComposer.vue', import.meta.url),
  'utf8',
);
const outlineEditor = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/DraftOutlineEditor.vue', import.meta.url),
  'utf8',
);

assert.match(sourceComposer, /import AutoResizeTextarea from/);
assert.equal((sourceComposer.match(/<AutoResizeTextarea/g) || []).length, 1);
assert.match(sourceComposer, /:min-height="152"/);
assert.match(outlineEditor, /import AutoResizeTextarea from/);
assert.equal((outlineEditor.match(/<AutoResizeTextarea/g) || []).length, 5);
assert.match(outlineEditor, /aria-label="AI 修改意见"/);
assert.match(assistantSource, /<DraftSourceComposer/);
assert.match(assistantSource, /<DraftOutlineEditor/);
assert.match(assistantSource, /@confirm="showConfirmation"/);
assert.match(assistantSource, /@revise="reviseOutline"/);

console.log('frontend auto resize textarea tests passed');
