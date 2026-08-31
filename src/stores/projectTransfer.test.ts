import { describe, expect, it } from 'vitest'
import type { PersistedProject } from './editor.persistence'
import { EDITOR_DOCUMENT_VERSION } from './editor.persistence'
import {
  PROJECT_FILE_FORMAT,
  createProjectFile,
  parseProjectFile,
  serializeProjectFile,
} from './projectTransfer'

function projectFixture(): PersistedProject {
  return {
    id: 'source-project-id',
    name: '前片方案',
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
    document: {
      version: EDITOR_DOCUMENT_VERSION,
      savedAt: '2026-08-30T00:00:00.000Z',
      gaugeInput: { sampleStitches: 20, sampleRows: 24, sampleWidthCm: 10, sampleHeightCm: 10 },
      fabric: { widthCm: 40, heightCm: 60 },
      shapes: [{
        id: 'front-piece', name: '前片', type: 'rectangle',
        x: 5, y: 4, widthCm: 30, heightCm: 50,
      }],
      shapeDirections: { 'front-piece': 'top-down' },
      shapeRoundingPolicies: { 'front-piece': { stitches: 'ceil', rows: null } },
      rasterOptions: { mode: 'inside', symmetryOptimization: false },
      selectedShapeId: 'front-piece',
      selectedPlanShapeId: 'front-piece',
    },
  }
}

describe('编织方案文件', () => {
  it('只导出名称和完整编辑文档，不携带来源项目 ID', () => {
    const project = projectFixture()
    const file = createProjectFile(project, '2026-08-31T01:02:03.000Z')
    const parsed = parseProjectFile(serializeProjectFile(file))

    expect(parsed).toEqual({ ok: true, file })
    expect(JSON.stringify(file)).not.toContain('source-project-id')
  })

  it('区分损坏 JSON、普通 JSON 和未知版本', () => {
    expect(parseProjectFile('{broken')).toEqual({ ok: false, reason: 'invalid-json' })
    expect(parseProjectFile('{}')).toEqual({ ok: false, reason: 'invalid-file' })
    expect(parseProjectFile(JSON.stringify({
      ...createProjectFile(projectFixture()),
      format: PROJECT_FILE_FORMAT,
      version: 99,
    }))).toEqual({ ok: false, reason: 'unsupported-version' })
  })

  it.each([
    { shapes: [{ id: 'same', type: 'circle', center: { x: 2, y: 2 }, radiusCm: 1 }, { id: 'same', type: 'circle', center: { x: 4, y: 4 }, radiusCm: 1 }] },
    { gaugeInput: { sampleStitches: -1, sampleRows: 10, sampleWidthCm: 10, sampleHeightCm: 10 } },
    { selectedShapeId: 'missing' },
  ])('拒绝非法文档 %#', (documentPatch) => {
    const file = createProjectFile(projectFixture())
    const serialized = JSON.stringify({
      ...file,
      project: { ...file.project, document: { ...file.project.document, ...documentPatch } },
    })

    expect(parseProjectFile(serialized)).toEqual({ ok: false, reason: 'invalid-file' })
  })
})
