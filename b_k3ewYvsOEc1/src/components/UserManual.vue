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
              <p>四个业务模块共用一份手册，当前已定位到对应章节</p>
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
              <span>系统会自动保存可恢复的任务与历史记录。</span>
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
                <div class="manual-figure-bar"><i></i><strong>深度编报工作区</strong><span>使用手册</span></div>
                <div class="report-figure-grid">
                  <div class="figure-sidebar">
                    <b>历史编报</b>
                    <span class="figure-line wide"></span><span class="figure-line"></span><span class="figure-line wide"></span>
                  </div>
                  <div class="figure-main">
                    <div class="figure-tabs"><b>创建任务</b><span>规划确认</span><span>生成结果</span></div>
                    <div class="figure-field">报告主题与背景材料</div>
                    <div class="figure-step-row"><span>1 方向</span><span>2 信源</span><span>3 补充</span></div>
                    <div class="figure-primary">开始深度编报</div>
                  </div>
                </div>
                <p>界面示意：左侧查看历史任务，中间完成创建、规划和结果查看。</p>
              </div>

              <div class="manual-block">
                <h3>创建并启动一次编报</h3>
                <ol class="manual-steps">
                  <li><b>填写报告主题。</b><span>主题尽量包含主体、事项、时间范围和关注方向，例如“某机构近期对华合作动向及风险研判”。</span></li>
                  <li><b>补充背景材料。</b><span>可粘贴事件线索、已知事实、网址或内部材料。背景越具体，规划方向越稳定。</span></li>
                  <li><b>生成报告规划。</b><span>系统会拆分研究方向、检索词和信源范围。此时尚未开始生成成稿，可继续调整。</span></li>
                  <li><b>逐项确认规划。</b><span>检查研究方向、联网搜索信源和数据库信源。普通用户只能看到其权限范围内的信源。</span></li>
                  <li><b>开始深度编报。</b><span>确认后进入资料采集、交叉核验、写作和质检流程。生成期间可以切换模块，任务会在后台继续。</span></li>
                </ol>
              </div>

              <div class="manual-two-column">
                <div class="manual-block">
                  <h3>结果页怎么查看</h3>
                  <ul class="manual-list">
                    <li><b>报告正文：</b>阅读、编辑并导出最终报告。</li>
                    <li><b>信源概览：</b>核对标题、机构、发布时间、相关性与原文。</li>
                    <li><b>规划选择：</b>回看本次实际采用的研究方向和信源范围。</li>
                    <li><b>引用依据：</b>核对正文引用编号与对应证据。</li>
                    <li><b>任务进度：</b>查看每个处理阶段及技术日志。</li>
                    <li><b>成稿自检：</b>查看结构、事实、引用等标准的具体核验说明。</li>
                  </ul>
                </div>
                <div class="manual-block manual-callout">
                  <Download :size="19" aria-hidden="true" />
                  <div>
                    <h3>导出前建议</h3>
                    <p>先检查正文中的引用编号，再到“引用依据”和“信源概览”确认原文。完成必要修改后再导出 Word 或 PDF。</p>
                  </div>
                </div>
              </div>

              <div class="manual-block">
                <h3>任务状态与失败排查</h3>
                <div class="manual-status-grid">
                  <div><span class="status-dot queued"></span><b>排队中</b><p>任务已提交，等待服务资源；无需重复点击。</p></div>
                  <div><span class="status-dot running"></span><b>生成中</b><p>可在历史记录中重新打开并查看实时进度。</p></div>
                  <div><span class="status-dot success"></span><b>已完成</b><p>成稿和信源已保存，可继续编辑或导出。</p></div>
                  <div><span class="status-dot failed"></span><b>失败</b><p>打开任务查看错误阶段和日志，再决定重试。</p></div>
                </div>
                <div class="manual-warning"><AlertTriangle :size="17" /><span>若只有部分资料采集成功，先核对信源和成稿完整度。不要仅凭“部分完成”状态直接对外使用。</span></div>
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
                <div class="manual-figure-bar"><i></i><strong>QA问答</strong><span>使用手册</span></div>
                <div class="qa-figure-grid">
                  <div class="figure-sidebar"><b>问答历史</b><span class="figure-line wide"></span><span class="figure-line"></span><span class="figure-line wide"></span></div>
                  <div class="qa-thread"><div class="question-bubble">提出包含时间与范围的问题</div><div class="answer-block"><b>回答</b><span></span><span></span><span class="short"></span></div><div class="qa-input">继续追问… <b>发送</b></div></div>
                  <div class="qa-sources"><b>参考信源</b><span>01 官方来源</span><span>02 数据库材料</span><span>03 联网搜索</span></div>
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
                  <p>左侧历史记录会保存会话。点击任一记录可恢复问题、回答和信源；新建问答不会删除旧会话。</p>
                </div>
                <div class="manual-block">
                  <h3>核对回答依据</h3>
                  <ul class="manual-list">
                    <li>点击回答中的引用编号查看对应来源。</li>
                    <li>优先核对官方来源、原始文件和发布时间。</li>
                    <li>来源标题相关不等于内容支持结论，应打开摘要或原文确认。</li>
                    <li>复制回答前保留必要引用，避免事实与依据分离。</li>
                  </ul>
                </div>
              </div>

              <div class="manual-block">
                <h3>常见状态</h3>
                <div class="manual-faq">
                  <details><summary>回答一直处于生成中</summary><p>先等待当前请求结束，不要连续发送相同问题。切换页面后可从历史会话恢复。</p></details>
                  <details><summary>回答为空或没有参考信源</summary><p>缩小问题范围并补充明确实体、日期或材料。若仍为空，当前权限范围内可能没有可用资料。</p></details>
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
                <div class="manual-figure-bar"><i></i><strong>每日动态感知</strong><span>使用手册</span></div>
                <div class="daily-figure-grid">
                  <div class="figure-sidebar"><b>历史简报</b><span class="figure-line wide"></span><span class="figure-line"></span><span class="figure-line wide"></span></div>
                  <div class="daily-main"><div class="daily-toolbar"><b>业务日期</b><span>文档视图</span><span>卡片视图</span></div><div class="daily-filter"><span>全部</span><span>政治</span><span>经济</span><span>安全</span></div><div class="daily-event"><i></i><div><b>重点事件标题</b><span>事件摘要与影响判断</span></div></div><div class="daily-event"><i></i><div><b>重点事件标题</b><span>事件摘要与影响判断</span></div></div></div>
                </div>
                <p>界面示意：从历史简报切换日期，在正文或卡片视图中查看事件。</p>
              </div>

              <div class="manual-block">
                <h3>查看当日简报</h3>
                <ol class="manual-steps">
                  <li><b>确认业务日期。</b><span>页面展示的是简报对应的业务日期，不一定等同于当前访问时间。</span></li>
                  <li><b>选择阅读视图。</b><span>文档视图适合连续阅读和导出；卡片视图适合快速扫描、分类筛选和展开单条事件。</span></li>
                  <li><b>按类别筛选。</b><span>使用类别入口缩小事件范围；切回“全部”恢复完整清单。</span></li>
                  <li><b>展开事件。</b><span>查看事件概述、重点主体、时间地点、影响判断及来源链接。</span></li>
                  <li><b>核对原始信源。</b><span>对准备引用的事实，打开来源链接确认标题、发布时间和原文语境。</span></li>
                </ol>
              </div>

              <div class="manual-two-column">
                <div class="manual-block">
                  <h3>历史、复制与导出</h3>
                  <p>左侧历史简报按日期排列，点击即可切换。复制用于快速引用当前内容；导出 Word 用于形成可编辑文档。导出前应确认业务日期和筛选条件。</p>
                </div>
                <div class="manual-block">
                  <h3>转入拟稿助手</h3>
                  <p>有权限时，可将单条事件导入拟稿助手。系统会带入事件主题、摘要和来源，随后仍需在事件分析阶段核对信息是否完整。</p>
                </div>
              </div>

              <div class="manual-block">
                <h3>内容状态说明</h3>
                <div class="manual-status-grid three">
                  <div><span class="status-dot success"></span><b>可用</b><p>简报已生成，可阅读、复制或导出。</p></div>
                  <div><span class="status-dot running"></span><b>生成中</b><p>等待当日任务完成，历史简报仍可查看。</p></div>
                  <div><span class="status-dot failed"></span><b>异常</b><p>内容缺失或质量状态异常时，不应直接用于成稿。</p></div>
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
                <div class="manual-figure-bar"><i></i><strong>拟稿助手</strong><span>使用手册</span></div>
                <div class="draft-figure-grid">
                  <div class="figure-sidebar"><b>拟稿历史</b><span class="figure-line wide"></span><span class="figure-line"></span><span class="figure-line wide"></span></div>
                  <div class="draft-flow"><div><b>1</b><span>输入材料</span></div><em></em><div><b>2</b><span>事件分析</span></div><em></em><div><b>3</b><span>编辑提纲</span></div><em></em><div><b>4</b><span>导入编报</span></div></div>
                </div>
                <p>界面示意：拟稿按四个阶段推进，历史记录可恢复当前进度。</p>
              </div>

              <div class="manual-block">
                <h3>完整拟稿流程</h3>
                <ol class="manual-steps">
                  <li><b>输入原始材料。</b><span>粘贴新闻、简报、会议纪要或自行整理的事实。至少包含一个明确事件主题。</span></li>
                  <li><b>检查事件分析。</b><span>重点核对事件概括、核心主体、时间与地点、关键事实和涉我风险。显示“暂无明确内容”时，应返回补充材料后重新分析。</span></li>
                  <li><b>生成提纲。</b><span>系统根据事件分析生成章节结构。生成后可拖动阅读、逐项修改标题与要点。</span></li>
                  <li><b>编辑或使用 AI 修改。</b><span>手动修改适合精确调整；AI 修改应给出具体要求，例如“把第二部分改为按时间排序”。</span></li>
                  <li><b>确认并导入深度编报。</b><span>确认提纲后导入，系统会把拟稿材料和提纲带入编报规划，之后仍需确认信源和研究方向。</span></li>
                </ol>
              </div>

              <div class="manual-two-column">
                <div class="manual-block">
                  <h3>自动保存与历史恢复</h3>
                  <p>提纲编辑会自动保存。左侧拟稿历史显示已有任务，点击可恢复材料、分析和提纲。切换记录前先留意页面的保存状态提示。</p>
                </div>
                <div class="manual-block manual-callout green">
                  <History :size="19" aria-hidden="true" />
                  <div>
                    <h3>避免重复创建</h3>
                    <p>页面刷新或暂时离开后，先从拟稿历史恢复任务。只有主题确实变化时再新建拟稿。</p>
                  </div>
                </div>
              </div>

              <div class="manual-block">
                <h3>异常处理</h3>
                <div class="manual-faq">
                  <details><summary>事件分析字段显示“暂无明确内容”</summary><p>这表示当前材料或解析结果没有提供对应字段。补充人物、机构、日期、地点和关键事实后重新分析，不要用概括性文字代替事实。</p></details>
                  <details><summary>提纲修改后没有保存</summary><p>先保留当前内容，观察保存提示并稍后重试。不要立即切换历史记录，以免未保存内容丢失。</p></details>
                  <details><summary>导入深度编报失败</summary><p>检查是否已确认提纲以及账号是否具备编报权限。失败后可从拟稿历史恢复，无需重新录入全部材料。</p></details>
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
.manual-figure-bar i { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 13px 0 #cbd5e1, 26px 0 #cbd5e1; margin-right: 26px; }
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
