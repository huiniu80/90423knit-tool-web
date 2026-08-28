<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { instructionToText } from '../core/knitting/planner'
import { useEditorStore } from '../stores/editor'

const store = useEditorStore()
const { direction, instructions, hasSeparatedRegions } = storeToRefs(store)

const totalStitches = computed(() =>
  instructions.value.reduce((sum, item) => sum + item.stitchCount, 0),
)

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
</script>

<template>
  <section class="instructions-panel">
    <div class="instructions-header">
      <div>
        <span class="eyebrow">KNITTING PLAN</span>
        <h2>逐行编织指令</h2>
      </div>
      <div class="instruction-summary">
        <span><b>{{ instructions.length }}</b> 行</span>
        <span><b>{{ totalStitches }}</b> 累计针次</span>
      </div>
      <div class="segmented-control direction-control">
        <button :class="{ active: direction === 'bottom-up' }" @click="direction = 'bottom-up'">↑ 从下往上</button>
        <button :class="{ active: direction === 'top-down' }" @click="direction = 'top-down'">↓ 从上往下</button>
      </div>
    </div>

    <div v-if="hasSeparatedRegions" class="warning-banner">
      当前轮廓包含分离编织区域；针格仍已保留，V1 暂不自动生成分针操作。
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
      <div v-else class="empty-instructions">创建图形后，逐行针法会在这里实时生成。</div>
    </div>
  </section>
</template>
