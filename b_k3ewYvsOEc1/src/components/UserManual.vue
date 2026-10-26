<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  AlertTriangle,
  BookOpenText,
  CheckCircle2,
  Database,
  Download,
  FileText,
  History,
  MessageSquareText,
  Newspaper,
  PenLine,
  Search,
  X,
} from '@lucide/vue'
import { MANUAL_SECTIONS, normalizeManualSection } from '../lib/userManualNavigation.js'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  initialSection: {
    type: String,
    default: 'report',
  },
})

const emit = defineEmits(['close'])

const scrollAreaRef = ref(null)
const sidebarRef = ref(null)
const closeButtonRef = ref(null)
const activeSection = ref('report')
const sectionRefs = new Map()
let previousBodyOverflow = ''
let previousActiveElement = null

const chapterIcons = {
  report: FileText,
  qa: MessageSquareText,
  daily: Newspaper,
  draft: PenLine,
}

function setSectionRef(id, element) {
  if (element) sectionRefs.set(id, element)
  else sectionRefs.delete(id)
}

function scrollToSection(id, behavior = 'smooth') {
  const normalizedId = normalizeManualSection(id)
  const area = scrollAreaRef.value
  const section = sectionRefs.get(normalizedId)
  if (!area || !section) return
  activeSection.value = normalizedId
  const navButton = sidebarRef.value?.querySelector(`[data-manual-target="${normalizedId}"]`)
  if (navButton) {
    sidebarRef.value.scrollLeft = Math.max(0, navButton.offsetLeft - (sidebarRef.value.clientWidth - navButton.offsetWidth) / 2)
  }
  const targetTop = area.scrollTop + section.getBoundingClientRect().top - area.getBoundingClientRect().top
  const nextTop = Math.max(0, targetTop - 22)
  if (behavior === 'auto') {
    area.style.scrollBehavior = 'auto'
    area.scrollTop = nextTop
    window.requestAnimationFrame(() => { area.style.scrollBehavior = '' })
    return
  }
  area.scrollTo({ top: nextTop, behavior })
}

function handleScroll() {
  const area = scrollAreaRef.value
  if (!area) return
  const marker = area.getBoundingClientRect().top + 120
  let current = MANUAL_SECTIONS[0].id
  for (const chapter of MANUAL_SECTIONS) {
    const section = sectionRefs.get(chapter.id)
    if (section && section.getBoundingClientRect().top <= marker) current = chapter.id
  }
  activeSection.value = current
}

function closeManual() {
  emit('close')
}

function handleKeydown(event) {
  if (props.open && event.key === 'Escape') closeManual()
}

watch(
  () => [props.open, props.initialSection],
  async ([open]) => {
    if (!open) {
      document.body.style.overflow = previousBodyOverflow
      if (previousActiveElement instanceof HTMLElement) previousActiveElement.focus()
      return
    }

    previousActiveElement = document.activeElement
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    await nextTick()
    scrollToSection(props.initialSection, 'auto')
    closeButtonRef.value?.focus()
  },
  { immediate: true },
)

