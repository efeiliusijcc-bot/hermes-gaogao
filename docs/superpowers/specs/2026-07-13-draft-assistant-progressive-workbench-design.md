# Draft Assistant Progressive Workbench Design

## Objective

Refactor the Draft Assistant presentation layer into a continuous five-step workbench while preserving all existing business behavior. The change keeps the current blue internal-admin visual language and improves information hierarchy, editing width, and step-specific actions.

## Non-Goals And Contracts

The refactor must not change:

- the five-step business flow;
- backend endpoints or payload fields;
- `useReportJobs.js`;
- outline and version data structures;
- permission checks and owner isolation;
- report import behavior;
- existing save and automatic-save semantics.

Round one changes layout, component boundaries, visibility, and presentation only. Round two may improve automatic-save interaction, undo, keyboard shortcuts, responsive details, and broader tests without changing the contracts above.

## Layout Model

The page remains a three-column workbench beneath the unchanged system header and sticky step navigation.

### Step 1-2

- Left: expanded 260px event source and history panel.
- Center: dominant current-step workspace.
- Right: 260-280px contextual assistance for the current step only.

### Step 3-5

- Left: automatically collapsed 64px history rail, unless the user has an explicit preference.
- Center: receives the released width and remains the primary reading and editing surface.
- Right: contextual version, AI revision, or import panel.

Below 1360px the right panel becomes a drawer. Below 1100px both auxiliary panels may become drawers while the center remains a single-column work surface. The first round preserves the existing responsive mechanism and fixes only issues needed to prevent overflow or inaccessible controls. Full responsive refinement belongs to round two.

## Left Sidebar State Rules

The sidebar uses the existing `auto | expanded | collapsed` preference stored under `draftAssistant.historySidebarPreference`.

- `auto`: Step 1-2 use the expanded event-source panel; Step 3-5 use the 64px history rail.
- `expanded`: the user's explicit preference wins across event refreshes, version refreshes, and saves. At widths below 1100px, expanded means an off-canvas drawer with a persistent 36px open control rather than a permanently visible column.
- `collapsed`: the 64px history rail remains visible at every step where history navigation is available.
- Switching to an event without an outline returns `auto` mode to the expanded Step 1-2 panel.
- Switching to an event with an outline collapses in `auto` mode.
- An automatic collapse never writes a manual preference and never overrides an explicit `expanded` preference.
- Collapse and expansion preserve the center workspace scroll position and move focus only when the focused control would otherwise become hidden.

Round one reuses `useCollapsibleHistorySidebar.js` and does not create a second sidebar-state implementation.

## Round One Responsive Baseline

Round one must meet these minimum guarantees before broader responsive polish:

- At 1600px and above, all three columns are visible and the center track is at least 720px.
- From 1360px through 1599px, the left panel may narrow to 230-260px, the right panel may narrow to 250px, and the center remains at least 720px.
- From 1100px through 1359px, the right panel is an off-canvas drawer with an always-available open control; the center and current left state occupy the grid.
- Below 1100px, an expanded left panel and the right panel are drawers; a collapsed left rail remains 64px; drawer backdrops and close actions remain keyboard accessible.
- At 1024px, 1280px, and 1440px, the document and workbench must not create horizontal page overflow.
- The step navigation, Step 4 toolbar, sidebar controls, and primary action remain reachable without relying on hover.

Round two may refine breakpoint spacing, mobile density, and transitions but may not defer these baseline guarantees.

## Step Navigation

The existing five steps remain. The navigation gains explicit semantic states:

- current: system blue and `aria-current="step"`;
- completed: green check and completion label;
- needs attention: orange label;
- failed: red label;
- not started: neutral gray.

The navigation remains sticky inside the Draft Assistant content area and does not obscure the main content.

## Round One Scope

### Step 1: Event Input

Replace the large empty center state with a live event preview and a compact explanation of what analysis will produce. Keep the existing input fields and submit method.

The left panel adds presentation-only derived information:

- title and material character counts;
- valid-link count and friendly invalid-link notice;
- completion percentage;
- filled and missing field summaries.

The center contains the primary `开始事件分析` action. A title remains the only blocking condition. Sparse material produces an orange advisory rather than blocking progress.

### Step 2: Analysis

