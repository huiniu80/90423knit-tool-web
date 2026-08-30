<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { getShapeBounds } from '../core/geometry/geometry'
import {
  analyzeLineArt,
  calibrateContour,
  cropRasterToContent,
} from '../core/import/imageImporter'
import type {
  ImageImportAnalysis,
  ImageRaster,
  ImageRotation,
} from '../core/import/imageImport.types'
import { useEditorStore } from '../stores/editor'

const emit = defineEmits<{ close: []; imported: [] }>()
const store = useEditorStore()
const { fabric, gauge, shapes, selectedShapeId } = storeToRefs(store)
const targetShapeId = ref(selectedShapeId.value)
const targetShape = computed(() => shapes.value.find((shape) => shape.id === targetShapeId.value) ?? null)
const step = ref<1 | 2 | 3>(1)
const sourceRaster = shallowRef<ImageRaster | null>(null)
const analysis = shallowRef<ImageImportAnalysis | null>(null)
const previewCanvas = ref<HTMLCanvasElement | null>(null)
const selectedCandidateId = ref<string | null>(null)
const processing = ref(false)
const errorMessage = ref('')
const fileName = ref('')
const dragActive = ref(false)
const threshold = ref(127)
const inverted = ref(false)
const repairRadius = ref(3)
const rotation = ref<ImageRotation>(0)
const autoCrop = ref(true)
const previewMode = ref<'original' | 'binary' | 'overlay'>('overlay')
const calibrationAxis = ref<'width' | 'height'>('width')
const dimensionValue = ref(0)
let analysisTimer: ReturnType<typeof setTimeout> | null = null
let analysisVersion = 0

const selectedCandidate = computed(() =>
  analysis.value?.candidates.find((candidate) => candidate.id === selectedCandidateId.value) ?? null,
)
const calibrated = computed(() => {
  if (!selectedCandidate.value || dimensionValue.value <= 0) return null
  try {
    return calibrateContour(selectedCandidate.value, {
      axis: calibrationAxis.value,
      valueCm: dimensionValue.value,
      stitchWidthCm: gauge.value.stitchWidthCm,
      rowHeightCm: gauge.value.rowHeightCm,
    })
  } catch {
    return null
  }
})
const targetBounds = computed(() => targetShape.value ? getShapeBounds(targetShape.value) : null)
const resultingFabric = computed(() => {
  const result = calibrated.value
  if (!result) return fabric.value
  if (targetBounds.value) {
    return {
      widthCm: Math.max(fabric.value.widthCm, Math.ceil(targetBounds.value.x + result.widthCm)),
      heightCm: Math.max(fabric.value.heightCm, Math.ceil(targetBounds.value.y + result.heightCm)),
    }
  }
  return {
    widthCm: Math.max(fabric.value.widthCm, Math.ceil(result.widthCm)),
    heightCm: Math.max(fabric.value.heightCm, Math.ceil(result.heightCm)),
  }
})
const fabricWillExpand = computed(() =>
  resultingFabric.value.widthCm !== fabric.value.widthCm
  || resultingFabric.value.heightCm !== fabric.value.heightCm,
)

function close(): void {
  if (!processing.value) emit('close')
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
}

function rasterForAnalysis(): ImageRaster | null {
  if (!sourceRaster.value) return null
  return autoCrop.value ? cropRasterToContent(sourceRaster.value) : sourceRaster.value
}

async function runAnalysis(useAutomaticThreshold = false): Promise<void> {
  const raster = rasterForAnalysis()
  if (!raster) return
  const version = ++analysisVersion
  processing.value = true
  errorMessage.value = ''
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  try {
    let result = analyzeLineArt(raster, {
      threshold: threshold.value,
      inverted: inverted.value,
      repairRadius: repairRadius.value,
      rotation: rotation.value,
    })
    if (useAutomaticThreshold) {
      threshold.value = result.automaticThreshold
      result = analyzeLineArt(raster, {
        threshold: threshold.value,
        inverted: inverted.value,
        repairRadius: repairRadius.value,
        rotation: rotation.value,
      })
    }
    if (version !== analysisVersion) return
    analysis.value = result
    const stillExists = result.candidates.some((candidate) => candidate.id === selectedCandidateId.value)
    if (!stillExists) selectedCandidateId.value = result.candidates[0]?.id ?? null
    if (!result.candidates.length) errorMessage.value = '没有检测到可用的闭合区域。请调整阈值、反转颜色或增大补线范围。'
    await nextTick()
    drawPreview()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '图片分析失败'
  } finally {
    if (version === analysisVersion) processing.value = false
  }
}

