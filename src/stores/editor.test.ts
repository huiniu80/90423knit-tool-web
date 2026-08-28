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

  it('导出数据使用 version 1 格式并可再次导入', () => {
    const store = useEditorStore()
    store.direction = 'top-down'
    const project = store.exportProject()

    expect(project.version).toBe(1)
    expect(project.direction).toBe('top-down')

    store.shapes = []
    store.importProject(project)
    expect(store.shapes).toHaveLength(project.shapes.length)
    expect(store.direction).toBe('top-down')
  })

  it('拒绝不支持的项目版本', () => {
    const store = useEditorStore()
    const project = store.exportProject()
    expect(() => store.importProject({ ...project, version: 2 } as never)).toThrow(
      '不支持的项目文件版本',
    )
  })
})
