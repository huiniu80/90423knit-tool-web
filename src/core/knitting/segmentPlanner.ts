import type { FabricCanvas, Gauge } from '../gauge/gauge.types'
import type { ShapeBoundarySegment } from '../geometry/boundarySegments'
import {
  edgeShapingPlanToLabelLines,
  generateGarmentEdgeShapingPlan,
  generateInstructions,
} from './planner'
import type { GarmentEdgeRole, KnitDirection, ShapingSide } from './planner.types'
import { rasterize } from '../raster/rasterizer'
import type { RasterOptions, RasterRow } from '../raster/raster.types'
import { getShapeBounds } from '../geometry/geometry'

export interface SegmentShapingDescription {
  boundarySide: ShapingSide | 'both'
  lines: string[]
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
    }
  }

  const rows = rasterize(segment.sourceShape, gauge, canvas, rasterOptions)
  const instructions = generateInstructions(rows, direction)
  const activeRows = rows.filter((row) => row.stitchCount > 0)
  if (!activeRows.length) return { boundarySide: 'both', lines: ['未落入针格'] }

  const bounds = getShapeBounds(segment.rasterShape)
  const firstRow = direction === 'bottom-up' ? activeRows[0] : activeRows.at(-1)
  const lastRow = direction === 'bottom-up' ? activeRows.at(-1) : activeRows[0]
  const isHorizontal = bounds.height <= gauge.rowHeightCm * 0.55
  if (isHorizontal && firstRow && Math.abs(segment.anchor.y - firstRow.yCm) <= gauge.rowHeightCm) {
    return { boundarySide: 'both', lines: [`起针边 · 起 ${firstRow.stitchCount} 针`] }
  }
  if (isHorizontal && lastRow && Math.abs(segment.anchor.y - lastRow.yCm) <= gauge.rowHeightCm) {
    return { boundarySide: 'both', lines: [`结束边 · 收 ${lastRow.stitchCount} 针`] }
  }

  const edge = nearestGarmentEdge(rows, segment.anchor, gauge.stitchWidthCm)
  if (!edge) return { boundarySide: 'both', lines: ['未识别织片边界'] }
  const split = instructions.find((instruction) => instruction.transition === 'split')
  const isNeck = edge === 'left-neck' || edge === 'right-neck'
  const spansNeck = isNeck
    && bounds.x <= outlineCenterX
    && bounds.x + bounds.width >= outlineCenterX
  const edges: GarmentEdgeRole[] = spansNeck ? ['left-neck', 'right-neck'] : [edge]
  const lines = edges.flatMap((currentEdge) => {
    const plan = generateGarmentEdgeShapingPlan(instructions, currentEdge)
    return edgeShapingPlanToLabelLines(plan, instructions.length > 0)
      .map((line) => `${plan.label} · ${line}`)
  })
  if (isNeck && split) {
    lines.unshift(`领口起始 · 中间收 ${Math.abs(split.centerChange)} 针`)
  }

  return {
    boundarySide: 'both',
    lines,
  }
}
