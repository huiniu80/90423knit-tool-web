<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Bounds, Point, PolygonShape, Shape } from '../core/geometry/shape.types'
import { getShapeBounds, resizeShapeToBounds, translateShape } from '../core/geometry/geometry'
import { useEditorStore } from '../stores/editor'

type Corner = 'nw' | 'ne' | 'se' | 'sw'
type Interaction =
  | { kind: 'pan'; start: Point; origin: Point }
  | { kind: 'move'; start: Point; shape: Shape }
  | { kind: 'resize'; corner: Corner; anchor: Point; shape: Shape }
  | { kind: 'point'; pointIndex: number; shape: PolygonShape }

const store = useEditorStore()
const {
  fabric,
  fabricGrid,
  gauge,
  rasterRows,
  shapes,
  selectedShape,
  selectedShapeId,
  activeTool,
  viewMode,
  zoom,
} = storeToRefs(store)

const host = ref<HTMLDivElement | null>(null)
const stageSize = ref({ width: 900, height: 600 })
const pan = ref<Point>({ x: 60, y: 40 })
const interaction = ref<Interaction | null>(null)
const draftPoints = ref<Point[]>([])
const selectedPointIndex = ref<number | null>(null)
let resizeObserver: ResizeObserver | null = null

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const fabricWidthPx = computed(() => fabric.value.widthCm * zoom.value)
const fabricHeightPx = computed(() => fabric.value.heightCm * zoom.value)
const showOutline = computed(() => viewMode.value !== 'grid')
const showRaster = computed(() => viewMode.value !== 'outline')
const stageCursor = computed(() => {
  if (interaction.value?.kind === 'pan') return 'grabbing'
  if (activeTool.value === 'pan') return 'grab'
  if (activeTool.value === 'polygon') return 'crosshair'
  return interaction.value ? 'grabbing' : 'default'
})

const verticalLines = computed(() =>
  Array.from({ length: fabricGrid.value.columnCount + 1 }, (_, index) =>
    index * gauge.value.stitchWidthCm * zoom.value,
  ),
)
const horizontalLines = computed(() =>
  Array.from({ length: fabricGrid.value.rowCount + 1 }, (_, index) =>
    fabricHeightPx.value - index * gauge.value.rowHeightCm * zoom.value,
  ),
)
const rasterBands = computed(() =>
  rasterRows.value.flatMap((row) =>
    row.segments.map((segment) => ({
      key: `${row.rowIndex}-${segment.startStitch}-${segment.endStitch}`,
      x: segment.startStitch * gauge.value.stitchWidthCm * zoom.value,
      y: fabricHeightPx.value - (row.rowIndex + 1) * gauge.value.rowHeightCm * zoom.value,
      width:
        (segment.endStitch - segment.startStitch + 1) *
        gauge.value.stitchWidthCm *
        zoom.value,
      height: gauge.value.rowHeightCm * zoom.value,
    })),
  ),
)

function toCanvasPoint(point: Point): Point {
  return {
    x: point.x * zoom.value,
    y: (fabric.value.heightCm - point.y) * zoom.value,
  }
}

function shapePoints(shape: Shape): number[] {
  if (shape.type !== 'triangle' && shape.type !== 'polygon') return []
  return shape.points.flatMap((point) => {
    const canvasPoint = toCanvasPoint(point)
    return [canvasPoint.x, canvasPoint.y]
  })
}

function shapeConfig(shape: Shape): Record<string, unknown> {
  const common = {
    name: `shape:${shape.id}`,
    stroke: '#b24631',
    strokeWidth: selectedShapeId.value === shape.id ? 2.2 : 1.5,
    fill: 'rgba(194, 88, 61, 0.13)',
    hitStrokeWidth: 12,
  }
  switch (shape.type) {
    case 'rectangle':
      return {
        ...common,
        x: shape.x * zoom.value,
        y: (fabric.value.heightCm - shape.y - shape.heightCm) * zoom.value,
        width: shape.widthCm * zoom.value,
        height: shape.heightCm * zoom.value,
      }
    case 'circle': {
      const center = toCanvasPoint(shape.center)
      return { ...common, x: center.x, y: center.y, radius: shape.radiusCm * zoom.value }
    }
    case 'ellipse': {
      const center = toCanvasPoint(shape.center)
      return {
        ...common,
        x: center.x,
        y: center.y,
        radiusX: shape.radiusXcm * zoom.value,
        radiusY: shape.radiusYcm * zoom.value,
      }
    }
    case 'triangle':
    case 'polygon':
      return { ...common, points: shapePoints(shape), closed: true }
  }
}

