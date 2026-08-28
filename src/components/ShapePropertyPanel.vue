<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { getShapeBounds, resizeShapeToBounds } from '../core/geometry/geometry'
import type { Bounds } from '../core/geometry/shape.types'
import { useEditorStore } from '../stores/editor'

const store = useEditorStore()
const { selectedShape } = storeToRefs(store)
const bounds = computed(() => selectedShape.value ? getShapeBounds(selectedShape.value) : null)

const typeLabels = {
  rectangle: '矩形',
  triangle: '三角形',
  circle: '圆形',
  ellipse: '椭圆',
  polygon: '多边形',
}

function updateBound(key: keyof Bounds, event: Event): void {
  if (!selectedShape.value || !bounds.value) return
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(value) || ((key === 'width' || key === 'height') && value <= 0)) return
  store.replaceShape(resizeShapeToBounds(selectedShape.value, { ...bounds.value, [key]: value }))
}

function updateName(event: Event): void {
  if (!selectedShape.value) return
  const name = (event.target as HTMLInputElement).value.trim()
  store.replaceShape({ ...selectedShape.value, name: name || undefined })
}
</script>

<template>
  <section class="panel-section property-panel">
    <div class="section-heading compact">
      <div>
        <span class="eyebrow">SHAPE</span>
        <h2>图形属性</h2>
      </div>
      <span v-if="selectedShape" class="shape-badge">{{ typeLabels[selectedShape.type] }}</span>
    </div>

    <div v-if="selectedShape && bounds" class="property-content">
      <label class="name-field">
        <span>名称</span>
        <input :value="selectedShape.name" type="text" @change="updateName" />
      </label>
      <div class="field-grid field-grid--two">
        <label><span>X 位置</span><div class="input-unit"><input :value="bounds.x.toFixed(2)" type="number" step="0.1" @change="updateBound('x', $event)" /><b>cm</b></div></label>
        <label><span>Y 位置</span><div class="input-unit"><input :value="bounds.y.toFixed(2)" type="number" step="0.1" @change="updateBound('y', $event)" /><b>cm</b></div></label>
        <label><span>宽度</span><div class="input-unit"><input :value="bounds.width.toFixed(2)" type="number" min="0.1" step="0.1" @change="updateBound('width', $event)" /><b>cm</b></div></label>
        <label><span>高度</span><div class="input-unit"><input :value="bounds.height.toFixed(2)" type="number" min="0.1" step="0.1" @change="updateBound('height', $event)" /><b>cm</b></div></label>
      </div>
      <p v-if="selectedShape.type === 'polygon'" class="property-tip">双击轮廓边添加节点；选中节点后按 Delete 删除。
      </p>
    </div>
    <div v-else class="empty-property">
      <span>◇</span>
      <p>选择画布中的图形<br />以精确编辑尺寸</p>
    </div>
  </section>
</template>
