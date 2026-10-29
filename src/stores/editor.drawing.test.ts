import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorStore } from './editor'
import { parseProjectFile, serializeProjectFile } from './projectTransfer'
import { EDITOR_DOCUMENT_VERSION, migrateEditorDocument } from './editor.persistence'
import type { StitchMark } from '../core/drawing/types'
import * as drawingFunctions from '../core/drawing/drawing'
import { calculateDrawing } from '../core/drawing/calculation'
const mark = (x: number, y: number, stitchId = 'knit'): StitchMark => ({ id: `${x}:${y}:${stitchId}`, x, y, stitchId })
beforeEach(() => { setActivePinia(createPinia()); vi.useFakeTimers(); vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, addEventListener: () => {}, removeEventListener: () => {} }) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('绘图与方案联动', () => {
  it('圆滑与原边缘查看不改针格计算或存档，预览确认与撤销仍是原有边界', () => {
    const store = useEditorStore()
    store.paintDrawing([mark(3, 3), mark(4, 3), mark(3, 4), mark(4, 4)])
    const beforePreview = JSON.stringify(store.readProjectSource()!.document)
    store.requestDrawingContours()
    expect(store.drawingPreviewDisplays[0].path.nodes.some(n => n.inControl)).toBe(true)
    expect(JSON.stringify(store.readProjectSource()!.document)).toBe(beforePreview)
    store.generateDrawingContours()
    const saved = JSON.stringify(store.readProjectSource()!.document)
    const rows = JSON.stringify(store.shapePlans.map(p => p.rasterRows))
    const calculation = JSON.stringify(calculateDrawing(store.drawing, store.shapePlans, store.gauge, store.fabricGrid))
    expect(store.drawingContourDisplays[0].fallback).toBeNull()
    expect(store.shapes[0].type === 'path' && store.shapes[0].nodes.every(n => !n.inControl && !n.outControl)).toBe(true)
    store.showDrawingEdges = true
    expect(JSON.stringify(store.readProjectSource()!.document)).toBe(saved)
    expect(JSON.stringify(store.shapePlans.map(p => p.rasterRows))).toBe(rows)
    expect(JSON.stringify(calculateDrawing(store.drawing, store.shapePlans, store.gauge, store.fabricGrid))).toBe(calculation)
    store.undo(); expect(store.shapes).toHaveLength(0); expect(store.drawingContourDisplays).toHaveLength(0)
    store.redo(); expect(store.drawingContourDisplays).toHaveLength(1)
    store.createProject(); expect(store.showDrawingEdges).toBe(false)
    store.$dispose()
  })
  it('连续填针一笔撤销，花样放置预览取消不改存档', () => {
    const store = useEditorStore(); store.paintDrawing([mark(1, 1), mark(2, 1)])
    expect(store.drawing.marks).toHaveLength(2); store.undo(); expect(store.drawing.marks).toHaveLength(0); store.redo()
    const sample = { id: 'sample', name: '花样', width: 2, height: 1, marks: [mark(0, 0, 'purl')] }
    store.saveSample(sample); store.startPlacement(sample); store.placementPreview!.x = 1; store.placementPreview!.y = 1
    expect(store.readProjectSource()!.document.drawing!.placements).toHaveLength(0)
    store.cancelDrawingPreview(); expect(store.drawing.marks).toHaveLength(2)
    store.startPlacement(sample); store.confirmPlacement(); expect(store.drawing.placements).toHaveLength(1); store.undo(); expect(store.drawing.placements).toHaveLength(0)
    store.$dispose()
  })
  it('生成精确轮廓与自动补针共同撤销，保留手绘路径', () => {
    const store = useEditorStore(); store.addShape({ id: 'manual', type: 'path', closed: false, nodes: [{ anchor: { x: 10, y: 10 } }, { anchor: { x: 20, y: 20 } }] })
    store.paintDrawing([mark(0, 0), mark(1, 0), mark(2, 0), mark(0, 1), mark(2, 1), mark(0, 2), mark(1, 2), mark(2, 2)])
    store.requestDrawingContours(); store.generateDrawingContours(); expect(store.shapes).toHaveLength(2); expect(store.drawing.automaticMarks).toHaveLength(1)
    expect(store.shapePlans.find(p => p.shapeId === store.drawing.generatedShapeIds[0])!.rasterRows.reduce((n, r) => n + r.stitchCount, 0)).toBe(9)
    store.undo(); expect(store.shapes).toHaveLength(1); expect(store.drawing.automaticMarks ?? []).toHaveLength(0)
    store.redo(); store.eraseDrawing([{ x: 1, y: 0 }]); store.requestDrawingContours(); store.generateDrawingContours(); expect(store.drawing.automaticMarks).toHaveLength(0)
    expect(store.shapes).toHaveLength(2); expect(store.shapes[0].id).toBe('manual'); store.$dispose()
  })
  it('自定义与可编辑副本文件往返，旧文件迁移不伪造针法', () => {
    const store = useEditorStore(); store.saveCustomStitch({ id: 'custom', name: '我的减针', input: 2, output: 1, span: 2, color: '#ABB8A5', paths: [[10, 10, 90, 90]], steps: ['两针变一针'], kind: 'custom', custom: true })
    store.paintDrawing([mark(1, 1, 'custom')]); const file = store.createProjectExport()!
    const parsed = parseProjectFile(serializeProjectFile(file)); expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.file.project.document.drawing).toEqual(store.drawing)
    const old = { ...store.readProjectSource()!.document, version: 3, drawing: undefined, viewMode: 'grid' }
    const upgraded = migrateEditorDocument(old)!; expect(upgraded.version).toBe(EDITOR_DOCUMENT_VERSION); expect(upgraded.drawing).toBeUndefined(); store.$dispose()
  })
  it('上游变更保留针格坐标，删除生成轮廓后仍能导出源方案', () => {
    const store = useEditorStore(); store.paintDrawing([mark(1, 1)]); store.requestDrawingContours(); store.generateDrawingContours(); const before = JSON.stringify(store.drawing.marks)
    store.setGaugeInputValue('sampleStitches', 20); expect(JSON.stringify(store.drawing.marks)).toBe(before)
    store.deleteSelected(); const parsed = parseProjectFile(serializeProjectFile(store.createProjectExport()!)); expect(parsed.ok).toBe(true); store.$dispose()
  })
  it('新与空白旧方案采用正面外观，有设计的旧操作图解保持原读法', () => {
    const store = useEditorStore()
    expect(store.drawing.convention).toBe('appearance')
    const document = store.readProjectSource()!.document
    const oldDrawing = { ...store.drawing, convention: 'operation' as const }
    expect(migrateEditorDocument({ ...document, drawing: oldDrawing })!.drawing!.convention).toBe('appearance')
    const withMarks = { ...oldDrawing, marks: [mark(0, 0)] }
    expect(migrateEditorDocument({ ...document, drawing: withMarks })!.drawing).toEqual(withMarks)
    store.$dispose()
  })
  it('轮廓默认下针可替换擦除和复制，不写成手绘填充或锁定生成边缘', () => {
    const store = useEditorStore()
    store.addShape({ id: 'piece', type: 'rectangle', x: 2, y: 3, widthCm: 3, heightCm: 1.2 })
    expect(store.drawingDisplayMarks).toHaveLength(6)
    expect(store.drawing.marks).toEqual([])
    const normalize = (marks: StitchMark[]) => marks.map(m => `${m.x},${m.y}:${m.stitchId}`).sort()
    expect(normalize(store.drawingDisplayMarks)).toEqual(normalize(calculateDrawing(store.drawing, store.shapePlans, store.gauge, store.fabricGrid).marks))
    const saved = JSON.stringify(store.readProjectSource()!.document)
    const sample = store.captureDrawingSample(2, 5, 4, 2)!
    expect(sample.marks).toHaveLength(6)
    expect(sample.marks.some(m => m.x === 3)).toBe(false)
    expect(JSON.stringify(store.readProjectSource()!.document)).toBe(saved)
    store.paintDrawing([mark(2, 5, 'purl')])
    expect(store.drawingDisplayMarks.find(m => m.x === 2 && m.y === 5)?.stitchId).toBe('purl')
    store.eraseDrawing([{ x: 2, y: 5 }])
    expect(store.drawingDisplayMarks.find(m => m.x === 2 && m.y === 5)?.stitchId).toBe('knit')
    store.undo()
    expect(store.drawingDisplayMarks.find(m => m.x === 2 && m.y === 5)?.stitchId).toBe('purl')
    store.requestDrawingContours()
    expect(store.contourCandidate!.filled.size).toBe(1)
    expect(store.contourCandidate!.loops[0]).toHaveLength(4)
    store.$dispose()
  })
  it('轮廓扩缩仅更新默认下针，保留已经画到轮廓外的针法', () => {
    const store = useEditorStore()
    store.addShape({ id: 'piece', type: 'rectangle', x: 2, y: 3, widthCm: 3, heightCm: 1.2 })
    store.paintDrawing([mark(4, 5, 'purl')])
    store.replaceShape({ ...store.shapes[0], type: 'rectangle', x: 2, y: 3, widthCm: 2, heightCm: 1.2 })
    expect(store.drawingBase).toHaveLength(4)
    expect(store.drawing.marks).toHaveLength(1)
    expect(store.drawingDisplayMarks.find(m => m.x === 4 && m.y === 5)?.stitchId).toBe('purl')
    store.eraseDrawing([{ x: 4, y: 5 }])
    expect(store.drawingDisplayMarks.some(m => m.x === 4)).toBe(false)
    store.replaceShape({ ...store.shapes[0], type: 'rectangle', x: 2, y: 3, widthCm: 4, heightCm: 1.2 })
    expect(store.drawingBase).toHaveLength(8)
    expect(store.drawing.marks).toEqual([])
    store.$dispose()
  })
  it('只有主动请求才计算填充边缘，过时候选不能确认，取消不写内容历史', () => {
    const trace = vi.spyOn(drawingFunctions, 'traceContours')
    const store = useEditorStore()
    store.paintDrawing([mark(1, 1)])
    expect(trace).not.toHaveBeenCalled()
    store.generateDrawingContours()
    expect(trace).not.toHaveBeenCalled()
    expect(store.shapes).toEqual([])
    store.requestDrawingContours()
    expect(trace).toHaveBeenCalledTimes(1)
    const candidate = store.contourCandidate
    expect(store.contourCandidate).toBe(candidate)
    expect(trace).toHaveBeenCalledTimes(1)
    store.paintDrawing([mark(2, 1)])
    expect(store.contourCandidate).toBeNull()
    expect(store.contourPreview).toBe(false)
    store.generateDrawingContours()
    expect(store.shapes).toEqual([])
    expect(trace).toHaveBeenCalledTimes(1)
    for (const mutate of [
      () => store.setGaugeInputValue('sampleWidthCm', 12),
      () => store.setFabricValue('widthCm', 65),
      () => { store.saveSample({ id: 's', name: '小样', width: 1, height: 1, marks: [mark(0, 0)] }); store.startPlacement(store.drawing.samples[0]); store.confirmPlacement() },
    ]) {
      store.requestDrawingContours(); mutate()
      expect(store.contourCandidate).toBeNull()
      expect(store.contourPreview).toBe(false)
    }
    const source = JSON.stringify(store.readProjectSource()!.document)
    store.requestDrawingContours(); store.clearDrawingContours()
    expect(JSON.stringify(store.readProjectSource()!.document)).toBe(source)
    store.requestDrawingContours(); store.generateDrawingContours()
    expect(store.shapes.length).toBeGreaterThan(0)
    store.undo(); expect(store.shapes).toEqual([])
    trace.mockRestore(); store.$dispose()
  })
})
