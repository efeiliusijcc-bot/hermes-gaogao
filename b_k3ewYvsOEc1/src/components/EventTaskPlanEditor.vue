<script setup>
import { computed } from 'vue'
import { CircleAlert } from '@lucide/vue'
import { eventIntentLabel, eventPlanningError, normalizeEventTaskPlan, normalizeIntentRecognition } from '../lib/eventTaskPlan.js'

const props = defineProps({
  intentRecognition: { type: Object, default: () => ({}) },
  eventTaskPlan: { type: Object, default: () => ({ tasks: [] }) },
  showIntent: { type: Boolean, default: true },
  showTasks: { type: Boolean, default: true },
  editable: { type: Boolean, default: true },
})

const emit = defineEmits(['resolve-intent', 'update-task'])
const intent = computed(() => normalizeIntentRecognition(props.intentRecognition))
const plan = computed(() => normalizeEventTaskPlan(props.eventTaskPlan))
const validationMessage = computed(() => eventPlanningError(intent.value, plan.value))
const showEventTasks = computed(() => intent.value.resolved === 'event_timeline' || (!intent.value.resolved && intent.value.detected !== 'other'))

function queryText(task) {
  return task.searchQueries.join('\n')
}

function updateQueries(task, value) {
  emit('update-task', {
    id: task.id,
    changes: {
      searchQueries: Array.from(new Set(String(value || '').split(/\r?\n|；|;/).map((item) => item.trim()).filter(Boolean))).slice(0, 3),
    },
  })
}
</script>

<template>
  <div class="event-plan-editor">
    <section v-if="showIntent" class="event-intent-block">
      <div class="event-plan-heading">
        <div>
          <span>搜情意图</span>
          <h3>{{ eventIntentLabel(intent) }}</h3>
        </div>
        <small>{{ intent.source === 'model' ? '模型识别' : '规则回退' }}</small>
      </div>
      <p>{{ intent.reason }}</p>
      <div v-if="intent.detected === 'uncertain' && editable" class="event-intent-actions">
        <button type="button" :class="{ selected: intent.resolved === 'event_timeline' }" :aria-pressed="intent.resolved === 'event_timeline'" @click="emit('resolve-intent', 'event_timeline')">按事件脉络规划</button>
        <button type="button" :class="{ selected: intent.resolved === 'other' }" :aria-pressed="intent.resolved === 'other'" @click="emit('resolve-intent', 'other')">沿用普通规划</button>
      </div>
    </section>

    <section v-if="showTasks && showEventTasks" class="event-task-block">
      <div class="event-plan-heading">
        <div>
          <span>可执行子任务</span>
          <h3>事件脉络五维拆解</h3>
        </div>
        <small>{{ plan.tasks.filter((task) => task.enabled).length }}/5 项启用</small>
      </div>
      <div class="event-task-list">
        <article v-for="(task, index) in plan.tasks" :key="task.id" :class="{ disabled: !task.enabled }">
          <label class="event-task-toggle">
            <input
              type="checkbox"
              :checked="task.enabled"
              :disabled="!editable"
              @change="emit('update-task', { id: task.id, changes: { enabled: $event.target.checked } })"
            />
            <span>{{ String(index + 1).padStart(2, '0') }}</span>
          </label>
          <div class="event-task-fields">
            <header><strong>{{ task.dimension }}</strong><span>{{ task.title }}</span></header>
            <textarea
              :value="task.objective"
              :readonly="!editable"
              maxlength="500"
              rows="2"
              aria-label="任务描述"
              @input="emit('update-task', { id: task.id, changes: { objective: $event.target.value } })"
            ></textarea>
            <label>
              <span>检索词，每行一条</span>
              <textarea
                :value="queryText(task)"
                :readonly="!editable"
                maxlength="242"
                rows="2"
                aria-label="任务检索词"
                @change="updateQueries(task, $event.target.value)"
              ></textarea>
            </label>
          </div>
        </article>
      </div>
    </section>

    <div v-else-if="showTasks" class="event-plan-ordinary">
      已沿用普通编报规划，本次不启用事件脉络五维任务。
    </div>

    <div v-if="validationMessage" class="event-plan-warning" role="status">
      <CircleAlert :size="16" aria-hidden="true" />{{ validationMessage }}
    </div>
  </div>
</template>

<style scoped>
.event-plan-editor { display: grid; gap: 18px; color: #1f2937; }
.event-intent-block, .event-task-block { border: 1px solid #dbe3ee; background: #fff; border-radius: 6px; padding: 16px; }
.event-plan-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.event-plan-heading span { display: block; color: #64748b; font-size: 12px; line-height: 1.5; }
.event-plan-heading h3 { margin: 3px 0 0; color: #163a67; font-size: 16px; line-height: 1.5; }
.event-plan-heading small { flex: none; border: 1px solid #d9e5f5; border-radius: 4px; background: #f4f8fd; color: #315f9d; padding: 3px 7px; font-size: 12px; }
.event-intent-block > p { margin: 10px 0 0; color: #526174; font-size: 14px; line-height: 1.75; }
.event-intent-actions { display: flex; gap: 8px; margin-top: 13px; }
.event-intent-actions button { border: 1px solid #b9c9dc; border-radius: 6px; background: #fff; color: #244b78; min-height: 36px; padding: 0 13px; font-size: 13px; cursor: pointer; }
.event-intent-actions button.selected { border-color: #315f9d; background: #315f9d; color: #fff; }
.event-task-list { margin-top: 13px; border-top: 1px solid #e5eaf0; }
.event-task-list article { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 12px; padding: 14px 0; border-bottom: 1px solid #e5eaf0; }
.event-task-list article:last-child { border-bottom: 0; padding-bottom: 0; }
.event-task-list article.disabled { opacity: 0.55; }
.event-task-toggle { display: flex; align-items: flex-start; gap: 7px; color: #8290a3; font-size: 12px; padding-top: 3px; }
.event-task-toggle input { width: 16px; height: 16px; accent-color: #315f9d; }
.event-task-fields { min-width: 0; }
.event-task-fields header { display: flex; align-items: baseline; gap: 9px; margin-bottom: 8px; }
.event-task-fields header strong { color: #172c47; font-size: 14px; }
.event-task-fields header span { color: #778397; font-size: 12px; }
.event-task-fields textarea { display: block; box-sizing: border-box; width: 100%; resize: vertical; border: 1px solid #dbe2ea; border-radius: 5px; background: #fbfcfe; color: #334155; padding: 8px 10px; font: inherit; font-size: 13px; line-height: 1.65; }
.event-task-fields textarea:focus { outline: 2px solid rgba(49, 95, 157, 0.16); border-color: #7f9fc5; }
.event-task-fields > label { display: block; margin-top: 8px; }
.event-task-fields > label > span { display: block; margin-bottom: 5px; color: #7b8797; font-size: 12px; }
.event-plan-warning { display: flex; align-items: center; gap: 7px; border-left: 3px solid #c58b24; background: #fff9ed; color: #7b5719; padding: 10px 12px; font-size: 13px; }
.event-plan-ordinary { border-left: 3px solid #94a3b8; background: #f8fafc; color: #526174; padding: 12px 14px; font-size: 13px; line-height: 1.65; }
@media (max-width: 640px) {
  .event-task-list article { grid-template-columns: 1fr; }
  .event-task-toggle { align-items: center; }
  .event-intent-actions { display: grid; }
}
</style>
