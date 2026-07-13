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
assert.match(componentSource, /ResizeObserver/);
assert.match(componentSource, /contentRect\.width/);
assert.match(componentSource, /emit\('update:modelValue'/);
assert.match(componentSource, /overflow-y:\s*hidden/);
assert.match(componentSource, /resize:\s*none/);
assert.doesNotMatch(componentSource, /max-height/);
assert.doesNotMatch(componentSource, /manualUpdateDraftOutline|saveManualOutline|confirmCurrentVersion/);

const assistantSource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/DraftAssistant.vue', import.meta.url),
  'utf8',
);
assert.match(assistantSource, /import AutoResizeTextarea from/);
assert.equal((assistantSource.match(/<AutoResizeTextarea/g) || []).length, 3);
assert.match(assistantSource, /\.draft-edit-fields\s*\{[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(assistantSource, /\.draft-edit-info-card\.argument\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1/);
assert.match(assistantSource, /@media \(max-width:\s*900px\)[\s\S]*\.draft-edit-fields[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
assert.match(assistantSource, /@media \(max-width:\s*900px\)[\s\S]*\.draft-edit-info-card\.argument[\s\S]*grid-column:\s*auto/);
assert.doesNotMatch(assistantSource, /\.draft-autogrow-textarea[\s\S]*overflow-y:\s*(?:auto|scroll)/);
assert.match(assistantSource, /@save="saveManualOutline"/);
assert.match(assistantSource, /@confirm="confirmCurrentVersion"/);
assert.match(assistantSource, /@refine="refineOutline"/);

console.log('frontend auto resize textarea tests passed');
