<script setup lang="ts">
import { useEditorStore } from '../stores/editor'
import { rowOperationToText, operationKindLabels } from '../core/knitting/rowOperations'
defineProps<{ open: boolean }>()
defineEmits<{ close: [] }>()
const store = useEditorStore()
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="project-dialog-backdrop" @click.self="$emit('close')">
      <section class="project-dialog row-plan-dialog" role="dialog" aria-modal="true" aria-labelledby="row-plan-title">
        <header>
          <div><h2 id="row-plan-title">逐行操作表</h2><p>第 N 行的全部操作先完成，再编织该行；同一行从左到右同时生效。</p></div>
          <button class="dialog-close" type="button" aria-label="关闭逐行操作表" @click="$emit('close')">×</button>
        </header>
        <div class="row-plan-content">
          <p>当前为主体平针数量计划，缝合补偿尚未加入；未验证具体机器动作。</p>
          <article v-for="plan in store.shapePlans" :key="plan.shapeId">
            <h3>{{ plan.shapeName || '未命名轮廓' }}</h3>
            <p v-if="plan.calculationMessage" role="alert">{{ plan.calculationMessage }}</p>
            <template v-else>
              <div v-for="instruction in plan.instructions" :key="instruction.sourceRowIndex" class="row-plan-row">
                <strong>第 {{ instruction.rowNumber }} 行前 · 本行 {{ instruction.stitchCount }} 针</strong>
                <p v-if="!instruction.operations?.length">不加不减</p>
                <div v-for="operation in instruction.operations" :key="`${operation.key}:${operation.startStitch}`" class="row-plan-operation">
                  <span>{{ rowOperationToText(operation) }}</span>
                  <button v-if="operation.canOverride" type="button"
                    :aria-label="`第${instruction.rowNumber}行${rowOperationToText(operation)}更改工艺`"
                    @click="store.setOperationOverride(plan.shapeId, operation.key, operation.kind === 'decrease' ? 'bind-off' : 'decrease')">
                    更改为{{ operation.kind === 'decrease' ? '平收' : '减针' }}
                  </button>
                  <button v-if="store.operationOverrides[plan.shapeId]?.[operation.key]" type="button"
                    @click="store.setOperationOverride(plan.shapeId, operation.key, null)">恢复自动{{ operationKindLabels[operation.defaultKind] }}</button>
                </div>
                <p v-if="instruction.transition === 'split' || instruction.transition === 'cast-on-separated'">之后左右两段分别继续编织。</p>
                <p v-if="instruction.transition === 'join'">中间加针后连接左右两段。</p>
                <div v-if="instruction.finishOperations?.length" class="row-plan-finish">
                  <strong>织完第 {{ instruction.rowNumber }} 行后结束</strong>
                  <p v-for="operation in instruction.finishOperations" :key="operation.key">{{ rowOperationToText(operation) }}</p>
                </div>
              </div>
            </template>
          </article>
          <p v-if="!store.shapePlans.length">请先绘制闭合轮廓。</p>
        </div>
      </section>
    </div>
  </Teleport>
</template>
