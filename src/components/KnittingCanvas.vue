<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { ShapeConfig as KonvaShapeConfig } from 'konva/lib/Shape'
import type { Stage } from 'konva/lib/Stage'
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
  flattenPath,
  movePathControlWithSymmetry,
  movePathNodeWithSymmetry,
  pathSegmentCount,
  removePathNodeWithSymmetry,
  splitPathSegmentWithSymmetry,
} from '../core/geometry/path'
import type { PathSymmetry } from '../core/geometry/path'
import { describeBoundarySegmentShaping } from '../core/knitting/segmentPlanner'
import {
  formatCm,
  formatDeviation,
} from '../core/dimensions/dimensionConversion'
import type {
  DimensionAxis,
  DimensionConversionResult,
  RoundingDirection,
} from '../core/dimensions/dimensionConversion'
import { useEditorStore } from '../stores/editor'
import { layoutMarkersGlobally } from './markerLayout'
import type { LineObstacle } from './markerLayout'

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
  markers: CanvasMarker[]
}

interface CanvasMarker {
  id: string
  label: string
  x: number
  y: number
  anchorX: number
  anchorY: number
}

interface AnnotationModel {
  key: string
  shapeId: string
  shapeName: string
  segmentIndex: number
  side: 'left' | 'right'
  anchor: Point
  width: number
  height: number
  lines: string[]
  markers: Array<{ label: string; point: Point }>
}

interface ShapingAnnotation extends Omit<AnnotationDraft, 'preferredY'> {
  y: number
  connectorPoints: number[]
}

interface TouchGesture {
  startCenter: Point
  startDistance: number
  startZoom: number
  startPan: Point
}

