import type { PathShape, Point, PolygonShape } from '../core/geometry/shape.types'
import { evaluatePathSegment, findNearestPathPosition, pathConstraintSymmetry, removePathNodeWithSymmetry, splitPathSegmentWithSymmetry } from '../core/geometry/path'

export interface SelectedEdge { shapeId: string; segmentIndex: number; t: number; point: Point }
export function nearestEditableEdge(shape: PathShape | PolygonShape, point: Point): SelectedEdge {
  if (shape.type === 'path') {
    const nearest = findNearestPathPosition(shape, point)
    return { shapeId: shape.id, ...nearest, point: evaluatePathSegment(shape, nearest.segmentIndex, nearest.t) }
  }
  let best = { shapeId: shape.id, segmentIndex: 0, t: 0, point: shape.points[0]! }
  let distance = Infinity
  shape.points.forEach((start, segmentIndex) => {
    const end = shape.points[(segmentIndex + 1) % shape.points.length]!
    const dx = end.x - start.x, dy = end.y - start.y
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy || 1)))
    const projection = { x: start.x + t * dx, y: start.y + t * dy }
    const nextDistance = Math.hypot(point.x - projection.x, point.y - projection.y)
    if (nextDistance < distance) { distance = nextDistance; best = { shapeId: shape.id, segmentIndex, t, point: projection } }
  })
  return best
}
export function insertEdgeNode(shape: PathShape | PolygonShape, edge: SelectedEdge): { shape: PathShape | PolygonShape; index: number } {
  const segmentCount = shape.type === 'polygon' ? shape.points.length : shape.nodes.length - (shape.closed ? 0 : 1)
  if (shape.id !== edge.shapeId || !Number.isInteger(edge.segmentIndex) || edge.segmentIndex < 0 || edge.segmentIndex >= segmentCount || !Number.isFinite(edge.t) || edge.t <= 0.0001 || edge.t >= 0.9999) return { shape, index: -1 }
  if (shape.type === 'path') {
    const result = splitPathSegmentWithSymmetry(shape, edge.segmentIndex, edge.t, pathConstraintSymmetry(shape))
    return { shape: result.path, index: result.insertedIndex }
  }
  const points = [...shape.points]
  points.splice(edge.segmentIndex + 1, 0, { ...edge.point })
  return { shape: { ...shape, points }, index: edge.segmentIndex + 1 }
}
export function deleteEditableNode(shape: PathShape | PolygonShape, index: number): PathShape | PolygonShape {
  if (!Number.isInteger(index) || index < 0 || index >= (shape.type === 'path' ? shape.nodes.length : shape.points.length)) return shape
  if (shape.type === 'path') return removePathNodeWithSymmetry(shape, index, pathConstraintSymmetry(shape))
  if (shape.points.length <= 3 || index < 0 || index >= shape.points.length) return shape
  return { ...shape, points: shape.points.filter((_, i) => i !== index) }
}
