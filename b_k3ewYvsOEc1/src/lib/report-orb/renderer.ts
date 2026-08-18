import { type ReportOrbParams } from './preset'
import { reportOrbShaderSource } from './shader-source'
import { writeReportOrbUniforms } from './uniforms'

export type ReportOrbRendererOptions = {
  canvas: HTMLCanvasElement
  getParams: () => ReportOrbParams
  onError: (error: Error) => void
  onReady: () => void
  animate?: boolean
  maxFps?: number
  maxDevicePixelRatio?: number
}

export function createReportOrbRenderer({
  canvas,
  getParams,
  onError,
  onReady,
  animate = true,
  maxFps = 30,
  maxDevicePixelRatio = 1.5,
}: ReportOrbRendererOptions): () => void {
  let disposed = false
  let animationFrame = 0
  let device: GPUDevice | null = null
  let gpuContext: GPUCanvasContext | null = null
  let readyNotified = false
  let failed = false
  let visible = document.visibilityState !== 'hidden'
  let lastRenderedAt = Number.NEGATIVE_INFINITY
  let cleanupVisibilityListener = () => {}
  const frameInterval = 1000 / Math.max(1, Math.min(maxFps, 60))

  function stopAnimationFrame(): void {
    if (!animationFrame) return
    cancelAnimationFrame(animationFrame)
    animationFrame = 0
  }

  function scheduleFrame(frame: FrameRequestCallback): void {
    if (disposed || failed || !visible || animationFrame) return
    animationFrame = requestAnimationFrame(frame)
  }

  function fail(error: Error): void {
    if (disposed || failed) return
    failed = true
    stopAnimationFrame()
    gpuContext?.unconfigure()
    device?.destroy()
    onError(error)
  }

  async function start(): Promise<void> {
    if (!navigator.gpu) {
      throw new Error('当前浏览器不支持 WebGPU')
    }

    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) {
      throw new Error('未找到可用的 WebGPU 适配器')
    }

    device = await adapter.requestDevice()
    if (disposed) {
      device.destroy()
      return
    }

    const context = canvas.getContext('webgpu')
    if (!context) {
      throw new Error('无法创建 WebGPU 画布上下文')
    }
    gpuContext = context

    const format = navigator.gpu.getPreferredCanvasFormat()
    gpuContext.configure({ device, format, alphaMode: 'premultiplied' })

    const shader = device.createShaderModule({
      label: 'hermes-report-orb',
      code: reportOrbShaderSource,
    })
    const compilation = await shader.getCompilationInfo()
    const compilationErrors = compilation.messages.filter((message) => message.type === 'error')
    if (compilationErrors.length > 0) {
      throw new Error(
        compilationErrors
          .map((message) => message.lineNum + ':' + message.linePos + ' ' + message.message)
          .join('\n'),
      )
    }

    const pipeline = device.createRenderPipeline({
      label: 'hermes-report-orb-pipeline',
      layout: 'auto',
      vertex: { module: shader, entryPoint: 'vs_main' },
      fragment: {
        module: shader,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    })
    const values = new Float32Array(128)
    const uniformBuffer = device.createBuffer({
      size: values.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    })
    const startedAt = performance.now()

    device.lost.then((info) => {
      fail(new Error('WebGPU 设备已断开：' + (info.message || info.reason)))
    })
    device.addEventListener('uncapturederror', (event) => {
      event.preventDefault()
      fail(new Error('WebGPU 渲染错误：' + event.error.message))
    })

    function resize(): void {
      const dpr = Math.min(window.devicePixelRatio || 1, Math.max(1, maxDevicePixelRatio))
      const width = Math.max(1, Math.floor(canvas.clientWidth * dpr))
      const height = Math.max(1, Math.floor(canvas.clientHeight * dpr))

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
    }

    function frame(now: number): void {
      animationFrame = 0
      if (disposed || failed || !device || !gpuContext || !visible) return

      if (readyNotified && animate && now - lastRenderedAt < frameInterval) {
        scheduleFrame(frame)
        return
      }

      try {
        lastRenderedAt = now
        resize()
        writeReportOrbUniforms(
          values,
          canvas.width,
          canvas.height,
          (now - startedAt) / 1000,
          getParams(),
        )
        device.queue.writeBuffer(uniformBuffer, 0, values)

        const encoder = device.createCommandEncoder()
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: gpuContext.getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        })
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, bindGroup)
        pass.draw(3, 1, 0, 0)
        pass.end()
        device.queue.submit([encoder.finish()])
        if (!readyNotified) {
          readyNotified = true
          onReady()
        }
        if (animate) scheduleFrame(frame)
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    }

    function handleVisibilityChange(): void {
      visible = document.visibilityState !== 'hidden'
      if (!visible) {
        stopAnimationFrame()
        return
      }
      lastRenderedAt = Number.NEGATIVE_INFINITY
      if (animate || !readyNotified) scheduleFrame(frame)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    cleanupVisibilityListener = () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
    scheduleFrame(frame)
  }

  start().catch((error: unknown) => {
    fail(error instanceof Error ? error : new Error(String(error)))
  })

  return () => {
    disposed = true
    cleanupVisibilityListener()
    stopAnimationFrame()
    gpuContext?.unconfigure()
    device?.destroy()
  }
}
