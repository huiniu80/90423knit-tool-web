<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { createCalculationSnapshot } from '../core/knitting/calculationSnapshot'
import type { PersistedProject } from '../stores/editor.persistence'
import SnapshotPieceView from './SnapshotPieceView.vue'
const props = defineProps<{ project: PersistedProject | null }>()
defineEmits<{ close: [] }>()
const current = computed(() => props.project ? createCalculationSnapshot(props.project.document) : null)
const selectedId = ref('')
const pieceChoices = computed(() => {
  const choices = new Map<string, string>()
  for (const piece of [...(props.project?.calculationSnapshot?.pieces ?? []), ...(current.value?.pieces ?? [])]) choices.set(piece.shapeId, piece.name)
  return [...choices].map(([id, name]) => ({ id, name }))
})
watch(() => props.project, () => { selectedId.value = pieceChoices.value[0]?.id ?? '' })
const oldPiece = computed(() => props.project?.calculationSnapshot?.pieces.find(p => p.shapeId === selectedId.value))
const newPiece = computed(() => current.value?.pieces.find(p => p.shapeId === selectedId.value))
</script>
<template>
  <Teleport to="body">
    <div v-if="project" class="project-dialog-backdrop" @click.self="$emit('close')">
      <section class="project-dialog" role="dialog" aria-modal="true" aria-labelledby="history-title">
        <header><div><h2 id="history-title">历史结果对照 · {{ project.name }}</h2><p>只读对照，当前编织始终按当前源数据重算。</p></div><button class="dialog-close" type="button" aria-label="关闭历史结果对照" @click="$emit('close')">×</button></header>
        <div class="row-plan-content">
          <p v-if="!project.calculationSnapshot">此方案没有导出时结果快照，仍可正常编辑。</p>
          <template v-else>
            <p>导出时：{{ project.calculationSnapshot.calculatedAt }} · 规则 {{ project.calculationSnapshot.ruleVersion }}</p>
            <p>当前：规则 {{ current?.ruleVersion }} · {{ current?.sourceFingerprint === project.calculationSnapshot.sourceFingerprint ? '源数据一致' : '源数据已变化，差异也可能来自编辑' }}</p>
            <label class="history-piece-select">对照织片 <select v-model="selectedId"><option v-for="choice in pieceChoices" :key="choice.id" :value="choice.id">{{ choice.name }}</option></select></label>
            <div class="history-comparison">
              <section><h3>导出时（只读）</h3><p>密度 {{ project.calculationSnapshot.gauge.stitchesPerCm.toFixed(4) }} 针/cm · {{ project.calculationSnapshot.gauge.rowsPerCm.toFixed(4) }} 行/cm</p><p v-for="warning in project.calculationSnapshot.warnings" :key="warning">{{ warning }}</p><SnapshotPieceView v-if="oldPiece" :key="`old:${selectedId}`" :piece="oldPiece" /><p v-else>导出时不存在此织片。</p></section>
              <section><h3>当前重算（只读）</h3><p>密度 {{ current?.gauge.stitchesPerCm.toFixed(4) }} 针/cm · {{ current?.gauge.rowsPerCm.toFixed(4) }} 行/cm</p><p v-for="warning in current?.warnings" :key="warning">{{ warning }}</p><SnapshotPieceView v-if="newPiece" :key="`current:${selectedId}`" :piece="newPiece" /><p v-else>当前已删除此织片。</p></section>
            </div>
          </template>
        </div>
      </section>
    </div>
  </Teleport>
</template>
