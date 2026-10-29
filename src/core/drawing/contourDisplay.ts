import type { Gauge } from '../gauge/gauge.types'
import type { PathNode, PathShape, Point } from '../geometry/shape.types'
import { flattenPath } from '../geometry/path'
import { hasSelfIntersection } from '../geometry/shapeValidation'

export const CONTOUR_DISPLAY_NOTE = '圆滑线仅供外观参考，针数和尺寸以实际针格及原轮廓为准。'
export interface DisplayContour {
  source: PathShape
  path: PathShape
  points: Point[]
  fallback: string | null
}
const EPS = 1e-8
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
const vector = (a: Point, b: Point): Point => ({ x: b.x - a.x, y: b.y - a.y })
const unit = (p: Point): Point => { const n = Math.hypot(p.x, p.y); return n > EPS ? { x: p.x / n, y: p.y / n } : { x: 0, y: 0 } }
function onEdge(a: Point, b: Point, p: Point): boolean {
  return Math.abs(cross(a, b, p)) < EPS && p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS && p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS
}
export function insideDisplayContour(points: Point[], p: Point): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i]
    if (onEdge(a, b, p)) return true
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
function boundariesMeet(first: Point[], second: Point[]): boolean {
  for (let i = 0; i < first.length; i++) {
    const a = first[i], b = first[(i + 1) % first.length]
    for (let j = 0; j < second.length; j++) {
      const c = second[j], d = second[(j + 1) % second.length]
      if (Math.max(a.x, b.x) < Math.min(c.x, d.x) - EPS || Math.max(c.x, d.x) < Math.min(a.x, b.x) - EPS || Math.max(a.y, b.y) < Math.min(c.y, d.y) - EPS || Math.max(c.y, d.y) < Math.min(a.y, b.y) - EPS) continue
      if (cross(a, b, c) * cross(a, b, d) < -EPS && cross(c, d, a) * cross(c, d, b) < -EPS) return true
      if (onEdge(a, b, c) || onEdge(a, b, d) || onEdge(c, d, a) || onEdge(c, d, b)) return true
    }
  }
  return false
}
function overlaps(a: Point[], b: Point[]): boolean {
  if (!a.length || !b.length) return false
  return boundariesMeet(a, b) || insideDisplayContour(a, b[0]) || insideDisplayContour(b, a[0])
}
function fallback(source: PathShape, reason: string): DisplayContour {
  return { source, path: source, points: flattenPath(source), fallback: reason }
}
/** Remove only small inward turns within a monotone staircase, preserving real notches. */
function simplifyStairs(input: Point[]): Point[] {
  const points = input.map(p => ({ ...p }))
  let changed = true
  while (changed && points.length > 3) {
    changed = false
    for (let i = 0; i < points.length; i++) {
      const at = (n: number) => points[(i + n + points.length) % points.length]
      if (cross(at(-1), at(0), at(1)) >= -EPS) continue
      const directions = [-2, -1, 0, 1].map(n => vector(at(n), at(n + 1)))
      if (['x', 'y'].some(axis => directions.some(d => d[axis as 'x' | 'y'] > EPS) && directions.some(d => d[axis as 'x' | 'y'] < -EPS))) continue
      const edge = vector(at(-1), at(1)), length = Math.hypot(edge.x, edge.y)
      if (length < EPS || Math.abs(cross(at(-1), at(1), at(0))) / length > 0.72) continue
      points.splice(i, 1); changed = true; break
    }
  }
  return points
}
function exteriorCurve(points: Point[], radius: number): PathShape {
  const offset = points.map((p, i) => {
    const incoming = unit(vector(points[(i + points.length - 1) % points.length], p)), outgoing = unit(vector(p, points[(i + 1) % points.length]))
    const divisor = Math.max(0.1, 1 + incoming.x * outgoing.x + incoming.y * outgoing.y)
    const dx = (incoming.y + outgoing.y) * radius / divisor, dy = -(incoming.x + outgoing.x) * radius / divisor
    const scale = Math.min(1, radius * 3 / Math.max(Math.hypot(dx, dy), EPS))
    return { x: p.x + dx * scale, y: p.y + dy * scale }
  })
  const nodes: PathNode[] = offset.map((anchor, i) => {
    const prev = offset[(i + offset.length - 1) % offset.length], next = offset[(i + 1) % offset.length]
    const incoming = unit(vector(prev, anchor)), outgoing = unit(vector(anchor, next))
    const tangent = unit({ x: incoming.x + outgoing.x, y: incoming.y + outgoing.y })
    const handle = Math.min(0.35, Math.hypot(anchor.x - prev.x, anchor.y - prev.y) * .2, Math.hypot(next.x - anchor.x, next.y - anchor.y) * .2)
    return { anchor, inControl: { x: anchor.x - tangent.x * handle, y: anchor.y - tangent.y * handle }, outControl: { x: anchor.x + tangent.x * handle, y: anchor.y + tangent.y * handle } }
  })
  return { id: 'display-only', type: 'path', closed: true, nodes }
}
function displayContour(source: PathShape, gauge: Gauge): DisplayContour {
  if (!source.closed || source.nodes.length < 3 || hasSelfIntersection(source)) return fallback(source, '无效轮廓保留原边缘。')
  const original = flattenPath(source).map(p => ({ x: p.x / gauge.stitchWidthCm, y: p.y / gauge.rowHeightCm }))
  if (original.length > 1200) return fallback(source, '复杂边缘保留实际轮廓，可查看或继续编辑。')
  const area = original.reduce((sum, p, i) => { const q = original[(i + 1) % original.length]; return sum + p.x * q.y - q.x * p.y }, 0)
  if (area < 0) original.reverse()
  const simplified = simplifyStairs(original)
  const notchEdges = new Set<number>()
  simplified.forEach((p, i) => {
    const prev = (i + simplified.length - 1) % simplified.length
    if (cross(simplified[prev], p, simplified[(i + 1) % simplified.length]) < -EPS) { notchEdges.add(prev); notchEdges.add(i) }
  })
  for (const radius of [0.18, 0.09, 0.045]) {
    const candidate = exteriorCurve(simplified, radius), outline = flattenPath(candidate)
    if (hasSelfIntersection(candidate) || !insideDisplayContour(outline, original[0]) || boundariesMeet(outline, original)) continue
    // Exterior witnesses preserve narrow open gaps, rather than smoothing across them.
    const closesGap = simplified.some((a, i) => {
      if (!notchEdges.has(i)) return false
      const b = simplified[(i + 1) % simplified.length], direction = unit(vector(a, b))
      const witness = { x: (a.x + b.x) / 2 + direction.y * .55, y: (a.y + b.y) / 2 - direction.x * .55 }
      return !insideDisplayContour(original, witness) && insideDisplayContour(outline, witness)
    })
    if (closesGap) continue
    const toCm = (p: Point): Point => ({ x: p.x * gauge.stitchWidthCm, y: p.y * gauge.rowHeightCm })
    const path: PathShape = { id: source.id, name: source.name, type: 'path', closed: true, nodes: candidate.nodes.map(n => ({ anchor: toCm(n.anchor), inControl: toCm(n.inControl!), outControl: toCm(n.outControl!) })) }
    return { source, path, points: outline.map(toCm), fallback: null }
  }
  return fallback(source, '狭窄或复杂边缘保留实际轮廓，避免圆滑后遮掉针格或封住凹口。')
}
/** Display geometry never enters the saved document or the knitting calculation. */
export function drawingContourDisplays(sources: PathShape[], gauge: Gauge): DisplayContour[] {
  const result = sources.map(s => displayContour(s, gauge))
  const originals = sources.map(flattenPath)
  const bounds = result.map((entry, index) => {
    const points = [...entry.points, ...originals[index]]
    return points.reduce((b, p) => ({ index, minX: Math.min(b.minX, p.x), maxX: Math.max(b.maxX, p.x), minY: Math.min(b.minY, p.y), maxY: Math.max(b.maxY, p.y) }), { index, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity })
  }).sort((a, b) => a.minX - b.minX)
  // Only nearby envelopes can merge; distant pieces do not need edge comparisons.
  for (let a = 0; a < bounds.length; a++) for (let b = a + 1; b < bounds.length && bounds[b].minX <= bounds[a].maxX + EPS; b++) {
    if (bounds[a].maxY < bounds[b].minY - EPS || bounds[b].maxY < bounds[a].minY - EPS) continue
    const i = bounds[a].index, j = bounds[b].index
    if (overlaps(originals[i], originals[j]) || overlaps(result[i].points, result[j].points)) {
      result[i] = fallback(sources[i], '相邻区域过近，保留各片实际边缘。')
      result[j] = fallback(sources[j], '相邻区域过近，保留各片实际边缘。')
    }
  }
  return result
}
