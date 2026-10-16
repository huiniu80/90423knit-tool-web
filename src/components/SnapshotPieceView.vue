<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import type { SnapshotPiece } from '../core/knitting/calculationSnapshot'
import { rowOperationToText } from '../core/knitting/rowOperations'
const props = defineProps<{ piece: SnapshotPiece }>()
const gridOpen = ref(false), rowsOpen = ref(false)
const patternId = useId().replace(/[^a-z0-9]/gi, '')
const grid = computed(() => {
  const segments = props.piece.rasterRows.flatMap(r => r.segments)
  const left = segments.reduce((min, s) => Math.min(min, s.startStitch), Infinity)
  const right = segments.reduce((max, s) => Math.max(max, s.endStitch), -Infinity)
  const low = props.piece.rasterRows[0]?.rowIndex ?? 0
  const high = props.piece.rasterRows.at(-1)?.rowIndex ?? low
  return { left, right, low, high, width: (right - left + 1) * 8, height: (high - low + 1) * 8 }
})
</script>
<template>
  <p>{{ piece.status || `整体目标 ${piece.stitches} 针 × ${piece.rows} 行；实际编织 ${piece.instructions.length} 行` }}</p>
  <p>成衣外观 {{ piece.appearance.width.toFixed(2) }} × {{ piece.appearance.height.toFixed(2) }} cm<br />取整尺寸 {{ piece.rounded.width.toFixed(2) }} × {{ piece.rounded.height.toFixed(2) }} cm<br />宽误差 {{ (piece.rounded.width - piece.appearance.width).toFixed(2) }} cm · 高误差 {{ (piece.rounded.height - piece.appearance.height).toFixed(2) }} cm</p>
  <details v-if="piece.rasterRows.length" @toggle="gridOpen = ($event.target as HTMLDetailsElement).open">
    <summary>查看针格（可滚动）</summary>
    <template v-if="gridOpen">
      <p>针号 {{ grid.left + 1 }}-{{ grid.right + 1 }}，编织行 1-{{ grid.high - grid.low + 1 }}，自下而上。<br />格原点 X {{ (piece.rasterRows[0]?.originXCm ?? 0).toFixed(4) }} cm；每格一针一行。</p>
      <div class="history-grid-scroll"><svg :width="grid.width" :height="grid.height" role="img" :aria-label="`${piece.name}针格，自下而上`">
        <defs><pattern :id="patternId" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M 8 0 L 0 0 0 8" fill="none" stroke="#8a8a8a" stroke-width="0.5" /></pattern></defs>
        <g v-for="row in piece.rasterRows" :key="row.rowIndex"><rect v-for="segment in row.segments" :key="segment.startStitch" :x="(segment.startStitch - grid.left) * 8" :y="(grid.high - row.rowIndex) * 8" :width="(segment.endStitch - segment.startStitch + 1) * 8" height="8" fill="#88afa1" /></g>
        <rect :width="grid.width" :height="grid.height" :fill="`url(#${patternId})`" />
      </svg></div>
    </template>
  </details>
  <details v-if="piece.instructions.length" @toggle="rowsOpen = ($event.target as HTMLDetailsElement).open">
    <summary>查看完整逐行操作表</summary>
    <template v-if="rowsOpen"><div v-for="row in piece.instructions" :key="row.rowNumber" class="row-plan-row">
      <b>第 {{ row.rowNumber }} 行 · {{ row.stitchCount }} 针</b><p>针位 {{ row.segments.map(s => `${s.startStitch + 1}-${s.endStitch + 1}`).join('、') }}</p>
      <p>{{ row.operations?.map(rowOperationToText).join('；') || '不加不减' }}</p>
      <p v-if="row.transition === 'split' || row.transition === 'cast-on-separated'">之后左右两段分别继续编织。</p><p v-if="row.transition === 'join'">中间加针后连接左右两段。</p>
      <p v-if="row.finishOperations?.length">织完本行后结束：{{ row.finishOperations.map(rowOperationToText).join('；') }}</p>
    </div></template>
  </details>
</template>
