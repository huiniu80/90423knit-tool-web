export const SIDEBAR_EXPANDED_STORAGE_KEY = 'knitting-pattern-planner:sidebar-expanded:v1'

interface PreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function getBrowserStorage(): PreferenceStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function loadSidebarExpanded(
  storage: PreferenceStorage | null = getBrowserStorage(),
): boolean {
  if (!storage) return true
  try {
    const value = storage.getItem(SIDEBAR_EXPANDED_STORAGE_KEY)
    return value === null ? true : value !== 'false'
  } catch {
    return true
  }
}

export function saveSidebarExpanded(
  expanded: boolean,
  storage: PreferenceStorage | null = getBrowserStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.setItem(SIDEBAR_EXPANDED_STORAGE_KEY, String(expanded))
    return true
  } catch {
    return false
  }
}
