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

export interface PathSymmetry {
  axisX: number
  pairedNodeIndexes: number[]
}

export type PathMirrorSource = 'average' | 'left' | 'right'

function pointsMatch(left: Point, right: Point, tolerance: number): boolean {
  return Math.hypot(left.x - right.x, left.y - right.y) <= tolerance
}

function reversePathNodes(nodes: readonly PathNode[]): PathNode[] {
  return [...nodes].reverse().map((node) => ({
    anchor: { ...node.anchor },
    inControl: node.outControl ? { ...node.outControl } : undefined,
    outControl: node.inControl ? { ...node.inControl } : undefined,
  }))
}

function joinEndToStart(
  first: readonly PathNode[],
  second: readonly PathNode[],
): PathNode[] {
  const firstEnd = first.at(-1)!
  const secondStart = second[0]!
  const joinedNode: PathNode = {
    anchor: { ...firstEnd.anchor },
    inControl: firstEnd.inControl ? { ...firstEnd.inControl } : undefined,
    outControl: secondStart.outControl ? { ...secondStart.outControl } : undefined,
  }
  return [
    ...first.slice(0, -1).map((node) => ({ ...node })),
    joinedNode,
    ...second.slice(1).map((node) => ({ ...node })),
  ]
}

/**
 * 将端点相接的两条开放路径拼成一条连续路径，并保留连接处两侧的控制柄。
 * 返回 null 表示两条路径的端点没有相接。
 */
export function joinConnectedOpenPaths(
  first: PathShape,
  second: PathShape,
  tolerance = 1e-6,
): PathShape | null {
  if (first.closed || second.closed || first.nodes.length < 2 || second.nodes.length < 2) {
    return null
  }

  const firstStart = first.nodes[0]!.anchor
  const firstEnd = first.nodes.at(-1)!.anchor
  const secondStart = second.nodes[0]!.anchor
  const secondEnd = second.nodes.at(-1)!.anchor
  let nodes: PathNode[] | null = null

  if (pointsMatch(firstEnd, secondStart, tolerance)) {
    nodes = joinEndToStart(first.nodes, second.nodes)
  } else if (pointsMatch(firstEnd, secondEnd, tolerance)) {
    nodes = joinEndToStart(first.nodes, reversePathNodes(second.nodes))
  } else if (pointsMatch(firstStart, secondEnd, tolerance)) {
    nodes = joinEndToStart(second.nodes, first.nodes)
  } else if (pointsMatch(firstStart, secondStart, tolerance)) {
    nodes = joinEndToStart(reversePathNodes(second.nodes), first.nodes)
  }
  if (!nodes) return null

  const start = nodes[0]!
  const end = nodes.at(-1)!
  const closesLoop = nodes.length >= 4 && pointsMatch(start.anchor, end.anchor, tolerance)
  if (closesLoop) {
    nodes[0] = {
      ...start,
      inControl: end.inControl ? { ...end.inControl } : start.inControl,
    }
    nodes.pop()
  }

  return {
    ...first,
    name: closesLoop ? '自定义闭合路径' : first.name,
    editConstraint: undefined,
    nodes,
    closed: closesLoop,
  }
}

function mirrorPointAcrossAxis(point: Point, axisX: number): Point {
  return { x: axisX * 2 - point.x, y: point.y }
}

function clonePathNode(node: PathNode): PathNode {
  return {
    anchor: { ...node.anchor },
    inControl: node.inControl ? { ...node.inControl } : undefined,
    outControl: node.outControl ? { ...node.outControl } : undefined,
  }
}

/** 为路径寻找与遍历方向相反的镜像拓扑；闭合路径会比较所有可能的起点。 */
function inferPairedNodeIndexes(path: PathShape, axisX: number): number[] | null {
  const count = path.nodes.length
  if (count < 2) return null
  if (!path.closed) return Array.from({ length: count }, (_, index) => count - 1 - index)

  let bestPairs: number[] | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (let offset = 0; offset < count; offset += 1) {
    const pairs = Array.from({ length: count }, (_, index) => (offset - index + count) % count)
    let score = 0
    for (let index = 0; index < count; index += 1) {
      const node = path.nodes[index]!
      const paired = path.nodes[pairs[index]!]!
      const target = mirrorPointAcrossAxis(node.anchor, axisX)
      score += Math.hypot(paired.anchor.x - target.x, paired.anchor.y - target.y)
      if (pairs[index] === index) score += Math.abs(node.anchor.x - axisX) * 4
    }
    if (score < bestScore) {
      bestScore = score
      bestPairs = pairs
    }
  }
  return bestPairs
}

