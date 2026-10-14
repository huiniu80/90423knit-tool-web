import { getShapeBounds } from './geometry'
import { flattenPath } from './path'
import type { Shape, Point } from './shape.types'
import type { FabricCanvas } from '../gauge/gauge.types'

const EPSILON = 1e-9
export type ShapeCalculationIssue = 'open' | 'self-intersection' | 'out-of-bounds' | null
function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}
function onSegment(a: Point, b: Point, c: Point): boolean {
  return Math.abs(cross(a, b, c)) <= EPSILON
    && c.x >= Math.min(a.x, b.x) - EPSILON && c.x <= Math.max(a.x, b.x) + EPSILON
    && c.y >= Math.min(a.y, b.y) - EPSILON && c.y <= Math.max(a.y, b.y) + EPSILON
}
function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = cross(a, b, c), abD = cross(a, b, d)
  const cdA = cross(c, d, a), cdB = cross(c, d, b)
  return (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON))
    && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON)))
    || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)
}
export function hasSelfIntersection(shape: Shape): boolean {
  const points = shape.type === 'path' ? flattenPath(shape)
    : shape.type === 'polygon' || shape.type === 'triangle' ? shape.points : []
  const edges = points.map((a, index) => {
    const b = points[(index + 1) % points.length]!
    return { a, b, index, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) }
  }).filter((edge) => Math.hypot(edge.a.x - edge.b.x, edge.a.y - edge.b.y) > EPSILON)
    .sort((a, b) => a.minX - b.minX)
  for (let i = 0; i < edges.length; i++) {
    const first = edges[i]!
    for (let j = i + 1; j < edges.length && edges[j]!.minX <= first.maxX + EPSILON; j++) {
      const second = edges[j]!
      const distance = Math.abs(first.index - second.index)
      if (distance === 1 || distance === points.length - 1) {
        // Adjacent edges may meet at one endpoint, but may not retrace each other.
        const shared = distance === 1
          ? points[Math.max(first.index, second.index)]!
          : points[0]!
        const otherFirst = Math.hypot(first.a.x - shared.x, first.a.y - shared.y) < EPSILON ? first.b : first.a
        const otherSecond = Math.hypot(second.a.x - shared.x, second.a.y - shared.y) < EPSILON ? second.b : second.a
        if (onSegment(shared, otherFirst, otherSecond) || onSegment(shared, otherSecond, otherFirst)) return true
        continue
      }
      if (second.minY > first.maxY + EPSILON || first.minY > second.maxY + EPSILON) continue
      if (intersects(first.a, first.b, second.a, second.b)) {
        return true
      }
    }
  }
  return false
}
export function shapeCalculationIssue(shape: Shape, canvas: FabricCanvas): ShapeCalculationIssue {
  if (shape.type === 'path' && !shape.closed) return 'open'
  if (hasSelfIntersection(shape)) return 'self-intersection'
  const bounds = getShapeBounds(shape)
  if (bounds.x < -EPSILON || bounds.y < -EPSILON
    || bounds.x + bounds.width > canvas.widthCm + EPSILON
    || bounds.y + bounds.height > canvas.heightCm + EPSILON) return 'out-of-bounds'
  return null
}
export const shapeIssueMessage = {
  open: '未闭合轮廓，不参与编织计算',
  'self-intersection': '轮廓自相交，请修改后再计算',
  'out-of-bounds': '织片超出计算范围，请移回画布或扩大画布',
} as const
