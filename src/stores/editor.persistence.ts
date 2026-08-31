import type { GaugeInput, FabricCanvas } from '../core/gauge/gauge.types'
import type { PathNode, Point, Shape } from '../core/geometry/shape.types'
import type { KnitDirection } from '../core/knitting/planner.types'
import type { RasterOptions } from '../core/raster/raster.types'
import type { ViewMode } from './editor.types'

/** Legacy single-document key. Kept only for one-time migration. */
export const EDITOR_STORAGE_KEY = 'knitting-pattern-planner:editor:v1'
export const PROJECT_LIBRARY_STORAGE_KEY = 'knitting-pattern-planner:projects:v1'
export const EDITOR_DOCUMENT_VERSION = 1
export const PROJECT_LIBRARY_VERSION = 1
export const MAX_PROJECTS = 5
export const EDITOR_AUTOSAVE_DELAY_MS = 300

export interface PersistedEditorDocument {
  version: typeof EDITOR_DOCUMENT_VERSION
  savedAt: string
  gaugeInput: GaugeInput
  fabric: FabricCanvas
  shapes: Shape[]
  shapeDirections: Record<string, KnitDirection>
  rasterOptions: RasterOptions
  /** Optional for compatibility with projects saved before display-mode persistence. */
  viewMode?: ViewMode
  selectedShapeId: string | null
  selectedPlanShapeId: string | null
}

export interface PersistedProject {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  document: PersistedEditorDocument
}

export interface PersistedProjectLibrary {
  version: typeof PROJECT_LIBRARY_VERSION
  activeProjectId: string
  projects: PersistedProject[]
}

export interface EditorStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface PageLifecycleTarget {
  addEventListener(type: 'pagehide', listener: () => void): void
  removeEventListener(type: 'pagehide', listener: () => void): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0
}

function isPoint(value: unknown): value is Point {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y)
}

function isPathNode(value: unknown): value is PathNode {
  return isRecord(value)
    && isPoint(value.anchor)
    && (value.inControl === undefined || isPoint(value.inControl))
    && (value.outControl === undefined || isPoint(value.outControl))
}

function hasValidBaseShape(value: Record<string, unknown>): boolean {
  return typeof value.id === 'string'
    && value.id.length > 0
    && (value.name === undefined || typeof value.name === 'string')
}

function isShape(value: unknown): value is Shape {
  if (!isRecord(value) || !hasValidBaseShape(value)) return false

  switch (value.type) {
    case 'rectangle':
      return isFiniteNumber(value.x) && isFiniteNumber(value.y)
        && isPositiveNumber(value.widthCm) && isPositiveNumber(value.heightCm)
    case 'triangle':
      return Array.isArray(value.points) && value.points.length === 3 && value.points.every(isPoint)
    case 'circle':
      return isPoint(value.center) && isPositiveNumber(value.radiusCm)
    case 'ellipse':
      return isPoint(value.center) && isPositiveNumber(value.radiusXcm) && isPositiveNumber(value.radiusYcm)
    case 'polygon':
      return Array.isArray(value.points) && value.points.length >= 3 && value.points.every(isPoint)
    case 'path':
      return Array.isArray(value.nodes)
        && value.nodes.length >= (value.closed === true ? 3 : 2)
        && value.nodes.every(isPathNode)
        && typeof value.closed === 'boolean'
    default:
      return false
  }
}

function isGaugeInput(value: unknown): value is GaugeInput {
  return isRecord(value)
    && isPositiveNumber(value.sampleStitches)
    && isPositiveNumber(value.sampleRows)
    && isPositiveNumber(value.sampleWidthCm)
    && isPositiveNumber(value.sampleHeightCm)
}

function isFabric(value: unknown): value is FabricCanvas {
  return isRecord(value) && isPositiveNumber(value.widthCm) && isPositiveNumber(value.heightCm)
}

function isShapeDirections(value: unknown): value is Record<string, KnitDirection> {
  return isRecord(value) && Object.values(value).every(
    (direction) => direction === 'bottom-up' || direction === 'top-down',
  )
}

function isRasterOptions(value: unknown): value is RasterOptions {
  return isRecord(value)
    && (value.mode === 'center' || value.mode === 'inside' || value.mode === 'outside')
    && typeof value.symmetryOptimization === 'boolean'
}

function isOptionalId(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value))
}