export function createPathSymmetry(path: PathShape, axisX: number): PathSymmetry | null {
  const pairedNodeIndexes = inferPairedNodeIndexes(path, axisX)
  return pairedNodeIndexes ? { axisX, pairedNodeIndexes } : null
}

export function pathConstraintSymmetry(path: PathShape): PathSymmetry | null {
  return path.editConstraint
    ? createPathSymmetry(path, path.editConstraint.axisX)
    : null
}

export function detectPathSymmetry(
  path: PathShape,
  tolerance: number,
  axisStep?: number,
): PathSymmetry | null {
  if (path.nodes.length < (path.closed ? 3 : 2)) return null
  const bounds = getPathBounds(path)
  const rawAxisX = bounds.x + bounds.width / 2
  const axisX = axisStep && axisStep > 0
    ? Math.round(rawAxisX / axisStep) * axisStep
    : rawAxisX
  const symmetry = createPathSymmetry(path, axisX)
  if (!symmetry) return null
  const matches = path.nodes.every((node, index) => {
    const pairedIndex = symmetry.pairedNodeIndexes[index]
    if (pairedIndex === undefined) return false
    const paired = path.nodes[pairedIndex]!
    return Math.hypot(
      paired.anchor.x - (axisX * 2 - node.anchor.x),
      paired.anchor.y - node.anchor.y,
    ) <= tolerance
  })
  return matches ? symmetry : null
}

function averagePoint(first: Point, second: Point): Point {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
}

function normalizedMirroredControl(
  first: Point | undefined,
  mirroredSecond: Point | undefined,
): Point | undefined {
  if (first && mirroredSecond) return averagePoint(first, mirroredSecond)
  return first ? { ...first } : mirroredSecond ? { ...mirroredSecond } : undefined
}

export function normalizePathWithSymmetry(
  path: PathShape,
  symmetry: PathSymmetry,
): PathShape {
  const nodes = path.nodes.map(clonePathNode)
  const visited = new Set<number>()

  nodes.forEach((node, index) => {
    if (visited.has(index)) return
    const pairedIndex = symmetry.pairedNodeIndexes[index]
    if (pairedIndex === undefined || pairedIndex < 0) return
    visited.add(index)
    visited.add(pairedIndex)

    if (pairedIndex === index) {
      node.anchor.x = symmetry.axisX
      const normalizedIn = normalizedMirroredControl(
        node.inControl,
        node.outControl ? mirrorPointAcrossAxis(node.outControl, symmetry.axisX) : undefined,
      )
      node.inControl = normalizedIn
      node.outControl = normalizedIn
        ? mirrorPointAcrossAxis(normalizedIn, symmetry.axisX)
        : undefined
      return
    }

    const paired = nodes[pairedIndex]!
    const leftIndex = node.anchor.x <= paired.anchor.x ? index : pairedIndex
    const rightIndex = leftIndex === index ? pairedIndex : index
    const left = nodes[leftIndex]!
    const right = nodes[rightIndex]!
    const normalizedAnchor = averagePoint(
      left.anchor,
      mirrorPointAcrossAxis(right.anchor, symmetry.axisX),
    )
    const normalizedIn = normalizedMirroredControl(
      left.inControl,
      right.outControl ? mirrorPointAcrossAxis(right.outControl, symmetry.axisX) : undefined,
    )
    const normalizedOut = normalizedMirroredControl(
      left.outControl,
      right.inControl ? mirrorPointAcrossAxis(right.inControl, symmetry.axisX) : undefined,
    )
    left.anchor = normalizedAnchor
    left.inControl = normalizedIn
    left.outControl = normalizedOut
    right.anchor = mirrorPointAcrossAxis(normalizedAnchor, symmetry.axisX)
    right.inControl = normalizedOut
      ? mirrorPointAcrossAxis(normalizedOut, symmetry.axisX)
      : undefined
    right.outControl = normalizedIn
      ? mirrorPointAcrossAxis(normalizedIn, symmetry.axisX)
      : undefined
  })
  return { ...path, nodes }
}

