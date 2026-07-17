<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { resizeTextareaElement } from '../../lib/autoResizeTextarea.js'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  modelValue: { type: String, default: '' },
  minHeight: { type: Number, default: 80 },
  placeholder: { type: String, default: '' },
  maxlength: { type: [Number, String], default: null },
  disabled: { type: Boolean, default: false },
  readonly: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'focus', 'blur'])
const textarea = ref(null)
let resizeObserver = null
let observedWidth = 0

function resize() {
  resizeTextareaElement(textarea.value)
}

function handleInput(event) {
  emit('update:modelValue', event.target.value)
  resizeTextareaElement(event.target)
}

onMounted(resize)

onMounted(() => {
  if (!textarea.value || typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width || 0
    if (!width || width === observedWidth) return
    observedWidth = width
    resize()
  })
  resizeObserver.observe(textarea.value)
})

onBeforeUnmount(() => resizeObserver?.disconnect())

watch([() => props.modelValue, () => props.minHeight], async () => {
  await nextTick()
  resize()
})

defineExpose({ resize })
</script>

<template>
  <textarea
    ref="textarea"
    v-bind="$attrs"
    class="auto-resize-textarea"
    rows="1"
    :value="modelValue"
    :style="{ minHeight: `${minHeight}px` }"
    :placeholder="placeholder"
    :maxlength="maxlength"
    :disabled="disabled"
    :readonly="readonly"
    :aria-label="ariaLabel || undefined"
    @input="handleInput"
    @focus="emit('focus', $event)"
    @blur="emit('blur', $event)"
  ></textarea>
</template>

<style scoped>
.auto-resize-textarea {
  width: 100%;
  height: auto;
  overflow-y: hidden;
  resize: none;
  box-sizing: border-box;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
