<script setup>
import { LoaderCircle } from '@lucide/vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { reportOrbParams } from '../lib/report-orb/preset'
import { createReportOrbRenderer } from '../lib/report-orb/renderer'

const canvasRef = ref(null)
const renderState = ref('loading')
const reducedMotion = ref(false)
let destroyRenderer = () => {}
let motionQuery = null

function startRenderer() {
  destroyRenderer()
  renderState.value = 'loading'
  reducedMotion.value = Boolean(motionQuery?.matches)

  if (!canvasRef.value) return
  destroyRenderer = createReportOrbRenderer({
    canvas: canvasRef.value,
    getParams: () => reportOrbParams,
    animate: !reducedMotion.value,
    maxFps: 30,
    maxDevicePixelRatio: 1.5,
    onReady: () => {
      renderState.value = 'ready'
    },
    onError: () => {
      renderState.value = 'fallback'
    },
  })
}

onMounted(() => {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  motionQuery.addEventListener?.('change', startRenderer)
  startRenderer()
})

onBeforeUnmount(() => {
  motionQuery?.removeEventListener?.('change', startRenderer)
  destroyRenderer()
})
</script>

<template>
  <div
    class="report-orb-loader"
    :data-render-state="renderState"
    :data-reduced-motion="reducedMotion ? 'true' : 'false'"
    aria-hidden="true"
  >
    <canvas
      ref="canvasRef"
      class="report-orb-canvas"
      :class="{ ready: renderState === 'ready' }"
    ></canvas>
    <div v-if="renderState !== 'ready'" class="report-orb-fallback">
      <LoaderCircle :size="44" :stroke-width="1.5" />
    </div>
  </div>
</template>

<style scoped>
.report-orb-loader {
  position: relative;
  width: clamp(160px, 14vw, 188px);
  aspect-ratio: 1;
  margin: 0 auto 14px;
  contain: layout paint size;
}

.report-orb-canvas {
  display: block;
  width: 100%;
  height: 100%;
  opacity: 0;
  transition: opacity 180ms ease;
}

.report-orb-canvas.ready {
  opacity: 1;
}

.report-orb-fallback {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #2563eb;
}

.report-orb-fallback svg {
  animation: report-orb-fallback-spin 1.2s linear infinite;
}

@keyframes report-orb-fallback-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 640px) {
  .report-orb-loader {
    width: clamp(112px, 34vw, 132px);
    margin-bottom: 10px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .report-orb-canvas {
    transition: none;
  }

  .report-orb-fallback svg {
    animation: none;
  }
}
</style>
