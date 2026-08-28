import type { HorizontalInterval, Point } from './shape.types'

const EPSILON = 1e-9

/** 标准扫描线填充：边的 y 区间使用半开区间，避免顶点重复计数。 */
export function getPolygonIntervals(
  points: readonly Point[],
  yCm: number,
): HorizontalInterval[] {
  if (points.length < 3) return []

  const intersections: number[] = []

  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]
    const end = points[(index + 1) % points.length]
    if (!start || !end) continue

    if (Math.abs(start.y - end.y) < EPSILON) continue

    const minY = Math.min(start.y, end.y)
    const maxY = Math.max(start.y, end.y)
    if (yCm < minY || yCm >= maxY) continue

    const ratio = (yCm - start.y) / (end.y - start.y)
    intersections.push(start.x + ratio * (end.x - start.x))
  }

  intersections.sort((a, b) => a - b)
  const intervals: HorizontalInterval[] = []

  for (let index = 0; index + 1 < intersections.length; index += 2) {
    const startX = intersections[index]
    const endX = intersections[index + 1]
    if (startX === undefined || endX === undefined) continue
    if (endX - startX > EPSILON) intervals.push({ startX, endX })
  }

  return intervals
}
