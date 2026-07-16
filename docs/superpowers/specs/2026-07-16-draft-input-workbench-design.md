# 拟稿助手事件源输入三栏工作台设计

## 目标

仅重构拟稿助手 `currentStepKey === 'input'` 的前端布局，使事件源输入、事件输入预览和操作辅助区在桌面端形成视口内三栏工作台，并拥有相互独立的滚动区域。分析、提纲、确认和导入阶段保持现有布局、状态和交互不变。

## 组件边界

### `DraftAssistant.vue`

- 继续持有表单、分析、历史事件和步骤状态。
- 输入阶段为工作区增加 `input-workbench` 状态类，负责三栏尺寸、视口高度和响应式切换。
- 继续使用现有 `runAnalyze`、`openEvent` 和 `startNewEvent`，不改变 API、payload、状态结构或事件流。
- 将右栏输入阶段的 `analyze`、`select-event` 和 `clear-input` 事件接回现有函数。

### `EventSourcePanel.vue`

- 只展示事件标题、补充材料、相关链接、类别、地区和事件信息完整度。
- 所有字段默认展开，保留现有双向更新、字符计数、链接校验和选项列表。
- 移除最近事件区域，以及仅服务于该区域的 props、emit 和时间格式化逻辑。
- 完整度处于左栏表单末尾，跟随左栏内部滚动，不使用 sticky 或 fixed。

### `EventPreviewPanel.vue`

- 保留标题预览、标签、材料摘要、五项执行步骤和缺失信息提示。
- 五项执行步骤使用两列卡片布局，内容较少时自然排列。
- 移除 `analyzing` prop、`analyze` emit 和主分析按钮，确保输入阶段只有一个主操作入口。

### `DraftContextPanel.vue`

- 输入阶段使用上部滚动内容区和底部固定操作区。
- 上部展示当前状态/校验结果、建议、输入完整度、可点击的最近草稿和清空输入。
- 最近草稿只使用现有 `events`，点击继续触发现有 `openEvent`。
- 不提供“保存草稿”按钮；显示弱提示“当前输入将在开始分析后自动保存为草稿。”
- 底部仅在输入阶段显示唯一的“开始事件分析”按钮，复用现有 `summary.canAnalyze` 与 `isAnalyzing` 判断。
- 其他步骤继续渲染原有辅助内容和按钮，不改变行为。

## 布局与滚动

- 应用壳继续使用 `height: 100vh` 和 `overflow: hidden`，顶部 `NexusHeader` 保持在三栏滚动区之外。
- `DraftAssistant` 输入阶段自身设置 `min-height: 0`、`overflow: hidden`，五步导航保持正常文档流。
- 输入工作台使用三栏 Grid：左栏约 320px，中栏 `minmax(0, 1fr)`，右栏约 320px，间距 16px。
- 左栏和中栏分别设置 `min-height: 0`、`min-width: 0`、`overflow-y: auto`。
- 右栏使用纵向 Flex；上部 `flex: 1; min-height: 0; overflow-y: auto`，底部操作区 `flex-shrink: 0`。
- 所有滚动容器使用简洁滚动条，并避免嵌套的第二条纵向滚动条。

## 响应式

- `>= 1280px`：完整三栏，左右栏 300px 至 340px。
- `1024px–1279px`：左右栏缩至约 260px 至 280px，间距缩小。
- `< 1024px`：输入工作台改为内部单列纵向滚动容器；三个面板不再各自限制高度，右栏放到中栏下方，底部分析操作区使用 `position: sticky; bottom: 0`，仍不启用 body 整页滚动。
- 不新增抽屉或重复页面。

## 数据与接口

- 不修改后端接口、数据库、请求封装或事件输入 payload。
- 不新增保存草稿接口，不使用 `localStorage`，不伪造保存状态。
- 开始分析后的现有持久化逻辑保持不变。

## 验证

- 源码测试覆盖输入阶段专用布局类、三个滚动区、右栏固定操作区、唯一分析按钮和最近草稿事件连接。
- 验证 `EventSourcePanel` 不再包含历史事件 props、emit 或空白占位。
- 运行现有拟稿助手、权限、顶部导航和文本输入回归测试。
- 运行前端 lint、服务端 TypeScript typecheck 和前端 Vite build。
- 浏览器检查 1024、1280、1440 和 1920 宽度，验证无 body 主滚动、双滚动、横向溢出或底部遮挡。
