<script setup>
defineProps({
  steps: { type: Array, default: () => [] },
})
</script>

<template>
  <nav class="draft-step-navigation" aria-label="拟稿步骤">
    <ol role="list">
      <li v-for="(step, index) in steps" :key="step.key" :class="step.status">
        <span class="step-index" aria-hidden="true">
          {{ step.status === 'completed' ? '✓' : index + 1 }}
        </span>
        <span class="step-copy">
          <strong>{{ step.title }}</strong>
          <small>{{ step.statusLabel }}</small>
        </span>
        <span
          v-if="index < steps.length - 1"
          class="step-connector"
          aria-hidden="true"
        ></span>
        <span
          v-if="step.status === 'current' || step.status === 'processing' || step.status === 'needs_attention' || step.status === 'failed'"
          class="step-current-marker"
          :aria-current="step.status === 'current' || step.status === 'processing' || step.status === 'needs_attention' ? 'step' : undefined"
        ></span>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.draft-step-navigation {
  position: sticky;
  top: 0;
  z-index: 18;
  margin-bottom: 14px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(255, 255, 255, 0.97);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
}
.draft-step-navigation ol { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); margin: 0; padding: 0; list-style: none; }
.draft-step-navigation li { position: relative; display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 62px; padding: 10px 16px; color: #64748b; }
.step-index { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 28px; width: 28px; height: 28px; border: 1px solid #dbe3ef; background: #f1f5f9; color: #64748b; border-radius: 50%; font-size: 12px; font-weight: 900; }
.step-copy { min-width: 0; }
.step-copy strong,
.step-copy small { display: block; letter-spacing: 0; }
.step-copy strong { overflow: hidden; color: inherit; font-size: 13px; font-weight: 900; text-overflow: ellipsis; white-space: nowrap; }
.step-copy small { margin-top: 3px; color: #94a3b8; font-size: 10px; font-weight: 700; }
.step-connector { position: absolute; top: 50%; right: -1px; width: 1px; height: 28px; background: #e2e8f0; transform: translateY(-50%); }
.step-current-marker { position: absolute; right: 14px; bottom: 0; left: 14px; height: 3px; border-radius: 3px 3px 0 0; background: #2563eb; }
li.current,
li.processing { color: #1d4ed8; background: #f8fbff; }
li.current .step-index,
li.processing .step-index { border-color: #2563eb; background: #2563eb; color: #fff; }
li.completed { color: #166534; }
li.completed .step-index { border-color: #86efac; background: #dcfce7; color: #15803d; }
li.needs_attention { color: #b45309; background: #fffaf3; }
li.needs_attention .step-index { border-color: #fdba74; background: #ffedd5; color: #c2410c; }
li.needs_attention .step-current-marker { background: #f59e0b; }
li.failed { color: #b91c1c; background: #fff7f7; }
li.failed .step-index { border-color: #fca5a5; background: #fee2e2; color: #b91c1c; }
li.failed .step-current-marker { background: #dc2626; }

@media (max-width: 860px) {
  .draft-step-navigation { overflow-x: auto; }
  .draft-step-navigation ol { min-width: 720px; }
}
</style>
