<script setup>
import { computed } from 'vue'
import { eventIntentLabel, hasEventPlanning, normalizeEventTaskPlan, normalizeIntentRecognition } from '../lib/eventTaskPlan.js'

const props = defineProps({
  context: { type: Object, default: null },
})

const available = computed(() => hasEventPlanning(props.context))
const intent = computed(() => normalizeIntentRecognition(props.context?.intentRecognition))
const plan = computed(() => normalizeEventTaskPlan(props.context?.eventTaskPlan))
</script>

<template>
  <section class="event-plan-summary">
    <div v-if="!available" class="event-plan-missing">
      <strong>该任务生成时未保存五维任务记录</strong>
      <p>不对历史数据进行推断或补写。</p>
    </div>
    <template v-else>
      <header>
        <div><span>搜情意图</span><h3>{{ eventIntentLabel(intent) }}</h3></div>
        <small>{{ intent.source === 'model' ? '模型识别' : '规则回退' }}</small>
      </header>
      <p class="event-intent-reason">{{ intent.reason }}</p>
      <div v-if="intent.resolved === 'event_timeline'" class="event-summary-list">
        <article v-for="(task, index) in plan.tasks" :key="task.id" :class="{ disabled: !task.enabled }">
          <span>{{ String(index + 1).padStart(2, '0') }}</span>
          <div>
            <header><strong>{{ task.dimension }}</strong><small>{{ task.enabled ? '已启用' : '未启用' }}</small></header>
            <p>{{ task.objective }}</p>
            <ul v-if="task.searchQueries.length"><li v-for="query in task.searchQueries" :key="query">{{ query }}</li></ul>
          </div>
        </article>
      </div>
    </template>
  </section>
</template>

<style scoped>
.event-plan-summary { border-top: 1px solid #e3e8ef; padding-top: 18px; }
.event-plan-summary > header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.event-plan-summary > header span { color: #738095; font-size: 12px; }
.event-plan-summary h3 { margin: 4px 0 0; color: #163a67; font-size: 16px; }
.event-plan-summary > header small { color: #315f9d; font-size: 12px; }
.event-intent-reason { margin: 9px 0 0; color: #526174; font-size: 14px; line-height: 1.7; }
.event-summary-list { margin-top: 14px; border-top: 1px solid #e5eaf0; }
.event-summary-list > article { display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 12px; padding: 13px 0; border-bottom: 1px solid #e5eaf0; }
.event-summary-list > article > span { color: #8b97a8; font-size: 12px; padding-top: 2px; }
.event-summary-list article header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.event-summary-list article strong { color: #24364d; font-size: 14px; }
.event-summary-list article small { color: #64748b; font-size: 12px; }
.event-summary-list article p { margin: 6px 0 0; color: #526174; font-size: 13px; line-height: 1.65; }
.event-summary-list article ul { display: flex; flex-wrap: wrap; gap: 6px; margin: 9px 0 0; padding: 0; list-style: none; }
.event-summary-list article li { border: 1px solid #dbe5f1; border-radius: 4px; background: #f7faff; color: #315f79; padding: 3px 7px; font-size: 12px; }
.event-summary-list article.disabled { opacity: 0.55; }
.event-plan-missing { border-left: 3px solid #cbd5e1; background: #f8fafc; padding: 12px 14px; }
.event-plan-missing strong { color: #475569; font-size: 14px; }
.event-plan-missing p { margin: 5px 0 0; color: #718096; font-size: 13px; line-height: 1.6; }
</style>
