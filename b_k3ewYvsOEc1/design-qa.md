# Task Progress Design QA

## Comparison Target

- Source visual truth: `/var/folders/fp/sq4f_14d1c1b1flqycsf3xtr0000gn/T/codex-clipboard-0106c6a0-b2a1-45f0-bf5e-dfffdd60d00a.png`
- Source pixels: 1672 x 941 at 1x density.
- Primary implementation capture: `/tmp/hermes-progress-final-desktop-v2.png`
- Implementation pixels and CSS viewport: 1672 x 941 at device scale factor 1.
- Combined full-view comparison: `/tmp/hermes-progress-comparison.png`
- Focused expanded-log capture: `/tmp/hermes-progress-final-logs.png`
- Mobile capture: `/tmp/hermes-progress-final-mobile.png`, 390 x 844 CSS px at device scale factor 1.
- State: completed report `17c21860`, task progress selected; focused capture has technical details and report-writing logs expanded.
- Density follow-up source: production browser annotation at `https://hermes-gaogao.vercel.app/`, viewport 1040 x 994, selected region x=259, y=290, width=780, height=180.
- Density follow-up implementation capture: `/tmp/hermes-progress-density-after-v2.png`, actual Vue progress and timeline components at 1040 x 994 and device scale factor 1.
- Density follow-up mobile capture: `/tmp/hermes-progress-density-mobile.png`, 390 x 844 and device scale factor 1.

## Findings

- No actionable P0, P1, or P2 differences remain in the requested progress presentation.
- Typography: the existing Inter and Fira Code stack is retained. Stage numbers, titles, statuses, and table values follow the reference hierarchy; all seven stage titles render without truncation at the target desktop viewport.
- Spacing and layout: seven numbered cards form one horizontal chain with aligned arrows. The compact table uses strict column tracks and separators. At 390 px, the chain scrolls inside its own container and the page itself does not overflow.
- Colors and tokens: the implementation uses restrained blue for structure/current state, green for completion, red for error, and neutral gray for waiting state, matching the source direction and the product's existing blue-white palette.
- Images and icons: the reference contains no content imagery. Existing Lucide UI icons are used; no placeholder, custom SVG, CSS drawing, or decorative asset was introduced.
- Copy and content: the seven report stages and their status labels match the real pipeline. Existing report metadata and technical event wording remain unchanged.
- Intentional product constraint: the technical-log container remains collapsible and keeps its internal vertical scrolling because the requested scope explicitly preserves the original log presentation. It now starts expanded on completed reports.

## Interaction And Runtime Checks

- Opened a real historical report and switched to `任务进度`.
- Opened and closed `查看技术详情`.
- Expanded `报告撰写`; 3 existing event cards and 3 `原始记录` entries remained available.
- Verified the mobile stage chain scrolls from 0 to 726 px while document width stays 390 px.
- Verified mobile table headers and desktop-only time columns collapse at the responsive breakpoint.
- Enabled browser runtime/log collection and repeated the primary flow; 0 error-like events were captured.
- Running tasks use the same `ReportProgressStageFlow` component as completed reports. A new production task was not triggered for QA.
- Density follow-up at 1040 px: progress flow height is 130 px, each card is 132 x 84 px, technical details start expanded at 402 px high, and no stage title is truncated.
- Density follow-up at 390 px: cards remain 150 x 84 px, the flow scrolls internally from 0 to 810 px, and the document itself has no horizontal overflow.

## Comparison History

1. Initial implementation capture: `/tmp/hermes-progress-final-desktop.png`.
   - P2: `资料深度采集` was truncated by approximately 7 px in the narrower existing report canvas.
   - Fix: reduced card horizontal padding from 12 px to 10 px, number width from 25 px to 23 px, title gap from 5 px to 4 px, and realigned the status inset.
2. Post-fix capture: `/tmp/hermes-progress-final-desktop-v2.png`.
   - All stage titles fit, the stage container has no overflow at 1672 x 941, and no further P0/P1/P2 findings remain.
3. Density follow-up first capture: `/tmp/hermes-progress-density-after.png`.
   - P2: the enlarged 130 px minimum card width left `资料深度采集` approximately 2 px short.
   - Fix: raised the minimum desktop card width to 132 px without changing the page width or responsive behavior.
4. Density follow-up post-fix capture: `/tmp/hermes-progress-density-after-v2.png`.
   - All titles fit, the details are expanded by default, and no further P0/P1/P2 findings remain.

## Follow-up Polish

- P3: none required for the requested scope.

## Implementation Checklist

