# 拟稿助手五步导航静态布局实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让拟稿助手顶部五步导航处于页面正常布局流中，随内容滚动而不悬浮遮挡分析内容。

**Architecture:** 保持 `DraftStepNavigation.vue` 的组件、状态和交互不变，只移除导航根元素的粘性定位属性。用现有前端源码测试锁定定位契约，再执行拟稿助手回归测试和 Vite 构建。

**Tech Stack:** Vue 3、Vue SFC scoped CSS、Node.js test runner、Vite。

## Global Constraints

- 只修改五步导航定位样式与对应测试。
- 保留五个步骤的顺序、状态、颜色、文案、无障碍属性和移动端横向滚动。
- 不修改拟稿助手数据、接口、步骤推进、侧栏或其他页面。
- 不增加依赖，不改后端接口或数据库。

### Task 1: Lock Static Navigation Position

**Files:**
- Modify: `tests/frontend-draft-workbench.test.ts`
- Modify: `b_k3ewYvsOEc1/src/components/DraftStepNavigation.vue:24-31`

**Interfaces:**
- Consumes: the existing `navigationSource` fixture read from `DraftStepNavigation.vue`.
- Produces: a source-level regression assertion that rejects `position: sticky` and `position: fixed` on the step navigation root.

- [ ] **Step 1: Add the failing regression assertions**

Append to the existing `navigationSource` assertions:

```ts
assert.doesNotMatch(navigationSource, /\.draft-step-navigation\s*\{[^}]*position:\s*(?:sticky|fixed)/s)
assert.doesNotMatch(navigationSource, /\.draft-step-navigation\s*\{[^}]*\btop:\s*0/s)
```

- [ ] **Step 2: Run the focused test and verify it fails for the current sticky rule**

Run:

```bash
node --import tsx --test tests/frontend-draft-workbench.test.ts
```

Expected: FAIL because `.draft-step-navigation` currently contains `position: sticky` and `top: 0`.

- [ ] **Step 3: Remove only the floating-position declarations**

In `.draft-step-navigation` remove `position: sticky`, `top: 0`, and `z-index: 18`. Keep `margin-bottom`, border, background, radius, and shadow unchanged so the existing visual hierarchy remains intact.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
node --import tsx --test tests/frontend-draft-workbench.test.ts
```

Expected: PASS with `frontend draft workbench tests passed`.

- [ ] **Step 5: Run the frontend production build**

Run:

```bash
npm run build --prefix b_k3ewYvsOEc1
```

Expected: Vite exits with code 0 and emits `b_k3ewYvsOEc1/dist/`.

- [ ] **Step 6: Review the diff and commit the implementation**

Run:

```bash
git diff --check
git diff -- b_k3ewYvsOEc1/src/components/DraftStepNavigation.vue tests/frontend-draft-workbench.test.ts
git add b_k3ewYvsOEc1/src/components/DraftStepNavigation.vue tests/frontend-draft-workbench.test.ts
git commit -m "fix: keep draft steps in normal flow"
```

Expected: no whitespace errors and one focused implementation commit.
