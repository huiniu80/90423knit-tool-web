import { describe, expect, it } from 'vitest'
import type { PersistedProject } from './editor.persistence'
import { EDITOR_DOCUMENT_VERSION } from './editor.persistence'
import { CALCULATION_RULE_VERSION, createCalculationSnapshot, isCalculationSnapshot, sourceFingerprint } from '../core/knitting/calculationSnapshot'
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
  it('同次源导出有效快照、规则版本和结束平收，重新导出替换旧快照', () => {
    const project = projectFixture()
    const file = createProjectFile(project, '2026-10-16T02:00:00.000Z')
    const snapshot = file.project.calculationSnapshot!
    expect(snapshot.calculatedAt).toBe(file.exportedAt)
    expect(snapshot.ruleVersion).toBe(CALCULATION_RULE_VERSION)
    expect(snapshot.sourceFingerprint).toBe(sourceFingerprint(file.project.document))
    expect(isCalculationSnapshot(snapshot)).toBe(true)
    expect(snapshot.pieces[0]!.instructions.at(-1)!.finishOperations![0]!.kind).toBe('bind-off')
    const old = JSON.stringify(snapshot)
    project.document.gaugeInput.sampleRows = 30
    const newer = createProjectFile(project).project.calculationSnapshot!
    expect(newer.pieces[0]!.instructions.length).not.toBe(snapshot.pieces[0]!.instructions.length)
    expect(JSON.stringify(snapshot)).toBe(old)
  })
  it('没有快照的旧文件保持兼容，历史规则版本可只读保存', () => {
    const file = createProjectFile(projectFixture())
    file.project.calculationSnapshot!.ruleVersion = 'historical-older-rule'
    expect(parseProjectFile(serializeProjectFile(file)).ok).toBe(true)
    delete file.project.calculationSnapshot
    expect(parseProjectFile(serializeProjectFile(file)).ok).toBe(true)
  })
  it('无效织片保留真实状态而不带有效逐行表，镜像针格保留原轴偏移', () => {
    const project = projectFixture()
    project.document.shapes.push({ id: 'open', type: 'path', closed: false, nodes: [{ anchor: { x: 1, y: 1 } }, { anchor: { x: 4, y: 8 } }] })
    project.document.shapes[0] = { id: 'front-piece', type: 'path', closed: true, editConstraint: { type: 'vertical-mirror', axisX: 20.3 }, nodes: [{ anchor: { x: 12.8, y: 10 } }, { anchor: { x: 27.8, y: 10 } }, { anchor: { x: 24.3, y: 20 } }, { anchor: { x: 16.3, y: 20 } }] }
    const snapshot = createCalculationSnapshot(project.document)
    expect(snapshot.pieces[1]!.status).toContain('未闭合')
    expect(snapshot.pieces[1]!.instructions).toEqual([])
    expect(snapshot.pieces[0]!.rasterRows[0]!.originXCm).toBeDefined()
    expect(snapshot.pieces[0]!.rasterRows.every(row => row.stitchCount % 2 === 0)).toBe(true)
    expect(isCalculationSnapshot(snapshot)).toBe(true)
  })
  it('快照针数、操作冲突、无穷尺寸和超量操作拒绝导入，不信任历史内容', () => {
    for (const mutate of [
      (s: ReturnType<typeof createCalculationSnapshot>) => { s.pieces[0]!.rasterRows[0]!.stitchCount++ },
      (s: ReturnType<typeof createCalculationSnapshot>) => { s.pieces[0]!.instructions[1]!.operations = s.pieces[0]!.instructions[0]!.operations },
      (s: ReturnType<typeof createCalculationSnapshot>) => { s.pieces[0]!.appearance.width = Infinity },
      (s: ReturnType<typeof createCalculationSnapshot>) => { s.pieces[0]!.instructions[0]!.operations = Array(11).fill(s.pieces[0]!.instructions[0]!.operations![0]) },
    ]) {
      const file = createProjectFile(projectFixture())
      mutate(file.project.calculationSnapshot!)
      expect(parseProjectFile(serializeProjectFile(file)).ok).toBe(false)
    }
  })
  it('最高行数的宽针格文件可安全往返，计算引用不因排版改变', () => {
    const project = projectFixture()
    project.document.fabric = { widthCm: 60, heightCm: 300 }
    project.document.gaugeInput = { sampleStitches: 200, sampleRows: 100, sampleWidthCm: 20, sampleHeightCm: 10 }
    project.document.shapes = [{ id: 'front-piece', type: 'rectangle', x: 0, y: 0, widthCm: 60, heightCm: 300 }]
    const file = createProjectFile(project)
    expect(file.project.calculationSnapshot!.pieces[0]!.instructions).toHaveLength(3000)
    const serialized = serializeProjectFile(file)
    expect(serialized.length).toBeLessThan(10_000_000)
    expect(parseProjectFile(serialized).ok).toBe(true)
    const fingerprint = sourceFingerprint(project.document)
    project.document.cardPositions = { 'front-piece:0': { x: 4, y: 5 } }
    expect(sourceFingerprint(project.document)).toBe(fingerprint)
  })
  it('旧文件升级有说明，新文件往返不假报升级', () => {
    const current = createProjectFile(projectFixture())
    expect(parseProjectFile(serializeProjectFile(current))).toEqual({ ok: true, file: current })
    const old = { ...current, version: 1 }
    const parsed = parseProjectFile(JSON.stringify(old))
    expect(parsed.ok && parsed.upgraded).toBe(true)
  })
  it('旧方向安全迁移为自下而上，轮廓与取整覆盖保持不变', () => {
    const project = projectFixture()
    const legacy = createProjectFile(project)
    legacy.project.document.shapeDirections['front-piece'] = 'top-down'
    const parsed = parseProjectFile(JSON.stringify(legacy))
    if (!parsed.ok) throw new Error('legacy fixture rejected')
    expect(parsed.file.project.document.shapeDirections['front-piece']).toBe('bottom-up')
    expect(parsed.file.project.document.shapes).toEqual(project.document.shapes)
    expect(parsed.file.project.document.shapeRoundingPolicies).toEqual(project.document.shapeRoundingPolicies)
  })
  it.each(['inside', 'outside'] as const)('导入旧 %s 策略后重算中心，重新导出不携带待展示提示', (mode) => {
    const project = projectFixture()
    const file = createProjectFile(project)
    file.project.document.rasterOptions.mode = mode
    const parsed = parseProjectFile(serializeProjectFile(file))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.file.project.document.rasterOptions.mode).toBe('center')
    expect(parsed.file.project.document.shapes).toEqual(project.document.shapes)
    expect(parsed.file.project.document.rasterRuleNoticePending).toBe(true)
    const exported = createProjectFile(parsed.file.project)
    expect(exported.project.document.rasterRuleNoticePending).toBeUndefined()
    expect(exported.project.document.rasterOptions.mode).toBe('center')
  })
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
