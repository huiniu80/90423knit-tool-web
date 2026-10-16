import type { KnittingInstruction, GarmentEdgeRole } from './planner.types'
import type { StitchSegment } from '../raster/raster.types'

export type OperationKind = 'cast-on' | 'increase' | 'decrease' | 'bind-off'
export type OperationEdge = GarmentEdgeRole | 'center'
export type OperationOverrides = Record<string, 'decrease' | 'bind-off'>
export interface RowOperation extends StitchSegment {
  key: string
  edge: OperationEdge
  kind: OperationKind
  defaultKind: OperationKind
  count: number
  canOverride: boolean
}
export const operationEdgeLabels: Record<OperationEdge, string> = {
  'left-outer': '左侧', 'right-outer': '右侧',
  'left-neck': '左段右侧', 'right-neck': '右段左侧', center: '中间',
}
export const operationKindLabels: Record<OperationKind, string> = {
  'cast-on': '起针', increase: '加针', decrease: '减针', 'bind-off': '平收',
}

function difference(source: readonly StitchSegment[], occupied: readonly StitchSegment[]): StitchSegment[] {
  return source.flatMap(segment => {
    let parts = [{ ...segment }]
    for (const other of occupied) parts = parts.flatMap(part => {
      if (other.endStitch < part.startStitch || other.startStitch > part.endStitch) return [part]
      return [
        ...(other.startStitch > part.startStitch ? [{ startStitch: part.startStitch, endStitch: other.startStitch - 1 }] : []),
        ...(other.endStitch < part.endStitch ? [{ startStitch: other.endStitch + 1, endStitch: part.endStitch }] : []),
      ]
    })
    return parts
  })
}
const overlaps = (a: StitchSegment, b: StitchSegment): boolean => a.startStitch <= b.endStitch && b.startStitch <= a.endStitch
const contains = (a: StitchSegment, b: StitchSegment): boolean => a.startStitch <= b.startStitch && a.endStitch >= b.endStitch

export function validateRowOperations(before: readonly StitchSegment[], after: readonly StitchSegment[], operations: readonly RowOperation[]): string | null {
  for (const segments of [before, after]) {
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!
      if (!Number.isInteger(segment.startStitch) || !Number.isInteger(segment.endStitch) || segment.startStitch > segment.endStitch) return '针段范围无效'
      if (i && segments[i - 1]!.endStitch >= segment.startStitch) return '针段重复占针或作用区域重叠'
    }
  }
  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i]!
    const removal = operation.kind === 'decrease' || operation.kind === 'bind-off'
    const owner = (removal ? before : after).find(segment => contains(segment, operation))
    if (!owner || operation.count <= 0 || operation.count !== operation.endStitch - operation.startStitch + 1) return '操作数量超过所属针段或针位不一致'
    if ((removal ? after : before).some(segment => overlaps(segment, operation))) return '操作作用区域与保留针位重叠'
    if (operations.slice(0, i).some(other => overlaps(other, operation))) return '同一针重复占用，操作作用区域重叠'
  }
  const sum = (segments: readonly StitchSegment[]): number => segments.reduce((total, s) => total + s.endStitch - s.startStitch + 1, 0)
  const expectedRemoved = sum(difference(before, after))
  const expectedAdded = sum(difference(after, before))
  const removed = operations.filter(o => o.kind === 'decrease' || o.kind === 'bind-off').reduce((total, o) => total + o.count, 0)
  const added = operations.filter(o => o.kind === 'increase' || o.kind === 'cast-on').reduce((total, o) => total + o.count, 0)
  return removed !== expectedRemoved || added !== expectedAdded ? '操作数量与当前针格变化不一致' : null
}

export function buildRowOperations(instructions: KnittingInstruction[], overrides: OperationOverrides = {}): KnittingInstruction[] {
  return instructions.map((instruction, index) => {
    const before = instructions[index - 1]?.segments ?? []
    const after = instruction.segments
    const operations: RowOperation[] = []
    const addOperation = (span: StitchSegment, removal: boolean): void => {
      const owner = (removal ? before : after).find(segment => contains(segment, span))!
      const ended = removal && !after.some(segment => overlaps(segment, owner))
      let edge: OperationEdge
      const first = after[0]!
      const last = after.at(-1)!
      if (before.length === 1 && after.length === 2 && span.startStitch > first.endStitch && span.endStitch < last.startStitch) edge = 'center'
      else if (before.length === 2 && !removal && span.startStitch > before[0]!.endStitch && span.endStitch < before[1]!.startStitch) edge = 'center'
      else if (span.endStitch < first.startStitch || (!removal && span.startStitch === first.startStitch)) edge = 'left-outer'
      else if (span.startStitch > last.endStitch || (!removal && span.endStitch === last.endStitch)) edge = 'right-outer'
      else if ((removal ? before : after).length === 2) edge = owner === (removal ? before : after)[0] ? 'left-neck' : 'right-neck'
      else edge = span.startStitch === owner.startStitch ? 'left-outer' : 'right-outer'
      const count = span.endStitch - span.startStitch + 1
      const defaultKind: OperationKind = !removal ? (index === 0 ? 'cast-on' : 'increase') : ended || edge === 'center' || count >= 4 ? 'bind-off' : 'decrease'
      const canOverride = removal && !ended && edge !== 'center'
      const key = `${instruction.rowNumber}:${edge}`
      operations.push({ ...span, key, edge, count, defaultKind, canOverride,
        kind: canOverride ? overrides[key] ?? defaultKind : defaultKind })
    }
    difference(before, after).forEach(span => addOperation(span, true))
    difference(after, before).forEach(span => addOperation(span, false))
    operations.sort((a, b) => a.startStitch - b.startStitch)
    const conflict = validateRowOperations(before, after, operations)
    const finishOperations: RowOperation[] = index === instructions.length - 1
      ? after.map((span, segmentIndex) => ({ ...span, key: `finish:${segmentIndex}`,
        edge: segmentIndex === 0 ? 'left-outer' : 'right-outer', count: span.endStitch - span.startStitch + 1,
        kind: 'bind-off', defaultKind: 'bind-off', canOverride: false })) : []
    const transition = instruction.transition === 'join' && !operations.some(operation => operation.edge === 'center' && operation.kind === 'increase')
      ? 'continue' : instruction.transition
    const centerChange = operations.filter(operation => operation.edge === 'center')
      .reduce((total, operation) => total + (operation.kind === 'increase' ? operation.count : -operation.count), 0)
    return { ...instruction, transition, centerChange, operations, finishOperations, conflict, supported: instruction.supported && !conflict }
  })
}

export function rowOperationToText(operation: RowOperation): string {
  return `${operationEdgeLabels[operation.edge]}${operationKindLabels[operation.kind]} ${operation.count} 针（针号 ${operation.startStitch + 1}–${operation.endStitch + 1}）`
}
