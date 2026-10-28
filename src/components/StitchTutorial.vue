<script setup lang="ts">
import { ref, watch } from 'vue'
import type { StitchDefinition } from '../core/drawing/types'
import StitchSymbol from './StitchSymbol.vue'
const props = withDefaults(defineProps<{ definition: StitchDefinition; initiallyOpen?: boolean }>(), { initiallyOpen: true })
const step = ref(0), enlarged = ref(false)
watch(() => props.definition.id, () => { step.value = 0 })
</script>
<template>
  <details class="stitch-tutorial" :open="initiallyOpen || undefined">
    <summary>如何编织 · {{ definition.name }}</summary>
    <p>消耗 {{ definition.input }} 针 → 生成 {{ definition.output }} 针；占 {{ definition.span }} 格。</p>
    <div class="symbol-example"><StitchSymbol :definition="definition" /><span>针格符号示例：一个符号表示一次完整操作。</span></div>
    <template v-if="!definition.custom">
      <button class="tutorial-image" :class="{ enlarged }" :aria-expanded="enlarged" @click="enlarged = !enlarged">
        <svg viewBox="0 0 280 160" role="img" :aria-label="`${definition.name}第${step + 1}步示意`">
          <rect width="280" height="160" fill="#f5f0e8" />
          <path d="M18 110L230 55" stroke="#776552" stroke-width="8" stroke-linecap="round" />
          <path v-if="definition.kind !== 'cable' || step === 1" :d="step === definition.steps.length - 1 ? 'M252 130L95 50' : 'M252 130L116 39'" stroke="#9b8b76" stroke-width="7" stroke-linecap="round" />
          <g v-for="n in Math.max(1, definition.input)" :key="n" :transform="`translate(${86 + n * 19} ${95 - n * 5})`">
            <path v-if="definition.kind === 'twist'" d="M-5 12C-16-18 13-21 6 10L-5-8L6-20" stroke="#b08b90" stroke-width="4" fill="none" />
            <ellipse v-else rx="7" ry="18" stroke="#b08b90" stroke-width="4" fill="none" />
          </g>
          <path v-if="definition.kind === 'cable'" :d="definition.id.endsWith('-l') ? 'M63 127Q119 151 158 124' : 'M63 36Q119 12 158 39'" stroke="#7d998b" stroke-width="7" stroke-linecap="round" fill="none" />
          <path v-if="definition.kind === 'slip'" d="M122 44Q185 18 220 65M212 51L220 65L202 65" stroke="#3f7565" stroke-width="3" fill="none" />
          <path v-else-if="definition.kind === 'cable'" :d="step === 0 ? 'M122 81Q97 99 82 123M83 109L82 123L96 119' : 'M90 127Q165 140 205 76M191 82L205 76L202 92'" stroke="#3f7565" stroke-width="3" fill="none" />
          <path v-else-if="definition.kind === 'increase' && definition.input === 0" d="M91 104Q96 44 138 65Q175 95 149 122" stroke="#b08b90" stroke-width="4" fill="none" />
          <path v-else :d="step === 0 ? 'M157 40L129 84M129 84L128 67M129 84L146 77' : 'M77 129Q103 132 155 91Q184 67 169 53'" :stroke="step === 0 ? '#3f7565' : '#b08b90'" stroke-width="3" fill="none" />
          <text x="12" y="23" font-size="12" fill="#443f38">{{ step + 1 }} · {{ definition.kind === 'cable' ? '绿色：麻花针／移动方向' : '棕色：棒针　粉色：线圈　绿色：操作方向' }}</text>
        </svg>
        <span>{{ enlarged ? '收起步骤图' : '放大步骤图' }}</span>
      </button>
      <p>步骤 {{ step + 1 }}/{{ definition.steps.length }}：{{ definition.steps[step] }}</p>
      <div class="drawing-buttons"><button :disabled="step === 0" @click="step--">上一步</button><button :disabled="step === definition.steps.length - 1" @click="step++">下一步</button></div>
    </template>
    <p v-else>客户自定义针法尚未提供棒针步骤图，按以下客户说明操作。</p>
    <ol><li v-for="(text, i) in definition.steps" :key="i">{{ text }}</li></ol>
    <small>步骤图为动作示意，请结合文字入针方向与线位。图解的正反面读法在绘图工具区选择。</small>
  </details>
</template>
<style scoped>
.stitch-tutorial { margin-top: 16px; padding-top: 12px; border-top: 1px solid #d8d0c5; }.stitch-tutorial summary { min-height: 44px; cursor: pointer; }.symbol-example { display: flex; align-items: center; gap: 8px; }.tutorial-image { display: block; width: 100%; padding: 0; margin-top: 12px; }.tutorial-image svg { width: 100%; max-height: 180px; }.tutorial-image.enlarged svg { max-height: 350px; } li { margin-bottom: 8px; }
</style>