function scheduleAnalysis(): void {
  if (analysisTimer) clearTimeout(analysisTimer)
  analysisTimer = setTimeout(() => void runAnalysis(), 120)
}

function reanalyze(): void {
  void runAnalysis()
}

async function decodeFile(file: File): Promise<void> {
  errorMessage.value = ''
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    errorMessage.value = '仅支持 PNG、JPG 和 WebP 图片。'
    return
  }
  if (file.size > 15 * 1024 * 1024) {
    errorMessage.value = '图片不能超过 15 MB。'
    return
  }
  processing.value = true
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('浏览器无法读取图片像素')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    const imageData = context.getImageData(0, 0, width, height)
    sourceRaster.value = { width, height, data: imageData.data.slice() }
    fileName.value = file.name
    inverted.value = false
    repairRadius.value = 3
    rotation.value = 0
    previewMode.value = 'overlay'
    await runAnalysis(true)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '无法打开这张图片'
  } finally {
    processing.value = false
  }
}

function onFileInput(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) void decodeFile(file)
  ;(event.target as HTMLInputElement).value = ''
}

function onDrop(event: DragEvent): void {
  dragActive.value = false
  const file = event.dataTransfer?.files[0]
  if (file) void decodeFile(file)
}

function rotate(): void {
  rotation.value = ((rotation.value + 90) % 360) as ImageRotation
  void runAnalysis()
}

function resetAdjustments(): void {
  inverted.value = false
  repairRadius.value = 3
  rotation.value = 0
  autoCrop.value = true
  void runAnalysis(true)
}

function setPreviewMode(mode: typeof previewMode.value): void {
  previewMode.value = mode
  drawPreview()
}

function drawPreview(): void {
  const canvas = previewCanvas.value
  const result = analysis.value
  if (!canvas || !result) return
  canvas.width = result.raster.width
  canvas.height = result.raster.height
  const context = canvas.getContext('2d')
  if (!context) return
  if (previewMode.value === 'binary') {
    const data = new Uint8ClampedArray(result.foregroundMask.length * 4)
    result.foregroundMask.forEach((value, index) => {
      const color = value ? 25 : 255
      data[index * 4] = color
      data[index * 4 + 1] = color
      data[index * 4 + 2] = color
      data[index * 4 + 3] = 255
    })
    context.putImageData(new ImageData(data, result.raster.width, result.raster.height), 0, 0)
  } else {
    context.putImageData(new ImageData(result.raster.data.slice(), result.raster.width, result.raster.height), 0, 0)
    if (previewMode.value === 'overlay') {
      context.fillStyle = 'rgba(255,255,255,.28)'
      context.fillRect(0, 0, canvas.width, canvas.height)
    }
  }
  if (previewMode.value === 'original') return
  result.candidates.forEach((candidate) => {
    context.beginPath()
    candidate.points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y))
    context.closePath()
    context.lineWidth = candidate.id === selectedCandidateId.value ? Math.max(2, canvas.width / 500) : Math.max(1, canvas.width / 800)
    context.strokeStyle = candidate.id === selectedCandidateId.value ? '#1d8d70' : 'rgba(178,70,49,.7)'
    context.stroke()
  })
  const candidate = selectedCandidate.value
  if (candidate?.repairedPixels.length) {
    context.fillStyle = '#f29f32'
    candidate.repairedPixels.forEach((point) => context.fillRect(point.x, point.y, 1, 1))
  }
}