const selectionRect = computed(() => {
  if (!selectedShape.value || activeTool.value !== 'select') return null
  const bounds = getShapeBounds(selectedShape.value)
  return {
    x: bounds.x * zoom.value,
    y: (fabric.value.heightCm - bounds.y - bounds.height) * zoom.value,
    width: bounds.width * zoom.value,
    height: bounds.height * zoom.value,
  }
})

const resizeHandles = computed(() => {
  const rect = selectionRect.value
  if (!rect) return []
  return [
    { corner: 'nw' as const, x: rect.x, y: rect.y },
    { corner: 'ne' as const, x: rect.x + rect.width, y: rect.y },
    { corner: 'se' as const, x: rect.x + rect.width, y: rect.y + rect.height },
    { corner: 'sw' as const, x: rect.x, y: rect.y + rect.height },
  ]
})

const polygonHandles = computed(() => {
  if (selectedShape.value?.type !== 'polygon' || activeTool.value !== 'select') return []
  return selectedShape.value.points.map((point, index) => ({ index, ...toCanvasPoint(point) }))
})

const draftCanvasPoints = computed(() =>
  draftPoints.value.flatMap((point) => {
    const canvasPoint = toCanvasPoint(point)
    return [canvasPoint.x, canvasPoint.y]
  }),
)

function pointerFromEvent(event: KonvaEventObject<MouseEvent | WheelEvent>): Point | null {
  const position = event.target.getStage()?.getPointerPosition()
  return position ? { x: position.x, y: position.y } : null
}

function worldFromScreen(screen: Point, clampToFabric = false): Point {
  const point = {
    x: (screen.x - pan.value.x) / zoom.value,
    y: fabric.value.heightCm - (screen.y - pan.value.y) / zoom.value,
  }
  if (!clampToFabric) return point
  return {
    x: Math.min(fabric.value.widthCm, Math.max(0, point.x)),
    y: Math.min(fabric.value.heightCm, Math.max(0, point.y)),
  }
}

function targetName(event: KonvaEventObject<MouseEvent>): string {
  return event.target.name?.() ?? ''
}

function beginMove(shape: Shape, pointer: Point): void {
  store.beginShapeMutation()
  interaction.value = { kind: 'move', start: worldFromScreen(pointer), shape: clonePlain(shape) }
}

function beginResize(shape: Shape, corner: Corner): void {
  const bounds = getShapeBounds(shape)
  const opposite: Record<Corner, Point> = {
    nw: { x: bounds.x + bounds.width, y: bounds.y },
    ne: { x: bounds.x, y: bounds.y },
    se: { x: bounds.x, y: bounds.y + bounds.height },
    sw: { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
  }
  store.beginShapeMutation()
  interaction.value = { kind: 'resize', corner, anchor: opposite[corner], shape: clonePlain(shape) }
}

function onMouseDown(event: KonvaEventObject<MouseEvent>): void {
  host.value?.focus()
  const pointer = pointerFromEvent(event)
  if (!pointer || activeTool.value === 'polygon') return

  const name = targetName(event)
  if (activeTool.value === 'pan' || event.evt.button === 1) {
    interaction.value = { kind: 'pan', start: pointer, origin: { ...pan.value } }
    return
  }
  if (activeTool.value !== 'select') return

  if (name.startsWith('point:') && selectedShape.value?.type === 'polygon') {
    const pointIndex = Number(name.split(':')[2])
    selectedPointIndex.value = pointIndex
    store.beginShapeMutation()
    interaction.value = {
      kind: 'point',
      pointIndex,
      shape: clonePlain(selectedShape.value),
    }
    return
  }
  if (name.startsWith('resize:') && selectedShape.value) {
    beginResize(selectedShape.value, name.split(':')[1] as Corner)
    return
  }
  if (name.startsWith('shape:')) {
    const id = name.slice('shape:'.length)
    selectedShapeId.value = id
    selectedPointIndex.value = null
    const shape = shapes.value.find((item) => item.id === id)
    if (shape) beginMove(shape, pointer)
    return
  }
  selectedShapeId.value = null
  selectedPointIndex.value = null
}

function onMouseMove(event: KonvaEventObject<MouseEvent>): void {
  const pointer = pointerFromEvent(event)
  const current = interaction.value
  if (!pointer || !current) return

  if (current.kind === 'pan') {
    pan.value = {
      x: current.origin.x + pointer.x - current.start.x,
      y: current.origin.y + pointer.y - current.start.y,
    }
    return
  }

  const world = worldFromScreen(pointer, current.kind === 'point')
  if (current.kind === 'move') {
    store.updateShapeLive(
      translateShape(
        current.shape,
        world.x - current.start.x,
        world.y - current.start.y,
      ),
    )
  } else if (current.kind === 'resize') {
    const bounds: Bounds = {
      x: Math.min(current.anchor.x, world.x),
      y: Math.min(current.anchor.y, world.y),
      width: Math.max(0.1, Math.abs(world.x - current.anchor.x)),
      height: Math.max(0.1, Math.abs(world.y - current.anchor.y)),
    }
    store.updateShapeLive(resizeShapeToBounds(current.shape, bounds))
  } else if (current.kind === 'point') {
    const points = current.shape.points.map((point, index) =>
      index === current.pointIndex ? world : point,
    )
    store.updateShapeLive({ ...current.shape, points })
  }
}

function endInteraction(): void {
  if (interaction.value && interaction.value.kind !== 'pan') store.commitShapeMutation()
  interaction.value = null
}

function onStageClick(event: KonvaEventObject<MouseEvent>): void {
  if (activeTool.value !== 'polygon') return
  const pointer = pointerFromEvent(event)
  if (!pointer) return
  const point = worldFromScreen(pointer, true)
  const first = draftPoints.value[0]

  if (
    first &&
    draftPoints.value.length >= 3 &&
    Math.hypot(point.x - first.x, point.y - first.y) <= 0.55
  ) {
    finishPolygon()
    return
  }
  draftPoints.value.push(point)
}

function finishPolygon(): void {
  if (draftPoints.value.length < 3) return
  store.addPolygon(clonePlain(draftPoints.value))
  draftPoints.value = []
}

function nearestEdgeInsertion(shape: PolygonShape, point: Point): number {
  let bestIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY
  shape.points.forEach((start, index) => {
    const end = shape.points[(index + 1) % shape.points.length]
    if (!end) return
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy
    const t = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
    const projection = { x: start.x + t * dx, y: start.y + t * dy }
    const distance = Math.hypot(point.x - projection.x, point.y - projection.y)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index + 1
    }
  })
  return bestIndex
}

