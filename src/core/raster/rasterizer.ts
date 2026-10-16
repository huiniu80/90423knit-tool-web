import type { FabricCanvas, Gauge } from '../gauge/gauge.types'
import { calculateFabricGrid } from '../gauge/gauge'
import { getHorizontalIntervals, getShapeBounds, resizeShapeToBounds } from '../geometry/geometry'
import type { HorizontalInterval, Shape } from '../geometry/shape.types'
import { shapeCalculationIssue } from '../geometry/shapeValidation'
import { normalizePathWithSymmetry, pathConstraintSymmetry } from '../geometry/path'
import type {
  RasterOptions,
  RasterRow,
  ShapeRasterTarget,
  StitchSegment,
} from './raster.types'

const EPSILON = 1e-9

function intervalToSegment(
  interval: HorizontalInterval,
  stitchWidthCm: number,
  originXCm = 0,
  symmetric = false,
): StitchSegment {
  return {
    startStitch: Math.ceil((interval.startX - originXCm) / stitchWidthCm - 0.5 + (symmetric ? EPSILON : -EPSILON)),
    endStitch: Math.ceil((interval.endX - originXCm) / stitchWidthCm - 0.5 - EPSILON) - 1,
  }
}

function mergeAndClipSegments(
  segments: StitchSegment[],
  columnCount: number,
): StitchSegment[] {
  const clipped = segments
    .map((segment) => ({
      startStitch: Math.max(0, segment.startStitch),
      endStitch: Math.min(columnCount - 1, segment.endStitch),
    }))
    .filter((segment) => segment.startStitch <= segment.endStitch)
    .sort((a, b) => a.startStitch - b.startStitch)

  const merged: StitchSegment[] = []
  for (const segment of clipped) {
    const previous = merged.at(-1)
    if (previous && segment.startStitch <= previous.endStitch + 1) {
      previous.endStitch = Math.max(previous.endStitch, segment.endStitch)
    } else {
      merged.push({ ...segment })
    }
  }
  return merged
}

function rowsFromSegments(
  segmentsByRow: readonly StitchSegment[][],
  rowCount: number,
  rowHeightCm: number,
): RasterRow[] {
  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const segments = segmentsByRow[rowIndex] ?? []
    return {
      rowIndex,
      yCm: (rowIndex + 0.5) * rowHeightCm,
      segments,
      stitchCount: segments.reduce(
        (sum, segment) => sum + segment.endStitch - segment.startStitch + 1,
        0,
      ),
    }
  })
}

function rasterizeFilledShape(
  shape: Shape,
  gauge: Gauge,
  canvas: FabricCanvas,
): RasterRow[] {
  const { columnCount, rowCount } = calculateFabricGrid(canvas, gauge)
  const bounds = getShapeBounds(shape)
  const mirrorAxis = shape.type === 'path' && shape.editConstraint?.type === 'vertical-mirror' ? shape.editConstraint.axisX : null
  const originXCm = mirrorAxis === null ? 0 : mirrorAxis - Math.floor(mirrorAxis / gauge.stitchWidthCm) * gauge.stitchWidthCm
  const segmentsByRow = Array.from({ length: rowCount }, (_, rowIndex) => {
    const yCm = (rowIndex + 0.5) * gauge.rowHeightCm
    if (yCm >= bounds.y + bounds.height - EPSILON) return []
    const intervals = getHorizontalIntervals(shape, yCm)
    const segments = intervals.map((interval) => intervalToSegment(interval, gauge.stitchWidthCm, originXCm, mirrorAxis !== null))
    if (mirrorAxis !== null) return segments.filter(segment => segment.startStitch <= segment.endStitch)
    return mergeAndClipSegments(
      segments,
      columnCount,
    )
  })
  return rowsFromSegments(segmentsByRow, rowCount, gauge.rowHeightCm)
    .map(row => originXCm ? { ...row, originXCm } : row)
}

export function rasterizeShapes(
  shapes: readonly Shape[],
  gauge: Gauge,
  canvas: FabricCanvas,
  options: RasterOptions,
): RasterRow[] {
  return mergeRasterRows(
    shapes.map((shape) => rasterize(shape, gauge, canvas, options)),
    gauge,
    canvas,
  )
}

export function mergeRasterRows(
  perShapeRows: readonly (readonly RasterRow[])[],
  gauge: Gauge,
  canvas: FabricCanvas,
): RasterRow[] {
  const { columnCount, rowCount } = calculateFabricGrid(canvas, gauge)
  const segmentsByRow = Array.from({ length: rowCount }, (_, rowIndex) =>
    mergeAndClipSegments(
      perShapeRows.flatMap((rows) => rows[rowIndex]?.segments ?? []),
      columnCount,
    ),
  )
  return rowsFromSegments(segmentsByRow, rowCount, gauge.rowHeightCm)
}

export function shapeForRaster(
  shape: Shape,
  gauge: Gauge,
  target?: ShapeRasterTarget,
): Shape {
  if (shape.type === 'path') {
    const symmetry = pathConstraintSymmetry(shape)
    if (symmetry) shape = normalizePathWithSymmetry(shape, symmetry)
  }
  if (target && (target.stitches !== null || target.rows !== null)) {
    const bounds = getShapeBounds(shape)
    const width = target.stitches === null ? bounds.width : target.stitches * gauge.stitchWidthCm
    const height = target.rows === null ? bounds.height : target.rows * gauge.rowHeightCm
    const adjustedBounds = {
      x: bounds.x + (bounds.width - width) / 2,
      y: bounds.y,
      width,
      height,
    }
    shape = resizeShapeToBounds(shape, adjustedBounds)
  }
  return shape
}

export function rasterize(
  shape: Shape,
  gauge: Gauge,
  canvas: FabricCanvas,
  _options: RasterOptions,
  target?: ShapeRasterTarget,
): RasterRow[] {
  if (shapeCalculationIssue(shape, canvas)) return []
  shape = shapeForRaster(shape, gauge, target)
  if (shapeCalculationIssue(shape, canvas)) return []
  return rasterizeFilledShape(shape, gauge, canvas)
}