function selectFromPreview(event: MouseEvent): void {
  if (!analysis.value || !previewCanvas.value || previewMode.value === 'original') return
  const rect = previewCanvas.value.getBoundingClientRect()
  const scale = Math.min(
    rect.width / previewCanvas.value.width,
    rect.height / previewCanvas.value.height,
  )
  const renderedWidth = previewCanvas.value.width * scale
  const renderedHeight = previewCanvas.value.height * scale
  const offsetX = (rect.width - renderedWidth) / 2
  const offsetY = (rect.height - renderedHeight) / 2
  const x = (event.clientX - rect.left - offsetX) / scale
  const y = (event.clientY - rect.top - offsetY) / scale
  if (x < 0 || y < 0 || x > previewCanvas.value.width || y > previewCanvas.value.height) return
  const matches = analysis.value.candidates.filter((candidate) =>
    x >= candidate.bounds.x && x <= candidate.bounds.x + candidate.bounds.width
    && y >= candidate.bounds.y && y <= candidate.bounds.y + candidate.bounds.height,
  ).sort((left, right) => left.area - right.area)
  if (matches[0]) {
    selectedCandidateId.value = matches[0].id
    drawPreview()
  }
}

function goToCalibration(): void {
  if (!selectedCandidate.value) return
  step.value = 3
  const bounds = targetBounds.value
  dimensionValue.value = Number((bounds?.width ?? 0).toFixed(2))
}

function commit(): void {
  const result = calibrated.value
  if (!result) return
  processing.value = true
  try {
    store.commitImportedPath({
      nodes: result.nodes,
      widthCm: result.widthCm,
      heightCm: result.heightCm,
      targetShapeId: targetShape.value?.id ?? null,
      name: fileName.value.replace(/\.[^.]+$/, '') || '导入织片',
    })
    emit('imported')
  } finally {
    processing.value = false
  }
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  if (analysisTimer) clearTimeout(analysisTimer)
  analysisVersion += 1
})
</script>

