<script setup>
import { CheckCircle2, Circle, CircleAlert, LoaderCircle } from '@lucide/vue'

const props = defineProps({
  stages: {
    type: Array,
    default: () => [],
  },
})

function statusLabel(status) {
  if (status === 'done') return '已完成'
  if (status === 'current') return '进行中'
  if (status === 'error') return '异常'
  return '未开始'
}

function statusIcon(status) {
  if (status === 'done') return CheckCircle2
  if (status === 'current') return LoaderCircle
  if (status === 'error') return CircleAlert
  return Circle
}
</script>

<template>
  <section v-if="props.stages.length" class="report-progress-flow" aria-label="编报任务阶段">
    <div
      class="report-progress-flow-list"
      role="list"
      :style="{ '--stage-count': Math.max(props.stages.length, 1) }"
    >
      <article
        v-for="(stage, index) in props.stages"
        :key="stage.key"
        class="report-progress-stage"
        :class="`report-progress-stage-${stage.status}`"
        role="listitem"
        :aria-current="stage.status === 'current' ? 'step' : undefined"
        :title="stage.desc"
      >
        <div class="report-progress-stage-title">
          <span>{{ String(index + 1).padStart(2, '0') }}</span>
          <strong>{{ stage.title }}</strong>
        </div>
        <div class="report-progress-stage-status">
          <component :is="statusIcon(stage.status)" :size="13" aria-hidden="true" />
          <span>{{ statusLabel(stage.status) }}</span>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.report-progress-flow {
  width: 100%;
  overflow-x: auto;
  border: 1px solid #dfe6ef;
  border-radius: 6px;
  background: #fff;
  scrollbar-width: thin;
  scrollbar-color: #cbd5e1 transparent;
}

.report-progress-flow::-webkit-scrollbar { height: 6px; }
.report-progress-flow::-webkit-scrollbar-track { background: transparent; }
.report-progress-flow::-webkit-scrollbar-thumb { border-radius: 6px; background: #cbd5e1; }

.report-progress-flow-list {
  display: grid;
  grid-template-columns: repeat(var(--stage-count), minmax(140px, 1fr));
  min-width: calc(var(--stage-count) * 140px);
}

.report-progress-stage {
  position: relative;
  display: grid;
  min-height: 74px;
  align-content: space-between;
  gap: 8px;
  padding: 13px 14px 12px;
  border: 0;
  border-right: 1px solid #e5eaf0;
  background: #fff;
  color: #667085;
}

.report-progress-stage:last-child { border-right: 0; }

.report-progress-stage-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.report-progress-stage-title > span {
  display: inline-flex;
  width: 24px;
  flex: 0 0 auto;
  align-items: center;
  color: #2563eb;
  font-family: 'Fira Code', 'Microsoft YaHei', monospace;
  font-size: 12px;
  font-weight: 750;
}

.report-progress-stage-title strong {
  overflow: hidden;
  color: #25324a;
  font-size: 14px;
  font-weight: 750;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.report-progress-stage-status {
  display: flex;
  align-items: center;
  gap: 5px;
  padding-left: 30px;
  color: #98a2b3;
  font-size: 12px;
  font-weight: 650;
}

.report-progress-stage-status svg { flex: 0 0 auto; }

.report-progress-stage-done .report-progress-stage-status { color: #16a34a; }

.report-progress-stage-current {
  box-shadow: inset 3px 0 0 #2563eb;
  background: #f4f8ff;
}

.report-progress-stage-current .report-progress-stage-status { color: #2563eb; }
.report-progress-stage-current .report-progress-stage-status svg { animation: report-progress-spin 1.2s linear infinite; }

.report-progress-stage-error {
  box-shadow: inset 3px 0 0 #dc2626;
  background: #fffafa;
}

.report-progress-stage-error .report-progress-stage-status { color: #dc2626; }
.report-progress-stage-waiting .report-progress-stage-title > span { color: #98a2b3; }
.report-progress-stage-waiting .report-progress-stage-title strong { color: #667085; }

@keyframes report-progress-spin { to { transform: rotate(360deg); } }

@media (max-width: 760px) {
  .report-progress-flow-list { grid-template-columns: repeat(var(--stage-count), 150px); }
}

@media (prefers-reduced-motion: reduce) {
  .report-progress-stage-current .report-progress-stage-status svg { animation: none; }
}
</style>