- [x] Shared horizontal stage component for live and completed reports.
- [x] Reference-style stage summary table.
- [x] Original technical event cards, raw records, and new-log affordance retained.
- [x] Completed-report technical details expanded by default and progress scale increased.
- [x] Desktop, expanded-log, mobile, runtime-error, test, and build verification completed.

## Liquid Orb Follow-up

- Scope: replaced the live report loading ring with the adapted WebGPU liquid orb while preserving task copy, actions, progress stages, and technical logs.
- Desktop (1440 x 1000): WebGPU reached `ready`; the loader measured 188 x 188 CSS pixels and rendered at 282 x 282 device pixels with DPR capped at 1.5.
- Motion: isolated orb screenshots taken 600 ms apart produced different hashes, confirming that the effect animates.
- Mobile (390 x 844): the loader measured 132 x 132 CSS pixels, technical details remained open, and horizontal overflow was 0.
- Reduced motion: the renderer produced one static frame; isolated screenshots taken 800 ms apart produced identical hashes.
- No WebGPU: the canvas remained hidden, the Lucide fallback was visible, and the existing stage flow and technical details remained available.
- Visual direction: the opal form is retained with a restrained blue, cyan, and green palette suited to the existing Hermes interface.
- Planning stage: the same orb now replaces the legacy ring while the plan is generated; it rendered at 188 px on desktop and 132 px on mobile with no page or modal overflow.

final result: passed

---

# Design QA: OpenClaw report layout reference

## Comparison target

- Reference: `/Users/a15070743048/Desktop/hermes/artifacts/ui-reference/openclaw-report-reference-1280x995.png`
- Implementation: `/Users/a15070743048/Desktop/hermes/artifacts/ui-reference/hermes-local-after-1280x995-final.png`
- Combined comparison: `/Users/a15070743048/Desktop/hermes/artifacts/ui-reference/openclaw-vs-hermes-1280x995.png`
- Responsive implementation: `/Users/a15070743048/Desktop/hermes/artifacts/ui-reference/hermes-local-after-1024x800.png`
- State: authenticated, latest completed report, report body tab selected
- Viewport: 1280 x 995 CSS px at device scale factor 1; additional check at 1024 x 800

## Findings and iterations

### Resolved P1: report history escaped the sidebar

- Evidence: the first local capture measured a 604.66 px history row inside a 207 px panel.
- Cause: grid min-content sizing followed the long report title.
- Fix: use a constrained vertical flex stack and set both the stack and history rows to `min-width: 0`; rows now measure 181 px inside the 207 px panel.

### Resolved P2: report metadata wrapped the title label

- Evidence: the first implementation capture rendered the `报告标题` label on two lines and made the information bar 66 px high.
- Fix: keep metadata labels on one line, constrain the title item to 280 px, and ellipsize only the title value. The information bar now measures 46 px at 1280 px.

## Fidelity review

- Fonts and typography: both use Inter with Chinese system-font fallbacks. Tabs are 14 px/600, actions 13 px/600, and metadata 13 px. Long history and report titles truncate without changing the surrounding layout.
- Spacing and layout rhythm: sidebar, inner cards, history-row width, 47 px tab strip, 42 px actions, and 46 px metadata bar match the reference proportions. The Hermes-only account footer reduces the visible history height by design.
- Colors and visual tokens: white cards, `#f5f7fb` canvas, light blue selected states, subdued borders, and `#2563eb` primary action follow the reference.
- Image and icon fidelity: there are no raster assets in the target region. Existing Lucide application icons are retained instead of copying the reference's text glyph icons.
- Copy and content: Hermes keeps its real six report tabs, artifact state, delete action, user footer, report content, and actual runtime data. The removed top report identity row is replaced by the reference-style metadata title field.

## Intentional product differences

- Hermes keeps `引用依据` and `成稿自检`, so the tab strip has six segments instead of four.
- Hermes keeps `删除编报` and the bottom-left account entry because they are current product functions.
- The duplicate top `报告列表` action remains omitted because the sidebar already provides `查看全部报告`.
- The 1024 px layout allows metadata to wrap naturally while preserving 13 px text and avoiding horizontal overflow.

## Interaction and responsive checks

- Report, source, and progress tabs switched successfully in the local authenticated app.
- No document, sidebar, or history-panel horizontal overflow at 1280 x 995.
- No document horizontal overflow at 1024 x 800; all six tabs, four actions, metadata, and account footer remain reachable.
- Export and delete actions were not invoked to avoid downloads or destructive changes; their existing event bindings were preserved and covered by source tests.

No remaining P0, P1, or P2 visual mismatch was found in the requested regions. Remaining differences are intentional product constraints listed above.

final result: passed