export function isPersistedEditorDocument(value: unknown): value is PersistedEditorDocument {
  if (!isRecord(value)
    || value.version !== EDITOR_DOCUMENT_VERSION
    || !isValidTimestamp(value.savedAt)
    || !isGaugeInput(value.gaugeInput)
    || !isFabric(value.fabric)
    || !Array.isArray(value.shapes)
    || !value.shapes.every(isShape)
    || !isShapeDirections(value.shapeDirections)
    || !isRasterOptions(value.rasterOptions)
    || (value.viewMode !== undefined
      && value.viewMode !== 'outline'
      && value.viewMode !== 'grid'
      && value.viewMode !== 'overlay')
    || !isOptionalId(value.selectedShapeId)
    || !isOptionalId(value.selectedPlanShapeId)) return false

  return new Set(value.shapes.map((shape) => shape.id)).size === value.shapes.length
}

function isPersistedProject(value: unknown): value is PersistedProject {
  return isRecord(value)
    && typeof value.id === 'string' && value.id.length > 0
    && typeof value.name === 'string' && value.name.trim().length > 0
    && isValidTimestamp(value.createdAt)
    && isValidTimestamp(value.updatedAt)
    && isPersistedEditorDocument(value.document)
}

export function getBrowserEditorStorage(): EditorStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function readStorageValue(storage: EditorStorage | null, key: string): unknown | null | undefined {
  if (!storage) return null
  try {
    const serialized = storage.getItem(key)
    return serialized === null ? null : JSON.parse(serialized)
  } catch {
    return undefined
  }
}

export function loadEditorDocument(
  storage: EditorStorage | null = getBrowserEditorStorage(),
): PersistedEditorDocument | null {
  const value = readStorageValue(storage, EDITOR_STORAGE_KEY)
  if (value === null) return null
  if (isPersistedEditorDocument(value)) return value
  try { storage?.removeItem(EDITOR_STORAGE_KEY) } catch { /* startup must continue */ }
  return null
}

export function saveEditorDocument(
  document: PersistedEditorDocument,
  storage: EditorStorage | null = getBrowserEditorStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.setItem(EDITOR_STORAGE_KEY, JSON.stringify(document))
    return true
  } catch {
    return false
  }
}

/** Loads valid projects individually so one damaged project cannot discard the whole library. */
export function loadProjectLibrary(
  storage: EditorStorage | null = getBrowserEditorStorage(),
): PersistedProjectLibrary | null {
  const value = readStorageValue(storage, PROJECT_LIBRARY_STORAGE_KEY)
  if (value === null) return null
  if (!isRecord(value) || value.version !== PROJECT_LIBRARY_VERSION || !Array.isArray(value.projects)) {
    try { storage?.removeItem(PROJECT_LIBRARY_STORAGE_KEY) } catch { /* startup must continue */ }
    return null
  }

  const seen = new Set<string>()
  const projects = value.projects.filter((project): project is PersistedProject => {
    if (!isPersistedProject(project) || seen.has(project.id)) return false
    seen.add(project.id)
    return true
  }).slice(0, MAX_PROJECTS)
  if (!projects.length) return null

  const requestedActiveId = typeof value.activeProjectId === 'string' ? value.activeProjectId : ''
  const activeProjectId = projects.some((project) => project.id === requestedActiveId)
    ? requestedActiveId
    : [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0].id
  return { version: PROJECT_LIBRARY_VERSION, activeProjectId, projects }
}

export function saveProjectLibrary(
  library: PersistedProjectLibrary,
  storage: EditorStorage | null = getBrowserEditorStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.setItem(PROJECT_LIBRARY_STORAGE_KEY, JSON.stringify(library))
    return true
  } catch {
    return false
  }
}

export function removeLegacyEditorDocument(storage: EditorStorage | null): void {
  try { storage?.removeItem(EDITOR_STORAGE_KEY) } catch { /* migration has already succeeded */ }
}

export function installProjectAutoSave(options: {
  createLibrary: () => PersistedProjectLibrary
  storage?: EditorStorage | null
  pageLifecycleTarget?: PageLifecycleTarget | null
  delayMs?: number
  onSave?: (saved: boolean) => void
}): { schedule: () => void; flush: () => boolean; dispose: () => void } {
  const storage = options.storage === undefined ? getBrowserEditorStorage() : options.storage
  const delayMs = options.delayMs ?? EDITOR_AUTOSAVE_DELAY_MS
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = (): boolean => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    const saved = saveProjectLibrary(options.createLibrary(), storage)
    options.onSave?.(saved)
    return saved
  }
  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(flush, delayMs)
  }
  const handlePageHide = (): void => { flush() }
  options.pageLifecycleTarget?.addEventListener('pagehide', handlePageHide)

  return {
    schedule,
    flush,
    dispose: () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
      options.pageLifecycleTarget?.removeEventListener('pagehide', handlePageHide)
    },
  }
}
