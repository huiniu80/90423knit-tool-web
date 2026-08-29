import { getPolygonIntervals } from './polygon'
import type {
  Bounds,
  HorizontalInterval,
  PathNode,
  PathShape,
  Point,
} from './shape.types'

export const PATH_FLATNESS_CM = 0.02
const MAX_SUBDIVISION_DEPTH = 12
const EPSILON = 1e-9

export interface CubicSegment {
  startIndex: number
  endIndex: number
  p0: Point
  p1: Point
  p2: Point
  p3: Point
}

export interface PathEndpointSnap {
  pathId: string
  nodeIndex: number
  point: Point
  distance: number
}

function lerpPoint(start: Point, end: Point, t: number): Point {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  }
}

function distanceToLine(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length < EPSILON) return Math.hypot(point.x - start.x, point.y - start.y)
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / length
}

export function pathSegmentCount(path: PathShape): number {
  if (path.nodes.length < 2) return 0
  return path.closed ? path.nodes.length : path.nodes.length - 1
}

export function findNearestOpenPathEndpoint(
  paths: readonly PathShape[],
  point: Point,
  maxDistance: number,
): PathEndpointSnap | null {
  let nearest: PathEndpointSnap | null = null
  for (const path of paths) {
    if (path.closed || path.nodes.length < 2) continue
    const endpointIndexes = [0, path.nodes.length - 1]
    for (const nodeIndex of endpointIndexes) {
      const endpoint = path.nodes[nodeIndex]?.anchor
      if (!endpoint) continue
      const distance = Math.hypot(point.x - endpoint.x, point.y - endpoint.y)
      if (distance <= maxDistance && (!nearest || distance < nearest.distance)) {
        nearest = { pathId: path.id, nodeIndex, point: { ...endpoint }, distance }
      }
    }
  }
  return nearest
}

export function getPathSegment(path: PathShape, segmentIndex: number): CubicSegment | null {
  const count = pathSegmentCount(path)
  if (segmentIndex < 0 || segmentIndex >= count) return null
  const startIndex = segmentIndex
  const endIndex = (segmentIndex + 1) % path.nodes.length
  const start = path.nodes[startIndex]
  const end = path.nodes[endIndex]
  if (!start || !end) return null
  return {
    startIndex,
    endIndex,
    p0: start.anchor,
    p1: start.outControl ?? start.anchor,
    p2: end.inControl ?? end.anchor,
    p3: end.anchor,
  }
}

export function evaluatePathSegment(path: PathShape, segmentIndex: number, t: number): Point {
  const segment = getPathSegment(path, segmentIndex)
  if (!segment) return { x: 0, y: 0 }
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const c = 3 * mt * t * t
  const d = t * t * t
  return {
    x: a * segment.p0.x + b * segment.p1.x + c * segment.p2.x + d * segment.p3.x,
    y: a * segment.p0.y + b * segment.p1.y + c * segment.p2.y + d * segment.p3.y,
  }
}

function flattenCubic(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  output: Point[],
  depth: number,
): void {
  const flatness = Math.max(distanceToLine(p1, p0, p3), distanceToLine(p2, p0, p3))
  if (flatness <= PATH_FLATNESS_CM || depth >= MAX_SUBDIVISION_DEPTH) {
    output.push({ ...p3 })
    return
  }

  const p01 = lerpPoint(p0, p1, 0.5)
  const p12 = lerpPoint(p1, p2, 0.5)
  const p23 = lerpPoint(p2, p3, 0.5)
  const p012 = lerpPoint(p01, p12, 0.5)
  const p123 = lerpPoint(p12, p23, 0.5)
  const midpoint = lerpPoint(p012, p123, 0.5)
  flattenCubic(p0, p01, p012, midpoint, output, depth + 1)
  flattenCubic(midpoint, p123, p23, p3, output, depth + 1)
}

export function flattenPath(path: PathShape): Point[] {
  const first = path.nodes[0]
  if (!first) return []
  const points: Point[] = [{ ...first.anchor }]
  for (let index = 0; index < pathSegmentCount(path); index += 1) {
    const segment = getPathSegment(path, index)
    if (segment) flattenCubic(segment.p0, segment.p1, segment.p2, segment.p3, points, 0)
  }
  if (
    path.closed &&
    points.length > 1 &&
    Math.hypot(points.at(-1)!.x - points[0]!.x, points.at(-1)!.y - points[0]!.y) < EPSILON
  ) {
    points.pop()
  }
  return points
}

export function getPathIntervals(path: PathShape, yCm: number): HorizontalInterval[] {
  if (!path.closed || path.nodes.length < 3) return []
  return getPolygonIntervals(flattenPath(path), yCm)
}

function cubicCoordinate(start: number, control1: number, control2: number, end: number, t: number): number {
  const mt = 1 - t
  return mt * mt * mt * start +
    3 * mt * mt * t * control1 +
    3 * mt * t * t * control2 +
    t * t * t * end
}