function onDoubleClick(event: KonvaEventObject<MouseEvent>): void {
  if (activeTool.value !== 'select' || selectedShape.value?.type !== 'polygon') return
  if (!targetName(event).startsWith('shape:')) return
  const pointer = pointerFromEvent(event)
  if (!pointer) return
  const world = worldFromScreen(pointer, true)
  const shape = clonePlain(selectedShape.value)
  const insertion = nearestEdgeInsertion(shape, world)
  shape.points.splice(insertion, 0, world)
  store.replaceShape(shape)
  selectedPointIndex.value = insertion
}

function onWheel(event: KonvaEventObject<WheelEvent>): void {
  event.evt.preventDefault()
  const pointer = pointerFromEvent(event)
  if (!pointer) return

  if (event.evt.ctrlKey || event.evt.metaKey) {
    const oldZoom = zoom.value
    const nextZoom = Math.min(60, Math.max(5, oldZoom * (event.evt.deltaY > 0 ? 0.9 : 1.1)))
    const localX = (pointer.x - pan.value.x) / oldZoom
    const localY = (pointer.y - pan.value.y) / oldZoom
    zoom.value = nextZoom
    pan.value = {
      x: pointer.x - localX * nextZoom,
      y: pointer.y - localY * nextZoom,
    }
  } else {
    pan.value = {
      x: pan.value.x - event.evt.deltaX,
      y: pan.value.y - event.evt.deltaY,
    }
  }
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    draftPoints.value = []
    interaction.value = null
    if (activeTool.value === 'polygon') activeTool.value = 'select'
    return
  }
  if (event.key === 'Enter' && activeTool.value === 'polygon') {
    finishPolygon()
    return
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedShape.value) {
    event.preventDefault()
    if (
      selectedShape.value.type === 'polygon' &&
      selectedPointIndex.value !== null &&
      selectedShape.value.points.length > 3
    ) {
      const shape = clonePlain(selectedShape.value)
      shape.points.splice(selectedPointIndex.value, 1)
      store.replaceShape(shape)
      selectedPointIndex.value = null
    } else {
      store.deleteSelected()
    }
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    event.shiftKey ? store.redo() : store.undo()
  }
}

function fitCanvas(): void {
  const padding = 72
  const nextZoom = Math.min(
    48,
    Math.max(
      5,
      Math.min(
        (stageSize.value.width - padding * 2) / fabric.value.widthCm,
        (stageSize.value.height - padding * 2) / fabric.value.heightCm,
      ),
    ),
  )
  zoom.value = nextZoom
  pan.value = {
    x: (stageSize.value.width - fabric.value.widthCm * nextZoom) / 2,
    y: (stageSize.value.height - fabric.value.heightCm * nextZoom) / 2,
  }
}

onMounted(() => {
  if (!host.value) return
  resizeObserver = new ResizeObserver(([entry]) => {
    if (!entry) return
    stageSize.value = {
      width: Math.max(320, entry.contentRect.width),
      height: Math.max(360, entry.contentRect.height),
    }
  })
  resizeObserver.observe(host.value)
  nextTick(fitCanvas)
})

