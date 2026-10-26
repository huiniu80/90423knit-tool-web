import type { DrawingDocument, PatternSample, StitchDefinition, StitchMark } from './types'
import { stitchMap } from './stitches'
import type { Point } from '../geometry/shape.types'

export const key = (x: number, y: number) => `${x},${y}`
export const uid = () => globalThis.crypto?.randomUUID?.() ?? `stitch-${Date.now()}-${Math.random()}`
export function cells(mark: StitchMark, defs: Map<string, StitchDefinition>): string[] {
  return Array.from({ length: defs.get(mark.stitchId)?.span ?? 1 }, (_, i) => key(mark.x + i, mark.y))
}
export function intersects(a: StitchMark, b: StitchMark, defs: Map<string, StitchDefinition>): boolean {
  return a.y === b.y && a.x < b.x + (defs.get(b.stitchId)?.span ?? 1) && b.x < a.x + (defs.get(a.stitchId)?.span ?? 1)
}
export function replaceMarks(source: StitchMark[], marks: StitchMark[], defs: Map<string, StitchDefinition>): StitchMark[] {
  let result = source
  for (const mark of marks) result = [...result.filter(m => !intersects(m, mark, defs)), mark]
  return result
}
/** Later placements cover whole operations, never split a cross-needle symbol. */
export function effectiveMarks(doc: DrawingDocument, includeAutomatic = true): StitchMark[] {
  const defs = stitchMap(doc.definitions)
  let result = doc.marks.filter(m => includeAutomatic || !m.automatic)
  for (const placement of doc.placements) result = replaceMarks(result, placement.marks.map(m => ({ ...m, x: m.x + placement.x, y: m.y + placement.y })), defs)
  if (includeAutomatic) {
    const used = occupied(result, defs)
    result = [...result, ...(doc.automaticMarks ?? []).filter(m => cells(m, defs).every(k => !used.has(k)))]
  }
  return result
}
export function occupied(marks: StitchMark[], defs: Map<string, StitchDefinition>): Set<string> {
  return new Set(marks.flatMap(m => cells(m, defs)))
}
/** Flood only external blanks; enclosed blanks become knit without changing drawn marks. */
export function filledRegion(marks: StitchMark[], defs: Map<string, StitchDefinition>, width: number, height: number) {
  const filled = occupied(marks, defs)
  if (!filled.size) return { filled, automatic: [] as StitchMark[] }
  const points = [...filled].map(p => p.split(',').map(Number))
  const minX = Math.max(-1, points.reduce((n, p) => Math.min(n, p[0]), Infinity) - 1)
  const maxX = Math.min(width, points.reduce((n, p) => Math.max(n, p[0]), 0) + 1)
  const minY = Math.max(-1, points.reduce((n, p) => Math.min(n, p[1]), Infinity) - 1)
  const maxY = Math.min(height, points.reduce((n, p) => Math.max(n, p[1]), 0) + 1)
  const outside = new Set<string>(); const queue: number[][] = [[minX, minY]]; outside.add(key(minX, minY))
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i]
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      const k = key(nx, ny)
      if (nx < minX || nx > maxX || ny < minY || ny > maxY || filled.has(k) || outside.has(k)) continue
      outside.add(k); queue.push([nx, ny])
    }
  }
  const automatic: StitchMark[] = []
  for (let y = Math.max(0, minY); y <= Math.min(height - 1, maxY); y++) for (let x = Math.max(0, minX); x <= Math.min(width - 1, maxX); x++) {
    const k = key(x, y)
    if (!filled.has(k) && !outside.has(k)) { filled.add(k); automatic.push({ id: uid(), x, y, stitchId: 'knit', automatic: true }) }
  }
  return { filled, automatic }
}
/** Trace exact cell edges, keeping diagonal-touching components independent. */
export function traceContours(region: Set<string>): Point[][] {
  const edges = new Map<string, Point[]>()
  const add = (x: number, y: number, nx: number, ny: number) => { const k = key(x, y); edges.set(k, [...(edges.get(k) ?? []), { x: nx, y: ny }]) }
  for (const cell of region) {
    const [x, y] = cell.split(',').map(Number)
    if (!region.has(key(x, y - 1))) add(x, y, x + 1, y)
    if (!region.has(key(x + 1, y))) add(x + 1, y, x + 1, y + 1)
    if (!region.has(key(x, y + 1))) add(x + 1, y + 1, x, y + 1)
    if (!region.has(key(x - 1, y))) add(x, y + 1, x, y)
  }
  const loops: Point[][] = []
  while (edges.size) {
    const start = [...edges.keys()][0]; const [x, y] = start.split(',').map(Number)
    let current = { x, y }; let previous = { x: x - 1, y }; const loop: Point[] = []
    do {
      loop.push(current); const k = key(current.x, current.y); const options = edges.get(k)
      if (!options?.length) throw Error('针格边缘未闭合')
      // Turn left first: a diagonal contact must not splice two pieces.
      const dx = current.x - previous.x, dy = current.y - previous.y
      options.sort((a, b) => (dx * (b.y - current.y) - dy * (b.x - current.x)) - (dx * (a.y - current.y) - dy * (a.x - current.x)))
      const next = options.shift()!; if (!options.length) edges.delete(k)
      previous = current; current = next
    } while (key(current.x, current.y) !== start)
    loops.push(loop.filter((p, i) => {
      const a = loop[(i + loop.length - 1) % loop.length], b = loop[(i + 1) % loop.length]
      return (p.x - a.x) * (b.y - p.y) !== (p.y - a.y) * (b.x - p.x)
    }))
  }
  return loops
}
export const PRESETS = [
  { id: 'rib1', name: '1 上 1 下罗纹', width: 2, height: 2 },
  { id: 'rib2', name: '2 上 2 下罗纹', width: 4, height: 2 },
  { id: 'seed', name: '单桂花', width: 2, height: 2 },
  { id: 'seed2', name: '双桂花', width: 4, height: 4 },
  ...[4, 6].flatMap(n => ['l', 'r'].map(d => ({ id: `cable-${n}-${d}`, name: `${n} 针${d === 'l' ? '左' : '右'}麻花（${n + 2} 行循环）`, width: n + 2, height: n + 2 }))),
]
export function createPreset(id: string, convention: DrawingDocument['convention']): PatternSample {
  const preset = PRESETS.find(p => p.id === id)!
  const marks: StitchMark[] = []
  for (let y = 0; y < preset.height; y++) for (let x = 0; x < preset.width; x++) {
    let stitchId = 'knit'
    if (id.startsWith('cable')) {
      if (x === 0 || x === preset.width - 1) stitchId = 'purl'
      else if (y === preset.height - 2 && x === 1) { marks.push({ id: uid(), x, y, stitchId: id }); x += preset.width - 3; continue }
    } else {
      const purl = id === 'rib1' ? x % 2 === 0 : id === 'rib2' ? x % 4 < 2 : id === 'seed' ? (x + y) % 2 === 0 : (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0
      stitchId = purl ? 'purl' : 'knit'
    }
    if (convention === 'operation' && y % 2 === 1) stitchId = stitchId === 'knit' ? 'purl' : 'knit'
    marks.push({ id: uid(), x, y, stitchId })
  }
  return { id: uid(), name: preset.name, width: preset.width, height: preset.height, marks }
}

export function isDrawingDocument(value: unknown): value is DrawingDocument {
  if (!value || typeof value !== 'object') return false
  const d = value as DrawingDocument
  const int = (n: unknown, min = 0, max = 10000) => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max
  const str = (s: unknown, max = 2000) => typeof s === 'string' && s.length > 0 && s.length <= max
  if (d.version !== 1 || !Array.isArray(d.definitions) || d.definitions.length > 500 || !Array.isArray(d.marks) || !Array.isArray(d.samples) || !Array.isArray(d.placements) || !Array.isArray(d.generatedShapeIds) || !d.generatedShapeIds.every(s => str(s)) || ![null, 'appearance', 'operation'].includes(d.convention)) return false
  if (!d.definitions.every(s => s && str(s.id) && !stitchMap().has(s.id) && str(s.name, 80) && s.custom === true && s.kind === 'custom' && (s.color === null || /^#[0-9a-f]{6}$/i.test(s.color)) && int(s.span, 1, 24) && int(s.input, 0, 24) && int(s.output, 0, 24) && s.input + s.output > 0 && Array.isArray(s.steps) && s.steps.length <= 50 && s.steps.length > 0 && s.steps.every(v => str(v)) && Array.isArray(s.paths) && s.paths.length > 0 && s.paths.length <= 100 && s.paths.every(p => Array.isArray(p) && p.length >= 4 && p.length <= 4000 && p.length % 2 === 0 && p.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100)))) return false
  if (new Set(d.definitions.map(s => s.id)).size !== d.definitions.length) return false
  const defs = stitchMap(d.definitions)
  const validMarks = (marks: unknown, width = 10000, height = 10000) => {
    if (!Array.isArray(marks) || marks.length > 100000 || !marks.every(m => m && str(m.id) && int(m.x) && int(m.y) && m.y < height && str(m.stitchId) && defs.has(m.stitchId) && m.x + defs.get(m.stitchId)!.span <= width && (m.automatic === undefined || typeof m.automatic === 'boolean'))) return false
    const used = new Set<string>()
    return new Set(marks.map(m => m.id)).size === marks.length && marks.every(m => cells(m, defs).every(k => { if (used.has(k)) return false; used.add(k); return true }))
  }
  const validSample = (s: PatternSample) => s && str(s.id) && str(s.name, 80) && int(s.width, 1, 200) && int(s.height, 1, 200) && validMarks(s.marks, s.width, s.height)
  return validMarks(d.marks) && (d.automaticMarks === undefined || validMarks(d.automaticMarks)) && d.samples.length <= 100 && d.samples.every(validSample) && new Set(d.samples.map(s => s.id)).size === d.samples.length && d.placements.length <= 1000 && d.placements.every(p => validSample(p) && int(p.x) && int(p.y)) && new Set(d.placements.map(p => p.id)).size === d.placements.length
}
