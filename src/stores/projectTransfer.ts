import type { PersistedEditorDocument, PersistedProject } from './editor.persistence'
import { migrateEditorDocument } from './editor.persistence'
import { createCalculationSnapshot, isCalculationSnapshot } from '../core/knitting/calculationSnapshot'
import type { CalculationSnapshot } from '../core/knitting/calculationSnapshot'

export const PROJECT_FILE_FORMAT = 'knitting-pattern-planner/project'
export const PROJECT_FILE_VERSION = 2

export interface ExportedProjectFileV1 {
  format: typeof PROJECT_FILE_FORMAT
  version: typeof PROJECT_FILE_VERSION
  exportedAt: string
  project: {
    name: string
    document: PersistedEditorDocument
    calculationSnapshot?: CalculationSnapshot
  }
}

export type ProjectFileParseResult =
  | { ok: true; file: ExportedProjectFileV1; upgraded?: boolean }
  | { ok: false; reason: 'invalid-json' | 'invalid-file' | 'unsupported-version' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function hasConsistentDocumentReferences(document: PersistedEditorDocument): boolean {
  const shapeIds = new Set(document.shapes.map((shape) => shape.id))
  return Object.keys(document.shapeDirections).every((shapeId) => shapeIds.has(shapeId))
    && Object.keys(document.shapeRoundingPolicies).every((shapeId) => shapeIds.has(shapeId))
    && (document.selectedShapeId === null || shapeIds.has(document.selectedShapeId))
    && (document.selectedPlanShapeId === null || shapeIds.has(document.selectedPlanShapeId))
}

export function createProjectFile(
  project: Pick<PersistedProject, 'name' | 'document'>,
  exportedAt = new Date().toISOString(),
): ExportedProjectFileV1 {
  const document = clonePlain(project.document)
  document.rasterOptions.mode = 'center'
  document.shapeDirections = Object.fromEntries(Object.keys(document.shapeDirections).map((id) => [id, 'bottom-up']))
  delete document.rasterRuleNoticePending
  const snapshot = createCalculationSnapshot(document, exportedAt)
  if (!isCalculationSnapshot(snapshot)) throw Error('计算快照无效或规模过大，无法导出。')
  return {
    format: PROJECT_FILE_FORMAT,
    version: PROJECT_FILE_VERSION,
    exportedAt,
    project: {
      name: project.name,
      document,
      calculationSnapshot: snapshot,
    },
  }
}

export function serializeProjectFile(file: ExportedProjectFileV1): string {
  return JSON.stringify(file, null, 2)
}

export function parseProjectFile(serialized: string): ProjectFileParseResult {
  if (serialized.length > 100_000_000) return { ok: false, reason: 'invalid-file' }
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }

  if (!isRecord(value) || value.format !== PROJECT_FILE_FORMAT) {
    return { ok: false, reason: 'invalid-file' }
  }
  if (value.version !== 1 && value.version !== PROJECT_FILE_VERSION) {
    return { ok: false, reason: 'unsupported-version' }
  }
  if (!isRecord(value.project)
    || typeof value.project.name !== 'string'
    || !value.project.name.trim()
    || typeof value.exportedAt !== 'string'
    || Number.isNaN(Date.parse(value.exportedAt))
  ) {
    return { ok: false, reason: 'invalid-file' }
  }
  const document = migrateEditorDocument(value.project.document)
  if (!document || !hasConsistentDocumentReferences(document)) return { ok: false, reason: 'invalid-file' }
  if (value.project.calculationSnapshot !== undefined && !isCalculationSnapshot(value.project.calculationSnapshot)) return { ok: false, reason: 'invalid-file' }
  return {
    ok: true,
    ...((value.version !== PROJECT_FILE_VERSION || (isRecord(value.project.document) && value.project.document.version !== document.version)) ? { upgraded: true } : {}),
    file: {
      ...(value as unknown as ExportedProjectFileV1),
      version: PROJECT_FILE_VERSION,
      project: { name: value.project.name, document, ...(value.project.calculationSnapshot ? { calculationSnapshot: value.project.calculationSnapshot as CalculationSnapshot } : {}) },
    },
  }
}