<template>
  <div class="import-backdrop" role="presentation">
    <section class="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <header class="import-header">
        <div>
          <span class="eyebrow">IMPORT</span>
          <h2 id="import-title">导入线稿</h2>
        </div>
        <button type="button" class="import-close" aria-label="关闭导入" :disabled="processing" @click="close">×</button>
      </header>

      <ol class="import-steps" aria-label="导入步骤">
        <li :class="{ active: step === 1, done: step > 1 }"><b>1</b><span>选择图片</span></li>
        <li :class="{ active: step === 2, done: step > 2 }"><b>2</b><span>选择轮廓</span></li>
        <li :class="{ active: step === 3 }"><b>3</b><span>校准尺寸</span></li>
      </ol>

      <div class="import-body">
        <div v-if="step === 1 && !sourceRaster" class="import-dropzone" :class="{ active: dragActive }"
          @dragenter.prevent="dragActive = true" @dragover.prevent @dragleave.prevent="dragActive = false" @drop.prevent="onDrop">
          <div class="drop-icon">⌁</div>
          <h3>拖入清晰的闭合线稿</h3>
          <p>支持 PNG、JPG、WebP，最大 15 MB<br />推荐白底或透明底深色轮廓</p>
          <label class="primary-action">选择图片<input type="file" accept="image/png,image/jpeg,image/webp" @change="onFileInput" /></label>
        </div>

        <template v-else-if="analysis">
          <div class="import-workspace">
            <div class="import-preview-card">
              <div class="preview-toolbar">
                <div class="segmented-control compact">
                  <button :class="{ active: previewMode === 'original' }" @click="setPreviewMode('original')">原图</button>
                  <button :class="{ active: previewMode === 'binary' }" @click="setPreviewMode('binary')">黑白</button>
                  <button :class="{ active: previewMode === 'overlay' }" @click="setPreviewMode('overlay')">轮廓</button>
                </div>
                <small>{{ analysis.raster.width }} × {{ analysis.raster.height }} px</small>
              </div>
              <div class="preview-stage" :class="{ selectable: step === 2 }">
                <canvas ref="previewCanvas" @click="selectFromPreview" />
                <span v-if="processing" class="processing-cover">正在分析…</span>
              </div>
              <p class="preview-legend"><i class="selected" />选中轮廓 <i class="repair" />自动补线</p>
            </div>

            <aside v-if="step === 1" class="import-controls">
              <div class="control-heading"><b>{{ fileName }}</b><label class="text-action">更换图片<input type="file" accept="image/png,image/jpeg,image/webp" @change="onFileInput" /></label></div>
              <label class="range-control"><span>黑白阈值 <b>{{ threshold }}</b></span><input v-model.number="threshold" type="range" min="0" max="255" @input="scheduleAnalysis" /></label>
              <label class="range-control"><span>补线范围 <b>{{ repairRadius }} px</b></span><input v-model.number="repairRadius" type="range" min="0" max="8" @input="scheduleAnalysis" /></label>
              <label class="check-row"><input v-model="inverted" type="checkbox" @change="reanalyze" /><span>反转黑白</span></label>
              <label class="check-row"><input v-model="autoCrop" type="checkbox" @change="reanalyze" /><span>自动裁去空白</span></label>
              <div class="control-actions"><button type="button" @click="rotate">旋转 90°</button><button type="button" @click="resetAdjustments">重置</button></div>
              <div class="analysis-summary"><strong>{{ analysis.candidates.length }}</strong><span>个可用闭合轮廓</span><small>橙色位置会在导入前自动补线</small></div>
            </aside>

            <aside v-else-if="step === 2" class="import-controls candidate-panel">
              <h3>选择一个织片轮廓</h3>
              <p>点击预览中的轮廓，或从下面的候选列表选择。</p>
              <button v-for="(candidate, index) in analysis.candidates" :key="candidate.id" type="button"
                :class="['candidate-button', { active: candidate.id === selectedCandidateId }]"
                @click="selectedCandidateId = candidate.id; drawPreview()">
                <b>候选 {{ index + 1 }}</b>
                <span>{{ candidate.bounds.width }} × {{ candidate.bounds.height }} px</span>
                <small v-if="candidate.repairedPixels.length">含 {{ candidate.repairedPixels.length }} 个补线像素</small>
                <small v-else>轮廓完整</small>
              </button>
            </aside>

            <aside v-else class="import-controls calibration-panel">
              <h3>输入一个真实尺寸</h3>
              <div class="axis-switch segmented-control compact">
                <button :class="{ active: calibrationAxis === 'width' }" @click="calibrationAxis = 'width'">按宽度</button>
                <button :class="{ active: calibrationAxis === 'height' }" @click="calibrationAxis = 'height'">按高度</button>
              </div>
              <label class="dimension-field"><span>{{ calibrationAxis === 'width' ? '实际宽度' : '实际高度' }}</span><div><input v-model.number="dimensionValue" type="number" min="0.1" step="0.1" /><b>cm</b></div></label>
              <div v-if="calibrated" class="calibration-result">
                <span>导入尺寸</span><strong>{{ calibrated.widthCm.toFixed(2) }} × {{ calibrated.heightCm.toFixed(2) }} cm</strong>
                <small>约 {{ Math.round(calibrated.widthCm / gauge.stitchWidthCm) }} 针 × {{ Math.round(calibrated.heightCm / gauge.rowHeightCm) }} 行</small>
              </div>
              <p v-if="calibrated?.isComplex" class="import-warning">轮廓较复杂，已在 48 个锚点内尽量拟合；导入后请检查局部曲线。</p>
              <div class="commit-summary">
                <p><span>导入方式</span><b>{{ targetShape ? `替换“${targetShape.name ?? '未命名图形'}”` : '新增导入织片' }}</b></p>
                <p><span>画布</span><b>{{ resultingFabric.widthCm }} × {{ resultingFabric.heightCm }} cm</b></p>
              </div>
              <p v-if="fabricWillExpand" class="import-warning">为保留真实尺寸，确认后会扩大画布；现有图形不会移动。</p>
            </aside>
          </div>
        </template>

        <p v-if="errorMessage" class="import-error" role="alert">{{ errorMessage }}</p>
      </div>

      <footer class="import-footer">
        <button type="button" class="secondary-action" :disabled="processing" @click="step === 1 ? close() : step = (step - 1) as 1 | 2">{{ step === 1 ? '取消' : '上一步' }}</button>
        <button v-if="step === 1" type="button" class="primary-action" :disabled="processing || !analysis?.candidates.length" @click="step = 2; nextTick(drawPreview)">下一步</button>
        <button v-else-if="step === 2" type="button" class="primary-action" :disabled="!selectedCandidate" @click="goToCalibration">校准尺寸</button>
        <button v-else type="button" class="primary-action" :disabled="processing || !calibrated" @click="commit">确认导入</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.import-backdrop { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 22px; background: rgba(24,33,29,.66); backdrop-filter: blur(4px); }
