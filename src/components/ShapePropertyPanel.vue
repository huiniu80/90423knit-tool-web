<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { getShapeBounds, resizeShapeToBounds } from '../core/geometry/geometry'
import { detectPathSymmetry, enablePathMirror } from '../core/geometry/path'
import type { PathMirrorSource } from '../core/geometry/path'
import { snapCm, tidyPathToGrid } from '../core/geometry/snapping'
import type { Bounds } from '../core/geometry/shape.types'
import { useEditorStore } from '../stores/editor'

const store = useEditorStore()
const { gauge, selectedShape } = storeToRefs(store)
const bounds = computed(() => selectedShape.value ? getShapeBounds(selectedShape.value) : null)
const mirrorChoiceShapeId = ref<string | null>(null)
const hasPathSymmetry = computed(() => selectedShape.value?.type === 'path'
  && Boolean(selectedShape.value.editConstraint))
watch(() => selectedShape.value?.id, () => { mirrorChoiceShapeId.value = null })

const typeLabels = {
  rectangle: '矩形',
  triangle: '三角形',
  circle: '圆形',
  ellipse: '椭圆',
  polygon: '多边形',
  path: '路径',
}

function updateBound(key: keyof Bounds, event: Event): void {
  if (!selectedShape.value || !bounds.value) return
  const rawValue = Number((event.target as HTMLInputElement).value)
  const value = snapCm(rawValue)
  if (!Number.isFinite(value) || ((key === 'width' || key === 'height') && value <= 0)) return
  store.replaceShape(resizeShapeToBounds(selectedShape.value, { ...bounds.value, [key]: value }))
}

function updateName(event: Event): void {
  if (!selectedShape.value) return
  const name = (event.target as HTMLInputElement).value.trim()
  store.replaceShape({ ...selectedShape.value, name: name || undefined })
}

function togglePathClosed(): void {
  if (selectedShape.value?.type !== 'path') return
  if (!selectedShape.value.closed && selectedShape.value.nodes.length < 3) return
  store.replaceShape({ ...selectedShape.value, closed: !selectedShape.value.closed })
}

function tidySelectedPath(): void {
  if (selectedShape.value?.type !== 'path') return
  store.replaceShape(tidyPathToGrid(selectedShape.value))
}

function disablePathMirror(): void {
  if (selectedShape.value?.type !== 'path' || !selectedShape.value.editConstraint) return
  store.replaceShape({ ...selectedShape.value, editConstraint: undefined })
  mirrorChoiceShapeId.value = null
}

function requestPathMirror(): void {
  if (selectedShape.value?.type !== 'path' || selectedShape.value.editConstraint) return
  const path = selectedShape.value
  const symmetry = detectPathSymmetry(
    path,
    gauge.value.stitchWidthCm * 0.55,
    gauge.value.stitchWidthCm / 2,
  )
  if (symmetry) {
    store.replaceShape(enablePathMirror(path, 'average', gauge.value.stitchWidthCm / 2))
    return
  }
  mirrorChoiceShapeId.value = path.id
}

function confirmPathMirror(source: PathMirrorSource): void {
  if (selectedShape.value?.type !== 'path') return
  store.replaceShape(enablePathMirror(
    selectedShape.value,
    source,
    gauge.value.stitchWidthCm / 2,
  ))
  mirrorChoiceShapeId.value = null
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
        <label><span>X 位置</span><div class="input-unit"><input :value="bounds.x.toFixed(2)" type="number" step="0.5" @change="updateBound('x', $event)" /><b>cm</b></div></label>
        <label><span>Y 位置</span><div class="input-unit"><input :value="bounds.y.toFixed(2)" type="number" step="0.5" @change="updateBound('y', $event)" /><b>cm</b></div></label>
        <label><span>宽度</span><div class="input-unit"><input :value="bounds.width.toFixed(2)" type="number" min="0.5" step="0.5" @change="updateBound('width', $event)" /><b>cm</b></div></label>
        <label><span>高度</span><div class="input-unit"><input :value="bounds.height.toFixed(2)" type="number" min="0.5" step="0.5" @change="updateBound('height', $event)" /><b>cm</b></div></label>
      </div>
      <p v-if="selectedShape.type === 'polygon'" class="property-tip">双击轮廓边添加节点；选中节点后按 Delete 删除。
      </p>
      <div v-if="selectedShape.type === 'path'" class="path-property-block">
        <div class="mirror-mode-row">
          <span>编辑方式</span>
          <div class="segmented-control compact" aria-label="路径编辑方式">
            <button type="button" :class="{ active: !hasPathSymmetry }" @click="disablePathMirror">
              自由编辑
            </button>
            <button type="button" :class="{ active: hasPathSymmetry }" @click="requestPathMirror">
              左右镜像
            </button>
          </div>
        </div>
        <div v-if="mirrorChoiceShapeId === selectedShape.id" class="mirror-source-choice">
          <b>当前两侧不一致，请选择保留哪一侧：</b>
          <div>
            <button type="button" @click="confirmPathMirror('left')">以左侧为准</button>
            <button type="button" @click="confirmPathMirror('right')">以右侧为准</button>
            <button type="button" class="plain" @click="mirrorChoiceShapeId = null">取消</button>
          </div>
        </div>
        <div class="path-status-row">
          <span>{{ selectedShape.nodes.length }} 个锚点</span>
          <b v-if="hasPathSymmetry" class="symmetry-status">
            中心 X {{ selectedShape.editConstraint?.axisX.toFixed(2) }} cm
          </b>
          <div class="path-status-actions">
            <button type="button" title="锚点对齐到 0.5cm，并拉直接近水平或垂直的直边"
              @click="tidySelectedPath">整理尺寸</button>
            <button type="button" :disabled="!selectedShape.closed && selectedShape.nodes.length < 3"
              @click="togglePathClosed">
              {{ selectedShape.closed ? '打开路径' : '闭合路径' }}
            </button>
          </div>
        </div>
        <p class="property-tip">
          {{ selectedShape.closed
            ? hasPathSymmetry
              ? '左右镜像已锁定。拖动锚点、控制柄或曲线时，另一侧会围绕中心轴同步变化。'
              : '闭合路径会参与针格和针法计算；尺寸按 0.5cm 吸附，自由编辑时两侧互不影响。'
            : hasPathSymmetry
              ? '开放路径已启用左右镜像，中心节点会保持在中心轴上。'
              : '开放路径按 0.5cm 吸附；接近水平或垂直时自动拉直，按住 Alt 可临时关闭方向吸附。' }}
        </p>
      </div>
    </div>
    <div v-else class="empty-property">
      <span>◇</span>
      <p>选择画布中的图形<br />以精确编辑尺寸</p>
    </div>
  </section>
</template>
