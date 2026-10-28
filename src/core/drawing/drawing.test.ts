import { describe, expect, it } from 'vitest'
import { calculateGauge } from '../gauge/gauge'
import { rasterize } from '../raster/rasterizer'
import { stitchMap, stitchReading } from './stitches'
import { cells, createPreset, effectiveMarks, filledRegion, isDrawingDocument, occupied, replaceMarks, traceContours } from './drawing'
import { emptyDrawing } from './types'
import type { StitchMark } from './types'
import { calculateDrawing } from './calculation'
import { completeDrawingMarks, drawingBaseMarks } from './chart'
import type { ShapePlan } from '../../stores/editor.types'
const mark = (x: number, y: number, stitchId = 'knit'): StitchMark => ({ id: `${x}:${y}:${stitchId}`, x, y, stitchId })
const defs = stitchMap()
const gauge = calculateGauge({ sampleStitches: 10, sampleRows: 10, sampleWidthCm: 10, sampleHeightCm: 10 })
const piece = (width: number, height: number): ShapePlan => ({ shapeId: 'piece', shapeName: '衣片', shapeType: 'rectangle', direction: 'bottom-up', rasterRows: rasterize({ id: 'piece', type: 'rectangle', x: 0, y: 0, widthCm: width, heightCm: height }, gauge, { widthCm: 10, heightCm: 10 }, { mode: 'center', symmetryOptimization: false }), instructions: [], totalStitches: 0, hasSeparatedRegions: false, isFabric: true, dimensions: [], roundingPending: false, calculationMessage: '', canExport: true })
describe('手织绘图源数据与边缘', () => {
  it('默认按正面外观显示，组合平针区的反面行仍显示下针图符', () => {
    expect(emptyDrawing().convention).toBe('appearance')
    const sample = createPreset('cable-4-l', emptyDrawing().convention)
    expect(sample.marks.filter(m => m.y === 1 && m.x > 0 && m.x < 5).every(m => m.stitchId === 'knit')).toBe(true)
    expect(stitchReading(defs.get('knit')!, 'appearance')).toBe('正面织下针；反面织上针')
    expect(stitchReading(defs.get('purl')!, 'appearance')).toBe('正面织上针；反面织下针')
  })
  it('透明下针仍有占位，围合内部补针而凹口不补', () => {
    const ring = [mark(0, 0), mark(1, 0), mark(2, 0), mark(0, 1), mark(2, 1), mark(0, 2), mark(1, 2), mark(2, 2)]
    const result = filledRegion(ring, defs, 10, 10)
    expect(result.automatic.map(m => [m.x, m.y, m.stitchId])).toEqual([[1, 1, 'knit']])
    expect(result.filled.size).toBe(9)
    expect(filledRegion(ring.filter(m => m.x !== 1 || m.y !== 0), defs, 10, 10).automatic).toHaveLength(0)
    expect(defs.get('knit')?.color).toBeNull()
  })
  it('系统补针不锁住后来打开的边缘', () => {
    const doc = emptyDrawing(); doc.marks = [mark(0, 0), mark(1, 0), mark(2, 0), mark(0, 1), mark(2, 1), mark(0, 2), mark(1, 2), mark(2, 2)]
    doc.marks.push(...filledRegion(doc.marks, defs, 10, 10).automatic)
    doc.marks = doc.marks.filter(m => m.x !== 1 || m.y !== 0)
    expect(filledRegion(effectiveMarks(doc, false), defs, 10, 10).automatic).toHaveLength(0)
  })
  it('精确台阶、分离和对角接触不合并，路径再次针格化不漂移', () => {
    for (const marks of [[mark(0, 0), mark(1, 1)], [mark(0, 0), mark(1, 0), mark(0, 1)]]) {
      const region = occupied(marks, defs), loops = traceContours(region)
      const regenerated = loops.flatMap((points, i) => rasterize({ id: String(i), type: 'path', closed: true, nodes: points.map(anchor => ({ anchor })) }, gauge, { widthCm: 10, heightCm: 10 }, { mode: 'center', symmetryOptimization: false }).flatMap(row => row.segments.flatMap(s => Array.from({ length: s.endStitch - s.startStitch + 1 }, (_, i) => `${s.startStitch + i},${row.rowIndex}`))))
      expect(new Set(regenerated)).toEqual(region)
      expect(loops).toHaveLength(marks.length === 2 ? 2 : 1)
    }
  })
  it('跨针符号作为一次操作覆盖，移动删除副本恢复下层', () => {
    expect(cells(mark(0, 0, 'cable-4-l'), defs)).toHaveLength(4)
    expect(replaceMarks([mark(0, 0, 'cable-4-l')], [mark(2, 0, 'purl')], defs)).toEqual([mark(2, 0, 'purl')])
    const doc = emptyDrawing(); doc.marks = [mark(0, 0)]
    doc.placements.push({ id: 'p', name: '花样', width: 1, height: 1, x: 0, y: 0, marks: [mark(0, 0, 'purl')] })
    expect(effectiveMarks(doc)[0].stitchId).toBe('purl'); doc.placements[0].x = 1
    expect(effectiveMarks(doc).map(m => m.stitchId)).toEqual(['knit', 'purl'])
    doc.placements = []; expect(effectiveMarks(doc)).toEqual(doc.marks)
  })
  it('新放置的花样覆盖自动补针，移动后仍可见下层自动下针', () => {
    const doc = emptyDrawing(); doc.automaticMarks = [{ ...mark(0, 0), automatic: true }]
    doc.placements = [{ id: 'p', name: '花样', width: 1, height: 1, x: 0, y: 0, marks: [mark(0, 0, 'purl')] }]
    expect(effectiveMarks(doc).map(m => m.stitchId)).toEqual(['purl'])
    doc.placements[0].x = 1; expect(effectiveMarks(doc).map(m => m.stitchId)).toEqual(['purl', 'knit'])
  })
  it('组合保存真实操作，麻花不重复计针', () => {
    const sample = createPreset('cable-4-l', 'appearance')
    expect(sample.marks.filter(m => m.stitchId === 'cable-4-l')).toHaveLength(1)
    expect(occupied(sample.marks, defs).size).toBe(sample.width * sample.height)
    expect(createPreset('rib1', 'operation').marks.filter(m => m.y === 1).map(m => m.stitchId)).toEqual(['knit', 'purl'])
  })
  it('校验拒绝未知定义、重复消耗和损坏自定义，保留正常副本', () => {
    const doc = emptyDrawing(); doc.marks = [mark(0, 0)]
    expect(isDrawingDocument(doc)).toBe(true)
    doc.marks.push(mark(0, 0, 'purl')); expect(isDrawingDocument(doc)).toBe(false)
    doc.marks = [mark(0, 0, 'unknown')]; expect(isDrawingDocument(doc)).toBe(false)
    doc.marks = []; doc.definitions = [{ id: 'mine', name: '我的针法', span: 2, input: 2, output: 1, paths: [[10, 10, 90, 90]], color: '#ABB8A5', steps: ['两针织成一针'], custom: true, kind: 'custom' }]
    doc.marks = [mark(0, 0, 'mine')]; expect(isDrawingDocument(doc)).toBe(true)
    doc.definitions[0].input = NaN; expect(isDrawingDocument(doc)).toBe(false)
  })
})
describe('针法计算', () => {
  it('默认显示不填无效、错位或重叠针位，多针覆盖及擦除恢复完整底稿', () => {
    const plan = piece(3, 2)
    const base = drawingBaseMarks([plan], gauge)
    expect(base).toHaveLength(6)
    const multi = [mark(0, 0, 'k2tog')]
    const displayed = completeDrawingMarks(base, multi, defs)
    expect(displayed.filter(m => m.y === 0).map(m => m.stitchId).sort()).toEqual(['k2tog', 'knit'])
    expect(completeDrawingMarks(base, [], defs)).toEqual(base)
    expect(base).toHaveLength(6)
    expect(drawingBaseMarks([{ ...plan, canExport: false }], gauge)).toEqual([])
    expect(drawingBaseMarks([{ ...plan, rasterRows: plan.rasterRows.map(r => ({ ...r, originXCm: .5 })) }], gauge)).toEqual([])
    expect(drawingBaseMarks([plan, { ...plan, shapeId: 'other' }], gauge)).toEqual([])
    expect(completeDrawingMarks([], [mark(5, 5, 'purl')], defs)).toEqual([mark(5, 5, 'purl')])
  })
  it('正面外观图符保持不变，逐行完整列出上下针的实际动作', () => {
    const doc = emptyDrawing(); doc.marks = [mark(0, 0, 'purl'), mark(0, 1, 'purl')]
    const before = JSON.stringify(doc)
    const result = calculateDrawing(doc, [piece(2, 2)], gauge, { columnCount: 10, rowCount: 10 })
    expect(result.pieces[0].rows[0].actions).toEqual(['上针 × 1', '下针 × 1'])
    expect(result.pieces[0].rows[1].actions).toEqual(['下针 × 1（反面行反读）', '上针 × 1（反面行反读）'])
    expect(JSON.stringify(doc)).toBe(before)
    expect(result.pieces[0].rows.map(r => [r.input, r.output])).toEqual([[2, 2], [2, 2]])
  })
  it('编织行从衣片底边开始编号，正面外观读法不冒推复杂反面动作', () => {
    const doc = emptyDrawing(); doc.convention = 'appearance'; doc.marks = [mark(0, 1, 'knit')]
    const result = calculateDrawing(doc, [piece(1, 2)], gauge, { columnCount: 10, rowCount: 10 })
    expect(result.pieces[0].rows[1]).toMatchObject({ row: 2, canvasRow: 2, actions: ['上针 × 1（反面行反读）'] })
    doc.marks = [mark(0, 1, 'slip-purl-front')]
    expect(calculateDrawing(doc, [piece(1, 2)], gauge, { columnCount: 10, rowCount: 10 }).issues.join()).toContain('尚未定义反面动作')
  })
  it('占格、消耗、产出分开；不将内部减针重复计入边缘', () => {
    const doc = emptyDrawing(); doc.convention = 'operation'; doc.marks = [mark(0, 0, 'k2tog'), mark(2, 0)]
    const plan = piece(3, 2); plan.rasterRows[1].segments = [{ startStitch: 0, endStitch: 1 }]; plan.rasterRows[1].stitchCount = 2
    const result = calculateDrawing(doc, [plan], gauge, { columnCount: 10, rowCount: 10 })
    expect(result.pieces[0].rows[0]).toMatchObject({ cells: 3, input: 3, output: 2, internalDelta: -1 })
    expect(result.pieces[0].rows[1]).toMatchObject({ input: 2, edgeDelta: 0, error: '' })
    expect(result.issues).toEqual([])
  })
  it('轮廓不变但前行减针导致下一行缺针时报告具体行', () => {
    const doc = emptyDrawing(); doc.convention = 'operation'; doc.marks = [mark(0, 0, 'k2tog')]
    const result = calculateDrawing(doc, [piece(3, 2)], gauge, { columnCount: 10, rowCount: 10 })
    expect(result.pieces[0].rows[1].error).toContain('当前轮廓')
    expect(result.issues.join()).toContain('第 2 编织行')
  })
  it('轮廓外、重叠衣片、错位针格不生成假有效结果', () => {
    const doc = emptyDrawing(); doc.convention = 'operation'; doc.marks = [mark(4, 0)]
    expect(calculateDrawing(doc, [piece(3, 2)], gauge, { columnCount: 10, rowCount: 10 }).issues.join()).toContain('轮廓外')
    doc.marks = [mark(0, 0)]
    expect(calculateDrawing(doc, [piece(3, 2), { ...piece(3, 2), shapeId: 'other' }], gauge, { columnCount: 10, rowCount: 10 }).issues.join()).toContain('重叠衣片')
  })
})
