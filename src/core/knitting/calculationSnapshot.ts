import { calculateGauge } from '../gauge/gauge'
import { assessGrid } from '../gauge/gridConstraints'
import { getShapeBounds } from '../geometry/geometry'
import { shapeCalculationIssue, shapeIssueMessage } from '../geometry/shapeValidation'
import { createOverallDimensionResults, selectedShapeCounts } from '../dimensions/dimensionConversion'
import { rasterize, shapeForRaster } from '../raster/rasterizer'
import { generateInstructions } from './planner'
import type { KnittingInstruction } from './planner.types'
import type { RasterRow } from '../raster/raster.types'
import type { Bounds } from '../geometry/shape.types'
import type { PersistedEditorDocument } from '../../stores/editor.persistence'
import { validateRowOperations } from './rowOperations'
import type { RowOperation } from './rowOperations'

export const CALCULATION_RULE_VERSION = '2026.10.16-1'
export interface SnapshotPiece {
  shapeId: string
  name: string
  appearance: Bounds
  rounded: Bounds
  stitches: number | null
  rows: number | null
  rasterRows: RasterRow[]
  instructions: KnittingInstruction[]
  status: string
}
export interface CalculationSnapshot {
  version: 1
  ruleVersion: string
  calculatedAt: string
  sourceFingerprint: string
  gauge: { stitchesPerCm: number; rowsPerCm: number; stitchWidthCm: number; rowHeightCm: number }
  seamCompensation: 'not-implemented'
  warnings: string[]
  pieces: SnapshotPiece[]
}
export function sourceFingerprint(document: PersistedEditorDocument): string {
  const source = JSON.stringify([document.gaugeInput, document.fabric, document.shapes, document.shapeRoundingPolicies, document.operationOverrides ?? {}])
  let hash = 2166136261
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619)
  return (hash >>> 0).toString(16)
}
export function createCalculationSnapshot(document: PersistedEditorDocument, calculatedAt = new Date().toISOString()): CalculationSnapshot {
  const gauge = calculateGauge(document.gaugeInput)
  const assessment = assessGrid(document.gaugeInput, document.fabric)
  const pieces = document.shapes.map(shape => {
    const policy = document.shapeRoundingPolicies[shape.id] ?? { stitches: null, rows: null }
    const counts = selectedShapeCounts(shape, gauge, policy)
    const roundedShape = shapeForRaster(shape, gauge, { ...counts, direction: 'bottom-up' })
    const issue = shapeCalculationIssue(shape, document.fabric) ?? shapeCalculationIssue(roundedShape, document.fabric)
    const rasterRows = issue || assessment.status === 'blocked' ? [] : rasterize(shape, gauge, document.fabric, document.rasterOptions, { ...counts, direction: 'bottom-up' }).filter(row => row.stitchCount)
    // Preserve gaps for validation; active row centers stay numbered in canvas coordinates.
    const rowMap = new Map(rasterRows.map(row => [row.rowIndex, row]))
    const allRows = rasterRows.length ? Array.from({ length: rasterRows.at(-1)!.rowIndex - rasterRows[0]!.rowIndex + 1 }, (_, index) => {
      const rowIndex = rasterRows[0]!.rowIndex + index
      return rowMap.get(rowIndex) ?? { rowIndex, yCm: (rowIndex + 0.5) * gauge.rowHeightCm, segments: [], stitchCount: 0 }
    }) : []
    const instructions = generateInstructions(allRows, 'bottom-up', document.operationOverrides?.[shape.id])
    const conflict = instructions.find(row => row.conflict)
    const status = assessment.status === 'blocked' ? '网格超限，已暂停计算' : issue ? shapeIssueMessage[issue]
      : conflict ? `第 ${conflict.rowNumber} 行：${conflict.conflict}`
      : !rasterRows.length ? '未落入针格' : !instructions.length ? '不支持的复杂断开结构' : ''
    const overall = createOverallDimensionResults(shape, gauge, policy)
    return { shapeId: shape.id, name: shape.name || '未命名轮廓', appearance: getShapeBounds(shape), rounded: getShapeBounds(roundedShape),
      stitches: overall.find(item => item.axis === 'stitches')?.selected?.count ?? null,
      rows: overall.find(item => item.axis === 'rows')?.selected?.count ?? null,
      rasterRows, instructions: status ? [] : instructions, status }
  })
  return { version: 1, ruleVersion: CALCULATION_RULE_VERSION, calculatedAt, sourceFingerprint: sourceFingerprint(document), gauge,
    seamCompensation: 'not-implemented', warnings: ['缝合补偿尚未加入，织片尺寸仅为取整后的计算尺寸。', ...assessment.issues.map(issue => issue.message)], pieces }
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function bounds(value: unknown): boolean { return record(value) && ['x','y','width','height'].every(key => finite(value[key])) && (value.width as number) >= 0 && (value.height as number) >= 0 }
const shortText = (value: unknown): value is string => typeof value === 'string' && value.length <= 2000
const integer = (value: unknown, max = 6_000_000): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max
export function isCalculationSnapshot(value: unknown): value is CalculationSnapshot {
  if (!record(value)) return false
  const savedGauge = value.gauge
  if (value.version !== 1 || !shortText(value.ruleVersion) || !value.ruleVersion
    || typeof value.calculatedAt !== 'string' || Number.isNaN(Date.parse(value.calculatedAt))
    || !shortText(value.sourceFingerprint) || value.seamCompensation !== 'not-implemented'
    || !record(savedGauge) || !['stitchesPerCm','rowsPerCm','stitchWidthCm','rowHeightCm'].every(key => finite(savedGauge[key]) && (savedGauge[key] as number) > 0)
    || !Array.isArray(value.warnings) || value.warnings.length > 1000 || !value.warnings.every(shortText)
    || !Array.isArray(value.pieces) || value.pieces.length > 1000) return false
  let rows = 0
  const ids = new Set<string>()
  return value.pieces.every(piece => {
    if (!record(piece) || !shortText(piece.shapeId) || !piece.shapeId || ids.has(piece.shapeId) || !shortText(piece.name) || !shortText(piece.status)
      || !bounds(piece.appearance) || !bounds(piece.rounded) || !['stitches','rows'].every(key => piece[key] === null || integer(piece[key]))
      || !Array.isArray(piece.rasterRows) || !Array.isArray(piece.instructions)) return false
    ids.add(piece.shapeId)
    rows += piece.rasterRows.length + piece.instructions.length
    if (rows > 150_000 || piece.rasterRows.length > 3000 || piece.instructions.length > 3000) return false
    const segment = (s: unknown): boolean => record(s) && integer(s.startStitch, 2000) && integer(s.endStitch, 2000) && (s.startStitch as number) <= (s.endStitch as number)
    const segments = (spans: unknown, count: unknown, max = 2000): boolean => Array.isArray(spans) && spans.length <= max && spans.every(segment)
      && spans.every((s, index) => !index || spans[index - 1].endStitch < s.startStitch)
      && integer(count) && spans.reduce((sum, s) => sum + s.endStitch - s.startStitch + 1, 0) === count
    if (!piece.rasterRows.every((row, index, all) => record(row) && integer(row.rowIndex, 3000) && finite(row.yCm)
      && (!index || all[index - 1].rowIndex < row.rowIndex)
      && (row.originXCm === undefined || finite(row.originXCm)) && segments(row.segments, row.stitchCount))) return false
    if (piece.status) return piece.instructions.length === 0
    if (!piece.instructions.length || piece.instructions.length !== piece.rasterRows.length) return false
    const savedRows = piece.rasterRows
    const operations = (items: unknown): items is RowOperation[] => Array.isArray(items) && items.length <= 10 && items.every(operation => record(operation)
      && segment(operation) && integer(operation.count) && operation.count === (operation.endStitch as number) - (operation.startStitch as number) + 1
      && shortText(operation.key) && typeof operation.canOverride === 'boolean'
      && ['left-outer','left-neck','right-neck','right-outer','center'].includes(operation.edge as string)
      && ['cast-on','increase','decrease','bind-off'].includes(operation.kind as string)
      && ['cast-on','increase','decrease','bind-off'].includes(operation.defaultKind as string))
    return piece.instructions.every((row, index, all) => record(row) && row.rowNumber === index + 1
      && row.sourceRowIndex === savedRows[index].rowIndex && (!index || row.sourceRowIndex === all[index - 1].sourceRowIndex + 1)
      && segments(row.segments, row.stitchCount, 2) && JSON.stringify(row.segments) === JSON.stringify(savedRows[index].segments)
      && ['leftChange','rightChange','centerChange'].every(key => finite(row[key]))
      && row.supported === true && typeof row.isCastOn === 'boolean' && (row.conflict === null || row.conflict === undefined)
      && ['cast-on','cast-on-separated','continue','split','join'].includes(row.transition as string)
      && Array.isArray(row.panelChanges) && row.panelChanges.length <= 2 && row.panelChanges.every(p => record(p)
        && ['body','left-shoulder','right-shoulder'].includes(p.panel as string) && finite(p.leftChange) && finite(p.rightChange))
      && operations(row.operations) && operations(row.finishOperations)
      && !validateRowOperations(index ? all[index - 1].segments : [], row.segments as RasterRow['segments'], row.operations)
      && (index === all.length - 1
        ? row.finishOperations.every(o => o.kind === 'bind-off') && !validateRowOperations(row.segments as RasterRow['segments'], [], row.finishOperations)
        : row.finishOperations.length === 0))
  })
}
