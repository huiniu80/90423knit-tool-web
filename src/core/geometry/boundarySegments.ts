import { evaluatePathSegment, flattenPath, getPathSegment, pathSegmentCount } from './path'
import type { PathShape, Point, Shape } from './shape.types'

export interface ShapeBoundarySegment {
  key: string
  shapeId: string
  segmentIndex: number
  rasterShape: Shape
  anchor: Point
  spansBothSides: boolean
  sourceShape: Shape
}

function openPathSegment(
  shapeId: string,
  segmentIndex: number,
  start: Point,
  end: Point,
  outControl?: Point,
  inControl?: Point,
): PathShape {
  return {
    id: `${shapeId}:segment:${segmentIndex}`,
    type: 'path',
    closed: false,
    nodes: [
      { anchor: { ...start }, outControl: outControl ? { ...outControl } : undefined },
      { anchor: { ...end }, inControl: inControl ? { ...inControl } : undefined },
    ],
  }
}

function pointPairSegments(shape: Shape, points: readonly Point[]): ShapeBoundarySegment[] {
  if (points.length < 2) return []
  return points.map((start, segmentIndex) => {
    const end = points[(segmentIndex + 1) % points.length]!
    return {
      key: `${shape.id}:${segmentIndex}`,
      shapeId: shape.id,
      segmentIndex,
      rasterShape: openPathSegment(shape.id, segmentIndex, start, end),
      anchor: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
      spansBothSides: false,
      sourceShape: shape,
    }
  })
}

export function getShapeBoundarySegments(shape: Shape): ShapeBoundarySegment[] {
  if (shape.type === 'path') {
    return Array.from({ length: pathSegmentCount(shape) }, (_, segmentIndex) => {
      const segment = getPathSegment(shape, segmentIndex)!
      return {
        key: `${shape.id}:${segmentIndex}`,
        shapeId: shape.id,
        segmentIndex,
        rasterShape: openPathSegment(
          shape.id,
          segmentIndex,
          segment.p0,
          segment.p3,
          segment.p1,
          segment.p2,
        ),
        anchor: evaluatePathSegment(shape, segmentIndex, 0.5),
        spansBothSides: false,
        sourceShape: shape,
      }
    })
  }

  if (shape.type === 'triangle' || shape.type === 'polygon') {
    return pointPairSegments(shape, shape.points)
  }

  if (shape.type === 'rectangle') {
    return pointPairSegments(shape, [
      { x: shape.x, y: shape.y },
      { x: shape.x + shape.widthCm, y: shape.y },
      { x: shape.x + shape.widthCm, y: shape.y + shape.heightCm },
      { x: shape.x, y: shape.y + shape.heightCm },
    ])
  }

  const anchor = shape.type === 'circle'
    ? { x: shape.center.x, y: shape.center.y + shape.radiusCm }
    : { x: shape.center.x, y: shape.center.y + shape.radiusYcm }
  return [{
    key: `${shape.id}:0`,
    shapeId: shape.id,
    segmentIndex: 0,
    rasterShape: shape,
    anchor,
    spansBothSides: true,
    sourceShape: shape,
  }]
}

function distanceToLineSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy)
}

export function findNearestBoundarySegment(
  shape: Shape,
  point: Point,
): ShapeBoundarySegment | null {
  const segments = getShapeBoundarySegments(shape)
  let nearest: ShapeBoundarySegment | null = null
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const segment of segments) {
    if (segment.rasterShape.type !== 'path') return segment
    const flattened = flattenPath(segment.rasterShape)
    for (let index = 0; index < flattened.length - 1; index += 1) {
      const start = flattened[index]
      const end = flattened[index + 1]
      if (!start || !end) continue
      const distance = distanceToLineSegment(point, start, end)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest = segment
      }
    }
  }
  return nearest
}
