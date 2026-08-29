import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorStore } from './editor'

describe('Editor Store', () => {
  beforeEach(() => setActivePinia(createPinia()))

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

  it('导入项目后指令对象回到首个有效图形', () => {
    const store = useEditorStore()
    store.addDefaultShape('rectangle')
    const project = store.exportProject()
    store.addDefaultShape('circle')
    store.importProject(project)
    expect(store.selectedPlanShapeId).toBe(project.shapes[0]?.id)
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

  it('导出数据使用 version 3 格式并保留各对象方向', () => {
    const store = useEditorStore()
    const firstShapeId = store.shapes[0]!.id
    store.direction = 'top-down'
    const project = store.exportProject()

    expect(project.version).toBe(3)
    expect(project.shapeDirections[firstShapeId]).toBe('top-down')

    store.shapes = []
    store.importProject(project)
    expect(store.shapes).toHaveLength(project.shapes.length)
    expect(store.direction).toBe('top-down')
  })

  it('拒绝不支持的项目版本', () => {
    const store = useEditorStore()
    const project = store.exportProject()
    expect(() => store.importProject({ ...project, version: 4 } as never)).toThrow(
      '不支持的项目文件版本',
    )
  })

  it('继续接受 version 1 项目文件并迁移全局方向', () => {
    const store = useEditorStore()
    const current = store.exportProject()
    const project = {
      version: 1 as const,
      gauge: current.gauge,
      canvas: current.canvas,
      direction: 'top-down' as const,
      rasterOptions: current.rasterOptions,
      shapes: current.shapes,
    }
    store.shapes = []
    store.importProject(project)
    expect(store.shapes.length).toBeGreaterThan(0)
    expect(store.shapePlans.every((plan) => plan.direction === 'top-down')).toBe(true)
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

  it('拒绝无效的路径数据', () => {
    const store = useEditorStore()
    const project = store.exportProject()
    project.shapes = [{
      id: 'bad-path', type: 'path', closed: true,
      nodes: [{ anchor: { x: 1, y: 1 } }, { anchor: { x: 2, y: 2 } }],
    }]
    expect(() => store.importProject(project)).toThrow('路径数据无效')
  })
})