function extremaParameters(start: number, control1: number, control2: number, end: number): number[] {
  const a = -start + 3 * control1 - 3 * control2 + end
  const b = 3 * start - 6 * control1 + 3 * control2
  const c = -3 * start + 3 * control1
  const quadratic = 3 * a
  const linear = 2 * b

  if (Math.abs(quadratic) < EPSILON) {
    if (Math.abs(linear) < EPSILON) return []
    const t = -c / linear
    return t > 0 && t < 1 ? [t] : []
  }

  const discriminant = linear * linear - 4 * quadratic * c
  if (discriminant < 0) return []
  const root = Math.sqrt(discriminant)
  return [(-linear + root) / (2 * quadratic), (-linear - root) / (2 * quadratic)]
    .filter((t) => t > 0 && t < 1)
}

export function getPathBounds(path: PathShape): Bounds {
  if (!path.nodes.length) return { x: 0, y: 0, width: 0, height: 0 }
  const xs: number[] = []
  const ys: number[] = []
  const include = (point: Point): void => {
    xs.push(point.x)
    ys.push(point.y)
  }

  path.nodes.forEach((node) => include(node.anchor))
  for (let index = 0; index < pathSegmentCount(path); index += 1) {
    const segment = getPathSegment(path, index)
    if (!segment) continue
    extremaParameters(segment.p0.x, segment.p1.x, segment.p2.x, segment.p3.x)
      .forEach((t) => include({
        x: cubicCoordinate(segment.p0.x, segment.p1.x, segment.p2.x, segment.p3.x, t),
        y: cubicCoordinate(segment.p0.y, segment.p1.y, segment.p2.y, segment.p3.y, t),
      }))
    extremaParameters(segment.p0.y, segment.p1.y, segment.p2.y, segment.p3.y)
      .forEach((t) => include({
        x: cubicCoordinate(segment.p0.x, segment.p1.x, segment.p2.x, segment.p3.x, t),
        y: cubicCoordinate(segment.p0.y, segment.p1.y, segment.p2.y, segment.p3.y, t),
      }))
  }

  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

export function bendPathSegment(path: PathShape, segmentIndex: number, midpoint: Point): PathShape {
  const segment = getPathSegment(path, segmentIndex)
  if (!segment) return path
  const quadraticControl = {
    x: 2 * midpoint.x - (segment.p0.x + segment.p3.x) / 2,
    y: 2 * midpoint.y - (segment.p0.y + segment.p3.y) / 2,
  }
  const nodes = path.nodes.map((node) => ({ ...node }))
  const start = nodes[segment.startIndex]!
  const end = nodes[segment.endIndex]!
  start.outControl = {
    x: start.anchor.x + (quadraticControl.x - start.anchor.x) * 2 / 3,
    y: start.anchor.y + (quadraticControl.y - start.anchor.y) * 2 / 3,
  }
  end.inControl = {
    x: end.anchor.x + (quadraticControl.x - end.anchor.x) * 2 / 3,
    y: end.anchor.y + (quadraticControl.y - end.anchor.y) * 2 / 3,
  }
  return { ...path, nodes }
}

export function splitPathSegment(
  path: PathShape,
  segmentIndex: number,
  requestedT = 0.5,
): { path: PathShape; insertedIndex: number } {
  const segment = getPathSegment(path, segmentIndex)
  if (!segment) return { path, insertedIndex: -1 }
  const t = Math.min(0.95, Math.max(0.05, requestedT))
  const nodes: PathNode[] = path.nodes.map((node) => ({ ...node }))
  const isStraight = !nodes[segment.startIndex]!.outControl && !nodes[segment.endIndex]!.inControl
  const insertedIndex = segment.startIndex + 1

  if (isStraight) {
    nodes.splice(insertedIndex, 0, { anchor: lerpPoint(segment.p0, segment.p3, t) })
    return { path: { ...path, nodes }, insertedIndex }
  }

  const p01 = lerpPoint(segment.p0, segment.p1, t)
  const p12 = lerpPoint(segment.p1, segment.p2, t)
  const p23 = lerpPoint(segment.p2, segment.p3, t)
  const p012 = lerpPoint(p01, p12, t)
  const p123 = lerpPoint(p12, p23, t)
  const anchor = lerpPoint(p012, p123, t)
  nodes[segment.startIndex]!.outControl = p01
  nodes[segment.endIndex]!.inControl = p23
  nodes.splice(insertedIndex, 0, { anchor, inControl: p012, outControl: p123 })
  return { path: { ...path, nodes }, insertedIndex }
}

export function findNearestPathPosition(path: PathShape, point: Point): { segmentIndex: number; t: number } {
  let best = { segmentIndex: 0, t: 0.5 }
  let bestDistance = Number.POSITIVE_INFINITY
  for (let segmentIndex = 0; segmentIndex < pathSegmentCount(path); segmentIndex += 1) {
    for (let sample = 1; sample < 40; sample += 1) {
      const t = sample / 40
      const candidate = evaluatePathSegment(path, segmentIndex, t)
      const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y)
      if (distance < bestDistance) {
        bestDistance = distance
        best = { segmentIndex, t }
      }
    }
  }
  return best
}
