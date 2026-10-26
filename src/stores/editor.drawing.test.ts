import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorStore } from './editor'
import { parseProjectFile, serializeProjectFile } from './projectTransfer'
import { EDITOR_DOCUMENT_VERSION, migrateEditorDocument } from './editor.persistence'
import type { StitchMark } from '../core/drawing/types'
const mark = (x: number, y: number, stitchId = 'knit'): StitchMark => ({ id: `${x}:${y}:${stitchId}`, x, y, stitchId })
beforeEach(() => { setActivePinia(createPinia()); vi.useFakeTimers(); vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, addEventListener: () => {}, removeEventListener: () => {} }) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('绘图与方案联动', () => {
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
    store.generateDrawingContours(); expect(store.shapes).toHaveLength(2); expect(store.drawing.automaticMarks).toHaveLength(1)
    expect(store.shapePlans.find(p => p.shapeId === store.drawing.generatedShapeIds[0])!.rasterRows.reduce((n, r) => n + r.stitchCount, 0)).toBe(9)
    store.undo(); expect(store.shapes).toHaveLength(1); expect(store.drawing.automaticMarks ?? []).toHaveLength(0)
    store.redo(); store.eraseDrawing([{ x: 1, y: 0 }]); store.generateDrawingContours(); expect(store.drawing.automaticMarks).toHaveLength(0)
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
    const store = useEditorStore(); store.paintDrawing([mark(1, 1)]); store.generateDrawingContours(); const before = JSON.stringify(store.drawing.marks)
    store.setGaugeInputValue('sampleStitches', 20); expect(JSON.stringify(store.drawing.marks)).toBe(before)
    store.deleteSelected(); const parsed = parseProjectFile(serializeProjectFile(store.createProjectExport()!)); expect(parsed.ok).toBe(true); store.$dispose()
  })
})
