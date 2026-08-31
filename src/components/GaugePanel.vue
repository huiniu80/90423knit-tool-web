<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useEditorStore } from '../stores/editor'
import { GRID_LIMITS } from '../core/gauge/gridConstraints'
import type { GaugeInput, FabricCanvas } from '../core/gauge/gauge.types'
import type { RasterOptions } from '../core/raster/raster.types'

const store = useEditorStore()
const { gaugeInput, fabric, gauge, fabricGrid, gridAssessment, rasterOptions } = storeToRefs(store)
const rejectedMessage = ref('')

const assessmentMessage = computed(() => rejectedMessage.value
  || gridAssessment.value.issues.find((issue) => issue.severity === 'error')?.message
  || gridAssessment.value.issues.find((issue) => issue.severity === 'warning')?.message
  || '')

const assessmentTone = computed(() => rejectedMessage.value || gridAssessment.value.status === 'blocked'
  ? 'error'
  : gridAssessment.value.status === 'warning' ? 'warning' : 'valid')

watch([gaugeInput, fabric], () => { rejectedMessage.value = '' }, { deep: true })

function setPositive(
  target: 'gauge' | 'fabric',
  key: keyof GaugeInput | keyof FabricCanvas,
  event: Event,
): void {
  const input = event.target as HTMLInputElement
  const value = Number(input.value)
  const result = target === 'gauge'
    ? store.setGaugeInputValue(key as keyof GaugeInput, value)
    : store.setFabricValue(key as keyof FabricCanvas, value)
  rejectedMessage.value = result.ok
    ? ''
    : result.assessment.issues.find((issue) => issue.severity === 'error')?.message ?? '该设置无法生成安全的编织网格。'
  if (!result.ok) {
    input.value = String(target === 'gauge'
      ? gaugeInput.value[key as keyof GaugeInput]
      : fabric.value[key as keyof FabricCanvas])
  }
}

function setRasterMode(event: Event): void {
  store.setRasterOptions({ mode: (event.target as HTMLSelectElement).value as RasterOptions['mode'] })
}
</script>

<template>
  <section class="panel-section gauge-panel">
    <div class="section-heading">
      <div>
        <span class="eyebrow">GAUGE</span>
        <h2>编织密度</h2>
      </div>
      <span class="status-dot" title="实时计算" />
    </div>

    <div class="field-grid field-grid--two">
      <label>
        <span>小样针数</span>
        <div class="input-unit">
          <input :value="gaugeInput.sampleStitches" type="number" min="1" :max="GRID_LIMITS.sampleCountMax" step="1"
            @change="setPositive('gauge', 'sampleStitches', $event)" />
          <b>针</b>
        </div>
      </label>
      <label>
        <span>小样行数</span>
        <div class="input-unit">
          <input :value="gaugeInput.sampleRows" type="number" min="1" :max="GRID_LIMITS.sampleCountMax" step="1"
            @change="setPositive('gauge', 'sampleRows', $event)" />
          <b>行</b>
        </div>
      </label>
      <label>
        <span>小样宽度</span>
        <div class="input-unit">
          <input :value="gaugeInput.sampleWidthCm" type="number" :min="GRID_LIMITS.sampleSizeMinCm" :max="GRID_LIMITS.sampleSizeMaxCm" step="0.1"
            @change="setPositive('gauge', 'sampleWidthCm', $event)" />
          <b>cm</b>
        </div>
      </label>
      <label>
        <span>小样高度</span>
        <div class="input-unit">
          <input :value="gaugeInput.sampleHeightCm" type="number" :min="GRID_LIMITS.sampleSizeMinCm" :max="GRID_LIMITS.sampleSizeMaxCm" step="0.1"
            @change="setPositive('gauge', 'sampleHeightCm', $event)" />
          <b>cm</b>
        </div>
      </label>
    </div>

    <div class="metric-strip">
      <div><span>1 针</span><strong>{{ gauge.stitchWidthCm.toFixed(2) }} cm</strong></div>
      <div><span>1 行</span><strong>{{ gauge.rowHeightCm.toFixed(2) }} cm</strong></div>
    </div>
  </section>

  <section class="panel-section">
    <div class="section-heading compact">
      <div>
        <span class="eyebrow">FABRIC</span>
        <h2>画布尺寸</h2>
      </div>
    </div>
    <div class="field-grid field-grid--two">
      <label>
        <span>宽度</span>
        <div class="input-unit">
          <input :value="fabric.widthCm" type="number" :min="GRID_LIMITS.fabricSizeMinCm" :max="GRID_LIMITS.fabricSizeMaxCm" step="1"
            @change="setPositive('fabric', 'widthCm', $event)" />
          <b>cm</b>
        </div>
      </label>
      <label>
        <span>高度</span>
        <div class="input-unit">
          <input :value="fabric.heightCm" type="number" :min="GRID_LIMITS.fabricSizeMinCm" :max="GRID_LIMITS.fabricSizeMaxCm" step="1"
            @change="setPositive('fabric', 'heightCm', $event)" />
          <b>cm</b>
        </div>
      </label>
    </div>
    <div class="fabric-result">
      <span>实际编织网格</span>
      <strong>{{ fabricGrid.columnCount }} 针 <i>×</i> {{ fabricGrid.rowCount }} 行</strong>
      <small>共 {{ gridAssessment.cellCount.toLocaleString('zh-CN') }} 个针格 ·
        {{ assessmentTone === 'valid' ? '性能良好' : assessmentTone === 'warning' ? '请留意性能' : '已暂停生成' }}</small>
    </div>
    <p v-if="assessmentMessage" :class="['grid-assessment-message', `grid-assessment-message--${assessmentTone}`]"
      :role="assessmentTone === 'error' ? 'alert' : 'status'">{{ assessmentMessage }}</p>
  </section>

  <section class="panel-section compact-options">
    <label class="select-label">
      <span>离散策略</span>
      <select :value="rasterOptions.mode" @change="setRasterMode">
        <option value="center">针格中心</option>
        <option value="inside">完全在轮廓内</option>
        <option value="outside">轮廓有覆盖</option>
      </select>
    </label>
  </section>
</template>
