import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useEditorStore } from './editor'
import { EDITOR_STORAGE_KEY, PROJECT_LIBRARY_STORAGE_KEY } from './editor.persistence'
import { parseProjectFile } from './projectTransfer'

class MemoryStorage {
  readonly values = new Map<string, string>()
  failWrites = false
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('storage full')
    this.values.set(key, value)
  }
  removeItem(key: string): void {
    this.values.delete(key)
  }
}

function stubBrowser(storage: MemoryStorage): void {
  vi.stubGlobal('window', {
    localStorage: storage,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
}

describe('Editor Store', () => {
  it('手工卡片随方案和文件保存，排版不占历史，恢复自动清除记录', async () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    stubBrowser(storage)
    const store = useEditorStore()
    store.addDefaultShape('rectangle')
    const shapeId = store.selectedShapeId!
    const key = `${shapeId}:0`
    store.setCardPosition(key, { x: -20, y: 500 })
    await nextTick()
    vi.advanceTimersByTime(300)
    expect(store.createProjectExport()!.project.document.cardPositions).toEqual({ [key]: { x: -20, y: 500 } })
    store.$dispose()
    setActivePinia(createPinia())
    const restored = useEditorStore()
    expect(restored.cardPositions[key]).toEqual({ x: -20, y: 500 })
    restored.setCardPosition(key, null)
    expect(restored.cardPositions[key]).toBeUndefined()
    expect(restored.canUndo).toBe(false)
    restored.setCardPosition(key, { x: 1, y: 2 })
    const firstId = restored.activeProjectId
    restored.createProject()
    expect(restored.cardPositions).toEqual({})
    restored.activateProject(firstId)
    expect(restored.cardPositions[key]).toEqual({ x: 1, y: 2 })
    restored.deleteSelected()
    expect(restored.createProjectExport()!.project.document.cardPositions).toEqual({})
    restored.undo()
    expect(restored.cardPositions[key]).toEqual({ x: 1, y: 2 })
    restored.$dispose()
  })
  it('自动最近整数与手工覆盖保存一致，上游重算保留方向且拒绝零候选', async () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    stubBrowser(storage)
    const store = useEditorStore()
    store.addShape({ id: 'r', type: 'rectangle', x: 2, y: 2, widthCm: 3.2, heightCm: 3.2 })
    store.setGaugeInputValue('sampleHeightCm', 10)
    expect(store.selectedShapePlan?.instructions).toHaveLength(3)
    store.setShapeRoundingDirection('r', 'rows', 'ceil')
    expect(store.selectedShapePlan?.instructions).toHaveLength(4)
    store.replaceShape({ id: 'r', type: 'rectangle', x: 2, y: 2, widthCm: 3.2, heightCm: 4.2 })
    expect(store.shapeRoundingPolicies.r?.rows).toBe('ceil')
    expect(store.selectedShapePlan?.instructions).toHaveLength(5)
    expect(store.notice).toContain('已保留手动取整方向')
    store.addShape({ id: 'tiny', type: 'rectangle', x: 2, y: 2, widthCm: 0.2, heightCm: 0.2 })
    store.setShapeRoundingDirection('tiny', 'rows', 'floor')
    expect(store.shapeRoundingPolicies.tiny).toBeUndefined()
    await nextTick()
    vi.advanceTimersByTime(300)
    expect(JSON.parse(storage.getItem(PROJECT_LIBRARY_STORAGE_KEY)!).projects[0].document.shapeRoundingPolicies.r.rows).toBe('ceil')
    store.$dispose()
  })
  it('同尺寸与同一方案成功打开均重置路径工具，失败和自动保存不重置会话', async () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    stubBrowser(storage)
    const store = useEditorStore()
    const firstId = store.activeProjectId
    store.addDefaultShape('rectangle')
    const original = JSON.stringify(store.shapes)
    const nextId = store.createProject()!
    expect(store.projectOpenRevision).toBe(1)
    store.activeTool = 'pan'
    expect(store.activateProject(firstId)).toBe(true)
    expect(store.activeTool).toBe('path')
    expect(JSON.stringify(store.shapes)).toBe(original)
    expect(store.projectOpenRevision).toBe(2)
    store.activeTool = 'select'
    expect(store.activateProject(firstId)).toBe(true)
    expect(store.projectOpenRevision).toBe(3)
    expect(store.activeTool).toBe('path')
    store.activeTool = 'pan'
    await nextTick()
    vi.advanceTimersByTime(300)
    expect(store.projectOpenRevision).toBe(3)
    expect(store.activeTool).toBe('pan')
    storage.failWrites = true
    expect(store.activateProject(nextId)).toBe(false)
    expect(store.createProject()).toBeNull()
    expect(store.deleteProject(firstId)).toBe(false)
    expect(store.projectOpenRevision).toBe(3)
    expect(store.activeProjectId).toBe(firstId)
    expect(store.activeTool).toBe('pan')
    store.$dispose()
  })
  it('指针取消恢复整次拖动源数据，不写撤销或保存中间状态', async () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    stubBrowser(storage)
    const store = useEditorStore()
    store.addDefaultShape('rectangle')
    await nextTick()
    vi.advanceTimersByTime(300)
    const original = JSON.stringify(store.shapes)
    store.beginShapeMutation()
    const shape = store.selectedShape!
    if (shape.type !== 'rectangle') throw new Error('fixture type')
    store.updateShapeLive({ ...shape, x: 10 })
    store.updateShapeLive({ ...shape, x: 20 })
    // A selection change can schedule a save while a drag is still in progress.
    store.selectedShapeId = null
    await nextTick()
    vi.advanceTimersByTime(300)
    expect(JSON.stringify(JSON.parse(storage.getItem(PROJECT_LIBRARY_STORAGE_KEY)!).projects[0].document.shapes)).toBe(original)
    store.cancelShapeMutation()
    store.commitShapeMutation()
    expect(JSON.stringify(store.shapes)).toBe(original)
    await nextTick()
    vi.advanceTimersByTime(300)
    expect(JSON.parse(storage.getItem(PROJECT_LIBRARY_STORAGE_KEY)!).projects[0].document.shapes).toEqual(store.shapes)
    store.undo()
    expect(store.shapes).toEqual([])
    store.$dispose()
  })
  it('复杂三段保留针格但整片不生成计划及编织导出', () => {
    const store = useEditorStore()
    store.addPath([{ anchor: { x: 2, y: 1 } }, { anchor: { x: 12, y: 1 } },
      { anchor: { x: 12, y: 9 } }, { anchor: { x: 10, y: 9 } }, { anchor: { x: 10, y: 3 } },
      { anchor: { x: 8, y: 3 } }, { anchor: { x: 8, y: 9 } }, { anchor: { x: 6, y: 9 } },
      { anchor: { x: 6, y: 3 } }, { anchor: { x: 4, y: 3 } }, { anchor: { x: 4, y: 9 } },
      { anchor: { x: 2, y: 9 } }], true)
    expect(store.selectedShapePlan?.rasterRows.some((row) => row.segments.length === 3)).toBe(true)
    expect(store.selectedShapePlan).toMatchObject({ calculationMessage: '不支持的复杂断开结构，请修改轮廓', instructions: [], canExport: false })
    store.$dispose()
  })
  it('无效织片状态明确，源数据保存且其他织片不受影响，修正后恢复', () => {
    const store = useEditorStore()
    store.addDefaultShape('rectangle')
    const validId = store.selectedShapeId!
    const validRows = store.shapePlans.find((plan) => plan.shapeId === validId)!.rasterRows
    store.addDefaultShape('rectangle')
    const invalidId = store.selectedShapeId!
    store.replaceShape({ id: invalidId, type: 'rectangle', x: -1, y: 0, widthCm: 4, heightCm: 3 })
    expect(store.selectedShapePlan).toMatchObject({ calculationMessage: '织片超出计算范围，请移回画布或扩大画布', canExport: false, instructions: [], rasterRows: [] })
    expect(store.createProjectExport()!.project.document.shapes.find((shape) => shape.id === invalidId)).toMatchObject({ x: -1 })
    expect(store.shapePlans.find((plan) => plan.shapeId === validId)!.rasterRows).toBe(validRows)
    store.replaceShape({ id: invalidId, type: 'rectangle', x: 1, y: 0, widthCm: 4, heightCm: 3 })
    expect(store.selectedShapePlan?.canExport).toBe(true)
    store.replaceShape({ id: invalidId, type: 'path', closed: false, nodes: [{ anchor: { x: 1, y: 1 } }, { anchor: { x: 8, y: 8 } }] })
    expect(store.selectedShapePlan).toMatchObject({ calculationMessage: '未闭合轮廓，不参与编织计算', dimensions: [], canExport: false, instructions: [] })
    store.$dispose()
  })
  it('有效密度提交重算并提示一次，无效提交不新增历史或提示', () => {
    vi.useFakeTimers()
    const store = useEditorStore()
    store.addDefaultShape('rectangle')
    const original = JSON.stringify(store.shapes)
    store.setGaugeInputValue('sampleStitches', 20)
    expect(store.notice).toBe('密度已更新，针格和编织方案已重新计算')
    expect(store.fabricGrid.columnCount).toBe(120)
    expect(JSON.stringify(store.shapes)).toBe(original)
    vi.advanceTimersByTime(6500)
    expect(store.notice).toBe('')
    expect(store.setGaugeInputValue('sampleStitches', -1).ok).toBe(false)
    expect(store.notice).toBe('')
    store.undo()
    expect(store.gaugeInput.sampleStitches).toBe(10)
    store.$dispose()
  })
  it('旧方案迁移提示在打开时消费，刷新及重复自动保存不会再次提示', async () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    stubBrowser(storage)
    const store = useEditorStore()
    store.addDefaultShape('rectangle')
    const file = store.createProjectExport()!
    file.project.document.rasterOptions.mode = 'outside'
    const parsed = parseProjectFile(JSON.stringify(file))
    if (!parsed.ok) throw new Error('legacy fixture rejected')
    expect(store.importProject(parsed.file).status).toBe('imported')
    expect(store.notice).toBe('针格规则已更新，结果可能变化')
    expect(store.rasterOptions.mode).toBe('center')
    expect(store.shapes).toEqual(file.project.document.shapes)
    await nextTick()
    vi.advanceTimersByTime(6500)
    expect(store.notice).toBe('')
    store.$dispose()
    setActivePinia(createPinia())
    const restored = useEditorStore()
    expect(restored.notice).toBe('')
    expect(restored.rasterOptions.mode).toBe('center')
    restored.$dispose()
  })
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('自动保存源数据并在新会话中恢复', async () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    stubBrowser(storage)
    const store = useEditorStore()
    store.addDefaultShape('rectangle')
    const starterId = store.selectedShapeId!

    store.addDefaultShape('circle')
    const circleId = store.selectedShapeId!
    store.setGaugeInputValue('sampleStitches', 18)
    store.setFabricValue('widthCm', 42)
    store.setRasterOptions({ mode: 'inside' })
    store.setShapeDirection(circleId, 'top-down')
    store.setShapeRoundingDirection(circleId, 'stitches', 'ceil')
    store.viewMode = 'outline'
    await nextTick()
    vi.advanceTimersByTime(300)
    expect(storage.getItem(PROJECT_LIBRARY_STORAGE_KEY)).not.toBeNull()
    const expectedGrid = store.fabricGrid
    store.$dispose()

    setActivePinia(createPinia())
    const restored = useEditorStore()
    expect(restored.shapes.map((shape) => shape.id)).toEqual([starterId, circleId])
    expect(restored.gaugeInput.sampleStitches).toBe(18)
    expect(restored.fabric.widthCm).toBe(42)
    expect(restored.rasterOptions.mode).toBe('center')
    expect(restored.viewMode).toBe('outline')
    expect(restored.direction).toBe('bottom-up')
    expect(restored.shapeRoundingPolicies[circleId]).toEqual({ stitches: 'ceil', rows: null })
    expect(restored.selectedShapeId).toBe(circleId)
    expect(restored.fabricGrid).toEqual(expectedGrid)
    expect(restored.canUndo).toBe(false)
    restored.$dispose()
  })

  it('空画布是有效存档，刷新后不会重新添加默认图形', async () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    stubBrowser(storage)
    const store = useEditorStore()
    store.shapes.splice(0)
    store.selectedShapeId = null
    store.selectedPlanShapeId = null
    await nextTick()
    vi.advanceTimersByTime(300)
    store.$dispose()

    setActivePinia(createPinia())
    const restored = useEditorStore()
    expect(restored.shapes).toEqual([])
    expect(restored.selectedShapeId).toBeNull()
    restored.$dispose()
  })

  it('刷新恢复显示模式，但不恢复绘制草稿、缩放和当前工具', async () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    stubBrowser(storage)
    const store = useEditorStore()
    store.zoom = 48
    store.viewMode = 'grid'
    store.activeTool = 'path'
    store.addDraftPathNode({ anchor: { x: 2, y: 2 } })
    store.setGaugeInputValue('sampleRows', 16)
    await nextTick()
    vi.advanceTimersByTime(300)
    store.$dispose()

    setActivePinia(createPinia())
    const restored = useEditorStore()
    expect(restored.gaugeInput.sampleRows).toBe(16)
    expect(restored.draftPathNodes).toEqual([])
    expect(restored.zoom).toBe(20)
    expect(restored.viewMode).toBe('grid')
    expect(restored.activeTool).toBe('path')
    expect(restored.canUndo).toBe(false)
    restored.$dispose()
  })

  it('恢复时会将无效的选中图形回退到最后一个有效图形', () => {
    const storage = new MemoryStorage()
    storage.setItem(EDITOR_STORAGE_KEY, JSON.stringify({
      version: 1,
      savedAt: '2026-08-30T00:00:00.000Z',
      gaugeInput: { sampleStitches: 10, sampleRows: 10, sampleWidthCm: 10, sampleHeightCm: 6 },
      fabric: { widthCm: 30, heightCm: 30 },
      shapes: [{ id: 'valid', type: 'circle', center: { x: 5, y: 5 }, radiusCm: 3 }],
      shapeDirections: {},
      rasterOptions: { mode: 'center', symmetryOptimization: true },
      selectedShapeId: 'missing',
      selectedPlanShapeId: 'missing',
    }))
    stubBrowser(storage)

    const store = useEditorStore()
    expect(store.selectedShapeId).toBe('valid')
    expect(store.selectedPlanShapeId).toBe('valid')
    store.$dispose()
  })

  it('首次进入编辑器默认启用路径工具', () => {
    const store = useEditorStore()

    expect(store.activeTool).toBe('path')
  })

  it('源数据修改后密度、针格和指令自动重算', () => {
    const store = useEditorStore()
    store.addDefaultShape('rectangle')
    expect(store.fabricGrid).toEqual({ columnCount: 60, rowCount: 117 })
    expect(store.instructions.length).toBeGreaterThan(0)

    store.fabric.widthCm = 20
    expect(store.fabricGrid.columnCount).toBe(20)
  })

  it('超限候选值在写入前被拒绝且不产生撤销记录', () => {
    const store = useEditorStore()
    const originalGauge = { ...store.gaugeInput }

    const result = store.setGaugeInputValue('sampleStitches', 5_000)

    expect(result.ok).toBe(false)
    expect(result.assessment.status).toBe('blocked')
    expect(store.gaugeInput).toEqual(originalGauge)
    expect(store.canUndo).toBe(false)
  })

  it('安全密度不触发常见范围警告并允许保存', () => {
    const store = useEditorStore()

    const result = store.setGaugeInputValue('sampleStitches', 110)

    expect(result.ok).toBe(true)
    expect(result.assessment.status).toBe('valid')
    expect(store.gaugeInput.sampleStitches).toBe(110)
  })

  it('保留超限旧方案、暂停栅格化，并允许分步修复', () => {
    const storage = new MemoryStorage()
    storage.setItem(EDITOR_STORAGE_KEY, JSON.stringify({
      version: 1,
      savedAt: '2026-08-30T00:00:00.000Z',
      gaugeInput: { sampleStitches: 5_000, sampleRows: 5_000, sampleWidthCm: 10, sampleHeightCm: 10 },
      fabric: { widthCm: 60, heightCm: 70 },
      shapes: [{ id: 'legacy-shape', type: 'rectangle', x: 0, y: 0, widthCm: 10, heightCm: 10 }],
      shapeDirections: {},
      rasterOptions: { mode: 'center', symmetryOptimization: true },
      selectedShapeId: 'legacy-shape',
      selectedPlanShapeId: 'legacy-shape',
    }))
    stubBrowser(storage)
    const store = useEditorStore()

    expect(store.gridAssessment.status).toBe('blocked')
    expect(store.rasterRows).toEqual([])
    expect(store.setGaugeInputValue('sampleStitches', 10).ok).toBe(true)
    expect(store.gridAssessment.status).toBe('blocked')
    expect(store.setGaugeInputValue('sampleRows', 10).ok).toBe(true)
    expect(store.gridAssessment.status).toBe('valid')
    expect(store.rasterRows.length).toBeGreaterThan(0)
  })

  it('创建图形可撤销和重做', () => {
    const store = useEditorStore()
    const initialCount = store.shapes.length
    store.addDefaultShape('circle')
    expect(store.shapes).toHaveLength(initialCount + 1)

    store.undo()
    expect(store.shapes).toHaveLength(initialCount)

    store.redo()
    expect(store.shapes).toHaveLength(initialCount + 1)
  })

  it('撤销无关操作时不替换画布尺寸状态', () => {
    const store = useEditorStore()
    const fabricState = store.fabric
    store.addDefaultShape('circle')

    store.undo()
    expect(store.fabric).toBe(fabricState)
  })

  it('每个图形独立生成计划，画布针格保持全部图形并集', () => {
    const store = useEditorStore()
    store.addDefaultShape('rectangle')
    const starterId = store.selectedShapeId!
    store.addPath([
      { anchor: { x: 2, y: 2 } },
      { anchor: { x: 12, y: 6 } },
    ], false)
    const pathId = store.selectedShapeId!

    expect(store.shapePlans).toHaveLength(store.shapes.length)
    expect(store.selectedPlanShapeId).toBe(pathId)
    expect(store.selectedShapePlan?.shapeType).toBe('path')
    expect(store.selectedShapePlan?.instructions).toHaveLength(0)
    expect(store.selectedShapePlan?.isFabric).toBe(false)

    const aggregateBefore = JSON.stringify(store.rasterRows)
    store.selectedPlanShapeId = starterId
    expect(JSON.stringify(store.rasterRows)).toBe(aggregateBefore)
    expect(store.selectedShapePlan?.shapeId).toBe(starterId)
  })

  it('只修改一个图形时复用其他图形的栅格结果', () => {
    const store = useEditorStore()
    store.addDefaultShape('circle')
    const firstShapeId = store.selectedShapeId!
    store.addDefaultShape('rectangle')
    const rectangle = store.selectedShape!
    if (rectangle.type !== 'rectangle') throw new Error('expected rectangle')
    const firstRows = store.shapePlans.find((plan) => plan.shapeId === firstShapeId)!.rasterRows
    const rectangleRows = store.shapePlans.find((plan) => plan.shapeId === rectangle.id)!.rasterRows

    store.beginShapeMutation()
    store.updateShapeLive({ ...rectangle, x: rectangle.x + 1 })

    expect(store.shapePlans.find((plan) => plan.shapeId === firstShapeId)!.rasterRows).toBe(firstRows)
    expect(store.shapePlans.find((plan) => plan.shapeId === rectangle.id)!.rasterRows).not.toBe(rectangleRows)
    store.commitShapeMutation()
  })

  it('实时拖动不反复安排自动保存，提交后保存最终图形', async () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    const setItem = vi.spyOn(storage, 'setItem')
    stubBrowser(storage)
    const store = useEditorStore()
    store.addDefaultShape('rectangle')
    const shape = store.selectedShape!
    await nextTick()
    vi.advanceTimersByTime(300)
    setItem.mockClear()

    store.beginShapeMutation()
    store.updateShapeLive({ ...shape, name: '拖动中的最终名称' })
    await nextTick()
    vi.advanceTimersByTime(300)
    expect(setItem).not.toHaveBeenCalled()

    store.commitShapeMutation()
    await nextTick()
    vi.advanceTimersByTime(300)
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(storage.getItem(PROJECT_LIBRARY_STORAGE_KEY)).toContain('拖动中的最终名称')
    store.$dispose()
  })

  it('在画布上选中哪条路径，就切换到对应的逐行指令', () => {
    const store = useEditorStore()
    store.addDefaultShape('rectangle')
    const firstShapeId = store.selectedShapeId!
    store.addPath([
      { anchor: { x: 2, y: 2 } },
      { anchor: { x: 18, y: 12 } },
    ], false)
    const secondShapeId = store.selectedShapeId!

    store.selectedShapeId = firstShapeId
    expect(store.selectedPlanShapeId).toBe(firstShapeId)
    expect(store.selectedShapePlan?.shapeId).toBe(firstShapeId)

    store.selectedShapeId = secondShapeId
    expect(store.selectedPlanShapeId).toBe(secondShapeId)
    expect(store.selectedShapePlan?.shapeId).toBe(secondShapeId)
  })

  it('对象计划名称实时更新且删除后回退到有效对象', () => {
    const store = useEditorStore()
    store.addDefaultShape('rectangle')
    store.addDefaultShape('circle')
    const circleId = store.selectedShapeId!
    const circle = store.selectedShape!
    store.replaceShape({ ...circle, name: '袖笼圆弧' })
    expect(store.selectedShapePlan?.shapeName).toBe('袖笼圆弧')

    store.deleteSelected()
    expect(store.shapePlans.some((plan) => plan.shapeId === circleId)).toBe(false)
    expect(store.selectedPlanShapeId).not.toBe(circleId)
    expect(store.shapePlans.some((plan) => plan.shapeId === store.selectedPlanShapeId)).toBe(true)
  })

  it('删除后撤销可恢复原图形和选择状态', () => {
    const store = useEditorStore()
    store.addDefaultShape('circle')
    const circleId = store.selectedShapeId!

    store.deleteSelected()
    expect(store.shapes.some((shape) => shape.id === circleId)).toBe(false)
    expect(store.selectedShapeId).not.toBe(circleId)

    store.undo()
    expect(store.shapes.some((shape) => shape.id === circleId)).toBe(true)
    expect(store.selectedShapeId).toBe(circleId)
    expect(store.selectedPlanShapeId).toBe(circleId)

    store.redo()
    expect(store.shapes.some((shape) => shape.id === circleId)).toBe(false)
    expect(store.selectedShapeId).not.toBe(circleId)
  })

  it('撤销后产生新编辑会清空重做栈', () => {
    const store = useEditorStore()
    store.addDefaultShape('circle')
    store.undo()
    expect(store.canRedo).toBe(true)
    store.addDefaultShape('rectangle')
    expect(store.canRedo).toBe(false)
  })

  it('所有轮廓固定自下而上，旧方向调用不能改变计划', () => {
    const store = useEditorStore()
    store.addDefaultShape('circle')
    const firstShapeId = store.selectedShapeId!
    expect(store.direction).toBe('bottom-up')
    store.direction = 'top-down'
    expect(store.shapePlans.find((plan) => plan.shapeId === firstShapeId)?.direction).toBe('bottom-up')

    store.addDefaultShape('rectangle')
    const rectangleId = store.selectedShapeId!
    expect(store.direction).toBe('bottom-up')
    expect(store.shapePlans.find((plan) => plan.shapeId === rectangleId)?.direction).toBe('bottom-up')
    expect(store.shapePlans.find((plan) => plan.shapeId === firstShapeId)?.direction).toBe('bottom-up')

    store.setShapeDirection(rectangleId, 'top-down')
    expect(store.direction).toBe('bottom-up')
  })

  it('路径创建和控制点修改可撤销与重做', () => {
    const store = useEditorStore()
    store.addPath([
      { anchor: { x: 1, y: 1 } },
      { anchor: { x: 8, y: 1 } },
    ], false)
    const path = store.selectedShape
    expect(path?.type).toBe('path')
    if (!path || path.type !== 'path') return

    store.beginShapeMutation()
    store.updateShapeLive({
      ...path,
      nodes: [
        { ...path.nodes[0]!, outControl: { x: 3, y: 5 } },
        { ...path.nodes[1]!, inControl: { x: 6, y: 4 } },
      ],
    })
    store.commitShapeMutation()
    expect(store.selectedShape?.type === 'path' && store.selectedShape.nodes[0]?.outControl).toEqual({ x: 3, y: 5 })

    store.undo()
    expect(store.selectedShape?.type === 'path' && store.selectedShape.nodes[0]?.outControl).toBeUndefined()
    store.redo()
    expect(store.selectedShape?.type === 'path' && store.selectedShape.nodes[1]?.inControl).toEqual({ x: 6, y: 4 })
  })

  it('连续绘制按每次落点和完成操作逐步撤销与重做', () => {
    const store = useEditorStore()
    const initialCount = store.shapes.length
    store.activeTool = 'path'
    store.addDraftPathNode({ anchor: { x: 2, y: 2 } })
    store.addDraftPathNode({ anchor: { x: 8, y: 2 } })
    store.addDraftPathNode({ anchor: { x: 8, y: 8 } })
    store.finishPathDraft(true)

    expect(store.shapes).toHaveLength(initialCount + 1)
    expect(store.draftPathNodes).toHaveLength(0)
    expect(store.activeTool).toBe('select')

    store.undo()
    expect(store.shapes).toHaveLength(initialCount)
    expect(store.draftPathNodes).toHaveLength(3)
    expect(store.activeTool).toBe('path')

    store.undo()
    expect(store.draftPathNodes).toHaveLength(2)
    store.redo()
    expect(store.draftPathNodes).toHaveLength(3)
    store.redo()
    expect(store.shapes).toHaveLength(initialCount + 1)
    expect(store.draftPathNodes).toHaveLength(0)
    expect(store.activeTool).toBe('select')
  })

  it('自由多边形草稿可逐点撤销直到清空起点', () => {
    const store = useEditorStore()
    store.activeTool = 'polygon'
    store.addDraftPoint({ x: 2, y: 2 })
    store.addDraftPoint({ x: 8, y: 2 })
    store.addDraftPoint({ x: 5, y: 8 })

    store.undo()
    expect(store.draftPoints).toHaveLength(2)
    store.undo()
    expect(store.draftPoints).toHaveLength(1)
    store.undo()
    expect(store.draftPoints).toHaveLength(0)
    expect(store.activeTool).toBe('polygon')
  })

  it('取消草稿一步恢复全部落点和控制柄，重做再次取消并清除旧重做分支', () => {
    const store = useEditorStore()
    store.addDefaultShape('circle')
    const countAfterCircle = store.shapes.length
    store.activeTool = 'path'
    store.addDraftPathNode({ anchor: { x: 2, y: 2 } })
    store.addDraftPathNode({ anchor: { x: 8, y: 2 } })
    store.addDraftPathNode({ anchor: { x: 8, y: 8 }, inControl: { x: 5, y: 7 } })
    const completeDraft = JSON.parse(JSON.stringify(store.draftPathNodes))
    store.addDraftPathNode({ anchor: { x: 2, y: 8 } })
    store.undo()
    expect(store.canRedo).toBe(true)

    store.cancelDrawing()
    expect(store.canRedo).toBe(false)
    expect(store.draftPathNodes).toHaveLength(0)
    store.undo()
    expect(store.shapes).toHaveLength(countAfterCircle)
    expect(store.draftPathNodes).toEqual(completeDraft)
    expect(store.activeTool).toBe('path')
    store.redo()
    expect(store.draftPathNodes).toHaveLength(0)
    expect(store.shapes).toHaveLength(countAfterCircle)
    store.undo()
    store.undo()
    expect(store.draftPathNodes).toHaveLength(2)
  })

  it('取消步骤恢复完整草稿，随后内容撤销不改草稿，空取消不占步骤', () => {
    const store = useEditorStore()
    store.activeTool = 'path'
    store.addDraftPathNode({ anchor: { x: 2, y: 2 } })
    store.setGaugeInputValue('sampleStitches', 12)
    store.addDraftPathNode({ anchor: { x: 8, y: 2 } })

    store.cancelDrawing()
    store.undo()
    expect(store.gaugeInput.sampleStitches).toBe(12)
    expect(store.draftPathNodes).toHaveLength(2)
    store.undo()
    expect(store.draftPathNodes).toHaveLength(1)
    store.undo()
    expect(store.gaugeInput.sampleStitches).toBe(10)
    expect(store.draftPathNodes).toHaveLength(1)
    store.redo()
    expect(store.gaugeInput.sampleStitches).toBe(12)
    expect(store.draftPathNodes).toHaveLength(1)
    store.redo()
    store.redo()
    store.cancelDrawing()
    store.undo()
    expect(store.draftPathNodes).toHaveLength(2)
  })

  it('编织参数和画布尺寸按步骤撤销，固定策略和方向不增加步骤', () => {
    const store = useEditorStore()
    store.addDefaultShape('rectangle')
    const shapeId = store.selectedShapeId!
    store.setGaugeInputValue('sampleStitches', 12)
    store.setFabricValue('widthCm', 42)
    store.setRasterOptions({ mode: 'inside' })
    store.setShapeDirection(shapeId, 'top-down')

    expect(store.direction).toBe('bottom-up')
    expect(store.direction).toBe('bottom-up')
    store.undo()
    expect(store.rasterOptions.mode).toBe('center')
    expect(store.fabric.widthCm).toBe(60)
    store.undo()
    expect(store.gaugeInput.sampleStitches).toBe(10)

    store.redo()
    store.redo()
    store.redo()
    store.redo()
    expect(store.gaugeInput.sampleStitches).toBe(12)
    expect(store.fabric.widthCm).toBe(42)
    expect(store.rasterOptions.mode).toBe('center')
    expect(store.direction).toBe('bottom-up')
  })

  it('织片取整策略同步尺寸、针格和指令并支持撤销及删除清理', () => {
    const store = useEditorStore()
    store.addShape({
      id: 'rounding-piece', type: 'rectangle', x: 4, y: 4, widthCm: 18.2, heightCm: 19,
    })
    store.setGaugeInputValue('sampleStitches', 20)
    store.setGaugeInputValue('sampleWidthCm', 10)
    store.setGaugeInputValue('sampleRows', 28)
    store.setGaugeInputValue('sampleHeightCm', 10)

    expect(store.selectedShapePlan?.roundingPending).toBe(false)
    store.setShapeRoundingDirection('rounding-piece', 'stitches', 'floor')
    store.setShapeRoundingDirection('rounding-piece', 'rows', 'ceil')
    const plan = store.selectedShapePlan!
    expect(store.shapeRoundingPolicies['rounding-piece']).toEqual({ stitches: 'floor', rows: 'ceil' })
    expect(plan.roundingPending).toBe(false)
    expect(plan.instructions).toHaveLength(54)
    expect(plan.instructions.every((instruction) => instruction.stitchCount === 36)).toBe(true)

    store.undo()
    expect(store.shapeRoundingPolicies['rounding-piece']?.rows).toBeNull()
    store.redo()
    expect(store.selectedShapePlan?.instructions).toHaveLength(54)
    store.deleteSelected()
    expect(store.shapeRoundingPolicies['rounding-piece']).toBeUndefined()
    store.undo()
    expect(store.shapeRoundingPolicies['rounding-piece']).toEqual({ stitches: 'floor', rows: 'ceil' })
  })

  it('最多保留最近 100 个操作步骤', () => {
    const store = useEditorStore()
    for (let value = 11; value <= 111; value += 1) {
      store.setGaugeInputValue('sampleStitches', value)
    }
    for (let index = 0; index < 100; index += 1) store.undo()

    expect(store.gaugeInput.sampleStitches).toBe(11)
    expect(store.canUndo).toBe(false)
    for (let index = 0; index < 100; index += 1) store.redo()
    expect(store.gaugeInput.sampleStitches).toBe(111)
    expect(store.canRedo).toBe(false)
  })

  it('视图与工具不占历史，连续拖动一步，切换后草稿历史隔离', () => {
    stubBrowser(new MemoryStorage())
    const store = useEditorStore()
    store.addDefaultShape('rectangle')
    const original = JSON.parse(JSON.stringify(store.selectedShape!))
    store.beginShapeMutation()
    store.updateShapeLive({ ...original, x: original.x + 1 })
    store.updateShapeLive({ ...original, x: original.x + 2 })
    store.commitShapeMutation()
    store.viewMode = 'grid'
    store.zoom = 40
    store.activeTool = 'pan'
    store.undo()
    expect(store.selectedShape).toEqual(original)
    expect(store.viewMode).toBe('grid')
    expect(store.zoom).toBe(40)
    expect(store.activeTool).toBe('pan')
    store.redo()
    expect(store.selectedShape).toEqual({ ...original, x: original.x + 2 })
    store.activeTool = 'path'
    store.addDraftPathNode({ anchor: { x: 1, y: 1 } })
    store.cancelDrawing()
    expect(store.createProject(true)).not.toBeNull()
    store.undo()
    expect(store.draftPathNodes).toEqual([])
    expect(store.shapes).toEqual([])
    store.$dispose()
  })

  it('相接的开放路径自动拼合并在围成轮廓时转为织片', () => {
    const store = useEditorStore()
    const initialCount = store.shapes.length
    store.addPath([
      { anchor: { x: 2, y: 2 } },
      { anchor: { x: 8, y: 2 } },
    ], false)
    store.addPath([
      { anchor: { x: 8, y: 2 } },
      { anchor: { x: 8, y: 8 } },
    ], false)
    store.addPath([
      { anchor: { x: 8, y: 8 } },
      { anchor: { x: 2, y: 8 } },
    ], false)
    store.addPath([
      { anchor: { x: 2, y: 8 } },
      { anchor: { x: 2, y: 2 } },
    ], false)

    expect(store.shapes).toHaveLength(initialCount + 1)
    expect(store.selectedShape).toMatchObject({
      type: 'path',
      closed: true,
      name: '自定义闭合路径',
    })
    expect(store.selectedShapePlan?.isFabric).toBe(true)
    expect(store.selectedShapePlan?.instructions[0]?.isCastOn).toBe(true)
  })

  it('新建和切换方案会保存各自内容并隔离撤销历史', () => {
    const storage = new MemoryStorage()
    stubBrowser(storage)
    const store = useEditorStore()
    const firstProjectId = store.activeProjectId
    store.addDefaultShape('rectangle')
    store.setGaugeInputValue('sampleStitches', 18)
    expect(store.canUndo).toBe(true)

    const secondProjectId = store.createProject()
    expect(secondProjectId).not.toBeNull()
    expect(store.shapes).toEqual([])
    expect(store.gaugeInput.sampleStitches).toBe(10)
    expect(store.canUndo).toBe(false)
    store.addDefaultShape('circle')

    expect(store.activateProject(firstProjectId)).toBe(true)
    expect(store.shapes[0]?.type).toBe('rectangle')
    expect(store.gaugeInput.sampleStitches).toBe(18)
    expect(store.canUndo).toBe(false)
    expect(store.activateProject(secondProjectId!)).toBe(true)
    expect(store.shapes[0]?.type).toBe('circle')
  })

  it('未完成草稿会阻止方案切换，明确丢弃后才允许继续', () => {
    const storage = new MemoryStorage()
    stubBrowser(storage)
    const store = useEditorStore()
    const firstProjectId = store.activeProjectId
    const secondProjectId = store.createProject()!
    store.addDraftPathNode({ anchor: { x: 2, y: 2 } })

    expect(store.activateProject(firstProjectId)).toBe(false)
    expect(store.activeProjectId).toBe(secondProjectId)
    expect(store.draftPathNodes).toHaveLength(1)
    expect(store.activateProject(firstProjectId, true)).toBe(true)
    expect(store.draftPathNodes).toEqual([])
  })

  it('方案库最多五份，替换后仍保持五份', () => {
    const storage = new MemoryStorage()
    stubBrowser(storage)
    const store = useEditorStore()
    for (let index = 0; index < 4; index += 1) expect(store.createProject()).not.toBeNull()

    expect(store.projects).toHaveLength(5)
    expect(store.createProject()).toBeNull()
    const replacedId = store.projects[0].id
    const replacementId = store.replaceProject(replacedId)
    expect(replacementId).not.toBeNull()
    expect(store.projects).toHaveLength(5)
    expect(store.projects.some((project) => project.id === replacedId)).toBe(false)
  })

  it('导出当前方案再导入时完整保留编辑数据并生成独立同名方案', () => {
    const storage = new MemoryStorage()
    stubBrowser(storage)
    const store = useEditorStore()
    store.addDefaultShape('rectangle')
    const shapeId = store.selectedShapeId!
    store.setGaugeInputValue('sampleStitches', 18)
    store.setFabricValue('widthCm', 42)
    store.setRasterOptions({ mode: 'inside' })
    store.setShapeDirection(shapeId, 'top-down')
    store.setShapeRoundingDirection(shapeId, 'rows', 'ceil')
    const sourceProjectId = store.activeProjectId
    const file = store.createProjectExport()!

    const result = store.importProject(file)

    expect(result.status).toBe('imported')
    expect(store.projects).toHaveLength(2)
    expect(store.activeProjectId).not.toBe(sourceProjectId)
    expect(store.activeProject?.name).toBe('未命名方案 1（导入）')
    expect(store.shapes).toEqual(file.project.document.shapes)
    expect(store.gaugeInput).toEqual(file.project.document.gaugeInput)
    expect(store.fabric).toEqual(file.project.document.fabric)
    expect(store.rasterOptions).toEqual(file.project.document.rasterOptions)
    expect(store.shapeDirections).toEqual(file.project.document.shapeDirections)
    expect(store.shapeRoundingPolicies).toEqual(file.project.document.shapeRoundingPolicies)
    expect(store.canUndo).toBe(false)
  })

  it('导入在容量满时等待选择，被替换项目只有确认后才改变', () => {
    const storage = new MemoryStorage()
    stubBrowser(storage)
    const store = useEditorStore()
    store.addDefaultShape('circle')
    const file = store.createProjectExport()!
    for (let index = 0; index < 4; index += 1) store.createProject()
    const originalIds = store.projects.map((project) => project.id)

    expect(store.importProject(file)).toEqual({ status: 'capacity' })
    expect(store.projects.map((project) => project.id)).toEqual(originalIds)

    const replacedId = originalIds[0]
    expect(store.replaceWithImportedProject(replacedId, file).status).toBe('imported')
    expect(store.projects).toHaveLength(5)
    expect(store.projects.some((project) => project.id === replacedId)).toBe(false)
    expect(store.activeProject?.name).toBe(file.project.name)
    expect(store.shapes[0]?.type).toBe('circle')
  })

  it('未完成草稿阻止导入，存储失败时也不修改方案库', () => {
    const storage = new MemoryStorage()
    stubBrowser(storage)
    const store = useEditorStore()
    store.addDefaultShape('rectangle')
    const file = store.createProjectExport()!
    store.addDraftPathNode({ anchor: { x: 2, y: 2 } })

    expect(store.importProject(file)).toEqual({ status: 'draft' })
    expect(store.projects).toHaveLength(1)
    expect(store.draftPathNodes).toHaveLength(1)

    storage.failWrites = true
    expect(store.importProject(file, true)).toEqual({ status: 'storage-error' })
    expect(store.projects).toHaveLength(1)
    expect(store.activeProject?.name).toBe('未命名方案 1')
  })

  it('导入超限方案时返回具体网格原因且不修改方案库', () => {
    const storage = new MemoryStorage()
    stubBrowser(storage)
    const store = useEditorStore()
    const file = store.createProjectExport()!
    file.project.document.gaugeInput.sampleStitches = 5_000

    const result = store.importProject(file)

    expect(result.status).toBe('grid-limit')
    if (result.status === 'grid-limit') {
      expect(result.assessment.status).toBe('blocked')
      expect(result.assessment.issues.some((issue) => issue.severity === 'error')).toBe(true)
    }
    expect(store.projects).toHaveLength(1)
  })

  it('删除当前方案后打开最近修改方案，且不允许删除最后一份', () => {
    const storage = new MemoryStorage()
    stubBrowser(storage)
    const store = useEditorStore()
    const firstProjectId = store.activeProjectId
    const secondProjectId = store.createProject()!

    expect(store.deleteProject(secondProjectId)).toBe(true)
    expect(store.activeProjectId).toBe(firstProjectId)
    expect(store.projects).toHaveLength(1)
    expect(store.deleteProject(firstProjectId)).toBe(false)
  })

  it('旧单文档成功迁移后写入方案库并清理旧键', () => {
    const storage = new MemoryStorage()
    storage.setItem(EDITOR_STORAGE_KEY, JSON.stringify({
      version: 1,
      savedAt: '2026-08-30T00:00:00.000Z',
      gaugeInput: { sampleStitches: 20, sampleRows: 24, sampleWidthCm: 10, sampleHeightCm: 10 },
      fabric: { widthCm: 40, heightCm: 60 },
      shapes: [],
      shapeDirections: {},
      rasterOptions: { mode: 'center', symmetryOptimization: true },
      selectedShapeId: null,
      selectedPlanShapeId: null,
    }))
    stubBrowser(storage)

    const store = useEditorStore()
    expect(store.activeProject?.name).toBe('方案 1')
    expect(storage.getItem(PROJECT_LIBRARY_STORAGE_KEY)).not.toBeNull()
    expect(storage.getItem(EDITOR_STORAGE_KEY)).toBeNull()
  })

})
