import { getPolygonIntervals } from './polygon'
import type { HorizontalInterval, TriangleShape } from './shape.types'

export function getTriangleIntervals(
  shape: TriangleShape,
  yCm: number,
): HorizontalInterval[] {
  return getPolygonIntervals(shape.points, yCm)
}
