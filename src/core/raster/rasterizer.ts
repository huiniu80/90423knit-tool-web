import type { FabricCanvas, Gauge } from '../gauge/gauge.types'
import { calculateFabricGrid } from '../gauge/gauge'
import { getHorizontalIntervals, getShapeBounds, resizeShapeToBounds } from '../geometry/geometry'
import { flattenPath } from '../geometry/path'
import type { HorizontalInterval, PathShape, Point, Shape } from '../geometry/shape.types'
import type {
  RasterMode,
  RasterOptions,
  RasterRow,
  ShapeRasterTarget,
  StitchSegment,
} from './raster.types'

const EPSILON = 1e-9

function intervalToSegment(
  interval: HorizontalInterval,
  stitchWidthCm: number,
  mode: RasterMode,
): StitchSegment {
  switch (mode) {
    case 'inside':
      return {
        startStitch: Math.ceil(interval.startX / stitchWidthCm - EPSILON),
        endStitch: Math.floor(interval.endX / stitchWidthCm + EPSILON) - 1,
      }
    case 'outside':
      return {
        startStitch: Math.floor(interval.startX / stitchWidthCm),
        endStitch: Math.ceil(interval.endX / stitchWidthCm - EPSILON) - 1,
      }
    case 'center':
      return {
        startStitch: Math.ceil(interval.startX / stitchWidthCm - 0.5 - EPSILON),
        endStitch: Math.floor(interval.endX / stitchWidthCm - 0.5 + EPSILON),
      }
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

function clipLineToGrid(
  start: Point,
  end: Point,
  columnCount: number,
  rowCount: number,
): [Point, Point] | null {
  const dx = end.x - start.x
  const dy = end.y - start.y
  let t0 = 0
  let t1 = 1
  const boundaries: Array<[number, number]> = [
    [-dx, start.x],
    [dx, columnCount - start.x],
    [-dy, start.y],
    [dy, rowCount - start.y],
  ]

  for (const [p, q] of boundaries) {
    if (Math.abs(p) < EPSILON) {
      if (q < 0) return null
      continue
    }
    const ratio = q / p
    if (p < 0) {
      if (ratio > t1) return null
      t0 = Math.max(t0, ratio)
    } else {
      if (ratio < t0) return null
      t1 = Math.min(t1, ratio)
    }
  }

  return [
    { x: start.x + dx * t0, y: start.y + dy * t0 },
    { x: start.x + dx * t1, y: start.y + dy * t1 },
  ]
}

function gridIndex(value: number, count: number): number | null {
  if (value < -EPSILON || value > count + EPSILON) return null
  if (value >= count - EPSILON) return count - 1
  return Math.max(0, Math.floor(value + EPSILON))
}

function columnsToSegments(columns: ReadonlySet<number>): StitchSegment[] {
  const sorted = [...columns].sort((a, b) => a - b)
  const segments: StitchSegment[] = []
  for (const column of sorted) {
    const previous = segments.at(-1)
    if (previous && column === previous.endStitch + 1) {
      previous.endStitch = column
    } else {
      segments.push({ startStitch: column, endStitch: column })
    }
  }
  return segments
}

export function rasterizeOpenPath(
  path: PathShape,
  gauge: Gauge,
  canvas: FabricCanvas,
): RasterRow[] {
  const { columnCount, rowCount } = calculateFabricGrid(canvas, gauge)
  const cellsByRow = Array.from({ length: rowCount }, () => new Set<number>())
  const points = flattenPath(path)

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    if (!start || !end) continue
    const clipped = clipLineToGrid(
      { x: start.x / gauge.stitchWidthCm, y: start.y / gauge.rowHeightCm },
      { x: end.x / gauge.stitchWidthCm, y: end.y / gauge.rowHeightCm },
      columnCount,
      rowCount,
    )
    if (!clipped) continue
    const [gridStart, gridEnd] = clipped
    const dx = gridEnd.x - gridStart.x
    const dy = gridEnd.y - gridStart.y
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 4))
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps
      const column = gridIndex(gridStart.x + dx * t, columnCount)
      const row = gridIndex(gridStart.y + dy * t, rowCount)
      if (column !== null && row !== null) cellsByRow[row]?.add(column)
    }
  }

  return rowsFromSegments(
    cellsByRow.map(columnsToSegments),
    rowCount,
    gauge.rowHeightCm,
  )
}

function rasterizeFilledShape(
  shape: Shape,
  gauge: Gauge,
  canvas: FabricCanvas,
  options: RasterOptions,
): RasterRow[] {
  const { columnCount, rowCount } = calculateFabricGrid(canvas, gauge)
  const segmentsByRow = Array.from({ length: rowCount }, (_, rowIndex) => {
    const yCm = (rowIndex + 0.5) * gauge.rowHeightCm
    return mergeAndClipSegments(
      getHorizontalIntervals(shape, yCm).map((interval) =>
        intervalToSegment(interval, gauge.stitchWidthCm, options.mode),
      ),
      columnCount,
    )
  })
  return rowsFromSegments(segmentsByRow, rowCount, gauge.rowHeightCm)
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

export function rasterize(
  shape: Shape,
  gauge: Gauge,
  canvas: FabricCanvas,
  options: RasterOptions,
  target?: ShapeRasterTarget,
): RasterRow[] {
  if (target && (target.stitches !== null || target.rows !== null)) {
    const bounds = getShapeBounds(shape)
    const width = target.stitches === null ? bounds.width : target.stitches * gauge.stitchWidthCm
    const height = target.rows === null ? bounds.height : target.rows * gauge.rowHeightCm
    const adjustedBounds = {
      x: bounds.x + (bounds.width - width) / 2,
      y: target.direction === 'bottom-up' ? bounds.y : bounds.y + bounds.height - height,
      width,
      height,
    }
    shape = resizeShapeToBounds(shape, adjustedBounds)
  }
  if (shape.type === 'path' && !shape.closed) {
    return rasterizeOpenPath(shape, gauge, canvas)
  }
  return rasterizeFilledShape(shape, gauge, canvas, options)
}
