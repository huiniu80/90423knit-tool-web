import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorStore } from './editor'

describe('Editor Store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('首次进入编辑器默认启用路径工具', () => {
    const store = useEditorStore()

    expect(store.activeTool).toBe('path')
  })

  it('源数据修改后密度、针格和指令自动重算', () => {
    const store = useEditorStore()
    expect(store.fabricGrid).toEqual({ columnCount: 30, rowCount: 50 })
    expect(store.instructions.length).toBeGreaterThan(0)

    store.fabric.widthCm = 20
    expect(store.fabricGrid.columnCount).toBe(20)
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
    const starterId = store.shapes[0]!.id
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

  it('在画布上选中哪条路径，就切换到对应的逐行指令', () => {
    const store = useEditorStore()
    const firstShapeId = store.shapes[0]!.id
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

  it('每个轮廓对象使用独立方向，新对象默认自下而上', () => {
    const store = useEditorStore()
    const firstShapeId = store.shapes[0]!.id
    expect(store.direction).toBe('bottom-up')
    store.direction = 'top-down'
    expect(store.shapePlans.find((plan) => plan.shapeId === firstShapeId)?.direction).toBe('top-down')

    store.addDefaultShape('rectangle')
    const rectangleId = store.selectedShapeId!
    expect(store.direction).toBe('bottom-up')
    expect(store.shapePlans.find((plan) => plan.shapeId === rectangleId)?.direction).toBe('bottom-up')
    expect(store.shapePlans.find((plan) => plan.shapeId === firstShapeId)?.direction).toBe('top-down')

    store.setShapeDirection(rectangleId, 'top-down')
    expect(store.direction).toBe('top-down')
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

  it('取消草稿会丢弃该绘图会话的撤销和重做记录', () => {
    const store = useEditorStore()
    store.addDefaultShape('circle')
    const countAfterCircle = store.shapes.length
    store.activeTool = 'path'
    store.addDraftPathNode({ anchor: { x: 2, y: 2 } })
    store.addDraftPathNode({ anchor: { x: 8, y: 2 } })
    store.undo()
    expect(store.canRedo).toBe(true)

    store.cancelDrawing()
    expect(store.canRedo).toBe(false)
    expect(store.draftPathNodes).toHaveLength(0)
    store.undo()
    expect(store.shapes).toHaveLength(countAfterCircle - 1)
  })

  it('取消草稿后撤销期间的参数修改不会恢复草稿', () => {
    const store = useEditorStore()
    store.activeTool = 'path'
    store.addDraftPathNode({ anchor: { x: 2, y: 2 } })
    store.setGaugeInputValue('sampleStitches', 12)
    store.addDraftPathNode({ anchor: { x: 8, y: 2 } })

    store.cancelDrawing()
    store.undo()
    expect(store.gaugeInput.sampleStitches).toBe(10)
    expect(store.draftPathNodes).toHaveLength(0)
    store.redo()
    expect(store.gaugeInput.sampleStitches).toBe(12)
    expect(store.draftPathNodes).toHaveLength(0)
  })

  it('编织参数、画布尺寸、离散策略和编织方向均按步骤撤销', () => {
    const store = useEditorStore()
    const shapeId = store.shapes[0]!.id
    store.setGaugeInputValue('sampleStitches', 12)
    store.setFabricValue('widthCm', 42)
    store.setRasterOptions({ mode: 'inside' })
    store.setShapeDirection(shapeId, 'top-down')

    expect(store.direction).toBe('top-down')
    store.undo()
    expect(store.direction).toBe('bottom-up')
    store.undo()
    expect(store.rasterOptions.mode).toBe('center')
    store.undo()
    expect(store.fabric.widthCm).toBe(30)
    store.undo()
    expect(store.gaugeInput.sampleStitches).toBe(10)

    store.redo()
    store.redo()
    store.redo()
    store.redo()
    expect(store.gaugeInput.sampleStitches).toBe(12)
    expect(store.fabric.widthCm).toBe(42)
    expect(store.rasterOptions.mode).toBe('inside')
    expect(store.direction).toBe('top-down')
  })

  it('最多保留最近 100 个操作步骤', () => {
    const store = useEditorStore()
    for (let value = 11; value <= 111; value += 1) {
      store.setGaugeInputValue('sampleStitches', value)
    }
    for (let index = 0; index < 100; index += 1) store.undo()

    expect(store.gaugeInput.sampleStitches).toBe(11)
    expect(store.canUndo).toBe(false)
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

})
