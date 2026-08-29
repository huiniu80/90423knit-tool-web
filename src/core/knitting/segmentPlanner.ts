import type { FabricCanvas, Gauge } from '../gauge/gauge.types'
import type { ShapeBoundarySegment } from '../geometry/boundarySegments'
import {
  generateGarmentEdgeShapingSequence,
  generateInstructions,
  stepNumberLabel,
} from './planner'
import type {
  GarmentEdgeRole,
  KnitDirection,
  ShapingSequenceStep,
  ShapingSide,
} from './planner.types'
import { rasterize } from '../raster/rasterizer'
import type { RasterOptions, RasterRow } from '../raster/raster.types'
import { getShapeBounds } from '../geometry/geometry'

export interface SegmentShapingDescription {
  boundarySide: ShapingSide | 'both'
  lines: string[]
  markers: SegmentShapingMarker[]
}

export interface SegmentShapingMarker {
  label: string
  point: { x: number; y: number }
}

const shortEdgeLabels: Record<GarmentEdgeRole, string> = {
  'left-outer': '左外侧',
  'left-neck': '左肩领口侧',
  'right-neck': '右肩领口侧',
  'right-outer': '右外侧',
}

function nearestGarmentEdge(
  rows: readonly RasterRow[],
  anchor: { x: number; y: number },
  stitchWidthCm: number,
): GarmentEdgeRole | null {
  let nearestEdge: GarmentEdgeRole | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  const include = (edge: GarmentEdgeRole, x: number, y: number): void => {
    const distance = Math.hypot(anchor.x - x, anchor.y - y)
    if (distance < nearestDistance) {
      nearestEdge = edge
      nearestDistance = distance
    }
  }

  rows.forEach((row) => {
    const left = row.segments[0]
    const right = row.segments.at(-1)
    if (!left || !right) return
    include('left-outer', left.startStitch * stitchWidthCm, row.yCm)
    include('right-outer', (right.endStitch + 1) * stitchWidthCm, row.yCm)
    if (row.segments.length === 2) {
      include('left-neck', (left.endStitch + 1) * stitchWidthCm, row.yCm)
      include('right-neck', right.startStitch * stitchWidthCm, row.yCm)
    }
  })
  return nearestEdge
}

function edgePoint(
  row: RasterRow,
  edge: GarmentEdgeRole,
  stitchWidthCm: number,
): { x: number; y: number } | null {
  const left = row.segments[0]
  const right = row.segments.at(-1)
  if (!left || !right) return null
  switch (edge) {
    case 'left-outer':
      return { x: left.startStitch * stitchWidthCm, y: row.yCm }
    case 'right-outer':
      return { x: (right.endStitch + 1) * stitchWidthCm, y: row.yCm }
    case 'left-neck':
      return row.segments.length === 2
        ? { x: (left.endStitch + 1) * stitchWidthCm, y: row.yCm }
        : null
    case 'right-neck':
      return row.segments.length === 2
        ? { x: right.startStitch * stitchWidthCm, y: row.yCm }
        : null
  }
}

function rowRange(step: ShapingSequenceStep): string {
  return step.startRowNumber === step.endRowNumber
    ? `${step.startRowNumber}行`
    : `${step.startRowNumber}–${step.endRowNumber}行`
}

function compactStepText(step: ShapingSequenceStep, includeEdge: boolean): string {
  const operation = step.operation === 'increase' ? '加' : '减'
  const edge = includeEdge ? `${shortEdgeLabels[step.edge]} · ` : ''
  return `${edge}${rowRange(step)} · 每${step.everyRows}行${operation}${step.stitchCount}针×${step.repeatCount}`
}

export function describeBoundarySegmentShaping(
  segment: ShapeBoundarySegment,
  direction: KnitDirection,
  gauge: Gauge,
  canvas: FabricCanvas,
  rasterOptions: RasterOptions,
  outlineCenterX: number,
): SegmentShapingDescription {
  if (segment.sourceShape.type === 'path' && !segment.sourceShape.closed) {
    return {
      boundarySide: 'both',
      lines: ['开放路径不形成织片'],
      markers: [],
    }
  }

  const rows = rasterize(segment.sourceShape, gauge, canvas, rasterOptions)
  const instructions = generateInstructions(rows, direction)
  const activeRows = rows.filter((row) => row.stitchCount > 0)
  if (!activeRows.length) return { boundarySide: 'both', lines: ['未落入针格'], markers: [] }

  const bounds = getShapeBounds(segment.rasterShape)
  const firstRow = direction === 'bottom-up' ? activeRows[0] : activeRows.at(-1)
  const lastRow = direction === 'bottom-up' ? activeRows.at(-1) : activeRows[0]
  const isHorizontal = bounds.height <= gauge.rowHeightCm * 0.55
  if (isHorizontal && firstRow && Math.abs(segment.anchor.y - firstRow.yCm) <= gauge.rowHeightCm) {
    return { boundarySide: 'both', lines: [`起针边 · 起 ${firstRow.stitchCount} 针`], markers: [] }
  }
  if (isHorizontal && lastRow && Math.abs(segment.anchor.y - lastRow.yCm) <= gauge.rowHeightCm) {
    return { boundarySide: 'both', lines: [`结束边 · 收 ${lastRow.stitchCount} 针`], markers: [] }
  }

  const edge = nearestGarmentEdge(rows, segment.anchor, gauge.stitchWidthCm)
  if (!edge) return { boundarySide: 'both', lines: ['未识别织片边界'], markers: [] }
  const split = instructions.find((instruction) => instruction.transition === 'split')
  const isNeck = edge === 'left-neck' || edge === 'right-neck'
  const spansNeck = isNeck
    && bounds.x <= outlineCenterX
    && bounds.x + bounds.width >= outlineCenterX
  const edges: GarmentEdgeRole[] = spansNeck ? ['left-neck', 'right-neck'] : [edge]
  const steps = edges.flatMap((currentEdge) =>
    generateGarmentEdgeShapingSequence(instructions, currentEdge),
  ).filter((step) => {
    const row = rows.find((item) => item.rowIndex === step.startSourceRowIndex)
    return row && row.yCm >= bounds.y - gauge.rowHeightCm
      && row.yCm <= bounds.y + bounds.height + gauge.rowHeightCm
  }).sort((left, right) =>
    left.startRowNumber - right.startRowNumber || edges.indexOf(left.edge) - edges.indexOf(right.edge),
  )
  const numberedSteps = steps.map((step, index) => ({ ...step, order: index + 1 }))
  const orderText = numberedSteps.map((step) => stepNumberLabel(step.order)).join('→')
  const lines = numberedSteps.length
    ? [
        `按 ${orderText} 编织`,
        ...(edges.length === 1 ? [`${shortEdgeLabels[edge]}边界`] : []),
        ...numberedSteps.map((step) =>
          `${stepNumberLabel(step.order)} ${compactStepText(step, edges.length > 1)}`,
        ),
      ]
    : [`${shortEdgeLabels[edge]}边界 · 不加不减`]
  if (isNeck && split) {
    lines.unshift(`领口起始 · 中间收 ${Math.abs(split.centerChange)} 针`)
  }

  const markers = numberedSteps.flatMap((step) => {
    const row = rows.find((item) => item.rowIndex === step.startSourceRowIndex)
    const point = row ? edgePoint(row, step.edge, gauge.stitchWidthCm) : null
    return point ? [{ label: stepNumberLabel(step.order), point }] : []
  })

  return {
    boundarySide: 'both',
    lines,
    markers,
  }
}