export function enablePathMirror(
  path: PathShape,
  source: PathMirrorSource,
  axisStep?: number,
): PathShape {
  const bounds = getPathBounds(path)
  const rawAxisX = bounds.x + bounds.width / 2
  const axisX = axisStep && axisStep > 0
    ? Math.round(rawAxisX / axisStep) * axisStep
    : rawAxisX
  const symmetry = createPathSymmetry(path, axisX)
  if (!symmetry) return path
  if (source === 'average') {
    return {
      ...normalizePathWithSymmetry(path, symmetry),
      editConstraint: { type: 'vertical-mirror', axisX },
    }
  }

  const nodes = path.nodes.map(clonePathNode)
  const visited = new Set<number>()
  nodes.forEach((node, index) => {
    if (visited.has(index)) return
    const pairedIndex = symmetry.pairedNodeIndexes[index]
    if (pairedIndex === undefined) return
    visited.add(index)
    visited.add(pairedIndex)
    if (pairedIndex === index) {
      node.anchor.x = axisX
      const controls = ([
        ['inControl', node.inControl],
        ['outControl', node.outControl],
      ] as const).filter((entry): entry is ['inControl' | 'outControl', Point] => Boolean(entry[1]))
      const preferred = controls.find(([, point]) => source === 'left'
        ? point.x <= axisX
        : point.x >= axisX) ?? controls[0]
      if (!preferred) {
        node.inControl = undefined
        node.outControl = undefined
        return
      }
      const [control, point] = preferred
      const pairedControl = control === 'inControl' ? 'outControl' : 'inControl'
      node[control] = { ...point }
      node[pairedControl] = mirrorPointAcrossAxis(point, axisX)
      return
    }
    const paired = nodes[pairedIndex]!
    const sourceIndex = source === 'left'
      ? (node.anchor.x <= paired.anchor.x ? index : pairedIndex)
      : (node.anchor.x >= paired.anchor.x ? index : pairedIndex)
    const targetIndex = sourceIndex === index ? pairedIndex : index
    const sourceNode = nodes[sourceIndex]!
    nodes[targetIndex] = {
      anchor: mirrorPointAcrossAxis(sourceNode.anchor, axisX),
      inControl: sourceNode.outControl
        ? mirrorPointAcrossAxis(sourceNode.outControl, axisX)
        : undefined,
      outControl: sourceNode.inControl
        ? mirrorPointAcrossAxis(sourceNode.inControl, axisX)
        : undefined,
    }
  })
  return { ...path, nodes, editConstraint: { type: 'vertical-mirror', axisX } }
}

export function movePathNodeWithSymmetry(
  path: PathShape,
  nodeIndex: number,
  target: Point,
  symmetry: PathSymmetry | null,
): PathShape {
  const normalized = symmetry ? normalizePathWithSymmetry(path, symmetry) : path
  const nodes = normalized.nodes.map(clonePathNode)
  const source = nodes[nodeIndex]
  if (!source) return path
  const pairedIndex = symmetry?.pairedNodeIndexes[nodeIndex] ?? -1
  const nextTarget = pairedIndex === nodeIndex && symmetry
    ? { x: symmetry.axisX, y: target.y }
    : target
  const deltaX = nextTarget.x - source.anchor.x
  const deltaY = nextTarget.y - source.anchor.y
  source.anchor = nextTarget
  if (source.inControl) {
    source.inControl = { x: source.inControl.x + deltaX, y: source.inControl.y + deltaY }
  }
  if (source.outControl) {
    source.outControl = { x: source.outControl.x + deltaX, y: source.outControl.y + deltaY }
  }

  if (symmetry && pairedIndex >= 0 && pairedIndex !== nodeIndex) {
    const paired = nodes[pairedIndex]!
    paired.anchor = mirrorPointAcrossAxis(source.anchor, symmetry.axisX)
    paired.inControl = source.outControl
      ? mirrorPointAcrossAxis(source.outControl, symmetry.axisX)
      : undefined
    paired.outControl = source.inControl
      ? mirrorPointAcrossAxis(source.inControl, symmetry.axisX)
      : undefined
  }
  return { ...normalized, nodes }
}

export function movePathControlWithSymmetry(
  path: PathShape,
  nodeIndex: number,
  control: 'inControl' | 'outControl',
  target: Point,
  symmetry: PathSymmetry | null,
): PathShape {
  const normalized = symmetry ? normalizePathWithSymmetry(path, symmetry) : path
  const nodes = normalized.nodes.map(clonePathNode)
  const source = nodes[nodeIndex]
  if (!source) return path
  source[control] = target
  const pairedIndex = symmetry?.pairedNodeIndexes[nodeIndex] ?? -1
  if (symmetry && pairedIndex >= 0) {
    const pairedControl = control === 'inControl' ? 'outControl' : 'inControl'
    nodes[pairedIndex]![pairedControl] = mirrorPointAcrossAxis(target, symmetry.axisX)
  }
  return { ...normalized, nodes }
}

