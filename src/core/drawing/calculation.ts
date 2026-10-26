import type { DrawingDocument, StitchMark } from './types'
import type { ShapePlan } from '../../stores/editor.types'
import type { Gauge, FabricGrid } from '../gauge/gauge.types'
import { cells, effectiveMarks, key } from './drawing'
import { REVERSE_STITCHES, stitchMap } from './stitches'
export interface DrawingRow { row: number; canvasRow: number; cells: number; input: number; output: number; internalDelta: number; edgeDelta: number; actions: string[]; error: string }
export interface DrawingPiece { id: string; name: string; rows: DrawingRow[]; marks: StitchMark[]; issues: string[] }
export interface DrawingCalculation { pieces: DrawingPiece[]; issues: string[]; marks: StitchMark[] }

/** Chart operations consume/produce needles once. Geometric shaping only supplies the residual. */
export function calculateDrawing(doc: DrawingDocument, plans: ShapePlan[], gauge: Gauge, grid: FabricGrid): DrawingCalculation {
  const defs = stitchMap(doc.definitions), marks = effectiveMarks(doc)
  const issues: string[] = []
  if (!doc.convention) issues.push('请先选择图符读法。')
  if (marks.some(m => m.x < 0 || m.y < 0 || m.x + defs.get(m.stitchId)!.span > grid.columnCount || m.y >= grid.rowCount)) issues.push('有针法超出当前画布，内容已保留，请调整位置或画布。')
  const occupiedPieces = new Map<string, Set<string>>()
  for (const plan of plans.filter(p => p.isFabric)) {
    const region = new Set<string>()
    for (const row of plan.rasterRows) for (const seg of row.segments) for (let x = seg.startStitch; x <= seg.endStitch; x++) {
      const globalX = x + (row.originXCm ?? 0) / gauge.stitchWidthCm
      if (Math.abs(globalX - Math.round(globalX)) > 1e-6) { if (!issues.includes('有衣片针格与绘图网格错位，请调整轮廓对齐后核对。')) issues.push('有衣片针格与绘图网格错位，请调整轮廓对齐后核对。'); continue }
      region.add(key(Math.round(globalX), row.rowIndex))
    }
    occupiedPieces.set(plan.shapeId, region)
  }
  const assigned = new Map<string, StitchMark[]>(), allUsed = new Set<string>()
  for (const mark of marks) {
    const owners = [...occupiedPieces].filter(([, region]) => cells(mark, defs).every(k => region.has(k)))
    if (owners.length !== 1) issues.push(owners.length ? `第 ${mark.y + 1} 行第 ${mark.x + 1} 格针法属于重叠衣片，请分开轮廓。` : `第 ${mark.y + 1} 行第 ${mark.x + 1} 格针法在轮廓外或跨过边缘，请生成／调整轮廓。`)
    else { const id = owners[0][0]; assigned.set(id, [...(assigned.get(id) ?? []), mark]); allUsed.add(mark.id) }
  }
  const pieces: DrawingPiece[] = []
  for (const plan of plans.filter(p => p.isFabric && (occupiedPieces.get(p.shapeId)?.size ?? 0) > 0)) {
    const region = occupiedPieces.get(plan.shapeId)!, explicit = assigned.get(plan.shapeId) ?? []
    const covered = new Set(explicit.flatMap(m => cells(m, defs)))
    const defaults: StitchMark[] = [...region].filter(k => !covered.has(k)).map(k => { const [x, y] = k.split(',').map(Number); return { id: `default-${plan.shapeId}-${k}`, x, y, stitchId: 'knit' } })
    const complete = [...explicit, ...defaults]
    const rows: DrawingRow[] = []; const pieceIssues: string[] = []
    if (plan.calculationMessage) pieceIssues.push(plan.calculationMessage)
    const activeRows = plan.rasterRows.filter(r => r.stitchCount)
    let previousOutput: number | null = null, previousCells = 0
    for (const row of activeRows) {
      const ops = complete.filter(m => m.y === row.rowIndex)
      const input = ops.reduce((n, m) => n + defs.get(m.stitchId)!.input, 0), output = ops.reduce((n, m) => n + defs.get(m.stitchId)!.output, 0)
      const edgeDelta = previousOutput === null ? input : input - previousOutput
      const nominalDelta = row.stitchCount - previousCells
      let error = ''
      if (previousOutput !== null && edgeDelta !== 0 && (nominalDelta === 0 || Math.sign(edgeDelta) !== Math.sign(nominalDelta) || Math.abs(edgeDelta) > Math.abs(nominalDelta))) error = `需要在边缘${edgeDelta > 0 ? '加' : '减'} ${Math.abs(edgeDelta)} 针才能衔接，当前轮廓未提供相应变化。请调整下一行针法或轮廓。`
      const changes = new Map<string, number>()
      for (const m of ops) changes.set(m.stitchId, (changes.get(m.stitchId) ?? 0) + 1)
      const knittingRow = rows.length + 1
      const opposite = REVERSE_STITCHES
      if (doc.convention === 'appearance' && knittingRow % 2 === 0) {
        const undefinedReverse = ops.find(m => !opposite[m.stitchId])
        if (undefinedReverse) error = `${defs.get(undefinedReverse.stitchId)!.name}尚未定义反面动作，请选择实际操作读法并核对本行针法。`
      }
      const reverseRow = doc.convention === 'appearance' && knittingRow % 2 === 0
      const actions = [...changes].map(([id, count]) => `${defs.get(reverseRow ? opposite[id] ?? id : id)!.name} × ${count}${reverseRow && opposite[id] ? '（反面行反读）' : ''}`)
      rows.push({ row: knittingRow, canvasRow: row.rowIndex + 1, cells: row.stitchCount, input, output, internalDelta: output - input, edgeDelta, actions, error })
      if (error) pieceIssues.push(`第 ${knittingRow} 编织行（画布第 ${row.rowIndex + 1} 行）：${error}`)
      previousOutput = output; previousCells = row.stitchCount
    }
    pieces.push({ id: plan.shapeId, name: plan.shapeName ?? '未命名衣片', rows, marks: complete, issues: pieceIssues })
  }
  if (!pieces.length) issues.push('请沿填充边缘生成轮廓，或先绘制闭合路径。')
  return { pieces, issues: [...new Set([...issues, ...pieces.flatMap(p => p.issues.map(i => `${p.name}：${i}`))])], marks: [...pieces.flatMap(p => p.marks), ...marks.filter(m => !allUsed.has(m.id))] }
}
