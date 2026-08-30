import { describe, expect, it } from 'vitest'
import {
  loadSidebarExpanded,
  saveSidebarExpanded,
  SIDEBAR_EXPANDED_STORAGE_KEY,
} from './editorLayoutPreferences'

function createStorage(initialValue: string | null = null) {
  let value = initialValue
  return {
    getItem: (key: string) => key === SIDEBAR_EXPANDED_STORAGE_KEY ? value : null,
    setItem: (key: string, nextValue: string) => {
      if (key === SIDEBAR_EXPANDED_STORAGE_KEY) value = nextValue
    },
  }
}

describe('编辑器布局偏好', () => {
  it('首次访问默认展开侧栏，并能记住用户选择', () => {
    const storage = createStorage()
    expect(loadSidebarExpanded(storage)).toBe(true)

    expect(saveSidebarExpanded(false, storage)).toBe(true)
    expect(loadSidebarExpanded(storage)).toBe(false)

    expect(saveSidebarExpanded(true, storage)).toBe(true)
    expect(loadSidebarExpanded(storage)).toBe(true)
  })

  it('存储不可用时安全回退为展开状态', () => {
    const storage = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    }
    expect(loadSidebarExpanded(storage)).toBe(true)
    expect(saveSidebarExpanded(false, storage)).toBe(false)
    expect(loadSidebarExpanded(null)).toBe(true)
  })
})
