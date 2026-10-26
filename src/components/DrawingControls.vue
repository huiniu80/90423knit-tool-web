<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEditorStore } from '../stores/editor'
import { calculateDrawing } from '../core/drawing/calculation'
import { intersects } from '../core/drawing/drawing'
import type { DrawingTool } from '../core/drawing/types'
import StitchSymbol from './StitchSymbol.vue'
const emit = defineEmits<{ library: [] }>()
const store = useEditorStore(), showRows = ref(false)
const calculation = computed(() => calculateDrawing(store.drawing, store.shapePlans, store.gauge, store.fabricGrid))
const replacements = computed(() => {
  const p = store.placementPreview
  return p ? store.drawingMarks.filter(old => p.marks.some(m => intersects(old, { ...m, x: m.x + p.x, y: m.y + p.y }, store.drawingDefinitions))).length : 0
})
function tool(id: DrawingTool) { store.cancelDrawingPreview(); store.drawingTool = id; store.activeTool = 'stitch' }
function position(axis: 'x' | 'y', e: Event) { const n = Number((e.target as HTMLInputElement).value); if (store.placementPreview && Number.isInteger(n) && n >= 1) store.placementPreview[axis] = n - 1 }
</script>
<template>
  <section class="drawing-controls" aria-label="绘图工具">
    <div class="drawing-buttons"><StitchSymbol :definition="store.drawingDefinitions.get(store.activeStitchId)!" /><button @click="emit('library')">针法库 · {{ store.drawingDefinitions.get(store.activeStitchId)?.name }}</button><button :class="{ active: store.activeTool === 'stitch' && store.drawingTool === 'paint' }" @click="tool('paint')">填针法</button><button :class="{ active: store.activeTool === 'stitch' && store.drawingTool === 'erase' }" @click="tool('erase')">擦除</button><button :class="{ active: store.activeTool === 'stitch' && store.drawingTool === 'sample' }" @click="tool('sample')">框选成小样</button><button @click="store.contourPreview = !store.contourPreview">{{ store.contourPreview ? '收起轮廓预览' : '预览填充边缘' }}</button><button @click="showRows = !showRows">{{ showRows ? '收起针数核对' : '针数核对' }}</button></div>
    <label class="convention-label">图符读法<select :value="store.drawing.convention ?? ''" @change="store.setDrawingConvention(($event.target as HTMLSelectElement).value as 'appearance' | 'operation')"><option disabled value="">请选择正反面表达方式</option><option value="appearance">表示正面外观，反面行反读上下针</option><option value="operation">表示每行实际执行的针法</option></select></label>
    <p v-if="store.drawing.convention === 'appearance'">图符表示织物正面外观：平针各行画下针，正面织下针、反面织上针。逐行表显示实际操作。</p>
    <p>单指或笔填格，双指平移缩放；路径工具可随时改轮廓。未填写的轮廓内针格按下针核对。</p>
    <div v-if="store.contourPreview" class="drawing-preview-banner" role="status"><span>沿填充生成 {{ store.contourCandidate.loops.length }} 个轮廓，内部补 {{ store.contourCandidate.automatic.length }} 针下针；保留手绘路径。</span><button :disabled="!store.contourCandidate.loops.length" @click="store.generateDrawingContours()">确认生成／更新轮廓</button><button @click="store.contourPreview = false">取消</button></div>
    <div v-if="store.placementPreview" class="drawing-preview-banner" role="status"><strong>放置预览 · {{ store.placementPreview.name }}</strong><span>红框为替换位置：{{ replacements }} 个完整操作。点击或拖动针格定位。</span><div class="drawing-fields"><label>起始针格<input type="number" min="1" :value="store.placementPreview.x + 1" @change="position('x', $event)" /></label><label>起始行<input type="number" min="1" :value="store.placementPreview.y + 1" @change="position('y', $event)" /></label></div><button @click="store.confirmPlacement()">{{ replacements ? '确认覆盖并放置' : '确认放置' }}</button><button @click="store.cancelDrawingPreview()">取消预览</button></div>
    <details v-if="calculation.issues.length" class="drawing-issues"><summary>需要核对 {{ calculation.issues.length }} 项</summary><p v-for="issue in calculation.issues.slice(0, 20)" :key="issue">{{ issue }}</p></details>
    <div v-if="showRows" class="drawing-row-check"><p>每行先处理边缘变化，再执行针法。花样内部变化只计一次；图解格宽与实际产出针数分别显示。{{ store.drawing.convention === 'appearance' ? '片织从下往上，奇数行右往左、偶数行左往右；反面行上下针互换。其他动作须结合各针法说明。' : '片织从下往上，奇数行右往左、偶数行左往右，符号直接表示动作。' }}</p><article v-for="piece in calculation.pieces" :key="piece.id"><h3>{{ piece.name }}</h3><div class="drawing-table-scroll"><table><thead><tr><th>编织行（画布行）</th><th>图解格</th><th>消耗</th><th>产出</th><th>内部增减</th><th>边缘增减／起针</th><th>针法及核对</th></tr></thead><tbody><tr v-for="row in piece.rows" :key="row.row"><td>{{ row.row }}（{{ row.canvasRow }}）</td><td>{{ row.cells }}</td><td>{{ row.input }}</td><td>{{ row.output }}</td><td>{{ row.internalDelta }}</td><td>{{ row.edgeDelta }}</td><td>{{ row.actions.join('；') || '下针' }} {{ row.error }}</td></tr></tbody></table></div></article></div>
  </section>
</template>
