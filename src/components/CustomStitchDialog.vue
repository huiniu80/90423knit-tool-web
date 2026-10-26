<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEditorStore } from '../stores/editor'
import type { StitchDefinition } from '../core/drawing/types'
import { uid } from '../core/drawing/drawing'
import StitchSymbol from './StitchSymbol.vue'
import { centerSymbol } from '../core/drawing/stitches'
const props = defineProps<{ source?: StitchDefinition }>()
const emit = defineEmits<{ close: [] }>()
const store = useEditorStore()
const name = ref(props.source ? `${props.source.name}（新版）` : '')
const color = ref(props.source?.color ?? '#C4AAA7')
const span = ref(props.source?.span ?? 1), input = ref(props.source?.input ?? 1), output = ref(props.source?.output ?? 1)
const steps = ref(props.source?.steps.join('\n') ?? '')
const paths = ref<number[][]>(props.source ? structuredClone(JSON.parse(JSON.stringify(props.source.paths))) : [])
const pen = ref<number[]>([])
let pointerId: number | null = null
const definition = computed<StitchDefinition>(() => ({ id: uid(), name: name.value.trim(), color: color.value, span: span.value, input: input.value, output: output.value, paths: centerSymbol(paths.value), steps: steps.value.split('\n').map(s => s.trim()).filter(Boolean), kind: 'custom', custom: true }))
const error = computed(() => !definition.value.name ? '请填写中文名称。' : !definition.value.steps.length ? '请填写操作步骤。' : !paths.value.length ? '请绘制黑色针法符号。' : ![span.value, input.value, output.value].every(Number.isInteger) || span.value < 1 || span.value > 24 || input.value < 0 || input.value > 24 || output.value < 0 || output.value > 24 || input.value + output.value === 0 ? '占格为 1–24，输入和输出为 0–24 针，不能同时为零。' : store.drawingDefinitions.has(definition.value.name) || [...store.drawingDefinitions.values()].some(s => s.name === definition.value.name) ? '名称已使用，请换一个名称。' : '')
function point(e: PointerEvent) { const rect = (e.currentTarget as SVGElement).getBoundingClientRect(); return [Math.max(2, Math.min(98, (e.clientX - rect.left) / rect.width * 100)), Math.max(2, Math.min(98, (e.clientY - rect.top) / rect.height * 100))] }
function down(e: PointerEvent) { if (pointerId !== null) { pen.value = []; return } e.preventDefault(); pointerId = e.pointerId; try { (e.currentTarget as Element).setPointerCapture(e.pointerId) } catch { /* Cancelled pointers still roll back through end. */ } pen.value = point(e) }
function move(e: PointerEvent) { if (pointerId === e.pointerId) pen.value.push(...point(e)) }
function end(e: PointerEvent) { if (pointerId !== e.pointerId) return; if (e.type === 'pointerup' && pen.value.length >= 4) paths.value.push([...pen.value]); pen.value = []; pointerId = null }
function save() { if (!error.value) { store.saveCustomStitch(definition.value); emit('close') } }
</script>
<template>
  <div class="drawing-modal-backdrop" @click.self="emit('close')">
    <section class="drawing-modal" role="dialog" aria-modal="true" aria-label="自定义针法">
      <header><h2>自定义针法</h2><button @click="emit('close')">取消</button></header>
      <p v-if="source">另存新版，已有图解继续使用原定义。</p>
      <label>中文名称<input v-model="name" maxlength="80" /></label>
      <div class="drawing-fields"><label>占用格数<input v-model.number="span" type="number" min="1" max="24" /></label><label>消耗针数<input v-model.number="input" type="number" min="0" max="24" /></label><label>生成针数<input v-model.number="output" type="number" min="0" max="24" /></label></div>
      <p>针数变化：{{ output - input > 0 ? '+' : '' }}{{ output - input }} 针。占格只决定图符范围。</p>
      <label>底色<input v-model="color" type="color" /></label>
      <label>操作步骤（每行一步）<textarea v-model="steps" rows="4" maxlength="10000" /></label>
      <p>用手指、笔或鼠标画黑色符号</p>
      <svg class="symbol-pad" viewBox="0 0 100 100" :style="{ background: color }" @pointerdown="down" @pointermove="move" @pointerup="end" @pointercancel="end" @lostpointercapture="end">
        <polyline v-for="(p, i) in [...paths, pen]" :key="i" :points="p.join(' ')" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <div class="drawing-buttons"><button :disabled="!paths.length" @click="paths.pop()">撤销一笔</button><button @click="paths = []">清除符号</button><StitchSymbol :definition="definition" /></div>
      <p role="status">{{ error || '预览确认后添加到针法库，可用于主图解和花样小样。' }}</p>
      <button class="primary" :disabled="!!error" @click="save">确认添加针法</button>
    </section>
  </div>
</template>
<style scoped>.symbol-pad { display: block; width: 220px; height: 180px; border: 1px solid #b2a89a; touch-action: none; }</style>