Keep the current structured analysis and normalized risk cards. Reorganize the content into a readable main analysis surface with a clear `确认分析结果并生成提纲` action. The right panel shows only analysis-stage actions and guidance.

Editing the generated analysis is not introduced in round one because no existing save contract supports it. The UI may expose existing re-analysis and material-update paths only.

### Step 3: Outline

Use the wide center surface for the complete outline. Writing focus, source requirements, and verification items use one accessible tab set with item counts; only one full-width list is visible at a time.

Outline rows present:

- a drag-handle affordance;
- full wrapping text;
- a compact overflow menu for edit, duplicate, move, and delete actions.

Round one keeps the existing move handlers as the functional sorting mechanism. Pointer drag-and-drop, inline editing shortcuts, and undo are round-two work.

### Step 4: Confirmation

Reuse and refine `DraftEditorToolbar.vue` as a lightweight 64-72px sticky toolbar. It displays the current version and existing save state, while keeping the current cancel, preview, save-new-version, and confirm handlers.

The left history rail stays collapsed by default. The center prioritizes long-form editing and full text wrapping. The right panel shows versions and AI revision controls relevant to confirmation only.

### Step 5: Import

Show the confirmed version and derived counts for writing focus, source requirements, and verification items. Keep the existing import handler and permission checks. The right panel explains the import and contains the current primary import action.

### Step 5 Material Coverage

Round one does not add a source endpoint or infer collection results that the current Draft Assistant response does not provide. Coverage uses only existing values:

- event material present or absent;
- valid event-link count;
- writing-focus count;
- source-requirement count;
- verification-item count;
- imported plan present or absent;
- an existing source array/count when the current response explicitly provides one.

The coverage label is rule based:

- `待补充`: no material and no valid links;
- `基础资料`: material or at least one valid link exists;
- `资料较完整`: material exists and at least two valid links exist;
- `已形成导入计划`: an imported plan exists.

If the backend does not return a collected-source list, `已采集资料数量` displays `未提供` rather than `0`, and the UI does not claim a percentage coverage score.

## Dynamic Right Panel

The right panel is composed from current-step sections instead of rendering every control in every stage:

- Step 1: input guidance, completion, recent draft context;
- Step 2: re-analysis/material guidance and outline generation;
- Step 3: AI revision, version history, preview/edit entry;
- Step 4: AI revision, version history, confirmation next step;
- Step 5: import explanation, coverage summary, import action.

Unavailable future actions are hidden. When an action is relevant but not yet enabled, the panel explains its enabling condition instead of displaying a stack of disabled buttons.

## Component Boundaries

Round one extracts presentation components without moving network or workflow state out of `DraftAssistant.vue`:

- `DraftStepNavigation.vue`: step status and accessibility;
- `EventSourcePanel.vue`: existing event form plus derived completion display;
- `EventPreviewPanel.vue`: Step 1 live preview and primary action;
- `DraftContextPanel.vue`: step-aware right-panel composition;
- existing `DraftHistorySidebar.vue`: collapsed/expanded history behavior;
- existing `StrategyTabs.vue`: full-width strategy tabs;
- existing `DraftEditorToolbar.vue`: Step 4 sticky controls.

`DraftAssistant.vue` remains the workflow coordinator and owns existing API calls, selected event/version state, mode transitions, and emitted events.

## Data Flow

All derived presentation state is computed from existing reactive state:

- completion and preview derive from `form`;
- step state derives from the existing `currentStepKey` and lifecycle flags;
- right-panel visibility derives from `currentStepKey`, `hasOutline`, confirmation state, and existing permissions;
- strategy counts derive from the normalized outline already used for display;
- save state derives from the existing editor save-state computation.

Child components receive data through props and emit intent events. They do not call APIs directly.

## Save Semantics

Round one preserves the current Draft Assistant behavior exactly:

- entering edit mode copies the selected outline into local reactive edit state;
- changes set the existing `dirty` presentation state by comparing against `editSnapshot`;
- no background API request is introduced;
- `预览提纲` validates and previews local changes without saving;
- `保存为新版本` calls the existing `manualUpdateDraftOutline` handler and creates the next outline version;
- `确认当前版本` confirms the currently selected saved version and does not silently save dirty edits;
- cancel, event switching, version switching, page unload, and leaving the workflow keep their existing unsaved-change guards;
- `saving`, `saved`, `dirty`, and `failed` labels describe the existing explicit save request only.