onBeforeUnmount(() => resizeObserver?.disconnect())
watch(() => [fabric.value.widthCm, fabric.value.heightCm], () => nextTick(fitCanvas))
watch(activeTool, (tool) => {
  if (tool !== 'polygon') draftPoints.value = []
})

defineExpose({ fitCanvas })
</script>

<template>
  <div ref="host" class="knitting-canvas" tabindex="0" :style="{ cursor: stageCursor }"
    @keydown="onKeyDown">
    <v-stage :config="{ width: stageSize.width, height: stageSize.height }"
      @mousedown="onMouseDown" @mousemove="onMouseMove" @mouseup="endInteraction"
      @mouseleave="endInteraction" @click="onStageClick" @dblclick="onDoubleClick" @wheel="onWheel">
      <v-layer>
        <v-group :config="{ x: pan.x, y: pan.y }">
          <v-rect :config="{
            name: 'fabric', x: 0, y: 0, width: fabricWidthPx, height: fabricHeightPx,
            fill: '#fffdf8', stroke: '#cfc7b9', strokeWidth: 1, shadowColor: '#4a3f35',
            shadowBlur: 18, shadowOpacity: 0.12, shadowOffsetY: 6,
          }" />

          <template v-if="showRaster">
            <v-rect v-for="band in rasterBands" :key="band.key" :config="{
              ...band, fill: '#263d36', opacity: viewMode === 'overlay' ? 0.7 : 0.92,
            }" />
          </template>

          <template v-if="showRaster">
            <v-line v-for="(x, index) in verticalLines" :key="`v-${index}`"
              :config="{ points: [x, 0, x, fabricHeightPx], stroke: index % 5 === 0 ? '#a59d90' : '#d8d2c8', strokeWidth: index % 5 === 0 ? 0.8 : 0.45, listening: false }" />
            <v-line v-for="(y, index) in horizontalLines" :key="`h-${index}`"
              :config="{ points: [0, y, fabricWidthPx, y], stroke: index % 5 === 0 ? '#a59d90' : '#d8d2c8', strokeWidth: index % 5 === 0 ? 0.8 : 0.45, listening: false }" />
          </template>

          <template v-if="showOutline">
            <template v-for="shape in shapes" :key="shape.id">
              <v-rect v-if="shape.type === 'rectangle'" :config="shapeConfig(shape)" />
              <v-circle v-else-if="shape.type === 'circle'" :config="shapeConfig(shape)" />
              <v-ellipse v-else-if="shape.type === 'ellipse'" :config="shapeConfig(shape)" />
              <v-line v-else :config="shapeConfig(shape)" />
            </template>
          </template>

          <template v-if="selectionRect && showOutline">
            <v-rect :config="{ ...selectionRect, stroke: '#287d72', strokeWidth: 1.3, dash: [5, 4], listening: false }" />
            <v-circle v-for="handle in resizeHandles" :key="handle.corner" :config="{
              name: `resize:${handle.corner}`, x: handle.x, y: handle.y, radius: 5,
              fill: '#fffdf8', stroke: '#287d72', strokeWidth: 2,
            }" />
          </template>

          <template v-if="showOutline">
            <v-circle v-for="handle in polygonHandles" :key="`point-${handle.index}`" :config="{
              name: `point:${selectedShapeId}:${handle.index}`, x: handle.x, y: handle.y,
              radius: selectedPointIndex === handle.index ? 6 : 4.5,
              fill: selectedPointIndex === handle.index ? '#e3a43b' : '#fffdf8',
              stroke: '#b24631', strokeWidth: 1.8,
            }" />
          </template>

          <template v-if="draftPoints.length">
            <v-line :config="{ points: draftCanvasPoints, stroke: '#b24631', strokeWidth: 2, dash: [7, 4] }" />
            <v-circle v-for="(point, index) in draftPoints" :key="`draft-${index}`" :config="{
              x: toCanvasPoint(point).x, y: toCanvasPoint(point).y,
              radius: index === 0 ? 6 : 4, fill: index === 0 ? '#e3a43b' : '#fffdf8',
              stroke: '#b24631', strokeWidth: 2,
            }" />
          </template>
        </v-group>
      </v-layer>
    </v-stage>

    <div class="canvas-hud canvas-hud--left">
      <b>{{ fabricGrid.columnCount }} 针 × {{ fabricGrid.rowCount }} 行</b>
      <span>原点在左下角 · 单位 cm</span>
    </div>
    <div v-if="activeTool === 'polygon'" class="polygon-hint">
      <b>多边形描点</b>
      <span>点击添加节点 · 点击起点或 Enter 闭合 · ESC 取消</span>
    </div>
  </div>
</template>
