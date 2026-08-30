<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { KonvaEventObject } from 'konva/lib/Node'
import type {
  Bounds,
  PathShape,
  Point,
  PolygonShape,
  Shape,
} from '../core/geometry/shape.types'
import {
  findNearestBoundarySegment,
  getShapeBoundarySegments,
} from '../core/geometry/boundarySegments'
import { getShapeBounds, resizeShapeToBounds, translateShape } from '../core/geometry/geometry'
import {
  bendPathSegmentWithSymmetry,
  detectPathSymmetry,
  evaluatePathSegment,
  findNearestOpenPathEndpoint,
  findNearestPathPosition,
  movePathControlWithSymmetry,
  movePathNodeWithSymmetry,
  pathSegmentCount,
  removePathNodeWithSymmetry,
  splitPathSegmentWithSymmetry,
} from '../core/geometry/path'
import type { PathSymmetry } from '../core/geometry/path'
import { describeBoundarySegmentShaping } from '../core/knitting/segmentPlanner'
import { useEditorStore } from '../stores/editor'

type Corner = 'nw' | 'ne' | 'se' | 'sw'
type Interaction =
  | { kind: 'pan'; start: Point; origin: Point }
  | { kind: 'move'; start: Point; shape: Shape }
  | { kind: 'resize'; corner: Corner; anchor: Point; shape: Shape }
  | { kind: 'point'; pointIndex: number; shape: PolygonShape }
  | { kind: 'path-anchor'; nodeIndex: number; shape: PathShape; symmetry: PathSymmetry | null }
  | { kind: 'path-control'; nodeIndex: number; control: 'inControl' | 'outControl'; shape: PathShape; symmetry: PathSymmetry | null }
  | { kind: 'path-midpoint'; segmentIndex: number; shape: PathShape; symmetry: PathSymmetry | null }

interface AnnotationDraft {
  key: string
  shapeId: string
  shapeName: string
  segmentIndex: number
  side: 'left' | 'right'
  anchorX: number
  anchorY: number
  x: number
  preferredY: number
  width: number
  height: number
  lines: string[]
  markers: Array<{ label: string; x: number; y: number }>
}

interface ShapingAnnotation extends Omit<AnnotationDraft, 'preferredY'> {
  y: number
  connectorPoints: number[]
}

const store = useEditorStore()
const {
  fabric,
  fabricGrid,
  gauge,
  rasterRows,
  shapes,
  shapePlans,
  selectedShape,
  selectedShapeId,
  activeTool,
  viewMode,
  zoom,
  draftPoints,
  draftPathNodes,
  draftTool,
} = storeToRefs(store)

const host = ref<HTMLDivElement | null>(null)
const stageSize = ref({ width: 900, height: 600 })
const pan = ref<Point>({ x: 60, y: 40 })
const interaction = ref<Interaction | null>(null)
const pathPointer = ref<Point | null>(null)
const selectedPointIndex = ref<number | null>(null)
const selectedPathNodeIndex = ref<number | null>(null)
const selectedGridAnnotationSegment = ref<{ shapeId: string; segmentIndex: number } | null>(null)
const highlightedAnnotationKey = ref<string | null>(null)
const annotationHovered = ref(false)
const canvasBackgroundHovered = ref(false)
let resizeObserver: ResizeObserver | null = null

