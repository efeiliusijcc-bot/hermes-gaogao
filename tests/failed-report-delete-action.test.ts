import assert from 'node:assert/strict';
import fs from 'node:fs';

const dataCanvasSource = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/DataCanvas.vue', import.meta.url),
  'utf8',
);

// The new button must live in the top workspace-actions toolbar, next to the
// 报告列表 button. Extract that toolbar region (opening div .. closing div).
const toolbarOpenAt = dataCanvasSource.indexOf('class="workspace-actions flex items-center gap-2"');
assert.notEqual(toolbarOpenAt, -1, 'workspace-actions toolbar not found');
const toolbarCloseAt = dataCanvasSource.indexOf('</div>', toolbarOpenAt);
assert.notEqual(toolbarCloseAt, -1, 'workspace-actions toolbar closing div not found');
const toolbar = dataCanvasSource.slice(toolbarOpenAt, toolbarCloseAt);

// 1. Failure-state gating: only shown when phase === 'error' AND canDeleteReport AND job?.jobId
assert.match(toolbar, /phase === 'error' && canDeleteReport && job\?\.jobId/);

// 2. Placement: inside the top toolbar, adjacent to the 报告列表 button
assert.match(toolbar, /报告列表<\/button>/);
const listAt = toolbar.indexOf('报告列表</button>');
const trashAt = toolbar.indexOf('删除编报');
assert.ok(listAt !== -1 && trashAt !== -1 && trashAt > listAt, '删除编报 button should follow 报告列表 in the top workspace-actions toolbar');

// 3. Reuses the existing delete-report flow: emits 'delete-report' with the job payload
assert.match(toolbar, /@click="emit\('delete-report', job\)"/);

// 4. Trash2 icon + button text
assert.match(toolbar, /<Trash2 :size="15" aria-hidden="true" \/> 删除编报/);

// 5. Supporting declarations: canDeleteReport prop and delete-report emit are defined
assert.match(dataCanvasSource, /canDeleteReport:\s*Boolean/);
assert.match(dataCanvasSource, /'delete-report',/);

console.log('failed-report-delete-action tests passed');
