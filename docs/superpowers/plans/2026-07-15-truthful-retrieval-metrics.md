# Truthful Retrieval Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace misleading report retrieval counters with the real counts emitted by each retrieval stage.

**Architecture:** Put the metric normalization in a small frontend utility so its fallback behavior can be tested independently. `DataCanvas.vue` will render only stage-specific values: vector candidates, fused candidates, accepted candidates, and deduplicated visible sources.

**Tech Stack:** Vue 3, JavaScript, Node.js test runner, Vite.

## Global Constraints

- Do not change backend retrieval behavior or report workflows.
- Never derive a displayed metric by adding overlapping candidate stages.
- Missing stage diagnostics render as unavailable rather than an inferred count.
- Do not operate on `gaogao-api`.

---

### Task 1: Normalize truthful retrieval metrics

**Files:**
- Create: `b_k3ewYvsOEc1/src/lib/sourceStats.js`
- Create: `tests/frontend-truthful-retrieval-metrics.test.js`

**Interfaces:**
- Consumes: the existing `databaseSources` response and the normalized visible-source count.
- Produces: `getTruthfulSourceStats(data, visibleSources)` returning `initialCandidates`, `fusedCandidates`, `selectedSources`, and `visibleSources`.

- [ ] Write a failing test asserting `100`, `50`, `12`, and `11` for the production diagnostic shape, and asserting that no overlapping totals are added.
- [ ] Run `node --test tests/frontend-truthful-retrieval-metrics.test.js` and confirm it fails because the utility is absent.
- [ ] Implement the minimal normalization utility with explicit diagnostic-field fallbacks only.
- [ ] Run the focused test and confirm it passes.

### Task 2: Render the real stage names and counts

**Files:**
- Modify: `b_k3ewYvsOEc1/src/components/DataCanvas.vue:2747`
- Modify: `b_k3ewYvsOEc1/src/components/DataCanvas.vue:5060`
- Test: `tests/frontend-truthful-retrieval-metrics.test.js`

**Interfaces:**
- Consumes: `getTruthfulSourceStats` from Task 1.
- Produces: four visible cards labeled `初筛候选`, `融合候选`, `最终入选`, and `实际展示`.

- [ ] Extend the failing test to require the four truthful labels and reject `候选命中` and `高相关候选`.
- [ ] Run the focused test and confirm the label assertions fail.
- [ ] Import the utility, replace the computed mapping, and update the four card labels/bindings.
- [ ] Run the focused test and confirm it passes.
- [ ] Run `npx pnpm@9.15.9 --dir b_k3ewYvsOEc1 build` and confirm the frontend build exits successfully.
