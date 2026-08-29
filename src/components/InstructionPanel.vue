<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { generateEdgeShapingPlan, instructionToText } from '../core/knitting/planner'
import type { EdgeShapingPlan, ShapingOperation } from '../core/knitting/planner.types'
import { useEditorStore } from '../stores/editor'

const store = useEditorStore()
const isOpen = ref(false)
const {
  direction,
  instructions,
  hasSeparatedRegions,
  selectedPlanShapeId,
  selectedShapePlan,
  shapePlans,
} = storeToRefs(store)

const totalStitches = computed(() => selectedShapePlan.value?.totalStitches ?? 0)
const edgeShapingPlans = computed(() => [
  generateEdgeShapingPlan(instructions.value, 'left'),
  generateEdgeShapingPlan(instructions.value, 'right'),
])

function togglePanel(): void {
  isOpen.value = !isOpen.value
}

function closePanel(): void {
  isOpen.value = false
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && isOpen.value) closePanel()
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown))

const typeLabels = {
  rectangle: '矩形',
  triangle: '三角形',
  circle: '圆形',
  ellipse: '椭圆',
  polygon: '多边形',
  path: '路径',
}

function planLabel(plan: (typeof shapePlans.value)[number]): string {
  return `${plan.shapeName || '未命名图形'} · ${typeLabels[plan.shapeType]}`
}

function rangeText(index: number): string {
  const instruction = instructions.value[index]
  if (!instruction?.segments.length) return '—'
  return instruction.segments
    .map((segment) => `${segment.startStitch + 1}–${segment.endStitch + 1}`)
    .join(', ')
}

function changeText(value: number): string {
  if (value > 0) return `+${value}`
  return value === 0 ? '—' : String(value)
}

function operationLabel(operation: ShapingOperation): string {
  return operation === 'increase' ? '加针' : '减针'
}

function ruleText(rule: EdgeShapingPlan['rules'][number]): string {
  return `${rule.everyRows}-${rule.stitchCount}-${rule.repeatCount}`
}

function planTotalText(plan: EdgeShapingPlan): string {
  const changes = []
  if (plan.totalIncreasedStitches) changes.push(`加 ${plan.totalIncreasedStitches} 针`)
  if (plan.totalDecreasedStitches) changes.push(`减 ${plan.totalDecreasedStitches} 针`)
  return changes.length ? `共 ${plan.totalRows} 行 · ${changes.join(' · ')}` : '全程不加不减'
}
</script>

<template>
  <section :class="['instructions-panel', { open: isOpen }]" aria-label="逐行编织指令">
    <button class="instruction-drawer-toggle" type="button" :aria-expanded="isOpen"
      aria-controls="instruction-drawer-content" @click="togglePanel">
      <span class="drawer-toggle-title"><span aria-hidden="true">≡</span><b>逐行编织指令</b></span>
      <span class="drawer-toggle-count">{{ instructions.length }} 行</span>
      <span class="drawer-toggle-action">{{ isOpen ? '收起' : '展开' }} <span aria-hidden="true">{{ isOpen ? '⌄' : '⌃' }}</span></span>
    </button>

    <div v-show="isOpen" id="instruction-drawer-content" class="instruction-drawer-content">
      <div class="instructions-header">
        <div>
          <span class="eyebrow">KNITTING PLAN</span>
          <h2>逐行编织指令</h2>
        </div>
        <label v-if="shapePlans.length" class="plan-shape-select">
          <span>输出对象</span>
          <select v-model="selectedPlanShapeId">
            <option v-for="plan in shapePlans" :key="plan.shapeId" :value="plan.shapeId">
              {{ planLabel(plan) }}
            </option>
          </select>
        </label>
        <div class="instruction-summary">
          <span><b>{{ instructions.length }}</b> 行</span>
          <span><b>{{ totalStitches }}</b> 累计针次</span>
        </div>
        <div class="segmented-control direction-control">
          <button :class="{ active: direction === 'bottom-up' }" @click="direction = 'bottom-up'">↑ 从下往上</button>
          <button :class="{ active: direction === 'top-down' }" @click="direction = 'top-down'">↓ 从上往下</button>
        </div>
        <button class="instruction-drawer-close" type="button" aria-label="关闭逐行编织指令" title="关闭"
          @click="closePanel">×</button>
      </div>

      <div v-if="hasSeparatedRegions" class="warning-banner">
        当前对象包含分离编织区域；针格仍已保留，暂不自动生成分针操作。
      </div>

      <div v-if="instructions.length" class="shaping-rules-panel">
        <div class="shaping-rules-heading">
          <b>加减针规律</b>
          <span><code>x-y-z</code> = 每 x 行加/减 y 针，共 z 次</span>
        </div>
        <div class="edge-rule-list">
          <div v-for="plan in edgeShapingPlans" :key="plan.side" class="edge-rule-row">
            <span class="edge-rule-side">{{ plan.side === 'left' ? '左侧边界' : '右侧边界' }}</span>
            <div v-if="plan.supported && plan.rules.length" class="edge-rule-codes">
              <span v-for="(rule, index) in plan.rules" :key="`${rule.operation}-${index}`"
                :class="rule.operation === 'increase' ? 'plus' : 'minus'">
                {{ operationLabel(rule.operation) }} <code>{{ ruleText(rule) }}</code><template v-if="index < plan.rules.length - 1">,</template>
              </span>
            </div>
            <span v-else-if="plan.supported" class="edge-rule-empty">不加不减</span>
            <span v-else class="edge-rule-empty">分离区域暂不支持归纳</span>
            <span v-if="plan.supported" class="edge-rule-total">{{ planTotalText(plan) }}</span>
          </div>
        </div>
      </div>

      <div class="instruction-table-wrap">
        <table v-if="instructions.length" class="instruction-table">
          <thead><tr><th>行号</th><th>物理行</th><th>针数</th><th>有效针范围</th><th>左侧</th><th>右侧</th><th>操作说明</th></tr></thead>
          <tbody>
            <tr v-for="(instruction, index) in instructions" :key="`${direction}-${instruction.sourceRowIndex}`"
              :class="{ unsupported: !instruction.supported }">
              <td><span class="row-number">{{ instruction.rowNumber }}</span></td>
              <td>{{ instruction.sourceRowIndex + 1 }}</td>
              <td><strong>{{ instruction.stitchCount }}</strong></td>
              <td><code>{{ rangeText(index) }}</code></td>
              <td :class="{ plus: instruction.leftChange > 0, minus: instruction.leftChange < 0 }">{{ changeText(instruction.leftChange) }}</td>
              <td :class="{ plus: instruction.rightChange > 0, minus: instruction.rightChange < 0 }">{{ changeText(instruction.rightChange) }}</td>
              <td>{{ instructionToText(instruction) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else-if="!shapePlans.length" class="empty-instructions">创建图形后，逐行针法会在这里实时生成。</div>
        <div v-else class="empty-instructions">当前对象没有落在画布针格内。</div>
      </div>
    </div>
  </section>
</template>
