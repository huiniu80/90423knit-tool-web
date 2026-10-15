import type { Gauge } from '../gauge/gauge.types'
import { getShapeBoundarySegments } from '../geometry/boundarySegments'
import { getShapeBounds, resizeShapeToBounds } from '../geometry/geometry'
import type { Point, Shape } from '../geometry/shape.types'

export type RoundingDirection = 'floor' | 'ceil'
export type DimensionAxis = 'stitches' | 'rows'

export interface ShapeRoundingPolicy {
  stitches: RoundingDirection | null
  rows: RoundingDirection | null
}

export interface RoundedDimensionOption {
  direction: RoundingDirection
  count: number
  actualCm: number
  deviationCm: number
  valid: boolean
}

export interface DimensionConversionResult {
  id: string
  shapeId: string
  segmentIndex: number
  axis: DimensionAxis
  targetCm: number
  densityPerCm: number
  rawCount: number
  floor: RoundedDimensionOption
  ceil: RoundedDimensionOption
  selected: RoundedDimensionOption | null
  confirmed: boolean
  exact: boolean
  anchor: Point
}

export const DIMENSION_EPSILON = 1e-6
export const HORIZONTAL_LINE_ROW_TOLERANCE = 0.5

function option(
  direction: RoundingDirection,
  count: number,
  targetCm: number,
  densityPerCm: number,
): RoundedDimensionOption {
  const actualCm = count / densityPerCm
  return { direction, count, actualCm, deviationCm: actualCm - targetCm, valid: count > 0 }
}

export function convertDimension(
  shapeId: string,
  segmentIndex: number,
  axis: DimensionAxis,
  targetCm: number,
  densityPerCm: number,
  direction: RoundingDirection | null,
  anchor: Point,
): DimensionConversionResult {
  const rawCount = targetCm * densityPerCm
  const nearest = Math.round(rawCount)
  const exact = nearest > 0 && Math.abs(rawCount - nearest) < DIMENSION_EPSILON
  const floorCount = exact ? nearest : Math.floor(rawCount)
  const ceilCount = exact ? nearest : Math.ceil(rawCount)
  const floor = option('floor', floorCount, targetCm, densityPerCm)
  const ceil = option('ceil', ceilCount, targetCm, densityPerCm)
  const selected = exact && floor.valid ? floor
    : direction === 'floor' && floor.valid ? floor
    : direction === 'ceil' ? ceil
    : floor.valid && rawCount - floorCount < ceilCount - rawCount - DIMENSION_EPSILON ? floor : ceil
  return {
    id: `${shapeId}:${segmentIndex}:${axis}`,
    shapeId,
    segmentIndex,
    axis,
    targetCm,
    densityPerCm,
    rawCount,
    floor,
    ceil,
    selected,
    confirmed: true,
    exact,
    anchor,
  }
}

export function createShapeDimensionResults(
  shape: Shape,
  gauge: Gauge,
  policy: ShapeRoundingPolicy,
): DimensionConversionResult[] {
  if (shape.type === 'path' && !shape.closed) return []
  const originalBounds = getShapeBounds(shape)
  const counts = selectedShapeCounts(shape, gauge, policy)
  const width = counts.stitches === null ? originalBounds.width : counts.stitches / gauge.stitchesPerCm
  const height = counts.rows === null ? originalBounds.height : counts.rows / gauge.rowsPerCm
  const adjustedShape = resizeShapeToBounds(shape, {
    x: originalBounds.x + (originalBounds.width - width) / 2, y: originalBounds.y, width, height,
  })
  const actualSegments = getShapeBoundarySegments(adjustedShape)
  return getShapeBoundarySegments(shape).flatMap((segment) => {
    const bounds = getShapeBounds(segment.rasterShape)
    const results: DimensionConversionResult[] = []
    const isEffectivelyHorizontal = segment.isStraight
      && bounds.height * gauge.rowsPerCm < HORIZONTAL_LINE_ROW_TOLERANCE
    if (bounds.width > DIMENSION_EPSILON) {
      results.push(convertDimension(
        shape.id,
        segment.segmentIndex,
        'stitches',
        bounds.width,
        gauge.stitchesPerCm,
        policy.stitches,
        { x: segment.anchor.x, y: bounds.y + bounds.height / 2 },
      ))
    }
    if (bounds.height > DIMENSION_EPSILON && !isEffectivelyHorizontal) {
      results.push(convertDimension(
        shape.id,
        segment.segmentIndex,
        'rows',
        bounds.height,
        gauge.rowsPerCm,
        policy.rows,
        { x: bounds.x + bounds.width / 2, y: segment.anchor.y },
      ))
    }
    const actualBounds = getShapeBounds(actualSegments.find((item) => item.segmentIndex === segment.segmentIndex)!.rasterShape)
    return results.map((result) => {
      const actualCm = result.axis === 'stitches' ? actualBounds.width : actualBounds.height
      // Local spans are measurements of the same globally adjusted shape, never separate rounding choices.
      return { ...result, selected: { direction: result.selected!.direction, count: actualCm * result.densityPerCm,
        actualCm, deviationCm: actualCm - result.targetCm, valid: true }, confirmed: true }
    })
  })
}

export function createOverallDimensionResults(shape: Shape, gauge: Gauge, policy: ShapeRoundingPolicy): DimensionConversionResult[] {
  if (shape.type === 'path' && !shape.closed) return []
  const bounds = getShapeBounds(shape)
  return [
    bounds.width > DIMENSION_EPSILON ? convertDimension(shape.id, -1, 'stitches', bounds.width, gauge.stitchesPerCm, policy.stitches, { x: bounds.x + bounds.width / 2, y: bounds.y }) : null,
    bounds.height > DIMENSION_EPSILON ? convertDimension(shape.id, -1, 'rows', bounds.height, gauge.rowsPerCm, policy.rows, { x: bounds.x, y: bounds.y + bounds.height / 2 }) : null,
  ].filter((item): item is DimensionConversionResult => Boolean(item))
}

export function selectedShapeCounts(
  shape: Shape,
  gauge: Gauge,
  policy: ShapeRoundingPolicy,
): { stitches: number | null; rows: number | null } {
  if (shape.type === 'path' && !shape.closed) return { stitches: null, rows: null }
  const bounds = getShapeBounds(shape)
  const stitchResult = convertDimension(
    shape.id, -1, 'stitches', bounds.width, gauge.stitchesPerCm,
    policy.stitches, { x: bounds.x + bounds.width / 2, y: bounds.y },
  )
  const rowResult = convertDimension(
    shape.id, -1, 'rows', bounds.height, gauge.rowsPerCm,
    policy.rows, { x: bounds.x, y: bounds.y + bounds.height / 2 },
  )
  return {
    stitches: stitchResult.selected?.count ?? null,
    rows: rowResult.selected?.count ?? null,
  }
}

export function formatCm(value: number): string {
  return Number(value.toFixed(2)).toString()
}

export function formatDeviation(value: number): string {
  const normalized = Math.abs(value) < 0.005 ? 0 : value
  return `${normalized >= 0 ? '+' : ''}${normalized.toFixed(2)}cm`
}