Round two may improve automatic-save behavior only after a separate contract decision. It must not reinterpret `manualUpdateDraftOutline` as an automatic save because that endpoint creates versions.

## Per-Step Status Model

`DraftStepNavigation.vue` receives presentation statuses derived from existing workflow state. It does not own workflow transitions.

- `input`: `current` before analysis, otherwise `completed`.
- `analysis`: `processing` while `isAnalyzing`; `current` when analysis exists without an outline; `completed` once an outline exists; `not_started` before analysis.
- `outline`: `processing` while outline generation/refinement runs; `failed` when the existing draft lifecycle is `failed`; `current` when an outline exists but confirmation has not started; `completed` during confirmation or import; `not_started` before an outline exists.
- `confirm`: `needs_attention` when editing has unsaved changes; `current` in edit/confirmation mode; `completed` once an imported plan exists; `not_started` before confirmation.
- `import`: `processing` while import or report-job creation runs; `current` when a confirmed version is import-ready or an imported plan exists; `completed` after a report job is created; `not_started` otherwise.

Every non-neutral status has text in addition to color. The current step uses `aria-current="step"`. A failure is shown only when an existing operation-specific state identifies the failed step; a generic page error is not guessed into a step failure.

## Error Handling

Existing caught errors remain authoritative. Presentation components receive user-safe messages and never render raw exception payloads. The refactor must not expose stack traces, Axios details, SQL messages, token content, or server paths.

## Visual System

Reuse existing colors, typography, radii, inputs, buttons, borders, and shadows. The page uses blue for primary/current state, green for completion, orange for verification/advisory states, and red only for destructive/error states. No purple, gradients, dark-tech theme, neon, glassmorphism, oversized hero treatment, or card nesting is introduced.

## Verification Gates

Round one is complete only when:

- Step 1 has a useful live preview and clear primary action;
- Step 1-2 keep the left panel expanded and Step 3-5 use the 64px rail by default;
- strategy content is tabbed and full width;
- the right panel changes by step and does not retain irrelevant disabled controls;
- Step 4 uses the sticky lightweight toolbar;
- long outline text wraps without clipping;
- existing event, analysis, outline, revision, manual save, confirmation, import, history, and permission paths still use their original handlers;
- related frontend tests and the production build pass;
- browser checks at 1440px and responsive breakpoints show no horizontal overflow.

Round two adds debounced automatic-save behavior only if it can preserve the existing version contract, then adds undo, keyboard editing shortcuts, refined drag-and-drop, responsive polish, and complete interaction coverage.

## Round One Test Checklist

Pure presentation helpers:

- title-only input enables analysis and reports missing optional fields;
- completion percentage is deterministic for all five event fields;
- valid and invalid URL lines are separated without exposing parser errors;
- step statuses cover input, analysis, outline generation failure, dirty confirmation, import-ready, importing, and report-job-created states;
- contextual right-panel sections differ for all five steps;
- material coverage returns `待补充`, `基础资料`, `资料较完整`, and `已形成导入计划` from existing data only;
- absent collected-source data renders `未提供`.

Component behavior:

- Step 1 renders the live preview and primary analysis action;
- Step 1-2 use the expanded source/history panel in automatic mode;
- Step 3-5 use the 64px rail in automatic mode;
- explicit expanded/collapsed preferences remain authoritative;
- the strategy tab set exposes counts, one active panel, keyboard semantics, and no three-column strategy grid;
- the right panel hides irrelevant future actions at every step;
- Step 4 toolbar remains sticky, 64-72px high, and uses the existing handlers;
- outline text wraps and the first-round overflow menu uses existing edit, duplicate, move, and delete handlers without pointer drag implementation;
- unsaved-change guards and explicit save-new-version behavior remain wired to existing functions.

Regression and build checks:

- existing history-sidebar, risk-summary, permission-module, and draft-confirmation tests pass;
- new Round One frontend tests pass after each TDD cycle;
- the frontend production build passes;
- browser checks at 1440px, 1280px, and 1024px confirm no horizontal overflow, accessible panel controls, and preserved center scroll position.
