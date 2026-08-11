<script setup>
import { CheckCircle2, ChevronRight, Circle, CircleAlert, LoaderCircle } from '@lucide/vue'

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
        <ChevronRight
          v-if="index < props.stages.length - 1"
          class="report-progress-stage-connector"
          :size="17"
          aria-hidden="true"
        />
      </article>
    </div>
  </section>
</template>

<style scoped>
.report-progress-flow {
  width: 100%;
  overflow-x: auto;
  border: 1px solid #dfe6ef;
  border-radius: 8px;
  background: #fff;
  padding: 18px 20px;
  scrollbar-width: thin;
  scrollbar-color: #cbd5e1 transparent;
}

.report-progress-flow::-webkit-scrollbar { height: 6px; }
.report-progress-flow::-webkit-scrollbar-track { background: transparent; }
.report-progress-flow::-webkit-scrollbar-thumb { border-radius: 6px; background: #cbd5e1; }

.report-progress-flow-list {
  display: grid;
  grid-template-columns: repeat(var(--stage-count), minmax(118px, 1fr));
  gap: 24px;
  min-width: calc(var(--stage-count) * 118px + (var(--stage-count) - 1) * 24px);
}

.report-progress-stage {
  position: relative;
  display: grid;
  min-height: 66px;
  align-content: space-between;
  gap: 9px;
  padding: 11px 10px 10px;
  border: 1px solid #d8e0ea;
  border-radius: 6px;
  background: #fff;
  color: #667085;
}

.report-progress-stage-title {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.report-progress-stage-title > span {
  display: grid;
  width: 23px;
  height: 23px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 4px;
  background: #eff6ff;
  color: #2563eb;
  font-family: 'Fira Code', 'Microsoft YaHei', monospace;
  font-size: 11px;
  font-weight: 750;
}

.report-progress-stage-title strong {
  overflow: hidden;
  color: #25324a;
  font-size: 12px;
  font-weight: 750;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.report-progress-stage-status {
  display: flex;
  align-items: center;
  gap: 5px;
  padding-left: 27px;
  color: #98a2b3;
  font-size: 10px;
  font-weight: 650;
}

.report-progress-stage-status svg { flex: 0 0 auto; }

.report-progress-stage-connector {
  position: absolute;
  top: 50%;
  right: -21px;
  color: #2563eb;
  transform: translateY(-50%);
}

.report-progress-stage-done .report-progress-stage-status { color: #16a34a; }

.report-progress-stage-current {
  border-color: #2563eb;
  background: #f8fbff;
  box-shadow: 0 0 0 1px rgb(37 99 235 / 10%);
}

.report-progress-stage-current .report-progress-stage-status { color: #2563eb; }
.report-progress-stage-current .report-progress-stage-status svg { animation: report-progress-spin 1.2s linear infinite; }

.report-progress-stage-error {
  border-color: #fca5a5;
  background: #fffafa;
}

.report-progress-stage-error .report-progress-stage-status { color: #dc2626; }
.report-progress-stage-waiting .report-progress-stage-title > span { background: #f2f4f7; color: #98a2b3; }
.report-progress-stage-waiting .report-progress-stage-title strong { color: #667085; }

@keyframes report-progress-spin { to { transform: rotate(360deg); } }

@media (max-width: 760px) {
  .report-progress-flow { padding: 14px; }
  .report-progress-flow-list { grid-template-columns: repeat(var(--stage-count), 132px); }
}

@media (prefers-reduced-motion: reduce) {
  .report-progress-stage-current .report-progress-stage-status svg { animation: none; }
}
</style>
