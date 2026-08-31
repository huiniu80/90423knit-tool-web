import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PersistedEditorDocument, PersistedProjectLibrary } from './editor.persistence'
import {
  EDITOR_DOCUMENT_VERSION,
  EDITOR_STORAGE_KEY,
  PROJECT_LIBRARY_STORAGE_KEY,
  PROJECT_LIBRARY_VERSION,
  installProjectAutoSave,
  loadEditorDocument,
  loadProjectLibrary,
  saveProjectLibrary,
  saveEditorDocument,
} from './editor.persistence'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
  removeItem(key: string): void {
    this.values.delete(key)
  }
}

class PageTarget {
  private listener: (() => void) | null = null
  addEventListener(_type: 'pagehide', listener: () => void): void {
    this.listener = listener
  }
  removeEventListener(_type: 'pagehide', listener: () => void): void {
    if (this.listener === listener) this.listener = null
  }
  pageHide(): void {
    this.listener?.()
  }
}

function documentFixture(): PersistedEditorDocument {
  return {
    version: EDITOR_DOCUMENT_VERSION,
    savedAt: '2026-08-30T00:00:00.000Z',
    gaugeInput: {
      sampleStitches: 20,
      sampleRows: 24,
      sampleWidthCm: 10,
      sampleHeightCm: 10,
    },
    fabric: { widthCm: 40, heightCm: 60 },
    shapes: [{
      id: 'front-piece',
      name: '前片',
      type: 'rectangle',
      x: 5,
      y: 4,
      widthCm: 30,
      heightCm: 50,
    }],
    shapeDirections: { 'front-piece': 'top-down' },
    rasterOptions: { mode: 'inside', symmetryOptimization: false },
    selectedShapeId: 'front-piece',
    selectedPlanShapeId: 'front-piece',
  }
}

function libraryFixture(): PersistedProjectLibrary {
  return {
    version: PROJECT_LIBRARY_VERSION,
    activeProjectId: 'project-1',
    projects: [{
      id: 'project-1',
      name: '前片方案',
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
      document: documentFixture(),
    }],
  }
}

afterEach(() => vi.useRealTimers())

describe('编辑器本地持久化', () => {
  it('可保存并读取版本化文档', () => {
    const storage = new MemoryStorage()
    const document = documentFixture()

    expect(saveEditorDocument(document, storage)).toBe(true)
    expect(loadEditorDocument(storage)).toEqual(document)
  })

  it.each([
    '{broken json',
    JSON.stringify({ ...documentFixture(), version: 2 }),
    JSON.stringify({ ...documentFixture(), shapes: [{ id: 'bad', type: 'circle', radiusCm: -1 }] }),
  ])('损坏、不支持或非法的存档会被删除并安全回退', (serialized) => {
    const storage = new MemoryStorage()
    storage.values.set(EDITOR_STORAGE_KEY, serialized)

    expect(loadEditorDocument(storage)).toBeNull()
    expect(storage.getItem(EDITOR_STORAGE_KEY)).toBeNull()
  })

  it('存储读写异常不会向编辑器抛出', () => {
    const unavailableStorage = {
      getItem: (): string | null => { throw new Error('blocked') },
      setItem: (): void => { throw new Error('full') },
      removeItem: (): void => { throw new Error('blocked') },
    }

    expect(loadEditorDocument(unavailableStorage)).toBeNull()
    expect(saveEditorDocument(documentFixture(), unavailableStorage)).toBe(false)
    expect(saveProjectLibrary(libraryFixture(), unavailableStorage)).toBe(false)
  })

  it('方案库会隔离损坏项目并回退到最近有效方案', () => {
    const storage = new MemoryStorage()
    const library = libraryFixture()
    storage.setItem(PROJECT_LIBRARY_STORAGE_KEY, JSON.stringify({
      ...library,
      activeProjectId: 'damaged',
      projects: [
        ...library.projects,
        { id: 'damaged', name: '损坏方案', createdAt: '', updatedAt: '', document: { version: 99 } },
      ],
    }))

    expect(loadProjectLibrary(storage)).toEqual(library)
  })

  it('连续修改只在防抖结束后保存一次', () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    const setItem = vi.spyOn(storage, 'setItem')
    const autoSave = installProjectAutoSave({
      createLibrary: libraryFixture,
      storage,
      delayMs: 300,
    })

    autoSave.schedule()
    vi.advanceTimersByTime(200)
    autoSave.schedule()
    vi.advanceTimersByTime(299)
    expect(setItem).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(setItem).toHaveBeenCalledTimes(1)
    autoSave.dispose()
  })

  it('pagehide 会立即补写最新状态并取消等待中的保存', () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    const pageTarget = new PageTarget()
    const setItem = vi.spyOn(storage, 'setItem')
    const autoSave = installProjectAutoSave({
      createLibrary: libraryFixture,
      storage,
      pageLifecycleTarget: pageTarget,
      delayMs: 300,
    })

    autoSave.schedule()
    pageTarget.pageHide()
    expect(setItem).toHaveBeenCalledTimes(1)
    vi.runAllTimers()
    expect(setItem).toHaveBeenCalledTimes(1)
    autoSave.dispose()
  })
})
