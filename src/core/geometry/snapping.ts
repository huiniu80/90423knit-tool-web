import type { PathNode, PathShape, Point } from './shape.types'
import { normalizePathWithSymmetry, pathConstraintSymmetry } from './path'

export const SNAP_STEP_CM = 0.5
export const AXIS_SNAP_ANGLE_DEGREES = 5

export type SnapAxis = 'horizontal' | 'vertical'

export interface PointSnapResult {
  point: Point
  axis: SnapAxis | null
  guideValue: number | null
}

export function snapCm(value: number, step = SNAP_STEP_CM): number {
  if (!Number.isFinite(value) || step <= 0) return value
  const snapped = Math.round(value / step) * step
  return Object.is(snapped, -0) ? 0 : snapped
}

export function snapPointToGrid(point: Point): Point {
  return { x: snapCm(point.x), y: snapCm(point.y) }
}

function axisDeviationDegrees(point: Point, reference: Point): { horizontal: number; vertical: number } | null {
  const deltaX = point.x - reference.x
  const deltaY = point.y - reference.y
  if (Math.abs(deltaX) < 1e-9 && Math.abs(deltaY) < 1e-9) return null
  const angle = Math.abs(Math.atan2(deltaY, deltaX) * 180 / Math.PI)
  const normalized = angle > 90 ? 180 - angle : angle
  return {
    horizontal: normalized,
    vertical: Math.abs(90 - normalized),
  }
}

export function snapPoint(
  point: Point,
  references: readonly Point[] = [],
  directionSnap = true,
): PointSnapResult {
  const gridPoint = snapPointToGrid(point)
  if (!directionSnap) return { point: gridPoint, axis: null, guideValue: null }

  let best: { axis: SnapAxis; deviation: number; reference: Point } | null = null
  for (const reference of references) {
    const deviation = axisDeviationDegrees(point, reference)
    if (!deviation) continue
    for (const axis of ['horizontal', 'vertical'] as const) {
      const value = deviation[axis]
      if (value > AXIS_SNAP_ANGLE_DEGREES || (best && value >= best.deviation)) continue
      best = { axis, deviation: value, reference }
    }
  }

  if (!best) return { point: gridPoint, axis: null, guideValue: null }
  if (best.axis === 'horizontal') {
    return {
      point: { x: gridPoint.x, y: best.reference.y },
      axis: 'horizontal',
      guideValue: best.reference.y,
    }
  }
  return {
    point: { x: best.reference.x, y: gridPoint.y },
    axis: 'vertical',
    guideValue: best.reference.x,
  }
}

class DisjointSet {
  private readonly parents: number[]

  constructor(size: number) {
    this.parents = Array.from({ length: size }, (_, index) => index)
  }

  find(index: number): number {
    const parent = this.parents[index]!
    if (parent === index) return index
    const root = this.find(parent)
    this.parents[index] = root
    return root
  }

  union(first: number, second: number): void {
    const firstRoot = this.find(first)
    const secondRoot = this.find(second)
    if (firstRoot !== secondRoot) this.parents[secondRoot] = firstRoot
  }
}

function cloneAndSnapNode(node: PathNode): PathNode {
  const anchor = snapPointToGrid(node.anchor)
  const deltaX = anchor.x - node.anchor.x
  const deltaY = anchor.y - node.anchor.y
  const translateControl = (control: Point | undefined): Point | undefined => control
    ? { x: control.x + deltaX, y: control.y + deltaY }
    : undefined
  return {
    anchor,
    inControl: translateControl(node.inControl),
    outControl: translateControl(node.outControl),
  }
}

function componentAverages(
  groups: DisjointSet,
  nodes: readonly PathNode[],
  coordinate: 'x' | 'y',
): Map<number, number> {
  const values = new Map<number, { sum: number; count: number }>()
  nodes.forEach((node, index) => {
    const root = groups.find(index)
    const current = values.get(root) ?? { sum: 0, count: 0 }
    current.sum += node.anchor[coordinate]
    current.count += 1
    values.set(root, current)
  })
  return new Map([...values].map(([root, value]) => [root, snapCm(value.sum / value.count)]))
}

export function tidyPathToGrid(path: PathShape): PathShape {
  const nodeCount = path.nodes.length
  if (!nodeCount) return path
  const horizontalGroups = new DisjointSet(nodeCount)
  const verticalGroups = new DisjointSet(nodeCount)
  const horizontalMembers = new Set<number>()
  const verticalMembers = new Set<number>()
  const segmentCount = path.closed ? nodeCount : nodeCount - 1

  for (let index = 0; index < segmentCount; index += 1) {
    const nextIndex = (index + 1) % nodeCount
    const start = path.nodes[index]!
    const end = path.nodes[nextIndex]!
    if (start.outControl || end.inControl) continue
    const deviation = axisDeviationDegrees(end.anchor, start.anchor)
    if (!deviation) continue
    if (deviation.horizontal <= AXIS_SNAP_ANGLE_DEGREES) {
      horizontalGroups.union(index, nextIndex)
      horizontalMembers.add(index)
      horizontalMembers.add(nextIndex)
    } else if (deviation.vertical <= AXIS_SNAP_ANGLE_DEGREES) {
      verticalGroups.union(index, nextIndex)
      verticalMembers.add(index)
      verticalMembers.add(nextIndex)
    }
  }

  const horizontalValues = componentAverages(horizontalGroups, path.nodes, 'y')
  const verticalValues = componentAverages(verticalGroups, path.nodes, 'x')
  const nodes = path.nodes.map((node, index) => {
    const snapped = cloneAndSnapNode(node)
    const nextAnchor = { ...snapped.anchor }
    if (horizontalMembers.has(index)) nextAnchor.y = horizontalValues.get(horizontalGroups.find(index))!
    if (verticalMembers.has(index)) nextAnchor.x = verticalValues.get(verticalGroups.find(index))!
    const deltaX = nextAnchor.x - snapped.anchor.x
    const deltaY = nextAnchor.y - snapped.anchor.y
    return {
      anchor: nextAnchor,
      inControl: snapped.inControl
        ? { x: snapped.inControl.x + deltaX, y: snapped.inControl.y + deltaY }
        : undefined,
      outControl: snapped.outControl
        ? { x: snapped.outControl.x + deltaX, y: snapped.outControl.y + deltaY }
        : undefined,
    }
  })

  const tidied = { ...path, nodes }
  const symmetry = pathConstraintSymmetry(tidied)
  return symmetry ? normalizePathWithSymmetry(tidied, symmetry) : tidied
}