.import-dialog { width: min(980px, 100%); max-height: min(820px, calc(100dvh - 44px)); display: flex; flex-direction: column; overflow: hidden; border: 1px solid #c8c0b3; border-radius: 14px; background: #faf8f3; box-shadow: 0 24px 70px rgba(20,29,25,.3); }
.import-header { min-height: 68px; padding: 14px 18px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #d8d1c5; }
.import-header h2 { margin: 0; color: #24352f; font-size: 18px; }
.import-close { width: 34px; height: 34px; border: 0; border-radius: 8px; color: #70756f; background: transparent; cursor: pointer; font-size: 24px; }
.import-close:hover { background: #ebe7df; }
.import-steps { margin: 0; padding: 13px 22px; display: grid; grid-template-columns: repeat(3, 1fr); list-style: none; border-bottom: 1px solid #ded8cd; background: #f2eee7; }
.import-steps li { position: relative; display: flex; align-items: center; justify-content: center; gap: 7px; color: #969087; font-size: 10px; }
.import-steps li:not(:last-child)::after { content: ''; position: absolute; width: 35%; height: 1px; right: -18%; background: #cec7bb; }
.import-steps b { width: 22px; height: 22px; display: grid; place-items: center; border: 1px solid #c9c1b5; border-radius: 50%; background: #faf8f3; }
.import-steps .active { color: #287d72; font-weight: 700; }
.import-steps .active b, .import-steps .done b { color: white; border-color: #287d72; background: #287d72; }
.import-body { min-height: 390px; flex: 1 1 auto; padding: 18px; overflow: auto; }
.import-dropzone { min-height: 360px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1.5px dashed #bbb2a4; border-radius: 12px; background: #f5f1e9; text-align: center; transition: .15s; }
.import-dropzone.active { border-color: #287d72; background: #e9f1ed; }
.drop-icon { width: 58px; height: 58px; display: grid; place-items: center; border-radius: 16px; color: #287d72; background: #dce9e3; font-size: 30px; }
.import-dropzone h3, .import-controls h3 { margin: 14px 0 5px; color: #263d36; font-size: 15px; }
.import-dropzone p, .candidate-panel > p { margin: 0 0 18px; color: #7a766e; font-size: 10px; line-height: 1.7; }
.primary-action, .secondary-action { min-width: 92px; height: 36px; padding: 0 14px; display: inline-grid; place-items: center; border-radius: 8px; cursor: pointer; font-size: 10px; font-weight: 700; }
.primary-action { border: 1px solid #203a32; color: #fff; background: #263d36; }
.secondary-action { border: 1px solid #cec6ba; color: #60655f; background: #fffdf8; }
.primary-action:disabled, .secondary-action:disabled { cursor: default; opacity: .4; }
.primary-action input, .text-action input { display: none; }
.import-workspace { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 16px; }
.import-preview-card, .import-controls { min-width: 0; border: 1px solid #d8d1c5; border-radius: 10px; background: #fffdf8; }
.preview-toolbar { height: 45px; padding: 7px 10px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #e0dacf; }
.preview-toolbar small { color: #918a80; font-size: 9px; }
.preview-stage { position: relative; height: 390px; display: grid; place-items: center; overflow: hidden; background-color: #e9e4db; background-image: linear-gradient(45deg,#ddd7cd 25%,transparent 25%),linear-gradient(-45deg,#ddd7cd 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ddd7cd 75%),linear-gradient(-45deg,transparent 75%,#ddd7cd 75%); background-size: 16px 16px; background-position: 0 0,0 8px,8px -8px,-8px 0; }
.preview-stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; min-width: 0; min-height: 0; display: block; object-fit: contain; }
.preview-stage.selectable canvas { cursor: crosshair; }
.processing-cover { position: absolute; inset: 0; display: grid; place-items: center; color: white; background: rgba(31,49,42,.55); font-size: 12px; }
.preview-legend { height: 32px; margin: 0; padding: 8px 11px; color: #77736c; border-top: 1px solid #e0dacf; font-size: 9px; }
.preview-legend i { width: 10px; height: 3px; display: inline-block; margin: 0 4px 2px 9px; }
.preview-legend i:first-child { margin-left: 0; }.preview-legend .selected { background: #1d8d70; }.preview-legend .repair { background: #f29f32; }
.import-controls { padding: 15px; overflow: auto; }
.control-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid #e4ded4; font-size: 10px; }
.control-heading b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.text-action { flex: 0 0 auto; color: #287d72; cursor: pointer; font-size: 9px; }
.range-control { display: block; margin-top: 16px; }.range-control span { display: flex; justify-content: space-between; color: #666c66; font-size: 10px; }.range-control input { width: 100%; accent-color: #287d72; }
.check-row { margin-top: 13px; display: flex; align-items: center; gap: 8px; color: #666c66; font-size: 10px; }.check-row input { accent-color: #287d72; }
.control-actions { margin-top: 15px; display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }.control-actions button { height: 32px; border: 1px solid #d2cabf; border-radius: 7px; background: #f7f3ec; cursor: pointer; font-size: 9px; }
.analysis-summary { margin-top: 16px; padding: 13px; border-radius: 8px; color: #dfe9e4; background: #2a433a; }.analysis-summary strong { margin-right: 5px; color: white; font-size: 18px; }.analysis-summary span, .analysis-summary small { font-size: 9px; }.analysis-summary small { display: block; margin-top: 5px; color: #adc0b8; }
.candidate-panel h3, .calibration-panel h3 { margin-top: 0; }
.candidate-button { width: 100%; margin-top: 8px; padding: 10px; display: grid; grid-template-columns: 1fr auto; gap: 3px 8px; border: 1px solid #ddd6cb; border-radius: 8px; color: #626862; background: #faf8f3; text-align: left; cursor: pointer; }.candidate-button b { color: #33463f; font-size: 10px; }.candidate-button span, .candidate-button small { font-size: 8px; }.candidate-button small { grid-column: 1 / -1; color: #918a80; }.candidate-button.active { border-color: #3b8b77; background: #eaf3ef; box-shadow: 0 0 0 2px rgba(59,139,119,.1); }
.axis-switch { width: 100%; margin: 10px 0 15px; }.axis-switch button { flex: 1; }
.dimension-field > span { display: block; margin-bottom: 5px; color: #77756f; font-size: 10px; }.dimension-field > div { position: relative; }.dimension-field input { width: 100%; height: 38px; padding: 0 42px 0 10px; border: 1px solid #d8d1c5; border-radius: 7px; background: #fff; }.dimension-field b { position: absolute; right: 10px; top: 12px; color: #999187; font-size: 9px; }
.calibration-result { margin-top: 14px; padding: 12px; border-radius: 8px; background: #ece8df; }.calibration-result span, .calibration-result small { display: block; color: #777b75; font-size: 9px; }.calibration-result strong { display: block; margin: 4px 0; color: #263d36; font-size: 14px; }
.commit-summary { margin-top: 14px; padding-top: 10px; border-top: 1px solid #e1dbd1; }.commit-summary p { margin: 7px 0; display: flex; justify-content: space-between; gap: 8px; font-size: 9px; }.commit-summary span { color: #878078; }.commit-summary b { color: #3d4944; text-align: right; }
.import-warning, .import-error { padding: 9px 10px; border-radius: 7px; color: #914431; background: #f8e4de; font-size: 9px; line-height: 1.55; }.import-error { margin: 12px 0 0; }
.import-footer { min-height: 64px; padding: 12px 18px; display: flex; align-items: center; justify-content: flex-end; gap: 9px; border-top: 1px solid #d8d1c5; background: #f5f2eb; }
@media (max-width: 700px) {
  .import-backdrop { padding: 0; }.import-dialog { width: 100%; height: 100dvh; max-height: none; border: 0; border-radius: 0; }.import-body { padding: 12px; }.import-workspace { grid-template-columns: 1fr; }.preview-stage { height: 310px; }.import-controls { max-height: none; }.import-steps { padding-inline: 10px; }.import-steps li:not(:last-child)::after { display: none; }
}
</style>
