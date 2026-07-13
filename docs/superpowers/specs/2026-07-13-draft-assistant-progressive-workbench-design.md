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