function mirroredSegmentIndex(
  path: PathShape,
  segmentIndex: number,
  symmetry: PathSymmetry,
): number | null {
  const segment = getPathSegment(path, segmentIndex)
  if (!segment) return null
  const mirroredStart = symmetry.pairedNodeIndexes[segment.endIndex]
  const mirroredEnd = symmetry.pairedNodeIndexes[segment.startIndex]
  if (mirroredStart === undefined || mirroredEnd === undefined) return null
  for (let index = 0; index < pathSegmentCount(path); index += 1) {
    const candidate = getPathSegment(path, index)
    if (candidate?.startIndex === mirroredStart && candidate.endIndex === mirroredEnd) return index
  }
  return null
}

export function bendPathSegmentWithSymmetry(
  path: PathShape,
  segmentIndex: number,
  midpoint: Point,
  symmetry: PathSymmetry | null,
): PathShape {
  if (!symmetry) return bendPathSegment(path, segmentIndex, midpoint)
  const normalized = normalizePathWithSymmetry(path, symmetry)
  const pairedSegmentIndex = mirroredSegmentIndex(normalized, segmentIndex, symmetry)
  if (pairedSegmentIndex === null) return bendPathSegment(normalized, segmentIndex, midpoint)
  if (pairedSegmentIndex === segmentIndex) {
    return bendPathSegment(normalized, segmentIndex, { x: symmetry.axisX, y: midpoint.y })
  }
  const bent = bendPathSegment(normalized, segmentIndex, midpoint)
  return bendPathSegment(
    bent,
    pairedSegmentIndex,
    mirrorPointAcrossAxis(midpoint, symmetry.axisX),
  )
}

export function removePathNodeWithSymmetry(
  path: PathShape,
  nodeIndex: number,
  symmetry: PathSymmetry | null,
): PathShape {
  const pairedIndex = symmetry?.pairedNodeIndexes[nodeIndex] ?? -1
  const indexes = pairedIndex >= 0 && pairedIndex !== nodeIndex
    ? [nodeIndex, pairedIndex].sort((left, right) => right - left)
    : [nodeIndex]
  const minimum = path.closed ? 3 : 2
  if (path.nodes.length - indexes.length < minimum) return path
  const normalized = symmetry ? normalizePathWithSymmetry(path, symmetry) : path
  const nodes = normalized.nodes.map(clonePathNode)
  indexes.forEach((index) => nodes.splice(index, 1))
  return { ...normalized, nodes }
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

export function splitPathSegmentWithSymmetry(
  path: PathShape,
  segmentIndex: number,
  requestedT: number,
  symmetry: PathSymmetry | null,
): { path: PathShape; insertedIndex: number } {
  if (!symmetry) return splitPathSegment(path, segmentIndex, requestedT)
  const normalized = normalizePathWithSymmetry(path, symmetry)
  const pairedSegmentIndex = mirroredSegmentIndex(normalized, segmentIndex, symmetry)
  if (pairedSegmentIndex === null) return splitPathSegment(normalized, segmentIndex, requestedT)
  const t = Math.min(0.95, Math.max(0.05, requestedT))

  if (pairedSegmentIndex === segmentIndex) {
    if (Math.abs(t - 0.5) < 0.001) return splitPathSegment(normalized, segmentIndex, 0.5)
    const firstT = Math.min(t, 1 - t)
    const secondT = Math.max(t, 1 - t)
    const first = splitPathSegment(normalized, segmentIndex, firstT)
    const second = splitPathSegment(
      first.path,
      segmentIndex + 1,
      (secondT - firstT) / (1 - firstT),
    )
    return {
      path: second.path,
      insertedIndex: t < 0.5 ? first.insertedIndex : second.insertedIndex,
    }
  }

  const operations = [
    { segmentIndex, t, selected: true },
    { segmentIndex: pairedSegmentIndex, t: 1 - t, selected: false },
  ].sort((left, right) => right.segmentIndex - left.segmentIndex)
  let result = normalized
  let insertedIndex = -1
  operations.forEach((operation) => {
    const split = splitPathSegment(result, operation.segmentIndex, operation.t)
    if (insertedIndex >= split.insertedIndex) insertedIndex += 1
    if (operation.selected) insertedIndex = split.insertedIndex
    result = split.path
  })
  return { path: result, insertedIndex }
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