interface DimensionLabelModel {
  result: DimensionConversionResult
  x: number
  y: number
  width: number
  height: number
  title: string
  formula: string
  anchorX: number
  anchorY: number
  side: 'left' | 'right'
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
const stageRef = ref<{ getNode: () => Stage } | null>(null)
const stageSize = ref({ width: 1, height: 1 })
const canvasReady = ref(false)
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
let initializationFrameId: number | null = null
let initializationScheduled = false
let activePenPointerId: number | null = null
let touchGesture: TouchGesture | null = null
const touchPointers = new Map<number, Point>()
let interactionFrameId: number | null = null
let pendingInteractionPointer: Point | null = null
let suppressNextStageClick = false

const canvasBoundaryPadding = 24
const annotationWidth = 264
const annotationLineHeight = 18
const annotationPaddingX = 12
const annotationPaddingY = 10
const annotationViewportMargin = 14
const annotationCollisionGap = 10
const annotationFabricGap = 42

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

const rasterShapeConfig = computed<KonvaShapeConfig>(() => {
  const rows = rasterRows.value
  const stitchWidthPx = gauge.value.stitchWidthCm * zoom.value
  const rowHeightPx = gauge.value.rowHeightCm * zoom.value
  const height = fabricHeightPx.value

  return {
    width: fabricWidthPx.value,
    height,
    fill: '#8eada1',
    opacity: viewMode.value === 'overlay' ? 0.4 : 0.64,
    sceneFunc(context, shape) {
      context.beginPath()
      for (const row of rows) {
        const y = height - (row.rowIndex + 1) * rowHeightPx
        for (const segment of row.segments) {
          context.rect(
            segment.startStitch * stitchWidthPx,
            y,
            (segment.endStitch - segment.startStitch + 1) * stitchWidthPx,
            rowHeightPx,
          )
        }
      }
      context.fillShape(shape)
    },
  }
})

const gridShapeConfig = computed<KonvaShapeConfig>(() => {
  const columnCount = fabricGrid.value.columnCount
  const rowCount = fabricGrid.value.rowCount
  const stitchWidthPx = gauge.value.stitchWidthCm * zoom.value
  const rowHeightPx = gauge.value.rowHeightCm * zoom.value
  const width = fabricWidthPx.value
  const height = fabricHeightPx.value

  return {
    width,
    height,
    listening: false,
    sceneFunc(context) {
      const drawLines = (
        count: number,
        isMajor: boolean,
        pointAt: (index: number) => [number, number, number, number],
      ) => {
        context.beginPath()
        for (let index = 0; index <= count; index += 1) {
          if ((index % 5 === 0) !== isMajor) continue
          const [startX, startY, endX, endY] = pointAt(index)
          context.moveTo(startX, startY)
          context.lineTo(endX, endY)
        }
        context.setAttr('strokeStyle', isMajor ? '#a59d90' : '#d8d2c8')
        context.setAttr('lineWidth', isMajor ? 0.8 : 0.45)
        context.stroke()
      }

      drawLines(columnCount, false, (index) => {
        const x = index * stitchWidthPx
        return [x, 0, x, height]
      })
      drawLines(columnCount, true, (index) => {
        const x = index * stitchWidthPx
        return [x, 0, x, height]
      })
      drawLines(rowCount, false, (index) => {
        const y = height - index * rowHeightPx
        return [0, y, width, y]
      })
      drawLines(rowCount, true, (index) => {
        const y = height - index * rowHeightPx
        return [0, y, width, y]
      })
    },
  }
})

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

function dimensionButtonTarget(name: string): {
  shapeId: string
  axis: DimensionAxis
  direction: RoundingDirection
} | null {
  if (!name.startsWith('dimension|')) return null
  const [, shapeId, axis, direction] = name.split('|')
  if (!shapeId || (axis !== 'stitches' && axis !== 'rows')) return null
  if (direction !== 'floor' && direction !== 'ceil') return null
  return { shapeId, axis, direction }
}

function dimensionTargetName(result: DimensionConversionResult, direction: RoundingDirection): string {
  return `dimension|${result.shapeId}|${result.axis}|${direction}`
}

function dimensionUnit(axis: DimensionAxis): string {
  return axis === 'stitches' ? '针' : '行'
}

function dimensionPrefix(axis: DimensionAxis): string {
  return axis === 'stitches' ? '宽' : '高'
}

function dimensionOptionText(
  result: DimensionConversionResult,
  direction: RoundingDirection,
): string {
  const choice = result[direction]
  const effect = direction === 'floor'
    ? result.axis === 'stitches' ? '更窄，可能更贴身' : '更短，可能更贴身'
    : result.axis === 'stitches' ? '更宽，松量增加' : '更长，松量增加'
  return `${direction === 'floor' ? '向下' : '向上'} ${choice.count}${dimensionUnit(result.axis)} · ${formatCm(choice.actualCm)}cm (${formatDeviation(choice.deviationCm)})\n${effect}`
}

const dimensionLabels = computed<DimensionLabelModel[]>(() => {
  if (viewMode.value !== 'overlay') return []
  const drafts: Array<Omit<DimensionLabelModel, 'y' | 'connectorPoints'> & { preferredY: number }> = []
  for (const result of shapePlans.value.flatMap((plan) => plan.dimensions)) {
    const title = `${dimensionPrefix(result.axis)} ${formatCm(result.targetCm)}cm / ${result.selected?.count ?? '待定'}${dimensionUnit(result.axis)}`
    const formula = result.exact
      ? `${formatCm(result.targetCm)}cm × ${formatCm(result.densityPerCm)}${dimensionUnit(result.axis)}/cm = ${result.selected!.count}${dimensionUnit(result.axis)}`
      : `${formatCm(result.targetCm)}cm × ${formatCm(result.densityPerCm)}${dimensionUnit(result.axis)}/cm = ${formatCm(result.rawCount)}${dimensionUnit(result.axis)}`
    const width = stageSize.value.width < 800
      ? Math.max(160, Math.min(220, (stageSize.value.width - 26) / 2))
      : 280
    const height = result.confirmed ? 60 : 108
    const anchorX = pan.value.x + result.anchor.x * zoom.value
    const anchorY = pan.value.y + (fabric.value.heightCm - result.anchor.y) * zoom.value
    const relativeX = result.anchor.x - fabric.value.widthCm / 2
    const side = relativeX < -0.001
      ? 'left'
      : relativeX > 0.001
        ? 'right'
        : (result.segmentIndex + (result.axis === 'rows' ? 1 : 0)) % 2 === 0 ? 'left' : 'right'
    const x = side === 'left'
      ? clamp(pan.value.x - width - 14, 8, stageSize.value.width - width - 8)
      : clamp(pan.value.x + fabricWidthPx.value + 14, 8, stageSize.value.width - width - 8)
    drafts.push({
      result, x, preferredY: anchorY - height / 2, width, height, title, formula,
      anchorX, anchorY, side,
    })
  }

  const placeSide = (side: 'left' | 'right'): DimensionLabelModel[] => {
    const items = drafts.filter((draft) => draft.side === side)
      .sort((left, right) => left.preferredY - right.preferredY)
    const gap = items.length > 1
      ? Math.max(3, Math.min(8, (stageSize.value.height - 16 - items.reduce((sum, item) => sum + item.height, 0)) / (items.length - 1)))
      : 0
    let cursor = 8
    const placed = items.map((item) => {
      const y = Math.max(cursor, clamp(item.preferredY, 8, stageSize.value.height - item.height - 8))
      cursor = y + item.height + gap
      return { ...item, y }
    })
    const overflow = Math.max(0, (placed.at(-1)?.y ?? 0) + (placed.at(-1)?.height ?? 0) + 8 - stageSize.value.height)
    return placed.map((item) => {
      const y = item.y - overflow
      const edgeX = side === 'left' ? item.x + item.width : item.x
      return {
        ...item,
        y,
        connectorPoints: [item.anchorX, item.anchorY, edgeX, y + item.height / 2],
      }
    })
  }

  return [...placeSide('left'), ...placeSide('right')]
})

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

function markerRadius(label: string): number {
  return label.length > 1 ? 14 : 12
}

function markerFontSize(label: string): number {
  return label.length > 1 ? 11 : 13
}

function markerWasDisplaced(marker: CanvasMarker): boolean {
  return Math.hypot(marker.x - marker.anchorX, marker.y - marker.anchorY) > 1
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

const annotationModels = computed<AnnotationModel[]>(() => {
  if (viewMode.value !== 'outline' && viewMode.value !== 'grid') return []
  const planByShapeId = new Map(shapePlans.value.map((plan) => [plan.shapeId, plan]))
  const models: AnnotationModel[] = []
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
    const duplicateProcess = models.some((model) =>
      model.shapeId === segment.shapeId
      && JSON.stringify(model.lines.slice(1)) === JSON.stringify(lines.slice(1)),
    )
    if (duplicateProcess) continue
    const height = annotationPaddingY * 2 + lines.length * annotationLineHeight
    const isCentered = Math.abs(segment.anchor.x - outlineCenterX) < 0.001
    const side = segment.anchor.x < outlineCenterX || (isCentered && segment.segmentIndex % 2 === 0)
      ? 'left'
      : 'right'
    models.push({
      key: segment.key,
      shapeId: segment.shapeId,
      shapeName,
      segmentIndex: segment.segmentIndex,
      side,
      anchor: segment.anchor,
      width: annotationWidth,
      height,
      lines,
      markers: description.markers,
    })
  }

  return models
})

const outlineLineObstacles = computed(() =>
  shapes.value.flatMap(shapeOutlineLineObstacles),
)

const shapingAnnotations = computed<ShapingAnnotation[]>(() => {
  const drafts: AnnotationDraft[] = annotationModels.value.map((model) => {
    const anchorX = pan.value.x + model.anchor.x * zoom.value
    const anchorY = pan.value.y + (fabric.value.heightCm - model.anchor.y) * zoom.value
    return {
      ...model,
      anchorX,
      anchorY,
      x: model.side === 'left'
        ? annotationViewportMargin
        : stageSize.value.width - annotationViewportMargin - annotationWidth,
      preferredY: anchorY - model.height / 2,
      markers: model.markers.map((marker, markerIndex) => ({
        id: `${model.key}-marker-${markerIndex}`,
        label: marker.label,
        x: pan.value.x + marker.point.x * zoom.value,
        y: pan.value.y + (fabric.value.heightCm - marker.point.y) * zoom.value,
        anchorX: pan.value.x + marker.point.x * zoom.value,
        anchorY: pan.value.y + (fabric.value.heightCm - marker.point.y) * zoom.value,
      })),
    }
  })

  const placed = [
    ...layoutAnnotationSide(drafts.filter((draft) => draft.side === 'left')),
    ...layoutAnnotationSide(drafts.filter((draft) => draft.side === 'right')),
  ]
  const positionedMarkers = layoutMarkersGlobally(
    placed.flatMap((annotation) => annotation.markers.map((marker) => ({
      id: marker.id,
      label: marker.label,
      anchorX: marker.anchorX,
      anchorY: marker.anchorY,
      radius: markerRadius(marker.label),
      side: annotation.side,
    }))),
    {
      bounds: {
        left: annotationViewportMargin,
        top: annotationViewportMargin,
        right: stageSize.value.width - annotationViewportMargin,
        bottom: stageSize.value.height - annotationViewportMargin,
      },
      circleObstacles: placed.map((annotation) => ({
        x: annotation.anchorX,
        y: annotation.anchorY,
        radius: 12,
      })),
      rectangleObstacles: placed.map((annotation) => ({
        x: annotation.x,
        y: annotation.y,
        width: annotation.width,
        height: annotation.height,
      })),
      lineObstacles: outlineLineObstacles.value,
    },
  )
  const markerPositionById = new Map(positionedMarkers.map((marker) => [marker.id, marker]))

  return placed.map((annotation) => ({
    ...annotation,
    markers: annotation.markers.map((marker) => {
      const position = markerPositionById.get(marker.id)
      return position ? { ...marker, x: position.x, y: position.y } : marker
    }),
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

function toStagePoint(point: Point): Point {
  const canvasPoint = toCanvasPoint(point)
  return { x: pan.value.x + canvasPoint.x, y: pan.value.y + canvasPoint.y }
}

function pointsToLineObstacles(points: Point[], closed: boolean): LineObstacle[] {
  if (points.length < 2) return []
  const stagePoints = points.map(toStagePoint)
  const count = closed ? stagePoints.length : stagePoints.length - 1
  return Array.from({ length: count }, (_, index) => {
    const start = stagePoints[index]!
    const end = stagePoints[(index + 1) % stagePoints.length]!
    return {
      startX: start.x,
      startY: start.y,
      endX: end.x,
      endY: end.y,
    }
  })
}

function ellipseOutlinePoints(center: Point, radiusX: number, radiusY: number): Point[] {
  const sampleCount = 96
  return Array.from({ length: sampleCount }, (_, index) => {
    const angle = index / sampleCount * Math.PI * 2
    return {
      x: center.x + Math.cos(angle) * radiusX,
      y: center.y + Math.sin(angle) * radiusY,
    }
  })
}

function shapeOutlineLineObstacles(shape: Shape): LineObstacle[] {
  switch (shape.type) {
    case 'rectangle':
      return pointsToLineObstacles([
        { x: shape.x, y: shape.y },
        { x: shape.x + shape.widthCm, y: shape.y },
        { x: shape.x + shape.widthCm, y: shape.y + shape.heightCm },
        { x: shape.x, y: shape.y + shape.heightCm },
      ], true)
    case 'circle':
      return pointsToLineObstacles(
        ellipseOutlinePoints(shape.center, shape.radiusCm, shape.radiusCm),
        true,
      )
    case 'ellipse':
      return pointsToLineObstacles(
        ellipseOutlinePoints(shape.center, shape.radiusXcm, shape.radiusYcm),
        true,
      )
    case 'triangle':
    case 'polygon':
      return pointsToLineObstacles(shape.points, true)
    case 'path':
      return pointsToLineObstacles(flattenPath(shape), shape.closed)
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

function pointerFromEvent(event: KonvaEventObject<PointerEvent | WheelEvent>): Point | null {
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

function targetName(event: KonvaEventObject<PointerEvent>): string {
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

  // 三种显示模式共用同一个视口边界，切换模式时画布的位置不会因留白规则不同而变化。
  const horizontalPadding = annotationViewportMargin + annotationWidth + annotationFabricGap

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

function firstTwoTouchPoints(): [Point, Point] | null {
  const points = [...touchPointers.values()]
  return points.length >= 2 && points[0] && points[1] ? [points[0], points[1]] : null
}

function touchCenter(first: Point, second: Point): Point {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
}

function beginTouchGesture(): void {
  flushInteractionMove()
  const points = firstTwoTouchPoints()
  if (!points) return
  const [first, second] = points
  touchGesture = {
    startCenter: touchCenter(first, second),
    startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
    startZoom: zoom.value,
    startPan: { ...pan.value },
  }
  interaction.value = null
}

function updateTouchGesture(): void {
  const points = firstTwoTouchPoints()
  if (!touchGesture || !points) return
  const [first, second] = points
  const center = touchCenter(first, second)
  const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y))
  const nextZoom = Math.min(
    60,
    Math.max(5, touchGesture.startZoom * distance / touchGesture.startDistance),
  )
  const localX = (touchGesture.startCenter.x - touchGesture.startPan.x) / touchGesture.startZoom
  const localY = (touchGesture.startCenter.y - touchGesture.startPan.y) / touchGesture.startZoom
  zoom.value = nextZoom
  pan.value = clampPan({
    x: center.x - localX * nextZoom,
    y: center.y - localY * nextZoom,
  })
}

function onPointerDown(event: KonvaEventObject<PointerEvent>): void {
  host.value?.focus()
  const pointer = pointerFromEvent(event)
  if (!pointer) return
  const name = targetName(event)
  const dimensionTarget = dimensionButtonTarget(name)
  if (dimensionTarget) {
    event.evt.preventDefault()
    suppressNextStageClick = true
    store.setShapeRoundingDirection(
      dimensionTarget.shapeId,
      dimensionTarget.axis,
      dimensionTarget.direction,
    )
    return
  }

  if (event.evt.pointerType === 'touch') {
    if (activePenPointerId !== null) return
    event.evt.preventDefault()
    touchPointers.set(event.evt.pointerId, pointer)
    if (touchPointers.size >= 2) {
      beginTouchGesture()
    } else {
      interaction.value = { kind: 'pan', start: pointer, origin: { ...pan.value } }
    }
    return
  }
  if (event.evt.pointerType === 'pen') activePenPointerId = event.evt.pointerId

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

function applyInteractionMove(pointer: Point): void {
  const current = interaction.value
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

function flushInteractionMove(): void {
  if (interactionFrameId !== null) {
    cancelAnimationFrame(interactionFrameId)
    interactionFrameId = null
  }
  const pointer = pendingInteractionPointer
  pendingInteractionPointer = null
  if (pointer) applyInteractionMove(pointer)
}

function scheduleInteractionMove(pointer: Point): void {
  pendingInteractionPointer = pointer
  if (interactionFrameId !== null) return
  interactionFrameId = requestAnimationFrame(() => {
    interactionFrameId = null
    const latestPointer = pendingInteractionPointer
    pendingInteractionPointer = null
    if (latestPointer) applyInteractionMove(latestPointer)
  })
}

function onPointerMove(event: KonvaEventObject<PointerEvent>): void {
  const pointer = pointerFromEvent(event)
  if (!pointer) return
  if (event.evt.pointerType === 'touch') {
    if (!touchPointers.has(event.evt.pointerId)) return
    event.evt.preventDefault()
    touchPointers.set(event.evt.pointerId, pointer)
    if (touchGesture) {
      updateTouchGesture()
      return
    }
  }
  const name = targetName(event)
  const annotationTarget = annotationCardTarget(name)
  canvasBackgroundHovered.value = isCanvasBackground(name)
  annotationHovered.value = Boolean(annotationTarget || dimensionButtonTarget(name))
  highlightedAnnotationKey.value = annotationTarget
    ? `${annotationTarget.shapeId}:${annotationTarget.segmentIndex}`
    : null
  pathPointer.value = activeTool.value === 'path' ? worldFromScreen(pointer, true) : null
  if (interaction.value) scheduleInteractionMove(pointer)
}

function endInteraction(): void {
  flushInteractionMove()
  if (interaction.value && interaction.value.kind !== 'pan') store.commitShapeMutation()
  interaction.value = null
}

function onPointerEnd(event: KonvaEventObject<PointerEvent>): void {
  if (event.evt.pointerType === 'pen' && event.evt.pointerId === activePenPointerId) {
    activePenPointerId = null
  }
  if (event.evt.pointerType !== 'touch') {
    endInteraction()
    return
  }

  touchPointers.delete(event.evt.pointerId)
  if (touchGesture) {
    touchGesture = null
    if (touchPointers.size >= 2) {
      beginTouchGesture()
    } else {
      const remaining = touchPointers.values().next().value as Point | undefined
      interaction.value = remaining
        ? { kind: 'pan', start: remaining, origin: { ...pan.value } }
        : null
    }
    return
  }
  endInteraction()
}

function onPointerLeave(event: KonvaEventObject<PointerEvent>): void {
  pathPointer.value = null
  annotationHovered.value = false
  canvasBackgroundHovered.value = false
  highlightedAnnotationKey.value = null
  onPointerEnd(event)
}

function onStagePointerClick(event: KonvaEventObject<PointerEvent>): void {
  if (suppressNextStageClick) {
    suppressNextStageClick = false
    return
  }
  if (event.evt.pointerType === 'touch') return
  if (annotationCardTarget(targetName(event)) || dimensionButtonTarget(targetName(event))) return
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

function onPointerDoubleClick(event: KonvaEventObject<PointerEvent>): void {
  if (event.evt.pointerType === 'touch') return
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
  const verticalPadding = 36
  // 始终预留标注区域，让同一画布在轮廓、针格和对比模式下保持相同缩放与位置。
  const horizontalPadding = annotationViewportMargin + annotationWidth + annotationFabricGap
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

function exportCanvas(): void {
  const stage = stageRef.value?.getNode()
  if (!stage) return

  const pixelRatio = 2
  const renderedCanvas = stage.toCanvas({ pixelRatio })
  const exportedCanvas = document.createElement('canvas')
  exportedCanvas.width = renderedCanvas.width
  exportedCanvas.height = renderedCanvas.height
  const context = exportedCanvas.getContext('2d')
  if (!context) return

  context.fillStyle = '#e8e3da'
  context.fillRect(0, 0, exportedCanvas.width, exportedCanvas.height)
  context.drawImage(renderedCanvas, 0, 0)

  const now = new Date()
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('')
  const downloadLink = document.createElement('a')
  downloadLink.download = `编织图解-${timestamp}.png`
  downloadLink.href = exportedCanvas.toDataURL('image/png')
  downloadLink.click()
}

onMounted(() => {
  if (!host.value) return
  resizeObserver = new ResizeObserver(([entry]) => {
    if (!entry) return
    const { width, height } = entry.contentRect
    if (width <= 0 || height <= 0) return
    stageSize.value = {
      width,
      height,
    }
    if (!canvasReady.value && !initializationScheduled) {
      initializationScheduled = true
      fitCanvas()
      nextTick(() => {
        initializationFrameId = requestAnimationFrame(() => {
          canvasReady.value = true
          initializationFrameId = null
        })
      })
    } else {
      pan.value = clampPan(pan.value)
    }
  })
  resizeObserver.observe(host.value)
  window.addEventListener('keydown', onWindowKeyDown)
})

onBeforeUnmount(() => {
  if (initializationFrameId !== null) cancelAnimationFrame(initializationFrameId)
  if (interactionFrameId !== null) cancelAnimationFrame(interactionFrameId)
  interactionFrameId = null
  pendingInteractionPointer = null
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
})
watch(() => shapes.value.map((shape) => shape.id), (shapeIds) => {
  if (
    selectedGridAnnotationSegment.value
    && !shapeIds.includes(selectedGridAnnotationSegment.value.shapeId)
  ) {
    selectedGridAnnotationSegment.value = null
  }
})
defineExpose({ fitCanvas, exportCanvas })
</script>

<template>
  <div ref="host" class="knitting-canvas" tabindex="0" :style="{ cursor: stageCursor }">
    <div :class="['canvas-stage', { 'canvas-stage--initializing': !canvasReady }]">
      <v-stage ref="stageRef" :config="{ width: stageSize.width, height: stageSize.height }"
        @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerEnd"
        @pointercancel="onPointerEnd" @pointerleave="onPointerLeave"
        @pointerclick="onStagePointerClick" @pointerdblclick="onPointerDoubleClick" @wheel="onWheel">
      <v-layer>
        <v-group :config="{ x: pan.x, y: pan.y }">
          <v-rect :config="{
            name: 'fabric', x: 0, y: 0, width: fabricWidthPx, height: fabricHeightPx,
            fill: '#fffdf8', stroke: '#cfc7b9', strokeWidth: 1, shadowColor: '#4a3f35',
            shadowBlur: 18, shadowOpacity: 0.12, shadowOffsetY: 6,
          }" />

          <v-shape v-if="showRasterFill" :config="rasterShapeConfig" />
          <v-shape :config="gridShapeConfig" />

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

        <template v-if="viewMode === 'overlay'">
          <v-line v-for="label in dimensionLabels" :key="`${label.result.id}-connector`"
            :config="{
              points: label.connectorPoints, stroke: label.result.confirmed ? '#5d897c' : '#b77633',
              strokeWidth: 1, dash: [4, 3], opacity: .72, listening: false,
            }" />
          <v-group v-for="label in dimensionLabels" :key="label.result.id"
            :config="{ x: label.x, y: label.y }">
            <v-rect :config="{
              width: label.width, height: label.height,
              fill: 'rgba(255,253,248,.97)', stroke: label.result.confirmed ? '#79a093' : '#c88338',
              strokeWidth: 1.2, cornerRadius: 9, shadowColor: '#40382f', shadowBlur: 8,
              shadowOpacity: .16, shadowOffsetY: 2, listening: false,
            }" />
            <v-text :config="{
              x: 10, y: 8, width: label.width - 20, height: 19, text: label.title,
              fill: '#263d36', fontSize: label.width < 240 ? 11 : 13,
              fontStyle: 'bold', listening: false,
            }" />
            <v-text :config="{
              x: 10, y: 29, width: label.width - 20, height: 15, text: label.formula,
              fill: '#3f4c46', fontSize: label.width < 240 ? 10.5 : 12, listening: false,
            }" />
            <template v-if="!label.result.confirmed">
              <v-text :config="{
                x: 10, y: 46, width: label.width - 20, height: 14,
                text: '取整待确认 · 将应用到本织片所有' + (label.result.axis === 'stitches' ? '横向' : '纵向') + '尺寸',
                fill: '#963c29', fontSize: label.width < 240 ? 10 : 11.5,
                fontStyle: 'bold', listening: false,
              }" />
              <v-group v-for="(roundingDirection, optionIndex) in (['floor', 'ceil'] as const)"
                :key="roundingDirection" :config="{
                  x: 7 + optionIndex * ((label.width - 20) / 2 + 6), y: 62,
                }">
                <v-rect :config="{
                  name: dimensionTargetName(label.result, roundingDirection),
                  width: (label.width - 20) / 2, height: 39,
                  fill: roundingDirection === 'floor' ? '#f3eee4' : '#e3efeb',
                  stroke: roundingDirection === 'floor' ? '#c1aa83' : '#7fa597',
                  strokeWidth: 1, cornerRadius: 6,
                }" />
                <v-text :config="{
                  name: dimensionTargetName(label.result, roundingDirection),
                  x: 4, y: 4, width: (label.width - 20) / 2 - 8, height: 32,
                  text: dimensionOptionText(label.result, roundingDirection),
                  fill: '#263a33', fontSize: label.width < 240 ? 9.5 : 10.5,
                  lineHeight: 1.25, align: 'center',
                }" />
              </v-group>
            </template>
            <v-text v-else :config="{
              x: 10, y: 46, width: label.width - 20, height: 12,
              text: label.result.exact ? '精确整数' : '实际 ' + formatCm(label.result.selected!.actualCm) + 'cm · 偏差 ' + formatDeviation(label.result.selected!.deviationCm),
              fill: label.result.exact ? '#52756b' : '#87592f',
              fontSize: label.width < 240 ? 10 : 11.5, listening: false,
            }" />
          </v-group>
        </template>

        <template v-if="viewMode === 'outline' || viewMode === 'grid'">
          <v-line v-for="annotation in shapingAnnotations" :key="`${annotation.key}-connector`"
            :config="{
              points: annotation.connectorPoints,
              stroke: annotationIsHighlighted(annotation.key) ? '#b24631' : '#8b8175',
              strokeWidth: annotationIsHighlighted(annotation.key) ? 1.6 : 1,
              opacity: annotationIsHighlighted(annotation.key) ? 0.9 : 0.62,
              dash: [5, 4], lineCap: 'round', lineJoin: 'round', listening: false,
            }" />
          <template v-for="annotation in shapingAnnotations" :key="`${annotation.key}-marker-lines`">
            <v-line v-for="marker in annotation.markers" v-show="markerWasDisplaced(marker)"
              :key="`${marker.id}-line`" :config="{
                points: [marker.anchorX, marker.anchorY, marker.x, marker.y],
                stroke: annotationIsHighlighted(annotation.key) ? '#b24631' : '#176f61',
                strokeWidth: 1.4, lineCap: 'round', listening: false,
              }" />
          </template>
          <v-group v-for="annotation in shapingAnnotations" :key="annotation.key"
            :config="{ x: annotation.anchorX, y: annotation.anchorY, listening: false }">
            <v-rect :config="{
              x: -12, y: -12, width: 24, height: 24,
              fill: annotationIsHighlighted(annotation.key) ? '#b24631' : '#263d36',
              stroke: '#fffdf8', strokeWidth: 2, cornerRadius: 12,
              shadowColor: '#263d36', shadowBlur: 5, shadowOpacity: 0.2,
              shadowOffsetY: 2, listening: false,
            }" />
            <v-text :config="{
              x: -10, y: -8, width: 20, height: 16,
              text: `${annotation.segmentIndex + 1}`, align: 'center', verticalAlign: 'middle',
              fill: '#fffdf8', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 10, fontStyle: 'bold', listening: false,
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
              x: 0, y: 9, width: 4, height: annotation.height - 18,
              fill: annotationIsHighlighted(annotation.key) ? '#b24631' : '#287d72',
              cornerRadius: [0, 2, 2, 0], listening: false,
            }" />
            <v-circle :config="{
              x: annotationPaddingX + 7,
              y: annotationPaddingY + annotationLineHeight / 2,
              radius: 8,
              fill: annotationIsHighlighted(annotation.key) ? '#b24631' : '#263d36',
              stroke: '#fffdf8', strokeWidth: 1.4,
              listening: false,
            }" />
            <v-text :config="{
              x: annotationPaddingX,
              y: annotationPaddingY + 1,
              width: 14,
              height: annotationLineHeight - 2,
              text: `${annotation.segmentIndex + 1}`,
              align: 'center', verticalAlign: 'middle',
              fill: '#fffdf8',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 9, fontStyle: 'bold', listening: false,
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
                fontSize: lineIndex === 0 ? 11 : 12,
                fontStyle: annotationLineIsBold(line, lineIndex) ? 'bold' : 'normal',
                verticalAlign: 'middle', listening: false,
              }" />
          </v-group>

          <template v-for="annotation in shapingAnnotations" :key="`${annotation.key}-markers`">
            <v-group v-for="marker in annotation.markers"
              :key="marker.id" :config="{ listening: false }">
              <v-circle :config="{
                x: marker.x, y: marker.y, radius: markerRadius(marker.label),
                fill: annotationIsHighlighted(annotation.key) ? '#b24631' : '#176f61',
                stroke: '#fffdf8', strokeWidth: 2,
                shadowColor: '#263d36', shadowBlur: 5, shadowOpacity: 0.24,
              }" />
              <v-text :config="{
                x: marker.x - markerRadius(marker.label),
                y: marker.y - markerRadius(marker.label),
                width: markerRadius(marker.label) * 2,
                height: markerRadius(marker.label) * 2,
                text: marker.label,
                align: 'center', verticalAlign: 'middle', fill: '#fffdf8',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: markerFontSize(marker.label), fontStyle: 'bold', listening: false,
              }" />
            </v-group>
          </template>
        </template>
      </v-layer>
      </v-stage>
    </div>

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
