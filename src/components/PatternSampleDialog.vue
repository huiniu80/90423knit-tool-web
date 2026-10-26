<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useEditorStore } from '../stores/editor'
import type { PatternSample, StitchMark } from '../core/drawing/types'
import { cells, replaceMarks, uid } from '../core/drawing/drawing'
import { drawStitch } from '../core/drawing/stitches'
import StitchSymbol from './StitchSymbol.vue'
const props = defineProps<{ source?: PatternSample; placementId?: string }>()
const emit = defineEmits<{ close: [] }>()
const store = useEditorStore()
const name = ref(props.source?.name ?? '我的花样小样')
const width = ref(props.source?.width ?? 8), height = ref(props.source?.height ?? 8)
const marks = ref<StitchMark[]>(JSON.parse(JSON.stringify(props.source?.marks ?? [])))
const canvas = ref<HTMLCanvasElement | null>(null)
const erasing = ref(false), showColors = ref(false)
const history = ref<StitchMark[][]>([])
let pointerId: number | null = null, backup: StitchMark[] = []
const error = computed(() => !name.value.trim() ? '请填写花样名称。' : !Number.isInteger(width.value) || !Number.isInteger(height.value) || width.value < 1 || width.value > 64 || height.value < 1 || height.value > 64 ? '小样宽高为 1–64 格。' : marks.value.some(m => m.x + store.drawingDefinitions.get(m.stitchId)!.span > width.value || m.y >= height.value) ? '缩小会截断已有针法，请先擦除超出范围的完整针法。' : '')
function render() {
  const c = canvas.value; if (!c) return
  const w = Math.min(64, Math.max(1, width.value || 1)), h = Math.min(64, Math.max(1, height.value || 1))
  c.width = w * 48; c.height = h * 48
  const ctx = c.getContext('2d')!; ctx.fillStyle = '#fffdf8'; ctx.fillRect(0, 0, c.width, c.height)
  for (const m of marks.value) drawStitch(ctx, store.drawingDefinitions.get(m.stitchId)!, m.x * 48, (h - m.y - 1) * 48, store.drawingDefinitions.get(m.stitchId)!.span * 48, 48)
  ctx.strokeStyle = '#c9c2b7'; ctx.lineWidth = 1
  ctx.beginPath(); for (let x = 0; x <= w; x++) { ctx.moveTo(x * 48, 0); ctx.lineTo(x * 48, h * 48) } for (let y = 0; y <= h; y++) { ctx.moveTo(0, y * 48); ctx.lineTo(w * 48, y * 48) } ctx.stroke()
}
function paint(e: PointerEvent) {
  const c = canvas.value!, rect = c.getBoundingClientRect(); const x = Math.floor((e.clientX - rect.left) / rect.width * width.value), y = height.value - 1 - Math.floor((e.clientY - rect.top) / rect.height * height.value)
  if (x < 0 || y < 0 || y >= height.value || x >= width.value) return
  if (erasing.value) marks.value = marks.value.filter(m => !cells(m, store.drawingDefinitions).includes(`${x},${y}`))
  else if (x + store.drawingDefinitions.get(store.activeStitchId)!.span <= width.value) marks.value = replaceMarks(marks.value, [{ id: uid(), x, y, stitchId: store.activeStitchId }], store.drawingDefinitions)
}
function down(e: PointerEvent) { if (pointerId !== null) { marks.value = backup; pointerId = null; return } pointerId = e.pointerId; backup = JSON.parse(JSON.stringify(marks.value)); try { (e.currentTarget as Element).setPointerCapture(e.pointerId) } catch { /* Pointer cancellation restores backup. */ } paint(e) }
function move(e: PointerEvent) { if (pointerId === e.pointerId) paint(e) }
function end(e: PointerEvent) { if (pointerId !== e.pointerId) return; if (e.type === 'pointerup') history.value.push(backup); else marks.value = backup; pointerId = null }
function save() {
  if (error.value) return
  const sample: PatternSample = { id: props.source?.id ?? uid(), name: name.value.trim(), width: width.value, height: height.value, marks: marks.value }
  if (props.placementId) store.startPlacement(sample, props.placementId); else store.saveSample(sample)
  emit('close')
}
watch([marks, width, height], () => nextTick(render), { deep: true }); onMounted(render)
</script>
<template>
  <div class="drawing-modal-backdrop" @click.self="emit('close')">
    <section class="drawing-modal wide" role="dialog" aria-modal="true" aria-label="编辑花样小样">
      <header><h2>{{ placementId ? '编辑花样副本' : '绘制花样小样' }}</h2><button @click="emit('close')">取消</button></header>
      <label>名称<input v-model="name" maxlength="80" /></label>
      <div class="drawing-fields"><label>宽（针格）<input v-model.number="width" type="number" min="1" max="64" /></label><label>高（行）<input v-model.number="height" type="number" min="1" max="64" /></label></div>
      <p>原点在左下角；空白为透明。花样小样不会改变编织密度。</p>
      <div class="drawing-buttons"><StitchSymbol :definition="store.drawingDefinitions.get(store.activeStitchId)!" /><button @click="showColors = !showColors">选择针法：{{ store.drawingDefinitions.get(store.activeStitchId)?.name }}</button><button :class="{ active: erasing }" @click="erasing = !erasing">{{ erasing ? '切回绘制' : '擦除' }}</button><button :disabled="!history.length" @click="marks = history.pop()!">撤销</button></div>
      <div v-if="showColors" class="stitch-library-grid"><button v-for="d in store.drawingDefinitions.values()" :key="d.id" @click="store.activeStitchId = d.id; erasing = false"><StitchSymbol :definition="d" /><span>{{ d.name }}</span></button></div>
      <div class="sample-scroll"><canvas ref="canvas" aria-label="花样小样针格" @pointerdown="down" @pointermove="move" @pointerup="end" @pointercancel="end" @lostpointercapture="end" /></div>
      <p role="status">{{ error || `已填写 ${marks.length} 个操作；预览后确认保存。` }}</p>
      <button class="primary" :disabled="!!error || !marks.length || pointerId !== null" @click="save">{{ placementId ? '预览副本修改' : '确认保存小样' }}</button>
    </section>
  </div>
</template>
<style scoped>.sample-scroll { max-height: 45vh; overflow: auto; padding: 8px; } canvas { display: block; touch-action: none; } </style>