onMounted(() => document.addEventListener('keydown', handleKeydown))

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.body.style.overflow = previousBodyOverflow
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="manual-backdrop" @click.self="closeManual">
      <section class="manual-dialog" role="dialog" aria-modal="true" aria-labelledby="user-manual-title">
        <header class="manual-header">
          <div class="manual-title-group">
            <span class="manual-title-icon" aria-hidden="true"><BookOpenText :size="20" /></span>
            <div>
              <h1 id="user-manual-title">AI深度编报系统使用手册</h1>
              <p><time datetime="2026-10-26">2026-10-26 更新</time> · 按当前操作流程核对，已定位到对应章节</p>
            </div>
          </div>
          <button ref="closeButtonRef" class="manual-close" type="button" aria-label="关闭使用手册" title="关闭" @click="closeManual">
            <X :size="19" aria-hidden="true" />
          </button>
        </header>

        <div class="manual-layout">
          <aside ref="sidebarRef" class="manual-sidebar" aria-label="手册章节">
            <p class="manual-sidebar-label">目录</p>
            <nav>
              <button
                v-for="(chapter, index) in MANUAL_SECTIONS"
                :key="chapter.id"
                type="button"
                :class="{ active: activeSection === chapter.id }"
                :data-manual-target="chapter.id"
                :aria-current="activeSection === chapter.id ? 'location' : undefined"
                @click="scrollToSection(chapter.id, 'auto')"
              >
                <span class="manual-nav-index">0{{ index + 1 }}</span>
                <component :is="chapterIcons[chapter.id]" :size="17" aria-hidden="true" />
                <span>{{ chapter.title }}</span>
              </button>
            </nav>
            <div class="manual-sidebar-note">
              <CheckCircle2 :size="16" aria-hidden="true" />
              <span>规划草稿与后台任务的保存方式不同，请查看对应章节的恢复说明。</span>
            </div>
          </aside>

          <main ref="scrollAreaRef" class="manual-content" @scroll.passive="handleScroll">
            <section id="manual-report" :ref="(element) => setSectionRef('report', element)" class="manual-chapter" data-manual-section="report">
              <div class="manual-chapter-heading">
                <span class="manual-chapter-number">01</span>
                <div>
                  <p>REPORT WORKSPACE</p>
                  <h2>AI智能体深度编报</h2>
                  <span>从任务创建、规划确认到成稿核验与导出</span>
                </div>
              </div>

              <div class="manual-figure" role="img" aria-label="深度编报页面结构示意图">
                <div class="manual-figure-bar"><strong>深度编报工作区</strong><span>使用手册</span></div>
                <div class="report-figure-grid">
                  <div class="figure-sidebar">
                    <b>历史编报</b>
                    <span class="figure-line wide"></span><span class="figure-line"></span><span class="figure-line wide"></span>
                  </div>
                  <div class="figure-main">
                    <div class="figure-tabs"><b>报告标题</b><span>补充背景</span></div>
                    <div class="figure-field">填写主题和材料，再生成规划</div>
                    <div class="figure-step-row"><span>1 生成规划</span><span>2 逐项确认</span><span>3 提交编写</span></div>
                    <div class="figure-primary">生成编报规划</div>
                  </div>
                </div>
                <p>流程示意，非实际页面截图：生成规划不等于提交报告，需确认后才开始编写。</p>
              </div>

              <div class="manual-block">
                <h3>创建并启动一次编报</h3>
                <ol class="manual-steps">
                  <li><b>填写报告主题。</b><span>主题尽量包含主体、事项、时间范围和关注方向，例如“某机构近期对华合作动向及风险研判”。</span></li>
                  <li><b>补充背景材料。</b><span>可粘贴事件线索、已知事实、网址或内部材料。背景越具体，规划方向越稳定。</span></li>
                  <li><b>点击“生成编报规划”。</b><span>系统生成规划，此时尚未提交编报任务。根据主题，可能先出现意图识别和事件脉络任务，按页面提示确认。</span></li>
                  <li><b>逐项确认规划。</b><span>K报依次核对信源范围、基本情况、涉我风险、对策建议和补充方向。可勾选方向、添加自定义方向及补充信源；不可用的数据库信源不能选择。</span></li>
                  <li><b>点击“确认并开始编写”。</b><span>提交成功后进入数据库检索、资料深度采集、素材整合、报告撰写和成稿自检。生成期间可切换模块，再从编报历史打开任务。</span></li>
                </ol>
              </div>

              <div class="manual-block">
                <h3>规划暂存、切页与恢复</h3>
                <ul class="manual-list">
                  <li><b>稍后继续：</b>收起弹窗并保留当前规划。切换历史报告、QA问答、每日动态感知或拟稿助手，也会暂存并收起，不会自动启动编报。</li>
                  <li><b>继续规划：</b>返回编报首页后，在“未完成规划”中查看主题和更新时间，点击后恢复步骤、勾选项、自定义方向及补充材料；不会自动弹窗。</li>
                  <li><b>放弃规划：</b>确认后才清除草稿。有草稿时发起新编报或导入编报背景，先选择“继续原规划”或“放弃并新建”；关闭提示保持原状态。</li>
                  <li><b>保存范围：</b>每个账号、每个标签页最多保留一份规划，仅在当前标签页会话中保存。刷新可恢复；关闭标签页后不保证保留，不跨设备同步；退出登录或切换账号会清除旧账号的当前会话草稿。</li>
                  <li><b>生成中刷新：</b>会显示“规划生成已中断”，保留原输入，需手动点击“重新生成规划”。已提交的后台编报任务不属于这份规划草稿。</li>
                </ul>
                <div class="manual-warning"><AlertTriangle :size="17" /><span>若出现“当前仅临时保存，刷新可能丢失”，请勿依赖刷新恢复。若出现“提交结果待核实”，先“查看历史”确认是否已创建任务，再决定是否“确认后重试提交”；系统不会自动再次提交。</span></div>
              </div>

              <div class="manual-two-column">
                <div class="manual-block">
                  <h3>结果页怎么查看</h3>
                  <ul class="manual-list">
                    <li><b>报告正文：</b>阅读成稿并导出。当前页面不提供正文在线编辑，需要修改时可导出 Word 后编辑。</li>
                    <li><b>信源概览：</b>核对标题、机构、发布时间、相关性与原文。</li>
                    <li><b>规划选择：</b>回看本次实际采用的研究方向和信源范围。</li>
                    <li><b>引用依据：</b>核对正文引用编号与对应证据。</li>
                    <li><b>任务进度：</b>查看运行概览和执行阶段，阶段详情保留“输入输出”和“日志”，不再提供阶段“概览”或“调用链”页签。</li>
                    <li><b>成稿自检：</b>查看结构、事实、引用等标准的具体核验说明。</li>
                  </ul>
                </div>
                <div class="manual-block manual-callout">
                  <Download :size="19" aria-hidden="true" />
                  <div>
                    <h3>导出前建议</h3>
                    <p>先检查正文中的引用编号，再到“引用依据”和“信源概览”确认原文。Word 可下载后编辑；“导出 PDF”会打开浏览器打印窗口，请选择保存为 PDF。</p>
                  </div>
                </div>
              </div>

              <div class="manual-block">
                <h3>任务状态与失败排查</h3>
                <div class="manual-status-grid">
                  <div><span class="status-dot queued"></span><b>排队中</b><p>任务已提交，等待服务资源；无需重复点击。</p></div>
                  <div><span class="status-dot running"></span><b>生成中</b><p>可在历史记录中重新打开并查看实时进度。</p></div>
                  <div><span class="status-dot success"></span><b>已完成</b><p>可读取成稿、核对信源并导出。</p></div>
                  <div><span class="status-dot failed"></span><b>失败</b><p>查看任务提示和阶段日志；反复失败时向管理员提供任务编号和时间。</p></div>
                </div>
                <p>深度采集的工具调用列表仅展示 Tavily Search 和 Web Fetch 的非失败记录，不代表后台全部调用都成功。请结合任务总状态、阶段日志和成稿完整度判断；没有保存的调用信息可能显示为“--”。</p>
                <div class="manual-warning"><AlertTriangle :size="17" /><span>任务“已完成”不等于所有事实都已核实。对外使用前仍应检查引用、原文和待核实内容。</span></div>
              </div>
            </section>

            <section id="manual-qa" :ref="(element) => setSectionRef('qa', element)" class="manual-chapter" data-manual-section="qa">
              <div class="manual-chapter-heading">
                <span class="manual-chapter-number">02</span>
                <div>
                  <p>QUESTION &amp; ANSWER</p>
                  <h2>QA问答</h2>
                  <span>围绕明确问题连续追问，并核对回答所依据的信源</span>
                </div>
              </div>

              <div class="manual-figure" role="img" aria-label="QA问答页面结构示意图">
                <div class="manual-figure-bar"><strong>QA问答</strong><span>使用手册</span></div>
                <div class="qa-figure-grid">
                  <div class="figure-sidebar"><b>问答历史</b><span class="figure-line wide"></span><span class="figure-line"></span><span class="figure-line wide"></span></div>
                  <div class="qa-thread"><div class="question-bubble">提出包含时间与范围的问题</div><div class="answer-block"><b>回答</b><span></span><span></span><span class="short"></span></div><div class="qa-input">继续追问… <b>发送</b></div></div>
                  <div class="qa-sources"><b>参考来源</b><span>标题 / 摘要</span><span>来源与时间</span><span>打开来源</span></div>
                </div>
                <p>界面示意：历史会话、连续对话和参考信源相互对应。</p>
              </div>

              <div class="manual-block">
                <h3>获得更准确回答的四个要点</h3>
                <ol class="manual-steps compact">
                  <li><b>说明主体。</b><span>写清组织、人物、国家、项目或政策名称，避免只使用“它”“该方”等代词。</span></li>
                  <li><b>限定时间。</b><span>使用“最近30天”“2026年第二季度”等明确范围；“近期”可能覆盖范围过宽。</span></li>
                  <li><b>限定任务。</b><span>说明要查事实、比较差异、梳理时间线，还是研判风险。</span></li>
                  <li><b>限定输出。</b><span>可要求表格、要点、时间线或固定字段，便于直接使用。</span></li>
                </ol>
              </div>

              <div class="manual-two-column">
                <div class="manual-block">
                  <h3>连续追问与历史记录</h3>
                  <p>同一会话内可直接追问“这些事件中哪些与我国相关”。系统会结合前文理解上下文。主题变化较大时，建议新建会话，避免旧上下文干扰。</p>
                  <p>左侧历史记录可重新打开会话；新建问答不会删除已有会话。当前会话列表按账号保存在本浏览器，不应当作跨设备同步的资料档案。</p>
                </div>
                <div class="manual-block">
                  <h3>核对回答依据</h3>
                  <ul class="manual-list">
                    <li>在“参考来源”中搜索、筛选或展开材料，点击“打开来源”核对原文。</li>
                    <li>优先核对官方来源、原始文件和发布时间。</li>
                    <li>来源标题相关不等于内容支持结论，应打开摘要或原文确认。</li>
                    <li>复制回答前保留必要引用，避免事实与依据分离。</li>
                  </ul>
                </div>
              </div>

              <div class="manual-block">
                <h3>把问答带入编报</h3>
                <p>回答完成后，可点击“一键导入当前回答”，或通过“加入背景选择”选择多轮问答，再点击“导入到编报背景”。导入只填充报告标题和补充背景，不会直接生成报告；之后仍需点击“生成编报规划”并确认提交。</p>
                <p>如果已有未完成规划，会先提示“继续原规划”或“放弃并新建”，不会静默覆盖原规划。</p>
              </div>

              <div class="manual-block">
                <h3>常见状态</h3>
                <div class="manual-faq">
                  <details><summary>回答一直处于生成中</summary><p>先等待当前请求结束，不要连续发送相同问题。切换页面后可从历史会话恢复。</p></details>
                  <details><summary>回答为空或没有参考来源</summary><p>缩小问题范围并补充明确实体、日期或材料。没有结构化来源不等于结论已经证实；还需检查材料范围、权限及服务提示。</p></details>
                  <details><summary>回答失败</summary><p>保留当前问题，查看界面错误提示后重试。多次失败时记录发生时间和问题内容，交由管理员核查服务日志。</p></details>
                </div>
              </div>
            </section>

            <section id="manual-daily" :ref="(element) => setSectionRef('daily', element)" class="manual-chapter" data-manual-section="daily">
              <div class="manual-chapter-heading">
                <span class="manual-chapter-number">03</span>
                <div>
                  <p>DAILY AWARENESS</p>
                  <h2>每日动态感知</h2>
                  <span>查看当日简报、筛选重点事件，并沿用到拟稿流程</span>
                </div>
              </div>

              <div class="manual-figure" role="img" aria-label="每日动态感知页面结构示意图">
                <div class="manual-figure-bar"><strong>每日动态感知</strong><span>使用手册</span></div>
                <div class="daily-figure-grid">
                  <div class="figure-sidebar"><b>历史简报</b><span class="figure-line wide"></span><span class="figure-line"></span><span class="figure-line wide"></span></div>
                  <div class="daily-main"><div class="daily-toolbar"><b>当前展示日期</b><span>正文</span><span>卡片</span></div><div class="daily-filter"><span>全部</span><span>危安</span><span>涉华</span><span>涉政</span></div><div class="daily-event"><i></i><div><b>重点事件标题</b><span>事件摘要与影响判断</span></div></div><div class="daily-event"><i></i><div><b>重点事件标题</b><span>事件摘要与影响判断</span></div></div></div>
                </div>
                <p>界面示意：从历史简报切换日期，在正文或卡片视图中查看事件。</p>
              </div>

              <div class="manual-block">
                <h3>查看当日简报</h3>
                <ol class="manual-steps">
                  <li><b>确认业务日期。</b><span>页面展示的是简报对应的业务日期，不一定等同于当前访问时间。</span></li>
                  <li><b>选择阅读视图。</b><span>“正文”适合连续阅读；“卡片”适合快速扫描、分类筛选和展开单条事件。</span></li>
                  <li><b>按类别筛选。</b><span>在卡片视图中使用类别入口缩小范围；类别和数量以当期简报为准，切回“全部”恢复完整清单。</span></li>
                  <li><b>展开事件。</b><span>查看事件概述、重点主体、时间地点、影响判断及来源链接。</span></li>
                  <li><b>核对原始信源。</b><span>对准备引用的事实，打开来源链接确认标题、发布时间和原文语境。</span></li>
                </ol>
              </div>

              <div class="manual-two-column">
                <div class="manual-block">
                  <h3>历史、复制与导出</h3>
                  <p>左侧历史简报按日期排列，点击即可切换。注意“今日业务日期”与“当前展示”可能不同；今日简报尚未就绪或生成未成功时，会提示正在展示最近一期。</p>
                  <p>分类筛选只影响卡片列表；复制和 Word 导出针对当前所选日期的整期简报，不是仅导出筛选出的卡片。操作前先核对“当前展示”的日期。</p>
                </div>
                <div class="manual-block">
                  <h3>转入拟稿助手</h3>
                  <p>有权限时，点击单条事件的“导入拟稿助手”。导入只填入拟稿助手输入框，不会自动分析或生成报告。先检查、补充材料，再由用户点击“开始拟稿”。</p>
                </div>
              </div>

              <div class="manual-block">
                <h3>简报版本与内容完整度</h3>
                <div class="manual-status-grid three">
                  <div><span class="status-dot success"></span><b>标准版</b><p>按标准内容展示，引用前仍需核对原始来源。</p></div>
                  <div><span class="status-dot running"></span><b>部分摘要版</b><p>部分条目摘要不完整，需补查原文。</p></div>
                  <div><span class="status-dot queued"></span><b>简要版</b><p>主要保留标题等简要信息，不宜直接作为完整事实依据。</p></div>
                </div>
              </div>
            </section>

            <section id="manual-draft" :ref="(element) => setSectionRef('draft', element)" class="manual-chapter" data-manual-section="draft">
              <div class="manual-chapter-heading">
                <span class="manual-chapter-number">04</span>
                <div>
                  <p>DRAFT ASSISTANT</p>
                  <h2>拟稿助手</h2>
                  <span>把零散材料整理为事件分析与可编辑提纲</span>
                </div>
              </div>

              <div class="manual-figure" role="img" aria-label="拟稿助手页面结构示意图">
                <div class="manual-figure-bar"><strong>拟稿助手</strong><span>使用手册</span></div>
                <div class="draft-figure-grid">
                  <div class="figure-sidebar"><b>拟稿历史</b><span class="figure-line wide"></span><span class="figure-line"></span><span class="figure-line wide"></span></div>
                  <div class="draft-flow"><div><b>1</b><span>开始拟稿</span></div><em></em><div><b>2</b><span>事件分析</span></div><em></em><div><b>3</b><span>编辑提纲</span></div><em></em><div><b>4</b><span>确认并创建</span></div></div>
                </div>
                <p>流程示意：先手动开始分析，确认提纲后直接创建深度编报任务。</p>
              </div>

              <div class="manual-block">
                <h3>完整拟稿流程</h3>
                <ol class="manual-steps">
                  <li><b>输入并开始拟稿。</b><span>在“编报主体和相关材料”输入框填写主题、事实和链接，最多 12,000 字符。点击“开始拟稿”（窄屏显示向上箭头）才会提交事件分析。</span></li>
                  <li><b>检查事件分析。</b><span>分析完成后核对事件概括、核心主体、时间与地点、关键事实和涉我风险。缺少信息时可“返回重新输入”补充材料；无需在这里确认五维任务。</span></li>
                  <li><b>点击“生成提纲”。</b><span>确认分析内容后生成章节结构，再在“编辑当前提纲”中逐项修改标题和说明；分析未完成或失败时不能生成提纲。</span></li>
                  <li><b>编辑或使用 AI 修改。</b><span>手动修改适合精确调整；AI 修改应给出具体要求，例如“把第二部分改为按时间排序”。</span></li>
                  <li><b>确认并创建深度编报。</b><span>先进入“确认提纲”核对内容，可“返回修改”。点击“确认并创建深度编报”后直接创建深度编报任务，不再进入首页的规划弹窗；创建成功后查看该报告任务的进度。</span></li>
                </ol>
              </div>

              <div class="manual-two-column">
                <div class="manual-block">
                  <h3>自动保存与历史恢复</h3>
                  <p>提纲编辑会自动保存。左侧拟稿历史可恢复已有材料、分析和提纲；窄屏通过“查看拟稿历史”按钮打开历史列表。离开前先确认保存状态；保存失败时点击“重试”，不要直接关闭页面。</p>
                </div>
                <div class="manual-block manual-callout green">
                  <History :size="19" aria-hidden="true" />
                  <div>
                    <h3>避免重复创建</h3>
                    <p>同一账号同时只能有一条进行中的事件分析。已有任务时可继续编辑输入材料，但应先“返回查看”该任务，勿重复提交。</p>
                  </div>
                </div>
              </div>

              <div class="manual-block">
                <h3>后台分析与跨页恢复</h3>
                <p>事件分析任务受理后，切换模块或刷新页面不会取消后台分析；重新登录后可从拟稿历史查看状态。离开拟稿页面时，会显示“拟稿分析中”等提醒，完成后显示“拟稿分析已完成”，点击“返回查看”打开对应记录。</p>
                <p>不要把“连接中断”当作任务已失败：页面会继续确认后台状态。只有明确显示失败后，才使用“重试分析”。后台分析完成不会自动生成提纲或提交深度编报，仍由用户确认下一步。</p>
              </div>

              <div class="manual-block">
                <h3>异常处理</h3>
                <div class="manual-faq">
                  <details><summary>事件分析提示材料不足或待核实</summary><p>这表示当前材料没有提供足够的对应事实。补充人物、机构、日期、地点和可靠来源后重新分析，不要用概括性文字代替事实。</p></details>
                  <details><summary>提纲修改后没有保存</summary><p>先保留当前内容，观察保存提示并稍后重试。不要立即切换历史记录，以免未保存内容丢失。</p></details>
                  <details><summary>创建深度编报失败或结果不明</summary><p>先查看编报历史，确认是否已有同主题任务，避免网络中断后重复创建。明确失败后再检查权限和页面提示；拟稿材料与已保存提纲可从历史恢复。</p></details>
                </div>
              </div>
            </section>

            <footer class="manual-footer">
              <div><Database :size="17" aria-hidden="true" /><span>权限范围会影响可见模块、数据库信源和管理功能。</span></div>
              <div><Search :size="17" aria-hidden="true" /><span>对外使用前，请核对时间、主体、原文与引用依据。</span></div>
            </footer>
          </main>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.manual-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1400;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgb(15 23 42 / 48%);
}