const canvasBoundaryPadding = 24
const annotationWidth = 224
const annotationLineHeight = 15
const annotationPaddingX = 10
const annotationPaddingY = 8
const annotationViewportMargin = 14
const annotationCollisionGap = 8
const annotationFabricGap = 38

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const fabricWidthPx = computed(() => fabric.value.widthCm * zoom.value)
const fabricHeightPx = computed(() => fabric.value.heightCm * zoom.value)
const showRasterFill = computed(() => viewMode.value !== 'outline')
const showOutlineFill = computed(() => viewMode.value === 'outline' || viewMode.value === 'overlay')
const stageCursor = computed(() => {
  if (annotationHovered.value) return 'pointer'
  if (interaction.value?.kind === 'pan') return 'grabbing'
  if (interaction.value?.kind === 'move') return 'grabbing'
  if (canvasBackgroundHovered.value && (activeTool.value === 'select' || activeTool.value === 'pan')) {
    return 'grab'
  }
  if (activeTool.value === 'pan') return 'move'
  if (activeTool.value === 'polygon' || activeTool.value === 'path') return 'crosshair'
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

function annotationCardTarget(name: string): { shapeId: string; segmentIndex: number } | null {
  const prefix = 'outline-card:'
  if (!name.startsWith(prefix)) return null
  const [shapeId, segmentIndexText] = name.slice(prefix.length).split('|')
  const segmentIndex = Number(segmentIndexText)
  return shapeId && Number.isInteger(segmentIndex) ? { shapeId, segmentIndex } : null
}

function layoutAnnotationSide(
  drafts: AnnotationDraft[],
): Array<AnnotationDraft & { y: number }> {
  const top = annotationViewportMargin
  const bottom = stageSize.value.height - annotationViewportMargin
  const placed = [...drafts]
    .sort((left, right) => left.preferredY - right.preferredY)
    .map((draft) => ({
      ...draft,
      y: clamp(draft.preferredY, top, bottom - draft.height),
    }))

  placed.forEach((current, index) => {
    const previous = placed[index - 1]
    if (previous && current.y < previous.y + previous.height + annotationCollisionGap) {
      current.y = previous.y + previous.height + annotationCollisionGap
    }
  })

  const last = placed.at(-1)
  const upwardShift = last ? Math.max(0, last.y + last.height - bottom) : 0
  if (upwardShift) placed.forEach((item) => (item.y -= upwardShift))
  const first = placed[0]
  const downwardShift = first ? Math.max(0, top - first.y) : 0
  if (downwardShift) placed.forEach((item) => (item.y += downwardShift))

  return placed
}

function connectorPoints(annotation: AnnotationDraft & { y: number }): number[] {
  const isLeft = annotation.side === 'left'
  const fabricEdgeX = isLeft
    ? pan.value.x - annotationFabricGap / 2
    : pan.value.x + fabricWidthPx.value + annotationFabricGap / 2
  const cardEdgeX = isLeft ? annotation.x + annotation.width : annotation.x
  const endY = clamp(
    annotation.anchorY,
    annotation.y + annotationPaddingY + annotationLineHeight / 2,
    annotation.y + annotation.height - annotationPaddingY - annotationLineHeight / 2,
  )
  return [
    annotation.anchorX,
    annotation.anchorY,
    fabricEdgeX,
    annotation.anchorY,
    fabricEdgeX,
    endY,
    cardEdgeX,
    endY,
  ]
}

function directionLabel(direction: (typeof shapePlans.value)[number]['direction']): string {
  return direction === 'bottom-up' ? '↑ 下→上' : '↓ 上→下'
}

function toggleAnnotationDirection(shapeId: string): void {
  const plan = shapePlans.value.find((item) => item.shapeId === shapeId)
  if (!plan) return
  store.setShapeDirection(
    shapeId,
    plan.direction === 'bottom-up' ? 'top-down' : 'bottom-up',
  )
}

const shapingAnnotations = computed<ShapingAnnotation[]>(() => {
  if (viewMode.value !== 'outline' && viewMode.value !== 'grid') return []
  const planByShapeId = new Map(shapePlans.value.map((plan) => [plan.shapeId, plan]))
  const drafts: AnnotationDraft[] = []
  const shapeBounds = shapes.value.map(getShapeBounds)
  const outlineLeft = shapeBounds.length ? Math.min(...shapeBounds.map((bounds) => bounds.x)) : 0
  const outlineRight = shapeBounds.length
    ? Math.max(...shapeBounds.map((bounds) => bounds.x + bounds.width))
    : fabric.value.widthCm
  const outlineCenterX = (outlineLeft + outlineRight) / 2
  const allSegments = shapes.value.flatMap(getShapeBoundarySegments)
  const annotatedSegments = viewMode.value === 'grid'
    ? allSegments.filter((segment) =>
      segment.shapeId === selectedGridAnnotationSegment.value?.shapeId
      && segment.segmentIndex === selectedGridAnnotationSegment.value?.segmentIndex,
    )
    : allSegments

  for (const segment of annotatedSegments) {
    const shapePlan = planByShapeId.get(segment.shapeId)
    if (!shapePlan) continue
    const description = describeBoundarySegmentShaping(
      segment,
      shapePlan.direction,
      gauge.value,
      fabric.value,
      store.rasterOptions,
      outlineCenterX,
    )
    const sidePrefix = description.boundarySide === 'left'
      ? '左边界'
      : description.boundarySide === 'right' ? '右边界' : null
    const ruleLines = sidePrefix
      ? description.lines.map((line) => `${sidePrefix} · ${line}`)
      : description.lines
    const shapeName = segment.sourceShape.name ?? '未命名织片'
    const lines = [
      `${shapeName} · 第 ${segment.segmentIndex + 1} 段 · ${directionLabel(shapePlan.direction)}`,
      ...ruleLines,
    ]
    const duplicateProcess = drafts.some((draft) =>
      draft.shapeId === segment.shapeId
      && JSON.stringify(draft.lines.slice(1)) === JSON.stringify(lines.slice(1)),
    )
    if (duplicateProcess) continue
    const height = annotationPaddingY * 2 + lines.length * annotationLineHeight
    const isCentered = Math.abs(segment.anchor.x - outlineCenterX) < 0.001
    const side = segment.anchor.x < outlineCenterX || (isCentered && segment.segmentIndex % 2 === 0)
      ? 'left'
      : 'right'
    const anchorX = pan.value.x + segment.anchor.x * zoom.value
    const anchorY = pan.value.y + (fabric.value.heightCm - segment.anchor.y) * zoom.value

    drafts.push({
      key: segment.key,
      shapeId: segment.shapeId,
      shapeName,
      segmentIndex: segment.segmentIndex,
      side,
      anchorX,
      anchorY,
      x: side === 'left'
        ? annotationViewportMargin
        : stageSize.value.width - annotationViewportMargin - annotationWidth,
      preferredY: anchorY - height / 2,
      width: annotationWidth,
      height,
      lines,
      markers: description.markers.map((marker) => ({
        label: marker.label,
        x: pan.value.x + marker.point.x * zoom.value,
        y: pan.value.y + (fabric.value.heightCm - marker.point.y) * zoom.value,
      })),
    })
  }

  const placed = [
    ...layoutAnnotationSide(drafts.filter((draft) => draft.side === 'left')),
    ...layoutAnnotationSide(drafts.filter((draft) => draft.side === 'right')),
  ]
  return placed.map((annotation) => ({
    ...annotation,
    connectorPoints: connectorPoints(annotation),
  }))
})

function annotationIsHighlighted(key: string): boolean {
  return highlightedAnnotationKey.value === key
}

function annotationLineColor(line: string, lineIndex: number): string {
  if (lineIndex === 0) return '#287d72'
  if (line.includes('加')) return '#237351'
  if (line.includes('减')) return '#b24631'
  return '#666b67'
}

function annotationLineIsBold(line: string, lineIndex: number): boolean {
  return lineIndex === 0 || line.includes('加') || line.includes('减')
}

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

function pathData(shape: PathShape): string {
  const first = shape.nodes[0]
  if (!first) return ''
  const start = toCanvasPoint(first.anchor)
  const commands = [`M ${start.x} ${start.y}`]
  for (let index = 0; index < pathSegmentCount(shape); index += 1) {
    const current = shape.nodes[index]
    const next = shape.nodes[(index + 1) % shape.nodes.length]
    if (!current || !next) continue
    const end = toCanvasPoint(next.anchor)
    if (current.outControl || next.inControl) {
      const control1 = toCanvasPoint(current.outControl ?? current.anchor)
      const control2 = toCanvasPoint(next.inControl ?? next.anchor)
      commands.push(`C ${control1.x} ${control1.y} ${control2.x} ${control2.y} ${end.x} ${end.y}`)
    } else {
      commands.push(`L ${end.x} ${end.y}`)
    }
  }
  if (shape.closed) commands.push('Z')
  return commands.join(' ')
}

function shapeConfig(shape: Shape): Record<string, unknown> {
  const common = {
    name: `shape:${shape.id}`,
    stroke: '#b24631',
    strokeWidth: selectedShapeId.value === shape.id ? 2.2 : 1.5,
    fill: showOutlineFill.value ? 'rgba(40, 125, 114, 0.16)' : 'transparent',
    fillEnabled: showOutlineFill.value,
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
    case 'path':
      return {
        ...common,
        data: pathData(shape),
        fill: shape.closed && showOutlineFill.value ? common.fill : 'transparent',
        fillEnabled: shape.closed && showOutlineFill.value,
        lineCap: 'round',
        lineJoin: 'round',
      }
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

const pathAnchorHandles = computed(() => {
  if (selectedShape.value?.type !== 'path' || activeTool.value !== 'select') return []
  return selectedShape.value.nodes.map((node, index) => ({ index, ...toCanvasPoint(node.anchor) }))
})

const pathControlHandles = computed(() => {
  if (selectedShape.value?.type !== 'path' || activeTool.value !== 'select') return []
  return selectedShape.value.nodes.flatMap((node, nodeIndex) => {
    const anchor = toCanvasPoint(node.anchor)
    return (['inControl', 'outControl'] as const).flatMap((control) => {
      const point = node[control]
      if (!point) return []
      const canvasPoint = toCanvasPoint(point)
      return [{ nodeIndex, control, anchor, ...canvasPoint }]
    })
  })
})

const pathMidpointHandles = computed(() => {
  if (selectedShape.value?.type !== 'path' || activeTool.value !== 'select') return []
  return Array.from({ length: pathSegmentCount(selectedShape.value) }, (_, segmentIndex) => ({
    segmentIndex,
    ...toCanvasPoint(evaluatePathSegment(selectedShape.value as PathShape, segmentIndex, 0.5)),
  }))
})

const draftCanvasPoints = computed(() =>
  draftPoints.value.flatMap((point) => {
    const canvasPoint = toCanvasPoint(point)
    return [canvasPoint.x, canvasPoint.y]
  }),
)

const draftPath = computed<PathShape | null>(() => draftPathNodes.value.length
  ? { id: 'draft-path', type: 'path', nodes: draftPathNodes.value, closed: false }
  : null,
)

const pathSnapDistanceCm = computed(() => 12 / zoom.value)
const existingOpenPaths = computed(() =>
  shapes.value.filter((shape): shape is PathShape => shape.type === 'path' && !shape.closed),
)
const pathSnapPreview = computed(() => {
  if (activeTool.value !== 'path' || !pathPointer.value) return null
  const first = draftPathNodes.value[0]?.anchor
  if (
    first &&
    draftPathNodes.value.length >= 3 &&
    Math.hypot(pathPointer.value.x - first.x, pathPointer.value.y - first.y) <= pathSnapDistanceCm.value
  ) {
    return { point: first, kind: 'close' as const }
  }
  const snap = findNearestOpenPathEndpoint(
    existingOpenPaths.value,
    pathPointer.value,
    pathSnapDistanceCm.value,
  )
  return snap ? { point: snap.point, kind: 'endpoint' as const } : null
})

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

function isCanvasBackground(name: string): boolean {
  return name === '' || name === 'fabric'
}

function clampPan(nextPan: Point): Point {
  const clampAxis = (
    offset: number,
    contentSize: number,
    viewportSize: number,
    padding: number,
  ): number => {
    const start = padding
    const end = viewportSize - contentSize - padding
    return Math.min(Math.max(offset, Math.min(start, end)), Math.max(start, end))
  }

  const horizontalPadding = viewMode.value === 'outline' || viewMode.value === 'grid'
    ? annotationViewportMargin + annotationWidth + annotationFabricGap
    : canvasBoundaryPadding

  return {
    x: clampAxis(nextPan.x, fabricWidthPx.value, stageSize.value.width, horizontalPadding),
    y: clampAxis(nextPan.y, fabricHeightPx.value, stageSize.value.height, canvasBoundaryPadding),
  }
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
  if (!pointer) return

  const name = targetName(event)
  const isPrimaryCanvasDrag = event.evt.button === 0
    && isCanvasBackground(name)
    && (activeTool.value === 'select' || activeTool.value === 'pan')
  if (event.evt.button === 1 || isPrimaryCanvasDrag) {
    if (isPrimaryCanvasDrag && activeTool.value === 'select') {
      selectedShapeId.value = null
      if (viewMode.value === 'grid') selectedGridAnnotationSegment.value = null
      selectedPointIndex.value = null
      selectedPathNodeIndex.value = null
    }
    interaction.value = { kind: 'pan', start: pointer, origin: { ...pan.value } }
    return
  }
  const annotationTarget = annotationCardTarget(name)
  if (annotationTarget) {
    toggleAnnotationDirection(annotationTarget.shapeId)
    return
  }
  if (activeTool.value === 'polygon' || activeTool.value === 'path') return

  if (viewMode.value === 'grid' && name.startsWith('shape:')) {
    const shapeId = name.slice('shape:'.length)
    const shape = shapes.value.find((item) => item.id === shapeId)
    const segment = shape
      ? findNearestBoundarySegment(shape, worldFromScreen(pointer))
      : null
    selectedGridAnnotationSegment.value = segment
      ? { shapeId, segmentIndex: segment.segmentIndex }
      : null
  }

  if (activeTool.value === 'pan') {
    if (!name.startsWith('shape:')) return
    const id = name.slice('shape:'.length)
    const shape = shapes.value.find((item) => item.id === id)
    if (!shape) return
    selectedShapeId.value = id
    selectedPointIndex.value = null
    selectedPathNodeIndex.value = null
    beginMove(shape, pointer)
    return
  }

  if (activeTool.value !== 'select') return

  if (name.startsWith('path-anchor:') && selectedShape.value?.type === 'path') {
    const nodeIndex = Number(name.split(':')[1])
    const shape = clonePlain(selectedShape.value)
    selectedPathNodeIndex.value = nodeIndex
    selectedPointIndex.value = null
    store.beginShapeMutation()
    interaction.value = {
      kind: 'path-anchor',
      nodeIndex,
      shape,
      symmetry: detectPathSymmetry(
        shape,
        gauge.value.stitchWidthCm * 0.55,
        gauge.value.stitchWidthCm / 2,
      ),
    }
    return
  }
  if (name.startsWith('path-control:') && selectedShape.value?.type === 'path') {
    const [, control, nodeIndexText] = name.split(':')
    const nodeIndex = Number(nodeIndexText)
    const shape = clonePlain(selectedShape.value)
    selectedPathNodeIndex.value = nodeIndex
    selectedPointIndex.value = null
    store.beginShapeMutation()
    interaction.value = {
      kind: 'path-control',
      nodeIndex,
      control: control as 'inControl' | 'outControl',
      shape,
      symmetry: detectPathSymmetry(
        shape,
        gauge.value.stitchWidthCm * 0.55,
        gauge.value.stitchWidthCm / 2,
      ),
    }
    return
  }
  if (name.startsWith('path-midpoint:') && selectedShape.value?.type === 'path') {
    const segmentIndex = Number(name.split(':')[1])
    const shape = clonePlain(selectedShape.value)
    selectedPathNodeIndex.value = null
    selectedPointIndex.value = null
    store.beginShapeMutation()
    interaction.value = {
      kind: 'path-midpoint',
      segmentIndex,
      shape,
      symmetry: detectPathSymmetry(
        shape,
        gauge.value.stitchWidthCm * 0.55,
        gauge.value.stitchWidthCm / 2,
      ),
    }
    return
  }
  if (name.startsWith('point:') && selectedShape.value?.type === 'polygon') {
    const pointIndex = Number(name.split(':')[2])
    selectedPointIndex.value = pointIndex
    selectedPathNodeIndex.value = null
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
    selectedPathNodeIndex.value = null
    return
  }
  selectedShapeId.value = null
  if (viewMode.value === 'grid') selectedGridAnnotationSegment.value = null
  selectedPointIndex.value = null
  selectedPathNodeIndex.value = null
}

function onMouseMove(event: KonvaEventObject<MouseEvent>): void {
  const pointer = pointerFromEvent(event)
  const current = interaction.value
  if (!pointer) return
  const name = targetName(event)
  const annotationTarget = annotationCardTarget(name)
  canvasBackgroundHovered.value = isCanvasBackground(name)
  annotationHovered.value = Boolean(annotationTarget)
  highlightedAnnotationKey.value = annotationTarget
    ? `${annotationTarget.shapeId}:${annotationTarget.segmentIndex}`
    : null
  pathPointer.value = activeTool.value === 'path' ? worldFromScreen(pointer, true) : null
  if (!current) return

  if (current.kind === 'pan') {
    pan.value = clampPan({
      x: current.origin.x + pointer.x - current.start.x,
      y: current.origin.y + pointer.y - current.start.y,
    })
    return
  }

  const world = worldFromScreen(
    pointer,
    current.kind === 'point' || current.kind === 'path-anchor',
  )
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
  } else if (current.kind === 'path-anchor') {
    store.updateShapeLive(movePathNodeWithSymmetry(
      current.shape,
      current.nodeIndex,
      world,
      current.symmetry,
    ))
  } else if (current.kind === 'path-control') {
    store.updateShapeLive(movePathControlWithSymmetry(
      current.shape,
      current.nodeIndex,
      current.control,
      world,
      current.symmetry,
    ))
  } else if (current.kind === 'path-midpoint') {
    store.updateShapeLive(bendPathSegmentWithSymmetry(
      current.shape,
      current.segmentIndex,
      world,
      current.symmetry,
    ))
  }
}

function endInteraction(): void {
  if (interaction.value && interaction.value.kind !== 'pan') store.commitShapeMutation()
  interaction.value = null
}

function onMouseLeave(): void {
  pathPointer.value = null
  annotationHovered.value = false
  canvasBackgroundHovered.value = false
  highlightedAnnotationKey.value = null
  endInteraction()
}

function onStageClick(event: KonvaEventObject<MouseEvent>): void {
  if (annotationCardTarget(targetName(event))) return
  if (activeTool.value !== 'polygon' && activeTool.value !== 'path') return
  const pointer = pointerFromEvent(event)
  if (!pointer) return
  const rawPoint = worldFromScreen(pointer, true)

  if (activeTool.value === 'path') {
    const first = draftPathNodes.value[0]?.anchor
    if (
      first &&
      draftPathNodes.value.length >= 3 &&
      Math.hypot(rawPoint.x - first.x, rawPoint.y - first.y) <= pathSnapDistanceCm.value
    ) {
      finishPath(true)
      return
    }
    const endpointSnap = findNearestOpenPathEndpoint(
      existingOpenPaths.value,
      rawPoint,
      pathSnapDistanceCm.value,
    )
    const point = endpointSnap?.point ?? rawPoint
    store.addDraftPathNode({ anchor: point })
    return
  }

  const point = rawPoint
  const first = draftPoints.value[0]

  if (
    first &&
    draftPoints.value.length >= 3 &&
    Math.hypot(point.x - first.x, point.y - first.y) <= 0.55
  ) {
    finishPolygon()
    return
  }
  store.addDraftPoint(point)
}

function finishPolygon(): void {
  if (draftPoints.value.length < 3) return
  store.finishPolygonDraft()
}

function finishPath(closed: boolean): void {
  const minimum = closed ? 3 : 2
  if (draftPathNodes.value.length < minimum) return
  store.finishPathDraft(closed)
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
  if (activeTool.value !== 'select' || !selectedShape.value) return
  const name = targetName(event)
  const pointer = pointerFromEvent(event)
  if (!pointer) return
  const world = worldFromScreen(pointer, true)

  if (selectedShape.value.type === 'path') {
    if (!name.startsWith('shape:') && !name.startsWith('path-midpoint:')) return
    const nearest = name.startsWith('path-midpoint:')
      ? { segmentIndex: Number(name.split(':')[1]), t: 0.5 }
      : findNearestPathPosition(selectedShape.value, world)
    const symmetry = detectPathSymmetry(
      selectedShape.value,
      gauge.value.stitchWidthCm * 0.55,
      gauge.value.stitchWidthCm / 2,
    )
    const result = splitPathSegmentWithSymmetry(
      selectedShape.value,
      nearest.segmentIndex,
      nearest.t,
      symmetry,
    )
    if (result.insertedIndex !== -1) {
      store.replaceShape(result.path)
      selectedPathNodeIndex.value = result.insertedIndex
    }
    return
  }
  if (selectedShape.value.type !== 'polygon') return
  if (!name.startsWith('shape:')) return
  const shape = clonePlain(selectedShape.value)
  const insertion = nearestEdgeInsertion(shape, world)
  shape.points.splice(insertion, 0, world)
  store.replaceShape(shape)
  selectedPointIndex.value = insertion
}

function onWheel(event: KonvaEventObject<WheelEvent>): void {
  if (!event.evt.ctrlKey && !event.evt.metaKey) return

  event.evt.preventDefault()
  const pointer = pointerFromEvent(event)
  if (!pointer) return

  const oldZoom = zoom.value
  const nextZoom = Math.min(60, Math.max(5, oldZoom * (event.evt.deltaY > 0 ? 0.9 : 1.1)))
  const localX = (pointer.x - pan.value.x) / oldZoom
  const localY = (pointer.y - pan.value.y) / oldZoom
  zoom.value = nextZoom
  pan.value = clampPan({
    x: pointer.x - localX * nextZoom,
    y: pointer.y - localY * nextZoom,
  })
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    store.cancelDrawing()
    interaction.value = null
    if (activeTool.value === 'polygon' || activeTool.value === 'path') activeTool.value = 'select'
    return
  }
  if (event.key === 'Enter' && activeTool.value === 'polygon') {
    event.preventDefault()
    finishPolygon()
    return
  }
  if (event.key === 'Enter' && activeTool.value === 'path') {
    event.preventDefault()
    finishPath(false)
    return
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedShape.value) {
    event.preventDefault()
    if (selectedShape.value.type === 'path' && selectedPathNodeIndex.value !== null) {
      const minimum = selectedShape.value.closed ? 3 : 2
      if (selectedShape.value.nodes.length - 1 < minimum) {
        store.deleteSelected()
      } else {
        const shape = clonePlain(selectedShape.value)
        const symmetry = detectPathSymmetry(
          shape,
          gauge.value.stitchWidthCm * 0.55,
          gauge.value.stitchWidthCm / 2,
        )
        store.replaceShape(removePathNodeWithSymmetry(
          shape,
          selectedPathNodeIndex.value,
          symmetry,
        ))
      }
      selectedPathNodeIndex.value = null
    } else if (
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
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
    event.preventDefault()
    store.redo()
  }
}

function onWindowKeyDown(event: KeyboardEvent): void {
  const target = event.target
  if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) {
    return
  }
  const isDrawingShortcut =
    (activeTool.value === 'polygon' || activeTool.value === 'path') &&
    (event.key === 'Enter' || event.key === 'Escape')
  const activeElement = document.activeElement
  const isCanvasFocused = Boolean(
    host.value && activeElement && (activeElement === host.value || host.value.contains(activeElement)),
  )
  if (isDrawingShortcut || isCanvasFocused) onKeyDown(event)
}

function fitCanvas(): void {
  const verticalPadding = 72
  const horizontalPadding = viewMode.value === 'outline' || viewMode.value === 'grid'
    ? annotationViewportMargin + annotationWidth + annotationFabricGap
    : verticalPadding
  const nextZoom = Math.min(
    48,
    Math.max(
      5,
      Math.min(
        (stageSize.value.width - horizontalPadding * 2) / fabric.value.widthCm,
        (stageSize.value.height - verticalPadding * 2) / fabric.value.heightCm,
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
      width: Math.max(1, entry.contentRect.width),
      height: Math.max(1, entry.contentRect.height),
    }
    pan.value = clampPan(pan.value)
  })
  resizeObserver.observe(host.value)
  window.addEventListener('keydown', onWindowKeyDown)
  nextTick(fitCanvas)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('keydown', onWindowKeyDown)
})
watch(() => [fabric.value.widthCm, fabric.value.heightCm], () => nextTick(fitCanvas))
watch(zoom, () => nextTick(() => (pan.value = clampPan(pan.value))))
watch(activeTool, (tool) => {
  if (draftTool.value && tool !== draftTool.value) store.cancelDrawing()
  if (tool !== 'path') pathPointer.value = null
})
watch(selectedShapeId, () => {
  selectedPointIndex.value = null
  selectedPathNodeIndex.value = null
})
watch(viewMode, (mode, previousMode) => {
  if (mode === 'grid' && previousMode !== 'grid') selectedGridAnnotationSegment.value = null
  nextTick(fitCanvas)
})
watch(() => shapes.value.map((shape) => shape.id), (shapeIds) => {
  if (
    selectedGridAnnotationSegment.value
    && !shapeIds.includes(selectedGridAnnotationSegment.value.shapeId)
  ) {
    selectedGridAnnotationSegment.value = null
  }
})
defineExpose({ fitCanvas })
</script>

<template>
  <div ref="host" class="knitting-canvas" tabindex="0" :style="{ cursor: stageCursor }">
    <v-stage :config="{ width: stageSize.width, height: stageSize.height }"
      @mousedown="onMouseDown" @mousemove="onMouseMove" @mouseup="endInteraction"
      @mouseleave="onMouseLeave" @click="onStageClick" @dblclick="onDoubleClick" @wheel="onWheel">
      <v-layer>
        <v-group :config="{ x: pan.x, y: pan.y }">
          <v-rect :config="{
            name: 'fabric', x: 0, y: 0, width: fabricWidthPx, height: fabricHeightPx,
            fill: '#fffdf8', stroke: '#cfc7b9', strokeWidth: 1, shadowColor: '#4a3f35',
            shadowBlur: 18, shadowOpacity: 0.12, shadowOffsetY: 6,
          }" />

          <template v-if="showRasterFill">
            <v-rect v-for="band in rasterBands" :key="band.key" :config="{
              ...band, fill: '#263d36', opacity: viewMode === 'overlay' ? 0.7 : 0.92,
            }" />
          </template>

          <v-line v-for="(x, index) in verticalLines" :key="`v-${index}`"
            :config="{ points: [x, 0, x, fabricHeightPx], stroke: index % 5 === 0 ? '#a59d90' : '#d8d2c8', strokeWidth: index % 5 === 0 ? 0.8 : 0.45, listening: false }" />
          <v-line v-for="(y, index) in horizontalLines" :key="`h-${index}`"
            :config="{ points: [0, y, fabricWidthPx, y], stroke: index % 5 === 0 ? '#a59d90' : '#d8d2c8', strokeWidth: index % 5 === 0 ? 0.8 : 0.45, listening: false }" />

          <template v-for="shape in shapes" :key="shape.id">
            <v-rect v-if="shape.type === 'rectangle'" :config="shapeConfig(shape)" />
            <v-circle v-else-if="shape.type === 'circle'" :config="shapeConfig(shape)" />
            <v-ellipse v-else-if="shape.type === 'ellipse'" :config="shapeConfig(shape)" />
            <v-path v-else-if="shape.type === 'path'" :config="shapeConfig(shape)" />
            <v-line v-else :config="shapeConfig(shape)" />
          </template>

          <template v-if="selectionRect">
            <v-rect :config="{ ...selectionRect, stroke: '#287d72', strokeWidth: 1.3, dash: [5, 4], listening: false }" />
            <v-circle v-for="handle in resizeHandles" :key="handle.corner" :config="{
              name: `resize:${handle.corner}`, x: handle.x, y: handle.y, radius: 5,
              fill: '#fffdf8', stroke: '#287d72', strokeWidth: 2,
            }" />
          </template>

          <v-circle v-for="handle in polygonHandles" :key="`point-${handle.index}`" :config="{
            name: `point:${selectedShapeId}:${handle.index}`, x: handle.x, y: handle.y,
            radius: selectedPointIndex === handle.index ? 6 : 4.5,
            fill: selectedPointIndex === handle.index ? '#e3a43b' : '#fffdf8',
            stroke: '#b24631', strokeWidth: 1.8,
          }" />

          <template v-if="pathAnchorHandles.length">
            <v-line v-for="handle in pathControlHandles" :key="`guide-${handle.control}-${handle.nodeIndex}`"
              :config="{
                points: [handle.anchor.x, handle.anchor.y, handle.x, handle.y],
                stroke: '#7e9b94', strokeWidth: 1, dash: [3, 3], listening: false,
              }" />
            <v-circle v-for="handle in pathMidpointHandles" :key="`path-mid-${handle.segmentIndex}`"
              :config="{
                name: `path-midpoint:${handle.segmentIndex}`, x: handle.x, y: handle.y,
                radius: 4.5, fill: '#e3a43b', stroke: '#fffdf8', strokeWidth: 1.5,
              }" />
            <v-circle v-for="handle in pathControlHandles" :key="`control-${handle.control}-${handle.nodeIndex}`"
              :config="{
                name: `path-control:${handle.control}:${handle.nodeIndex}`,
                x: handle.x, y: handle.y, radius: 4,
                fill: '#fffdf8', stroke: '#287d72', strokeWidth: 1.7,
              }" />
            <v-rect v-for="handle in pathAnchorHandles" :key="`anchor-${handle.index}`" :config="{
              name: `path-anchor:${handle.index}`, x: handle.x - 4.5, y: handle.y - 4.5,
              width: 9, height: 9,
              fill: selectedPathNodeIndex === handle.index ? '#e3a43b' : '#fffdf8',
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

          <template v-if="draftPath">
            <v-path :config="{
              data: pathData(draftPath), stroke: '#b24631', strokeWidth: 2,
              fill: 'transparent', dash: [7, 4], listening: false,
            }" />
            <v-rect v-for="(node, index) in draftPathNodes" :key="`draft-path-${index}`" :config="{
              x: toCanvasPoint(node.anchor).x - (index === 0 ? 5 : 3.5),
              y: toCanvasPoint(node.anchor).y - (index === 0 ? 5 : 3.5),
              width: index === 0 ? 10 : 7, height: index === 0 ? 10 : 7,
              fill: index === 0 ? '#e3a43b' : '#fffdf8',
              stroke: '#b24631', strokeWidth: 2, listening: false,
            }" />
          </template>

          <v-circle v-if="pathSnapPreview" :config="{
            x: toCanvasPoint(pathSnapPreview.point).x,
            y: toCanvasPoint(pathSnapPreview.point).y,
            radius: 8, stroke: '#287d72', strokeWidth: 2.2,
            fill: 'rgba(40, 125, 114, 0.14)', dash: [3, 2], listening: false,
          }" />
        </v-group>

        <template v-if="viewMode === 'outline' || viewMode === 'grid'">
          <v-line v-for="annotation in shapingAnnotations" :key="`${annotation.key}-connector`"
            :config="{
              points: annotation.connectorPoints,
              stroke: annotationIsHighlighted(annotation.key) ? '#b24631' : '#8b8175',
              strokeWidth: annotationIsHighlighted(annotation.key) ? 1.6 : 1,
              opacity: annotationIsHighlighted(annotation.key) ? 0.9 : 0.62,
              dash: [5, 4], lineCap: 'round', lineJoin: 'round', listening: false,
            }" />
          <template v-for="annotation in shapingAnnotations" :key="`${annotation.key}-markers`">
            <v-group v-for="(marker, markerIndex) in annotation.markers"
              :key="`${annotation.key}-marker-${markerIndex}`"
              :config="{ x: marker.x, y: marker.y, listening: false }">
              <v-circle :config="{
                radius: annotationIsHighlighted(annotation.key) ? 10 : 9,
                fill: annotationIsHighlighted(annotation.key) ? '#b24631' : '#287d72',
                stroke: '#fffdf8', strokeWidth: 2,
                shadowColor: '#263d36', shadowBlur: 4, shadowOpacity: 0.2,
              }" />
              <v-text :config="{
                x: -8, y: -7, width: 16, height: 14, text: marker.label,
                align: 'center', verticalAlign: 'middle', fill: '#fffdf8',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 10, fontStyle: 'bold', listening: false,
              }" />
            </v-group>
          </template>
          <v-group v-for="annotation in shapingAnnotations" :key="annotation.key"
            :config="{ x: annotation.anchorX, y: annotation.anchorY, listening: false }">
            <v-rect :config="{
              x: -11, y: -11, width: 22, height: 22,
              fill: annotationIsHighlighted(annotation.key) ? '#b24631' : '#263d36',
              stroke: '#fffdf8', strokeWidth: 2, cornerRadius: 11,
              shadowColor: '#263d36', shadowBlur: 5, shadowOpacity: 0.2,
              shadowOffsetY: 2, listening: false,
            }" />
            <v-text :config="{
              x: -9, y: -7, width: 18, height: 14,
              text: `${annotation.segmentIndex + 1}`, align: 'center', verticalAlign: 'middle',
              fill: '#fffdf8', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 9, fontStyle: 'bold', listening: false,
            }" />
          </v-group>

          <v-group v-for="annotation in shapingAnnotations" :key="`${annotation.key}-card`"
            :config="{ x: annotation.x, y: annotation.y, listening: activeTool !== 'path' }">
            <v-rect :config="{
              name: `outline-card:${annotation.shapeId}|${annotation.segmentIndex}`,
              width: annotation.width, height: annotation.height,
              fill: annotationIsHighlighted(annotation.key)
                ? 'rgba(255, 250, 244, 0.99)'
                : 'rgba(255, 253, 248, 0.96)',
              stroke: annotationIsHighlighted(annotation.key) ? '#c78b7e' : '#d8c9bd',
              strokeWidth: annotationIsHighlighted(annotation.key) ? 1.4 : 1,
              cornerRadius: 7, shadowColor: '#4a3f35', shadowBlur: 8,
              shadowOpacity: 0.12, shadowOffsetY: 2, listening: activeTool !== 'path',
            }" />
            <v-rect :config="{
              x: 0, y: 8, width: 3, height: annotation.height - 16,
              fill: annotationIsHighlighted(annotation.key) ? '#b24631' : '#287d72',
              cornerRadius: [0, 2, 2, 0], listening: false,
            }" />
            <v-circle :config="{
              x: annotationPaddingX + 7,
              y: annotationPaddingY + annotationLineHeight / 2,
              radius: 7,
              fill: annotationIsHighlighted(annotation.key) ? '#b24631' : '#263d36',
              stroke: '#fffdf8', strokeWidth: 1.4,
              listening: false,
            }" />
            <v-text :config="{
              x: annotationPaddingX + 1,
              y: annotationPaddingY + 2,
              width: 12,
              height: annotationLineHeight - 4,
              text: `${annotation.segmentIndex + 1}`,
              align: 'center', verticalAlign: 'middle',
              fill: '#fffdf8',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 8, fontStyle: 'bold', listening: false,
            }" />
            <v-text v-for="(line, lineIndex) in annotation.lines"
              :key="`${annotation.key}-line-${lineIndex}`" :config="{
                x: annotationPaddingX + (lineIndex === 0 ? 20 : 0),
                y: annotationPaddingY + lineIndex * annotationLineHeight,
                width: annotation.width - annotationPaddingX * 2 - (lineIndex === 0 ? 20 : 0),
                height: annotationLineHeight,
                text: line,
                fill: annotationLineColor(line, lineIndex),
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: lineIndex === 0 ? 9.5 : 10,
                fontStyle: annotationLineIsBold(line, lineIndex) ? 'bold' : 'normal',
                verticalAlign: 'middle', listening: false,
              }" />
          </v-group>
        </template>
      </v-layer>
    </v-stage>

    <div v-if="viewMode === 'grid' && !selectedGridAnnotationSegment"
      class="canvas-hud canvas-hud--selection-tip">
      <b>点击红色轮廓</b>
      <span>查看该对象的加减针规律与编织方向</span>
    </div>
    <div v-if="activeTool === 'polygon'" class="polygon-hint">
      <b>多边形描点</b>
      <span>点击添加节点 · 点击起点或 Enter 闭合 · ESC 取消</span>
    </div>
    <div v-if="activeTool === 'path'" class="polygon-hint path-hint">
      <b>贝塞尔路径</b>
      <span>点击添加锚点 · 靠近端点自动吸附 · 点击起点闭合 · ESC 取消</span>
      <button type="button" :disabled="draftPathNodes.length < 2"
        @mousedown.stop @click.stop="finishPath(false)">
        完成开放路径 <kbd>Enter</kbd>
      </button>
    </div>
  </div>
</template>
