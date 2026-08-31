import type { PersistedEditorDocument, PersistedProject } from './editor.persistence'
import { migrateEditorDocument } from './editor.persistence'

export const PROJECT_FILE_FORMAT = 'knitting-pattern-planner/project'
export const PROJECT_FILE_VERSION = 2

export interface ExportedProjectFileV1 {
  format: typeof PROJECT_FILE_FORMAT
  version: typeof PROJECT_FILE_VERSION
  exportedAt: string
  project: {
    name: string
    document: PersistedEditorDocument
  }
}

export type ProjectFileParseResult =
  | { ok: true; file: ExportedProjectFileV1 }
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
  return {
    format: PROJECT_FILE_FORMAT,
    version: PROJECT_FILE_VERSION,
    exportedAt,
    project: {
      name: project.name,
      document: clonePlain(project.document),
    },
  }
}

export function serializeProjectFile(file: ExportedProjectFileV1): string {
  return JSON.stringify(file, null, 2)
}

export function parseProjectFile(serialized: string): ProjectFileParseResult {
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
  return {
    ok: true,
    file: {
      ...(value as unknown as ExportedProjectFileV1),
      version: PROJECT_FILE_VERSION,
      project: { name: value.project.name, document },
    },
  }
}