.manual-dialog {
  width: min(1180px, 100%);
  height: min(860px, calc(100vh - 40px));
  overflow: hidden;
  border: 1px solid #dbe3ee;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 22px 64px rgb(15 23 42 / 22%);
  color: #172033;
  font-family: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
}

.manual-header {
  height: 68px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 0 22px;
  border-bottom: 1px solid #e5eaf0;
  background: #fff;
}

.manual-title-group,
.manual-title-group > div,
.manual-callout,
.manual-footer div {
  display: flex;
  align-items: center;
}

.manual-title-group { gap: 12px; min-width: 0; }
.manual-title-group > div { display: block; min-width: 0; }
.manual-title-icon { display: grid; width: 36px; height: 36px; place-items: center; border: 1px solid #bfdbfe; border-radius: 7px; background: #eff6ff; color: #2563eb; }
.manual-title-group h1 { margin: 0; color: #172033; font-size: 17px; line-height: 1.3; }
.manual-title-group p { margin: 3px 0 0; color: #667085; font-size: 12px; }

.manual-close {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #667085;
  cursor: pointer;
}

.manual-close:hover { border-color: #dbe3ee; background: #f8fafc; color: #172033; }
.manual-close:focus-visible,
.manual-sidebar button:focus-visible { outline: 2px solid rgb(37 99 235 / 42%); outline-offset: 2px; }

.manual-layout { height: calc(100% - 68px); display: grid; grid-template-columns: 224px minmax(0, 1fr); }

.manual-sidebar {
  display: flex;
  min-height: 0;
  flex-direction: column;
  padding: 22px 14px 16px;
  border-right: 1px solid #e5eaf0;
  background: #f8fafc;
}

.manual-sidebar-label { margin: 0 10px 10px; color: #98a2b3; font-size: 11px; font-weight: 700; text-transform: uppercase; }
.manual-sidebar nav { display: grid; gap: 4px; }
.manual-sidebar button { display: grid; min-height: 44px; grid-template-columns: 24px 20px minmax(0, 1fr); align-items: center; gap: 7px; width: 100%; padding: 0 10px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: #475467; text-align: left; cursor: pointer; }
.manual-sidebar button:hover { background: #fff; color: #1d4ed8; }
.manual-sidebar button.active { border-color: #dbeafe; background: #eff6ff; color: #1d4ed8; font-weight: 650; }
.manual-nav-index { color: #98a2b3; font: 600 10px/1 "Fira Code", monospace; }
.manual-sidebar button.active .manual-nav-index { color: #60a5fa; }
.manual-sidebar-note { display: flex; align-items: flex-start; gap: 8px; margin-top: auto; padding: 12px 10px; border-top: 1px solid #e5eaf0; color: #667085; font-size: 11px; line-height: 1.6; }
.manual-sidebar-note svg { flex: 0 0 auto; margin-top: 1px; color: #16a34a; }

.manual-content { min-width: 0; overflow-y: auto; scroll-behavior: smooth; overscroll-behavior: contain; background: #fff; }
.manual-content::-webkit-scrollbar { width: 8px; }
.manual-content::-webkit-scrollbar-track { background: #f8fafc; }
.manual-content::-webkit-scrollbar-thumb { border: 2px solid #f8fafc; border-radius: 8px; background: #cbd5e1; }
.manual-content::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

.manual-chapter { padding: 42px clamp(28px, 4vw, 56px) 54px; scroll-margin-top: 22px; }
.manual-chapter + .manual-chapter { border-top: 8px solid #f3f6f9; }
.manual-chapter-heading { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 28px; }
.manual-chapter-number { padding-top: 3px; color: #3b82f6; font: 700 12px/1.3 "Fira Code", monospace; }
.manual-chapter-heading p { margin: 0 0 4px; color: #2563eb; font-size: 10px; font-weight: 750; letter-spacing: 0.08em; }
.manual-chapter-heading h2 { margin: 0; color: #172033; font-size: 26px; line-height: 1.25; }
.manual-chapter-heading div > span { display: block; margin-top: 7px; color: #667085; font-size: 13px; }

.manual-figure { overflow: hidden; margin: 0 0 30px; border: 1px solid #dfe5ec; border-radius: 7px; background: #f8fafc; }
.manual-figure-bar { height: 38px; display: flex; align-items: center; gap: 9px; padding: 0 13px; border-bottom: 1px solid #dfe5ec; background: #fff; color: #475467; font-size: 10px; }
.manual-figure-bar strong { color: #344054; }
.manual-figure-bar span { margin-left: auto; color: #2563eb; }
.manual-figure > p { margin: 0; padding: 10px 14px; border-top: 1px solid #e5eaf0; background: #fff; color: #667085; font-size: 11px; }
.report-figure-grid,
.qa-figure-grid,
.daily-figure-grid,
.draft-figure-grid { display: grid; min-height: 230px; }
.report-figure-grid,
.daily-figure-grid,
.draft-figure-grid { grid-template-columns: 160px minmax(0, 1fr); }
.qa-figure-grid { grid-template-columns: 140px minmax(260px, 1fr) 150px; }
.figure-sidebar { display: flex; flex-direction: column; gap: 10px; padding: 20px 14px; border-right: 1px solid #e5eaf0; background: #f1f5f9; color: #475467; font-size: 10px; }
.figure-line { display: block; width: 72%; height: 8px; border-radius: 2px; background: #dbe3ee; }
.figure-line.wide { width: 92%; }
.figure-main { padding: 20px 24px; }
.figure-tabs { display: flex; gap: 20px; padding-bottom: 11px; border-bottom: 1px solid #dfe5ec; color: #98a2b3; font-size: 10px; }
.figure-tabs b { color: #2563eb; }
.figure-field { height: 62px; margin-top: 18px; padding: 13px; border: 1px solid #dbe3ee; border-radius: 5px; background: #fff; color: #98a2b3; font-size: 10px; }
.figure-step-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 12px; }
.figure-step-row span { padding: 9px; border: 1px solid #dbeafe; border-radius: 4px; background: #eff6ff; color: #2563eb; font-size: 9px; }
.figure-primary { width: 112px; margin: 14px 0 0 auto; padding: 9px; border-radius: 4px; background: #2563eb; color: #fff; font-size: 9px; text-align: center; }
.qa-thread { display: flex; flex-direction: column; gap: 14px; padding: 20px; }
.question-bubble { max-width: 72%; align-self: flex-end; padding: 10px 12px; border-radius: 6px; background: #eff6ff; color: #1d4ed8; font-size: 9px; }
.answer-block { display: grid; gap: 7px; width: 86%; color: #475467; font-size: 9px; }
.answer-block span { display: block; height: 7px; background: #dbe3ee; }
.answer-block span.short { width: 66%; }
.qa-input { display: flex; justify-content: space-between; margin-top: auto; padding: 12px; border: 1px solid #cbd5e1; border-radius: 5px; background: #fff; color: #98a2b3; font-size: 9px; }
.qa-input b { color: #2563eb; }
.qa-sources { display: flex; flex-direction: column; gap: 9px; padding: 20px 12px; border-left: 1px solid #e5eaf0; background: #fff; color: #475467; font-size: 9px; }
.qa-sources span { padding: 9px 7px; border-bottom: 1px solid #e5eaf0; }
.daily-main { padding: 17px 22px; }
.daily-toolbar { display: flex; align-items: center; gap: 8px; color: #475467; font-size: 9px; }
.daily-toolbar span { padding: 6px 8px; border: 1px solid #dbe3ee; border-radius: 4px; background: #fff; }
.daily-toolbar b { margin-right: auto; }
.daily-filter { display: flex; gap: 8px; margin: 15px 0 12px; }
.daily-filter span { padding: 5px 9px; border-radius: 4px; background: #e2e8f0; color: #64748b; font-size: 8px; }
.daily-filter span:first-child { background: #dbeafe; color: #1d4ed8; }
.daily-event { display: flex; gap: 11px; padding: 13px 0; border-top: 1px solid #e5eaf0; }
.daily-event i { width: 4px; border-radius: 2px; background: #22c55e; }
.daily-event div { display: grid; gap: 6px; color: #344054; font-size: 9px; }
.daily-event span { color: #98a2b3; }
.draft-flow { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 30px; }
.draft-flow div { display: grid; min-width: 92px; gap: 8px; place-items: center; padding: 18px 10px; border: 1px solid #dbe3ee; border-radius: 5px; background: #fff; color: #475467; font-size: 9px; }
.draft-flow b { display: grid; width: 25px; height: 25px; place-items: center; border-radius: 50%; background: #dbeafe; color: #1d4ed8; }
.draft-flow em { width: 24px; height: 1px; background: #93c5fd; }

.manual-block { margin-top: 26px; }
.manual-block h3 { margin: 0 0 12px; color: #25324a; font-size: 15px; }
.manual-block > p { margin: 0 0 10px; color: #596579; font-size: 13px; line-height: 1.8; }
.manual-two-column { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 26px; }
.manual-steps { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; counter-reset: step; }
.manual-steps li { position: relative; display: grid; min-height: 54px; grid-template-columns: 150px minmax(0, 1fr); gap: 16px; align-items: start; padding: 14px 0 14px 38px; border-top: 1px solid #e7ebf0; counter-increment: step; }
.manual-steps li:last-child { border-bottom: 1px solid #e7ebf0; }
.manual-steps li::before { content: counter(step); position: absolute; top: 13px; left: 0; display: grid; width: 24px; height: 24px; place-items: center; border-radius: 50%; background: #eff6ff; color: #2563eb; font: 700 10px/1 "Fira Code", monospace; }
.manual-steps b { color: #344054; font-size: 13px; }
.manual-steps span { color: #667085; font-size: 13px; line-height: 1.75; }
.manual-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.manual-list li { position: relative; padding-left: 14px; color: #667085; font-size: 13px; line-height: 1.7; }
.manual-list li::before { content: ''; position: absolute; top: 9px; left: 0; width: 4px; height: 4px; border-radius: 50%; background: #3b82f6; }
.manual-list b { color: #344054; }
.manual-callout { align-self: start; gap: 12px; padding: 16px; border: 1px solid #bfdbfe; border-radius: 6px; background: #f5f9ff; color: #2563eb; }
.manual-callout.green { border-color: #bbf7d0; background: #f0fdf4; color: #16a34a; }
.manual-callout svg { flex: 0 0 auto; }
.manual-callout div { display: block; }
.manual-callout h3 { margin-bottom: 5px; }
.manual-callout p { margin: 0; color: #596579; font-size: 12px; line-height: 1.7; }
.manual-status-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid #e3e8ef; border-radius: 6px; overflow: hidden; }
.manual-status-grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.manual-status-grid > div { position: relative; min-height: 112px; padding: 15px; border-right: 1px solid #e3e8ef; }
.manual-status-grid > div:last-child { border-right: 0; }
.manual-status-grid b { margin-left: 8px; color: #344054; font-size: 12px; }
.manual-status-grid p { margin: 9px 0 0; color: #667085; font-size: 11px; line-height: 1.65; }
.status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.status-dot.queued { background: #94a3b8; }
.status-dot.running { background: #3b82f6; }
.status-dot.success { background: #22c55e; }
.status-dot.failed { background: #ef4444; }
.manual-warning { display: flex; align-items: flex-start; gap: 9px; margin-top: 12px; padding: 11px 13px; border-left: 3px solid #f59e0b; background: #fffbeb; color: #78570a; font-size: 12px; line-height: 1.65; }
.manual-warning svg { flex: 0 0 auto; margin-top: 1px; }
.manual-faq { border-top: 1px solid #e5eaf0; }
.manual-faq details { border-bottom: 1px solid #e5eaf0; }
.manual-faq summary { padding: 14px 2px; color: #344054; font-size: 13px; font-weight: 650; cursor: pointer; }
.manual-faq p { margin: -2px 0 14px; padding-left: 18px; color: #667085; font-size: 12px; line-height: 1.75; }
.manual-footer { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 10px clamp(28px, 4vw, 56px) 42px; padding: 18px; border: 1px solid #dbe3ee; border-radius: 6px; background: #f8fafc; }
.manual-footer div { gap: 9px; color: #596579; font-size: 12px; line-height: 1.6; }
.manual-footer svg { flex: 0 0 auto; color: #2563eb; }

@media (max-width: 820px) {
  .manual-backdrop { padding: 0; }
  .manual-dialog { width: 100%; height: 100dvh; border: 0; border-radius: 0; }
  .manual-header { height: 64px; padding: 0 14px; }
  .manual-title-group p { display: none; }
  .manual-layout { height: calc(100% - 64px); display: flex; flex-direction: column; }
  .manual-sidebar { display: block; flex: 0 0 auto; padding: 8px 10px; overflow-x: auto; border-right: 0; border-bottom: 1px solid #e5eaf0; }
  .manual-sidebar-label,
  .manual-sidebar-note { display: none; }
  .manual-sidebar nav { display: flex; width: max-content; gap: 5px; }
  .manual-sidebar button { min-height: 38px; grid-template-columns: 18px minmax(0, 1fr); width: auto; padding: 0 11px; white-space: nowrap; }
  .manual-sidebar button svg { display: none; }
  .manual-chapter { padding: 30px 20px 40px; }
  .manual-chapter-heading h2 { font-size: 22px; }
  .manual-two-column { grid-template-columns: 1fr; gap: 4px; }
  .manual-steps li { grid-template-columns: 1fr; gap: 5px; }
  .manual-status-grid,
  .manual-status-grid.three { grid-template-columns: 1fr 1fr; }
  .manual-status-grid > div:nth-child(2n) { border-right: 0; }
  .manual-status-grid > div { border-bottom: 1px solid #e3e8ef; }
  .manual-status-grid > div:nth-last-child(-n + 2) { border-bottom: 0; }
  .qa-figure-grid { grid-template-columns: 100px minmax(220px, 1fr); }
  .qa-sources { display: none; }
  .report-figure-grid,
  .daily-figure-grid,
  .draft-figure-grid { grid-template-columns: 100px minmax(300px, 1fr); }
  .manual-figure { overflow-x: auto; }
  .draft-flow { gap: 5px; padding-inline: 16px; }
  .draft-flow div { min-width: 70px; }
  .draft-flow em { width: 10px; }
  .manual-footer { grid-template-columns: 1fr; margin-inline: 20px; }
}

@media (max-width: 520px) {
  .manual-title-icon { display: none; }
  .manual-title-group h1 { font-size: 15px; }
  .manual-chapter { padding-inline: 16px; }
  .manual-status-grid,
  .manual-status-grid.three { grid-template-columns: 1fr; }
  .manual-status-grid > div { border-right: 0; border-bottom: 1px solid #e3e8ef !important; }
  .manual-status-grid > div:last-child { border-bottom: 0 !important; }
  .manual-footer { margin-inline: 16px; }
}

@media (prefers-reduced-motion: reduce) {
  .manual-content { scroll-behavior: auto; }
}
</style>
