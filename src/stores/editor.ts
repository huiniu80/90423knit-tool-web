import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { defineStore } from 'pinia'
import { calculateFabricGrid, calculateGauge } from '../core/gauge/gauge'
import { assessGrid } from '../core/gauge/gridConstraints'
import type { GridAssessment } from '../core/gauge/gridConstraints'
import {
  createShapeDimensionResults,
  createOverallDimensionResults,
  selectedShapeCounts,
} from '../core/dimensions/dimensionConversion'
import type {
  DimensionAxis,
  RoundingDirection,
  ShapeRoundingPolicy,
} from '../core/dimensions/dimensionConversion'
import type { GaugeInput, FabricCanvas } from '../core/gauge/gauge.types'
import type { PathNode, PathShape, Point, Shape, ShapeType } from '../core/geometry/shape.types'
import { joinConnectedOpenPaths } from '../core/geometry/path'
import { shapeCalculationIssue, shapeIssueMessage } from '../core/geometry/shapeValidation'
import { generateInstructions } from '../core/knitting/planner'
import type { OperationOverrides } from '../core/knitting/rowOperations'
import type { KnitDirection } from '../core/knitting/planner.types'
import { mergeRasterRows, rasterize, rasterizeShapes, shapeForRaster } from '../core/raster/rasterizer'
import type { RasterOptions, RasterRow } from '../core/raster/raster.types'
import type {
  EditorTool,
  ShapePlan,
  ViewMode,
} from './editor.types'
import {
  EDITOR_DOCUMENT_VERSION,
  MAX_PROJECTS,
  PROJECT_LIBRARY_VERSION,
  getBrowserEditorStorage,
  installProjectAutoSave,
  loadEditorDocument,
  loadProjectLibrary,
  removeLegacyEditorDocument,
  saveProjectLibrary,
  migrateEditorDocument,
  retainedRecycledProjects,
} from './editor.persistence'
import type {
  PageLifecycleTarget,
  PersistedEditorDocument,
  PersistedProject,
  PersistedProjectLibrary,
  RecycledProject,
} from './editor.persistence'
import { createProjectFile } from './projectTransfer'
import type { ExportedProjectFileV1 } from './projectTransfer'
import { emptyDrawing } from '../core/drawing/types'
import type { DrawingDocument, DrawingTool, PatternPlacement, PatternSample, StitchDefinition, StitchMark } from '../core/drawing/types'
import { effectiveMarks, filledRegion, intersects, isDrawingDocument, replaceMarks, traceContours, uid } from '../core/drawing/drawing'
import { stitchMap } from '../core/drawing/stitches'
import { completeDrawingMarks, drawingBaseMarks } from '../core/drawing/chart'
import { drawingContourDisplays as createContourDisplays } from '../core/drawing/contourDisplay'

export type ProjectImportResult =
  | { status: 'imported'; projectId: string }
  | { status: 'grid-limit'; assessment: GridAssessment }
  | { status: 'capacity' | 'draft' | 'not-found' | 'storage-error' }

export type GridUpdateResult =
  | { ok: true; assessment: GridAssessment }
  | { ok: false; assessment: GridAssessment }

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const cloneShapes = (value: Shape[]): Shape[] => clonePlain(value)

interface HistorySnapshot {
  drawing: DrawingDocument
  operationOverrides: Record<string, OperationOverrides>
  gaugeInput: GaugeInput
  fabric: FabricCanvas
  shapes: Shape[]
  shapeDirections: Record<string, KnitDirection>
  shapeRoundingPolicies: Record<string, ShapeRoundingPolicy>
  rasterOptions: RasterOptions
  selectedShapeId: string | null
  selectedPlanShapeId: string | null
  draftPoints: Point[]
  draftPathNodes: PathNode[]
  draftTool: 'polygon' | 'path' | null
  drawingSessionId: string | null
}

interface HistoryEntry {
  snapshot: HistorySnapshot
  kind: 'content' | 'drawing'
  drawingSessionId: string | null
}

function isFabricShape(shape: Shape): boolean {
  return shape.type !== 'path' || shape.closed
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `shape-${Date.now()}-${Math.random()}`
}

export const useEditorStore = defineStore('editor', () => {
  const storage = getBrowserEditorStorage()
  const defaultGaugeInput: GaugeInput = {
    sampleStitches: 10,
    sampleRows: 10,
    sampleWidthCm: 10,
    sampleHeightCm: 6,
  }
  const defaultFabric: FabricCanvas = { widthCm: 60, heightCm: 70 }
  const defaultRasterOptions: RasterOptions = {
    mode: 'center',
    symmetryOptimization: true,
  }
  function createBlankDocument(savedAt = new Date().toISOString()): PersistedEditorDocument {
    return {
      version: EDITOR_DOCUMENT_VERSION,
      savedAt,
      gaugeInput: clonePlain(defaultGaugeInput),
      fabric: clonePlain(defaultFabric),
      shapes: [],
      shapeDirections: {},
      shapeRoundingPolicies: {},
      rasterOptions: clonePlain(defaultRasterOptions),
      viewMode: 'overlay',
      selectedShapeId: null,
      selectedPlanShapeId: null,
    }
  }

  const loadedLibrary = loadProjectLibrary(storage)
  const legacyDocument = loadedLibrary ? null : loadEditorDocument(storage)
  const startupTime = new Date().toISOString()
  const initialProject: PersistedProject = legacyDocument
    ? {
        id: createId(),
        name: '方案 1',
        createdAt: legacyDocument.savedAt,
        updatedAt: legacyDocument.savedAt,
        document: clonePlain(legacyDocument),
      }
    : {
        id: createId(),
        name: '未命名方案 1',
        createdAt: startupTime,
        updatedAt: startupTime,
        document: createBlankDocument(startupTime),
      }
  const initialLibrary: PersistedProjectLibrary = loadedLibrary ?? {
    version: PROJECT_LIBRARY_VERSION,
    activeProjectId: initialProject.id,
    projects: [initialProject],
  }
  const projects = ref<PersistedProject[]>(clonePlain(initialLibrary.projects))
  const recycleBin = ref<RecycledProject[]>(clonePlain(initialLibrary.recycleBin ?? []))
  const recycleClock = ref(Date.now())
  const recycledProjects = computed(() => retainedRecycledProjects(recycleBin.value, recycleClock.value))
  function refreshRecycleBin(): void { recycleClock.value = Date.now() }
  const recycleTimer = setInterval(refreshRecycleBin, 60_000)
  onScopeDispose(() => clearInterval(recycleTimer))
  const activeProjectId = ref(initialLibrary.activeProjectId)
  const activeInitialProject = projects.value.find(
    (project) => project.id === activeProjectId.value,
  ) ?? projects.value[0]
  const persistedDocument = activeInitialProject.document
  const initialShapes = persistedDocument ? cloneShapes(persistedDocument.shapes) : []
  const validInitialSelection = (shapeId: string | null): string | null => (
    shapeId && initialShapes.some((shape) => shape.id === shapeId)
      ? shapeId
      : initialShapes.at(-1)?.id ?? null
  )

  const gaugeInput = ref<GaugeInput>(
    clonePlain(persistedDocument?.gaugeInput ?? defaultGaugeInput),
  )
  const fabric = ref<FabricCanvas>(clonePlain(persistedDocument?.fabric ?? defaultFabric))
  const shapes = ref<Shape[]>(initialShapes)
  const drawing = ref<DrawingDocument>(clonePlain(persistedDocument.drawing ?? emptyDrawing()))
  const drawingTool = ref<DrawingTool>('paint')
  const activeStitchId = ref('knit')
  const drawingDefinitions = computed(() => stitchMap(drawing.value.definitions))
  const drawingMarks = computed(() => effectiveMarks(drawing.value))
  const placementPreview = ref<PatternPlacement | null>(null)
  const movingPlacementId = ref<string | null>(null)
  const contourPreview = ref(false)
  const contourCandidate = shallowRef<(ReturnType<typeof filledRegion> & { loops: Point[][] }) | null>(null)
  const selectedShapeId = ref<string | null>(
    validInitialSelection(persistedDocument?.selectedShapeId ?? initialShapes[0]?.id ?? null),
  )
  const selectedPlanShapeId = ref<string | null>(
    validInitialSelection(persistedDocument?.selectedPlanShapeId ?? selectedShapeId.value),
  )
  const zoom = ref(20)
  const cardPositions = ref<Record<string, Point>>(clonePlain(persistedDocument.cardPositions ?? {}))
  const operationOverrides = ref<Record<string, OperationOverrides>>(clonePlain(persistedDocument.operationOverrides ?? {}))
  const minimumViewZoom = ref(5)
  const projectOpenRevision = ref(0)
  const shapeDirections = ref<Record<string, KnitDirection>>(
    clonePlain(persistedDocument?.shapeDirections ?? {}),
  )
  const shapeRoundingPolicies = ref<Record<string, ShapeRoundingPolicy>>(
    clonePlain(persistedDocument?.shapeRoundingPolicies ?? {}),
  )
  const rasterOptions = ref<RasterOptions>(
    clonePlain(persistedDocument?.rasterOptions ?? defaultRasterOptions),
  )
  const viewMode = ref<ViewMode>(persistedDocument?.viewMode ?? 'overlay')
  const activeTool = ref<EditorTool>(viewMode.value === 'drawing' ? 'stitch' : 'path')
  const draftPoints = ref<Point[]>([])
  const draftPathNodes = ref<PathNode[]>([])
  const draftTool = ref<'polygon' | 'path' | null>(null)
  const drawingSessionId = ref<string | null>(null)
  const storageStatus = ref<'saved' | 'error'>(storage ? 'saved' : 'error')
  const notice = ref('')
  let noticeTimer: ReturnType<typeof setTimeout> | null = null
  function showNotice(message: string): void {
    if (noticeTimer !== null) clearTimeout(noticeTimer)
    notice.value = message
    noticeTimer = setTimeout(() => { notice.value = ''; noticeTimer = null }, 6000)
  }
  function consumeRasterRuleNotice(document: PersistedEditorDocument): void {
    if (!document.rasterRuleNoticePending) return
    delete document.rasterRuleNoticePending
    showNotice('针格规则已更新，结果可能变化')
  }
  consumeRasterRuleNotice(persistedDocument)
  onScopeDispose(() => { if (noticeTimer !== null) clearTimeout(noticeTimer) })

  const undoStack = ref<HistoryEntry[]>([])
  const redoStack = ref<HistoryEntry[]>([])
  const shapesRevision = ref(0)
  let mutationStart: HistorySnapshot | null = null

  interface CachedShapeRaster {
    shape: Shape
    rasterKey: string
    rows: RasterRow[]
  }

  interface CachedShapeInstructions {
    rows: RasterRow[]
    direction: KnitDirection
    instructions: ReturnType<typeof generateInstructions>
  }

  const rasterCache = new Map<string, CachedShapeRaster>()
  const instructionCache = new Map<string, CachedShapeInstructions>()

  const gauge = computed(() => calculateGauge(gaugeInput.value))
  const fabricGrid = computed(() => calculateFabricGrid(fabric.value, gauge.value))
  const gridAssessment = computed(() => assessGrid(gaugeInput.value, fabric.value))
  const activeProject = computed(
    () => projects.value.find((project) => project.id === activeProjectId.value) ?? null,
  )
  const hasUnfinishedDraft = computed(
    () => draftPoints.value.length > 0 || draftPathNodes.value.length > 0,
  )
  const selectedShape = computed(
    () => shapes.value.find((shape) => shape.id === selectedShapeId.value) ?? null,
  )
  const shapeRasterRows = computed(() => {
    if (gridAssessment.value.status === 'blocked') {
      return shapes.value.map((shape) => ({ shape, rows: [] as RasterRow[], isFabric: isFabricShape(shape) }))
    }
    const rasterKey = [
      gauge.value.stitchWidthCm,
      gauge.value.rowHeightCm,
      fabric.value.widthCm,
      fabric.value.heightCm,
      rasterOptions.value.mode,
      rasterOptions.value.symmetryOptimization,
    ].join('|')
    const liveShapeIds = new Set(shapes.value.map((shape) => shape.id))
    for (const shapeId of rasterCache.keys()) {
      if (!liveShapeIds.has(shapeId)) {
        rasterCache.delete(shapeId)
        instructionCache.delete(shapeId)
      }
    }

    return shapes.value.map((shape) => {
      const isFabric = isFabricShape(shape)
      const policy = shapeRoundingPolicies.value[shape.id] ?? { stitches: null, rows: null }
      const shapeRasterKey = [
        rasterKey,
        directionForShape(shape.id),
        policy.stitches ?? 'pending',
        policy.rows ?? 'pending',
      ].join('|')
      const cached = rasterCache.get(shape.id)
      if (cached?.shape === shape && cached.rasterKey === shapeRasterKey) {
        return { shape, rows: cached.rows, isFabric }
      }
      const counts = selectedShapeCounts(shape, gauge.value, policy)
      const rows = isFabric
        ? rasterize(shape, gauge.value, fabric.value, rasterOptions.value, {
            ...counts,
            direction: directionForShape(shape.id),
          })
        : rasterizeShapes([], gauge.value, fabric.value, rasterOptions.value)
      rasterCache.set(shape.id, { shape, rasterKey: shapeRasterKey, rows })
      return { shape, rows, isFabric }
    })
  })
  const rasterRows = computed(() => gridAssessment.value.status === 'blocked'
    ? []
    : mergeRasterRows(
        shapeRasterRows.value.filter((item) => item.isFabric).map((item) => item.rows),
        gauge.value,
        fabric.value,
      ))
  function directionForShape(_shapeId: string): KnitDirection {
    return 'bottom-up'
  }

  const direction = computed<KnitDirection>({
    get: () => selectedPlanShapeId.value
      ? directionForShape(selectedPlanShapeId.value)
      : 'bottom-up',
    set: (nextDirection) => {
      if (selectedPlanShapeId.value) setShapeDirection(selectedPlanShapeId.value, nextDirection)
    },
  })
  const shapePlans = computed<ShapePlan[]>(() => shapeRasterRows.value.map(({ shape, rows, isFabric }) => {
    const policy = shapeRoundingPolicies.value[shape.id] ?? { stitches: null, rows: null }
    const issue = shapeCalculationIssue(shape, fabric.value) ?? shapeCalculationIssue(
      shapeForRaster(shape, gauge.value, { ...selectedShapeCounts(shape, gauge.value, policy), direction: 'bottom-up' }),
      fabric.value,
    )
    const shapeDirection = directionForShape(shape.id)
    const cachedInstructions = instructionCache.get(shape.id)
    const baseInstructions = cachedInstructions?.rows === rows
      && cachedInstructions.direction === shapeDirection
      ? cachedInstructions.instructions
      : generateInstructions(rows, shapeDirection)
    if (baseInstructions !== cachedInstructions?.instructions) {
      instructionCache.set(shape.id, { rows, direction: shapeDirection, instructions: baseInstructions })
    }
    const planInstructions = Object.keys(operationOverrides.value[shape.id] ?? {}).length
      ? generateInstructions(rows, shapeDirection, operationOverrides.value[shape.id]) : baseInstructions
    const dimensions = createShapeDimensionResults(
      shape,
      gauge.value,
      shapeRoundingPolicies.value[shape.id] ?? { stitches: null, rows: null },
    )
    const activeRows = rows.filter((row) => row.stitchCount > 0)
    const complex = activeRows.length > 0 && planInstructions.length === 0
    const conflict = planInstructions.find(instruction => instruction.conflict)
    const calculationMessage = gridAssessment.value.status === 'blocked' ? '网格超限，已暂停计算'
      : issue ? shapeIssueMessage[issue]
      : conflict ? `第 ${conflict.rowNumber} 行：${conflict.conflict}，已暂停编织计划`
      : complex ? '不支持的复杂断开结构，请修改轮廓'
      : !activeRows.length ? '目标小于当前密度下的一针或一行，未落入针格' : ''
    return {
      shapeId: shape.id,
      shapeName: shape.name,
      shapeType: shape.type,
      direction: shapeDirection,
      rasterRows: rows,
      instructions: planInstructions,
      totalStitches: planInstructions.reduce((sum, item) => sum + item.stitchCount, 0),
      hasSeparatedRegions: rows.some((row) => row.segments.length > 1),
      isFabric,
      dimensions,
      roundingPending: dimensions.some((dimension) => !dimension.confirmed),
      calculationMessage,
      canExport: !calculationMessage,
    }
  }))
  const selectedShapePlan = computed(() =>
    shapePlans.value.find((plan) => plan.shapeId === selectedPlanShapeId.value) ?? null,
  )
  const instructions = computed(() => selectedShapePlan.value?.instructions ?? [])
  const hasSeparatedRegions = computed(() => selectedShapePlan.value?.hasSeparatedRegions ?? false)

  function ensureSelectedPlan(): void {
    if (!shapes.value.some((shape) => shape.id === selectedPlanShapeId.value)) {
      selectedPlanShapeId.value = shapes.value.at(-1)?.id ?? null
    }
  }

  watch(() => shapes.value.map((shape) => shape.id), ensureSelectedPlan)
  watch(selectedShapeId, (shapeId) => {
    if (shapeId && shapes.value.some((shape) => shape.id === shapeId)) {
      selectedPlanShapeId.value = shapeId
    }
  }, { flush: 'sync' })

  function changeDrawing(change: (next: DrawingDocument) => void): void {
    const next = clonePlain(drawing.value)
    change(next)
    if (!isDrawingDocument(next)) { showNotice('针法定义或小样范围无效，请检查后重试。'); return }
    if (JSON.stringify(next) === JSON.stringify(drawing.value)) return
    pushUndo(captureHistorySnapshot())
    drawing.value = next
  }
  const drawingBase = computed(() => drawingBaseMarks(shapePlans.value, gauge.value))
  const drawingDisplayMarks = computed(() => completeDrawingMarks(drawingBase.value, drawingMarks.value, drawingDefinitions.value))
  const showDrawingEdges = ref(false)
  const generatedIdKey = computed(() => JSON.stringify(drawing.value.generatedShapeIds))
  const generatedDrawingPaths = computed(() => {
    const ids = new Set<string>(JSON.parse(generatedIdKey.value))
    return shapes.value.filter((s): s is PathShape => ids.has(s.id) && s.type === 'path' && s.closed)
  })
  const drawingContourDisplays = computed(() => createContourDisplays(generatedDrawingPaths.value, gauge.value))
  const drawingPreviewDisplays = computed(() => !contourPreview.value || !contourCandidate.value ? [] : createContourDisplays(contourCandidate.value.loops.map((loop, i) => ({ id: `preview-${i}`, type: 'path', closed: true, nodes: loop.map(p => ({ anchor: { x: p.x * gauge.value.stitchWidthCm, y: p.y * gauge.value.rowHeightCm } })) })), gauge.value))

  function captureDrawingSample(x: number, y: number, width: number, height: number): PatternSample | null {
    if (width < 1 || height < 1 || width > 64 || height > 64) return null
    const marks = drawingDisplayMarks.value
      .filter(m => m.x >= x && m.y >= y && m.y < y + height && m.x + drawingDefinitions.value.get(m.stitchId)!.span <= x + width)
      .map(m => ({ ...m, id: uid(), x: m.x - x, y: m.y - y, automatic: undefined }))
    return marks.length ? { id: uid(), name: '框选花样', width, height, marks } : null
  }

  function clearDrawingContours(): void {
    contourPreview.value = false
    contourCandidate.value = null
  }
  watch([drawing, gaugeInput, fabric], () => {
    if (contourPreview.value) showNotice('图案或尺寸已改变，请重新点击生成轮廓。')
    clearDrawingContours()
  }, { deep: true, flush: 'sync' })

  function requestDrawingContours(): void {
    clearDrawingContours()
    if (drawingMarks.value.some(m => m.x + drawingDefinitions.value.get(m.stitchId)!.span > fabricGrid.value.columnCount || m.y >= fabricGrid.value.rowCount)) {
      showNotice('有针法超出画布，请先调整。'); return
    }
    const region = filledRegion(effectiveMarks(drawing.value, false), drawingDefinitions.value, fabricGrid.value.columnCount, fabricGrid.value.rowCount)
    const loops = traceContours(region.filled)
    if (!loops.length) { showNotice('请先填写针法，再生成轮廓。'); return }
    contourCandidate.value = { ...region, loops }
    contourPreview.value = true
  }

  function enterDrawing(): void {
    cancelDrawingPreview()
    viewMode.value = 'drawing'
    activeTool.value = 'stitch'
  }

  watch(viewMode, mode => {
    cancelDrawingPreview()
    if (mode === 'drawing') activeTool.value = 'stitch'
    else if (activeTool.value === 'stitch') activeTool.value = 'path'
  }, { flush: 'sync' })
  function paintDrawing(marks: StitchMark[]): void {
    const valid = marks.filter(m => m.x >= 0 && m.y >= 0 && m.y < fabricGrid.value.rowCount && m.x + (drawingDefinitions.value.get(m.stitchId)?.span ?? 1) <= fabricGrid.value.columnCount)
    changeDrawing(next => {
      for (const p of next.placements) p.marks = p.marks.filter(m => !valid.some(v => intersects({ ...m, x: m.x + p.x, y: m.y + p.y }, v, drawingDefinitions.value)))
      next.marks = replaceMarks(next.marks, valid, drawingDefinitions.value)
      next.automaticMarks = (next.automaticMarks ?? []).filter(m => !valid.some(v => intersects(m, v, drawingDefinitions.value)))
    })
  }
  function eraseDrawing(points: Point[]): void {
    const hit = (m: StitchMark) => points.some(p => p.y === m.y && p.x >= m.x && p.x < m.x + drawingDefinitions.value.get(m.stitchId)!.span)
    changeDrawing(next => {
      next.marks = next.marks.filter(m => !hit(m))
      next.automaticMarks = (next.automaticMarks ?? []).filter(m => !hit(m))
      for (const p of next.placements) p.marks = p.marks.filter(m => !hit({ ...m, x: m.x + p.x, y: m.y + p.y }))
    })
  }
  function saveSample(sample: PatternSample): void {
    changeDrawing(next => { const index = next.samples.findIndex(s => s.id === sample.id); if (index < 0) next.samples.push(clonePlain(sample)); else next.samples[index] = clonePlain(sample) })
  }
  function deleteSample(id: string): void { changeDrawing(next => { next.samples = next.samples.filter(s => s.id !== id) }) }
  function startPlacement(sample: PatternSample, movingId: string | null = null): void {
    movingPlacementId.value = movingId
    const old = drawing.value.placements.find(p => p.id === movingId)
    placementPreview.value = { ...clonePlain(sample), id: movingId ?? uid(), x: old?.x ?? 0, y: old?.y ?? 0 }
    drawingTool.value = 'place'; activeTool.value = 'stitch'
  }
  function confirmPlacement(): void {
    const preview = placementPreview.value
    if (!preview) return
    if (preview.x < 0 || preview.y < 0 || preview.x + preview.width > fabricGrid.value.columnCount || preview.y + preview.height > fabricGrid.value.rowCount) { showNotice('花样超出画布，请移动预览位置。'); return }
    changeDrawing(next => { next.placements = [...next.placements.filter(p => p.id !== movingPlacementId.value), clonePlain(preview)] })
    cancelDrawingPreview()
  }
  function cancelDrawingPreview(): void { placementPreview.value = null; movingPlacementId.value = null; clearDrawingContours(); drawingTool.value = 'paint' }
  function removePlacement(id: string): void { changeDrawing(next => { next.placements = next.placements.filter(p => p.id !== id) }) }
  function saveCustomStitch(definition: StitchDefinition): void {
    changeDrawing(next => { next.definitions.push(clonePlain(definition)) })
    activeStitchId.value = definition.id; activeTool.value = 'stitch'; drawingTool.value = 'paint'
  }
  function setDrawingConvention(convention: DrawingDocument['convention']): void { changeDrawing(next => { next.convention = convention }) }
  function generateDrawingContours(): void {
    const candidate = contourCandidate.value
    if (!contourPreview.value || !candidate) { showNotice('请先点击生成轮廓，预览后再确认。'); return }
    if (drawingMarks.value.some(m => m.x + drawingDefinitions.value.get(m.stitchId)!.span > fabricGrid.value.columnCount || m.y >= fabricGrid.value.rowCount)) { showNotice('有针法超出画布，请先调整。'); return }
    pushUndo(captureHistorySnapshot())
    const oldIds = new Set(drawing.value.generatedShapeIds)
    const newShapes: PathShape[] = candidate.loops.map((loop, i) => ({ id: uid(), name: `花样衣片 ${i + 1}`, type: 'path', closed: true, nodes: loop.map(p => ({ anchor: { x: p.x * gauge.value.stitchWidthCm, y: p.y * gauge.value.rowHeightCm } })) }))
    shapes.value = [...shapes.value.filter(s => !oldIds.has(s.id)), ...newShapes]
    for (const id of oldIds) { delete shapeDirections.value[id]; delete shapeRoundingPolicies.value[id]; delete operationOverrides.value[id] }
    drawing.value = { ...drawing.value, marks: drawing.value.marks.filter(m => !m.automatic), automaticMarks: candidate.automatic, generatedShapeIds: newShapes.map(s => s.id) }
    selectedShapeId.value = newShapes[0].id; selectedPlanShapeId.value = newShapes[0].id
    shapesRevision.value++; cancelDrawingPreview()
    showNotice(`已沿填充边缘生成 ${newShapes.length} 个轮廓，内部补 ${candidate.automatic.length} 针下针。可继续修改路径或针法。`)
  }

  function createPersistedDocument(): PersistedEditorDocument {
    const shapeIds = new Set(shapes.value.map((shape) => shape.id))
    const validSelection = (shapeId: string | null): string | null => (
      shapeId && shapeIds.has(shapeId) ? shapeId : shapes.value.at(-1)?.id ?? null
    )
    const validDirections = Object.fromEntries(
      Object.entries(shapeDirections.value).filter(([shapeId]) => shapeIds.has(shapeId)),
    )
    const validRoundingPolicies = Object.fromEntries(
      Object.entries(shapeRoundingPolicies.value).filter(([shapeId]) => shapeIds.has(shapeId)),
    )

    return {
      version: EDITOR_DOCUMENT_VERSION,
      savedAt: new Date().toISOString(),
      drawing: { ...clonePlain(drawing.value), generatedShapeIds: drawing.value.generatedShapeIds.filter(id => shapeIds.has(id)) },
      gaugeInput: clonePlain(gaugeInput.value),
      fabric: clonePlain(fabric.value),
      shapes: cloneShapes(mutationStart?.shapes ?? shapes.value),
      shapeDirections: validDirections,
      shapeRoundingPolicies: validRoundingPolicies,
      operationOverrides: Object.fromEntries(Object.entries(operationOverrides.value).filter(([shapeId]) => shapeIds.has(shapeId))),
      rasterOptions: clonePlain(rasterOptions.value),
      viewMode: viewMode.value,
      cardPositions: Object.fromEntries(Object.entries(cardPositions.value).filter(([key]) => shapeIds.has(key.slice(0, key.lastIndexOf(':'))))),
      selectedShapeId: validSelection(selectedShapeId.value),
      selectedPlanShapeId: validSelection(selectedPlanShapeId.value),
    }
  }

  function syncActiveProject(): PersistedProjectLibrary {
    const project = projects.value.find((item) => item.id === activeProjectId.value)
    if (project) {
      const document = createPersistedDocument()
      project.document = document
      project.updatedAt = document.savedAt
    }
    return {
      version: PROJECT_LIBRARY_VERSION,
      activeProjectId: activeProjectId.value,
      projects: clonePlain(projects.value),
      recycleBin: retainedRecycledProjects(recycleBin.value),
    }
  }

  const pageLifecycleTarget: PageLifecycleTarget | null = typeof window === 'undefined'
    ? null
    : window
  const autoSave = installProjectAutoSave({
    createLibrary: syncActiveProject,
    storage,
    pageLifecycleTarget,
    onSave: (saved) => { storageStatus.value = saved ? 'saved' : 'error' },
  })
  watch(
    [
      gaugeInput,
      fabric,
      shapeDirections,
      shapeRoundingPolicies,
      rasterOptions,
      viewMode,
      selectedShapeId,
      selectedPlanShapeId,
      shapesRevision,
      cardPositions,
      operationOverrides,
      drawing,
    ],
    autoSave.schedule,
    { deep: true },
  )
  onScopeDispose(autoSave.dispose)

  if (!loadedLibrary) {
    const migrated = saveProjectLibrary(syncActiveProject(), storage)
    storageStatus.value = migrated ? 'saved' : 'error'
    if (migrated && legacyDocument) removeLegacyEditorDocument(storage)
  }
  if (notice.value) autoSave.schedule()

  function captureHistorySnapshot(): HistorySnapshot {
    return {
      drawing: clonePlain(drawing.value),
      operationOverrides: clonePlain(operationOverrides.value),
      gaugeInput: clonePlain(gaugeInput.value),
      fabric: clonePlain(fabric.value),
      shapes: cloneShapes(shapes.value),
      shapeDirections: clonePlain(shapeDirections.value),
      shapeRoundingPolicies: clonePlain(shapeRoundingPolicies.value),
      rasterOptions: clonePlain(rasterOptions.value),
      selectedShapeId: selectedShapeId.value,
      selectedPlanShapeId: selectedPlanShapeId.value,
      draftPoints: clonePlain(draftPoints.value),
      draftPathNodes: clonePlain(draftPathNodes.value),
      draftTool: draftTool.value,
      drawingSessionId: drawingSessionId.value,
    }
  }

  function restoreHistorySnapshot(entry: HistoryEntry): void {
    const { snapshot } = entry
    drawing.value = clonePlain(snapshot.drawing)
    cancelDrawingPreview()
    let shapesChanged = false
    operationOverrides.value = clonePlain(snapshot.operationOverrides)
    if (JSON.stringify(gaugeInput.value) !== JSON.stringify(snapshot.gaugeInput)) {
      gaugeInput.value = clonePlain(snapshot.gaugeInput)
    }
    if (JSON.stringify(fabric.value) !== JSON.stringify(snapshot.fabric)) {
      fabric.value = clonePlain(snapshot.fabric)
    }
    if (JSON.stringify(shapes.value) !== JSON.stringify(snapshot.shapes)) {
      shapes.value = cloneShapes(snapshot.shapes)
      shapesChanged = true
    }
    if (JSON.stringify(shapeDirections.value) !== JSON.stringify(snapshot.shapeDirections)) {
      shapeDirections.value = clonePlain(snapshot.shapeDirections)
    }
    if (JSON.stringify(shapeRoundingPolicies.value) !== JSON.stringify(snapshot.shapeRoundingPolicies)) {
      shapeRoundingPolicies.value = clonePlain(snapshot.shapeRoundingPolicies)
    }
    if (JSON.stringify(rasterOptions.value) !== JSON.stringify(snapshot.rasterOptions)) {
      rasterOptions.value = clonePlain(snapshot.rasterOptions)
    }
    selectedShapeId.value = shapes.value.some((shape) => shape.id === snapshot.selectedShapeId)
      ? snapshot.selectedShapeId
      : shapes.value.at(-1)?.id ?? null
    selectedPlanShapeId.value = shapes.value.some((shape) => shape.id === snapshot.selectedPlanShapeId)
      ? snapshot.selectedPlanShapeId
      : selectedShapeId.value
    if (entry.kind === 'drawing') {
      draftPoints.value = clonePlain(snapshot.draftPoints)
      draftPathNodes.value = clonePlain(snapshot.draftPathNodes)
      draftTool.value = snapshot.draftTool
      drawingSessionId.value = snapshot.drawingSessionId
      activeTool.value = snapshot.draftTool ?? 'select'
    }
    ensureSelectedPlan()
    if (shapesChanged) shapesRevision.value += 1
  }

  function pushUndo(
    snapshot: HistorySnapshot,
    kind: HistoryEntry['kind'] = 'content',
    sessionId: string | null = null,
  ): void {
    undoStack.value.push({ snapshot: clonePlain(snapshot), kind, drawingSessionId: sessionId })
    if (undoStack.value.length > 100) undoStack.value.shift()
    redoStack.value = []
  }

  function beginShapeMutation(): void {
    if (!mutationStart) mutationStart = captureHistorySnapshot()
  }

  function updateShapeLive(nextShape: Shape): void {
    const index = shapes.value.findIndex((shape) => shape.id === nextShape.id)
    if (index !== -1) shapes.value[index] = nextShape
  }

  function commitShapeMutation(): void {
    if (!mutationStart) return
    if (JSON.stringify(mutationStart.shapes) !== JSON.stringify(shapes.value)) {
      pushUndo(mutationStart)
      shapesRevision.value += 1
      if (Object.values(shapeRoundingPolicies.value).some((policy) => policy.stitches || policy.rows)) showNotice('轮廓已更新，已保留手动取整方向并重新计算')
    }
    mutationStart = null
  }

  function cancelShapeMutation(): void {
    if (!mutationStart) return
    shapes.value = clonePlain(mutationStart.shapes)
    mutationStart = null
  }

  function replaceShape(nextShape: Shape): void {
    beginShapeMutation()
    updateShapeLive(nextShape)
    commitShapeMutation()
  }

  function setGaugeInputValue(key: keyof GaugeInput, value: number): GridUpdateResult {
    const nextGaugeInput = { ...gaugeInput.value, [key]: value }
    const assessment = assessGrid(nextGaugeInput, fabric.value)
    const fieldInvalid = assessment.issues.some((issue) => issue.severity === 'error' && issue.field === key)
    if (assessment.status === 'blocked' && (gridAssessment.value.status !== 'blocked' || fieldInvalid)) {
      return { ok: false, assessment }
    }
    if (gaugeInput.value[key] === value) return { ok: true, assessment }
    pushUndo(captureHistorySnapshot())
    gaugeInput.value = nextGaugeInput
    showNotice(assessment.status === 'blocked'
      ? '密度已更新，网格超限，请继续调整参数'
      : '密度已更新，针格和编织方案已重新计算')
    return { ok: true, assessment }
  }

  function setFabricValue(key: keyof FabricCanvas, value: number): GridUpdateResult {
    const nextFabric = { ...fabric.value, [key]: value }
    const assessment = assessGrid(gaugeInput.value, nextFabric)
    const fieldInvalid = assessment.issues.some((issue) => issue.severity === 'error' && issue.field === key)
    if (assessment.status === 'blocked' && (gridAssessment.value.status !== 'blocked' || fieldInvalid)) {
      return { ok: false, assessment }
    }
    if (fabric.value[key] === value) return { ok: true, assessment }
    pushUndo(captureHistorySnapshot())
    fabric.value = nextFabric
    return { ok: true, assessment }
  }

  function setRasterOptions(nextOptions: Partial<RasterOptions>): void {
    const next = { ...rasterOptions.value, ...nextOptions, mode: 'center' as const }
    if (JSON.stringify(next) === JSON.stringify(rasterOptions.value)) return
    pushUndo(captureHistorySnapshot())
    rasterOptions.value = next
  }

  function addShape(shape: Shape): void {
    pushUndo(captureHistorySnapshot())
    shapes.value.push(shape)
    selectedShapeId.value = shape.id
    selectedPlanShapeId.value = shape.id
    activeTool.value = 'select'
    shapesRevision.value += 1
  }

  function setShapeDirection(_shapeId: string, _nextDirection: KnitDirection): void {
    // Retained only for legacy callers; direction is no longer an editable rule.
  }

  function setShapeRoundingDirection(
    shapeId: string,
    axis: DimensionAxis,
    direction: RoundingDirection,
  ): void {
    const shape = shapes.value.find((shape) => shape.id === shapeId)
    if (!shape) return
    const current = shapeRoundingPolicies.value[shapeId] ?? { stitches: null, rows: null }
    const result = createOverallDimensionResults(shape, gauge.value, current).find((item) => item.axis === axis)
    if (!result || result.exact || !result[direction].valid) return
    if (current[axis] === direction) return
    pushUndo(captureHistorySnapshot())
    shapeRoundingPolicies.value = {
      ...shapeRoundingPolicies.value,
      [shapeId]: { ...current, [axis]: direction },
    }
  }

  function addDefaultShape(type: Exclude<ShapeType, 'polygon' | 'path'>): void {
    const centerX = fabric.value.widthCm / 2
    const centerY = fabric.value.heightCm / 2
    const id = createId()
    const common = { id, name: `新建${type}` }
    let shape: Shape

    switch (type) {
      case 'rectangle':
        shape = { ...common, type, x: centerX - 4, y: centerY - 3, widthCm: 8, heightCm: 6 }
        break
      case 'triangle':
        shape = {
          ...common,
          type,
          points: [
            { x: centerX - 4, y: centerY - 3 },
            { x: centerX + 4, y: centerY - 3 },
            { x: centerX, y: centerY + 4 },
          ],
        }
        break
      case 'circle':
        shape = { ...common, type, center: { x: centerX, y: centerY }, radiusCm: 4 }
        break
      case 'ellipse':
        shape = {
          ...common,
          type,
          center: { x: centerX, y: centerY },
          radiusXcm: 5,
          radiusYcm: 3,
        }
        break
    }
    addShape(shape)
  }

  function addPolygon(points: Point[]): void {
    addShape({ id: createId(), name: '自由多边形', type: 'polygon', points })
  }

  function insertPath(nodes: PathNode[], closed: boolean): void {
    let path: PathShape = {
      id: createId(),
      name: closed ? '自定义闭合路径' : '自定义开放路径',
      type: 'path' as const,
      nodes,
      closed,
    }
    const joinedShapeIds = new Set<string>()

    if (!closed) {
      let joined = true
      while (joined && !path.closed) {
        joined = false
        for (const shape of shapes.value) {
          if (shape.type !== 'path' || shape.closed || joinedShapeIds.has(shape.id)) continue
          const merged = joinConnectedOpenPaths(path, shape)
          if (!merged) continue
          path = merged
          joinedShapeIds.add(shape.id)
          joined = true
          break
        }
      }
    }

    shapes.value = shapes.value.filter((shape) => !joinedShapeIds.has(shape.id))
    if (joinedShapeIds.size) {
      shapeDirections.value = Object.fromEntries(
        Object.entries(shapeDirections.value).filter(([shapeId]) => !joinedShapeIds.has(shapeId)),
      )
      shapeRoundingPolicies.value = Object.fromEntries(
        Object.entries(shapeRoundingPolicies.value).filter(([shapeId]) => !joinedShapeIds.has(shapeId)),
      )
    }
    shapes.value.push(path)
    selectedShapeId.value = path.id
    selectedPlanShapeId.value = path.id
    activeTool.value = 'select'
    shapesRevision.value += 1
  }

  function addPath(nodes: PathNode[], closed: boolean): void {
    pushUndo(captureHistorySnapshot())
    insertPath(nodes, closed)
  }

  function beginDrawing(tool: 'polygon' | 'path'): string {
    if (draftTool.value !== tool || !drawingSessionId.value) {
      draftPoints.value = []
      draftPathNodes.value = []
      draftTool.value = tool
      drawingSessionId.value = createId()
    }
    return drawingSessionId.value
  }

  function addDraftPoint(point: Point): void {
    const sessionId = beginDrawing('polygon')
    pushUndo(captureHistorySnapshot(), 'drawing', sessionId)
    draftPoints.value.push(clonePlain(point))
  }

  function addDraftPathNode(node: PathNode): void {
    const sessionId = beginDrawing('path')
    pushUndo(captureHistorySnapshot(), 'drawing', sessionId)
    draftPathNodes.value.push(clonePlain(node))
  }

  function finishPolygonDraft(): void {
    if (draftTool.value !== 'polygon' || draftPoints.value.length < 3 || !drawingSessionId.value) return
    const history = captureHistorySnapshot()
    const sessionId = drawingSessionId.value
    const points = clonePlain(draftPoints.value)
    pushUndo(history, 'drawing', sessionId)
    draftPoints.value = []
    draftTool.value = null
    drawingSessionId.value = null
    shapes.value.push({ id: createId(), name: '自由多边形', type: 'polygon', points })
    selectedShapeId.value = shapes.value.at(-1)?.id ?? null
    selectedPlanShapeId.value = selectedShapeId.value
    activeTool.value = 'select'
    shapesRevision.value += 1
  }

  function finishPathDraft(closed: boolean): void {
    const minimum = closed ? 3 : 2
    if (draftTool.value !== 'path' || draftPathNodes.value.length < minimum || !drawingSessionId.value) return
    const history = captureHistorySnapshot()
    const sessionId = drawingSessionId.value
    const nodes = clonePlain(draftPathNodes.value)
    pushUndo(history, 'drawing', sessionId)
    draftPathNodes.value = []
    draftTool.value = null
    drawingSessionId.value = null
    insertPath(nodes, closed)
  }

  function cancelDrawing(): void {
    const sessionId = drawingSessionId.value
    if (sessionId && hasUnfinishedDraft.value) pushUndo(captureHistorySnapshot(), 'drawing', sessionId)
    draftPoints.value = []
    draftPathNodes.value = []
    draftTool.value = null
    drawingSessionId.value = null
  }

  function deleteSelected(): void {
    const deletedShape = selectedShape.value
    if (!deletedShape) return
    pushUndo(captureHistorySnapshot())
    shapes.value = shapes.value.filter((shape) => shape.id !== deletedShape.id)
    drawing.value.generatedShapeIds = drawing.value.generatedShapeIds.filter(id => id !== deletedShape.id)
    const { [deletedShape.id]: _deletedPolicy, ...remainingPolicies } = shapeRoundingPolicies.value
    shapeRoundingPolicies.value = remainingPolicies
    const { [deletedShape.id]: _deletedDirection, ...remainingDirections } = shapeDirections.value
    shapeDirections.value = remainingDirections
    selectedShapeId.value = shapes.value.at(-1)?.id ?? null
    ensureSelectedPlan()
    shapesRevision.value += 1
  }

  function resetProjectSession(): void {
    undoStack.value = []
    redoStack.value = []
    mutationStart = null
    draftPoints.value = []
    draftPathNodes.value = []
    draftTool.value = null
    drawingSessionId.value = null
    activeTool.value = viewMode.value === 'drawing' ? 'stitch' : 'path'
    rasterCache.clear()
    instructionCache.clear()
  }

  function applyProjectDocument(document: PersistedEditorDocument): void {
    drawing.value = clonePlain(document.drawing ?? emptyDrawing())
    activeStitchId.value = 'knit'
    showDrawingEdges.value = false
    cancelDrawingPreview()
    consumeRasterRuleNotice(document)
    autoSave.schedule()
    const nextShapes = cloneShapes(document.shapes)
    const validSelection = (shapeId: string | null): string | null => (
      shapeId && nextShapes.some((shape) => shape.id === shapeId)
        ? shapeId
        : nextShapes.at(-1)?.id ?? null
    )
    gaugeInput.value = clonePlain(document.gaugeInput)
    fabric.value = clonePlain(document.fabric)
    shapes.value = nextShapes
    shapeDirections.value = clonePlain(document.shapeDirections)
    shapeRoundingPolicies.value = clonePlain(document.shapeRoundingPolicies ?? {})
    rasterOptions.value = clonePlain(document.rasterOptions)
    viewMode.value = document.viewMode ?? 'overlay'
    cardPositions.value = clonePlain(document.cardPositions ?? {})
    operationOverrides.value = clonePlain(document.operationOverrides ?? {})
    selectedShapeId.value = validSelection(document.selectedShapeId)
    selectedPlanShapeId.value = validSelection(document.selectedPlanShapeId)
      ?? selectedShapeId.value
    resetProjectSession()
    shapesRevision.value += 1
    projectOpenRevision.value += 1
  }

  function nextProjectName(): string {
    const names = new Set(projects.value.map((project) => project.name))
    let index = 1
    while (names.has(`未命名方案 ${index}`)) index += 1
    return `未命名方案 ${index}`
  }

  function makeBlankProject(name = nextProjectName()): PersistedProject {
    const now = new Date().toISOString()
    return {
      id: createId(),
      name,
      createdAt: now,
      updatedAt: now,
      document: createBlankDocument(now),
    }
  }

  function uniqueImportedProjectName(sourceName: string, excludedProjectId?: string): string {
    const names = new Set(projects.value
      .filter((project) => project.id !== excludedProjectId)
      .map((project) => project.name))
    const normalized = sourceName.trim().slice(0, 40) || '导入方案'
    if (!names.has(normalized)) return normalized

    let index = 1
    while (true) {
      const suffix = index === 1 ? '（导入）' : `（导入 ${index}）`
      const candidate = `${normalized.slice(0, Math.max(1, 40 - suffix.length))}${suffix}`
      if (!names.has(candidate)) return candidate
      index += 1
    }
  }

  function makeImportedProject(
    file: ExportedProjectFileV1,
    excludedProjectId?: string,
  ): PersistedProject {
    const now = new Date().toISOString()
    const document = clonePlain(migrateEditorDocument(file.project.document) ?? file.project.document)
    document.savedAt = now
    return {
      id: createId(),
      name: uniqueImportedProjectName(file.project.name, excludedProjectId),
      ...(file.project.calculationSnapshot ? { calculationSnapshot: clonePlain(file.project.calculationSnapshot) } : {}),
      createdAt: now,
      updatedAt: now,
      document,
    }
  }

  function persistAndActivateProjects(nextProjects: PersistedProject[], project: PersistedProject, nextRecycleBin = retainedRecycledProjects(recycleBin.value)): boolean {
    const nextLibrary: PersistedProjectLibrary = {
      version: PROJECT_LIBRARY_VERSION,
      activeProjectId: project.id,
      projects: clonePlain(nextProjects),
      recycleBin: clonePlain(nextRecycleBin),
    }
    if (!saveProjectLibrary(nextLibrary, storage)) {
      storageStatus.value = 'error'
      return false
    }
    projects.value = nextProjects
    recycleBin.value = nextRecycleBin
    activeProjectId.value = project.id
    applyProjectDocument(project.document)
    storageStatus.value = 'saved'
    return true
  }

  function moveToRecycle(project: PersistedProject, reason: RecycledProject['reason'], records = recycleBin.value): RecycledProject[] {
    return retainedRecycledProjects([{ id: createId(), movedAt: new Date().toISOString(), reason, project: clonePlain(project) }, ...records])
  }

  function createProjectExport(projectId = activeProjectId.value): ExportedProjectFileV1 | null {
    if (projectId === activeProjectId.value) autoSave.flush()
    const project = readProjectSource(projectId)
    return project ? createProjectFile(project) : null
  }

  // Read the last committed source even before autosave, without altering the old snapshot.
  function readProjectSource(projectId = activeProjectId.value): PersistedProject | null {
    const project = projects.value.find(item => item.id === projectId)
    return project ? clonePlain(projectId === activeProjectId.value
      ? { ...project, document: createPersistedDocument() } : project) : null
  }

  function importProject(file: ExportedProjectFileV1, discardDraft = false): ProjectImportResult {
    const assessment = assessGrid(file.project.document.gaugeInput, file.project.document.fabric)
    if (assessment.status === 'blocked') return { status: 'grid-limit', assessment }
    if (projects.value.length >= MAX_PROJECTS) return { status: 'capacity' }
    if (hasUnfinishedDraft.value && !discardDraft) return { status: 'draft' }
    if (!autoSave.flush()) return { status: 'storage-error' }
    const project = makeImportedProject(file)
    const nextProjects = [...clonePlain(projects.value), project]
    return persistAndActivateProjects(nextProjects, project)
      ? { status: 'imported', projectId: project.id }
      : { status: 'storage-error' }
  }

  function replaceWithImportedProject(
    projectId: string,
    file: ExportedProjectFileV1,
    discardDraft = false,
  ): ProjectImportResult {
    const assessment = assessGrid(file.project.document.gaugeInput, file.project.document.fabric)
    if (assessment.status === 'blocked') return { status: 'grid-limit', assessment }
    if (hasUnfinishedDraft.value && !discardDraft) return { status: 'draft' }
    const index = projects.value.findIndex((project) => project.id === projectId)
    if (index === -1) return { status: 'not-found' }
    if (!autoSave.flush()) return { status: 'storage-error' }
    const project = makeImportedProject(file, projectId)
    const nextProjects = clonePlain(projects.value)
    const nextRecycleBin = moveToRecycle(nextProjects[index]!, 'replace')
    nextProjects.splice(index, 1, project)
    return persistAndActivateProjects(nextProjects, project, nextRecycleBin)
      ? { status: 'imported', projectId: project.id }
      : { status: 'storage-error' }
  }

  function activateProject(projectId: string, discardDraft = false): boolean {
    if (hasUnfinishedDraft.value && !discardDraft) return false
    const project = projects.value.find((item) => item.id === projectId)
    if (!project) return false
    if (!autoSave.flush()) return false
    return persistAndActivateProjects(clonePlain(projects.value), project)
  }

  function createProject(discardDraft = false): string | null {
    if (projects.value.length >= MAX_PROJECTS) return null
    if (hasUnfinishedDraft.value && !discardDraft) return null
    if (!autoSave.flush()) return null
    const project = makeBlankProject()
    return persistAndActivateProjects([...clonePlain(projects.value), project], project) ? project.id : null
  }

  function replaceProject(projectId: string, discardDraft = false): string | null {
    if (hasUnfinishedDraft.value && !discardDraft) return null
    const index = projects.value.findIndex((project) => project.id === projectId)
    if (index === -1) return null
    if (!autoSave.flush()) return null
    const project = makeBlankProject()
    const nextProjects = clonePlain(projects.value)
    const nextRecycleBin = moveToRecycle(nextProjects[index]!, 'replace')
    nextProjects.splice(index, 1, project)
    return persistAndActivateProjects(nextProjects, project, nextRecycleBin) ? project.id : null
  }

  function renameProject(projectId: string, name: string): boolean {
    const trimmedName = name.trim()
    const project = projects.value.find((item) => item.id === projectId)
    if (!project || !trimmedName) return false
    if (!autoSave.flush()) return false
    const nextProjects = clonePlain(projects.value)
    const next = nextProjects.find(item => item.id === projectId)!
    next.name = trimmedName.slice(0, 40)
    next.updatedAt = new Date().toISOString()
    if (!saveProjectLibrary({ version: PROJECT_LIBRARY_VERSION, activeProjectId: activeProjectId.value,
      projects: nextProjects, recycleBin: retainedRecycledProjects(recycleBin.value) }, storage)) {
      storageStatus.value = 'error'
      return false
    }
    projects.value = nextProjects
    storageStatus.value = 'saved'
    return true
  }

  function deleteProject(projectId: string, discardDraft = false): boolean {
    if (projects.value.length <= 1) return false
    const index = projects.value.findIndex((project) => project.id === projectId)
    if (index === -1) return false
    if (projectId === activeProjectId.value && hasUnfinishedDraft.value && !discardDraft) return false
    if (!autoSave.flush()) return false
    const nextProjects = clonePlain(projects.value)
    const nextRecycleBin = moveToRecycle(nextProjects[index]!, 'delete')
    nextProjects.splice(index, 1)
    if (projectId === activeProjectId.value) {
      const next = [...nextProjects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      return persistAndActivateProjects(nextProjects, next, nextRecycleBin)
    }
    if (!saveProjectLibrary({ version: PROJECT_LIBRARY_VERSION, activeProjectId: activeProjectId.value, projects: nextProjects, recycleBin: nextRecycleBin }, storage)) {
      storageStatus.value = 'error'
      return false
    }
    projects.value = nextProjects
    recycleBin.value = nextRecycleBin
    storageStatus.value = 'saved'
    return true
  }

  function restoreRecycledProject(recordId: string, replacementId?: string, discardDraft = false): ProjectImportResult {
    refreshRecycleBin()
    const records = retainedRecycledProjects(recycleBin.value)
    const record = records.find(item => item.id === recordId)
    if (!record) return { status: 'not-found' }
    const document = migrateEditorDocument(record.project.document)
    if (!document) return { status: 'not-found' }
    const assessment = assessGrid(document.gaugeInput, document.fabric)
    if (assessment.status === 'blocked') return { status: 'grid-limit', assessment }
    if (hasUnfinishedDraft.value && !discardDraft) return { status: 'draft' }
    if (projects.value.length >= MAX_PROJECTS && !replacementId) return { status: 'capacity' }
    const index = replacementId ? projects.value.findIndex(item => item.id === replacementId) : -1
    if (replacementId && index < 0) return { status: 'not-found' }
    if (!autoSave.flush()) return { status: 'storage-error' }
    const project: PersistedProject = { ...clonePlain(record.project), id: createId(),
      name: uniqueImportedProjectName(record.project.name, replacementId), document,
      updatedAt: new Date().toISOString() }
    const nextProjects = clonePlain(projects.value)
    let nextRecycleBin = records.filter(item => item.id !== recordId)
    if (index >= 0) {
      nextRecycleBin = moveToRecycle(nextProjects[index]!, 'replace', nextRecycleBin)
      nextProjects.splice(index, 1, project)
    } else nextProjects.push(project)
    return persistAndActivateProjects(nextProjects, project, nextRecycleBin)
      ? { status: 'imported', projectId: project.id } : { status: 'storage-error' }
  }

  function removeRecycledProject(recordId?: string): boolean {
    if (!autoSave.flush()) return false
    const nextRecycleBin = recordId ? retainedRecycledProjects(recycleBin.value).filter(item => item.id !== recordId) : []
    if (!saveProjectLibrary({ version: PROJECT_LIBRARY_VERSION, activeProjectId: activeProjectId.value,
      projects: clonePlain(projects.value), recycleBin: nextRecycleBin }, storage)) {
      storageStatus.value = 'error'
      return false
    }
    recycleBin.value = nextRecycleBin
    storageStatus.value = 'saved'
    return true
  }

  function undo(): void {
    const previous = undoStack.value.pop()
    if (!previous) return
    redoStack.value.push({
      snapshot: captureHistorySnapshot(),
      kind: previous.kind,
      drawingSessionId: previous.drawingSessionId,
    })
    restoreHistorySnapshot(previous)
  }

  function setCardPosition(key: string, point: Point | null): void {
    if (!/^.+:\d+$/.test(key)) return
    const shapeId = key.slice(0, key.lastIndexOf(':'))
    if (!shapes.value.some((shape) => shape.id === shapeId)) return
    const next = { ...cardPositions.value }
    if (point) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return
      next[key] = { ...point }
    } else delete next[key]
    cardPositions.value = next
  }

  function setOperationOverride(shapeId: string, key: string, kind: 'decrease' | 'bind-off' | null): void {
    const operation = shapePlans.value.find(plan => plan.shapeId === shapeId)?.instructions
      .flatMap(instruction => instruction.operations ?? []).find(item => item.key === key)
    if (!operation?.canOverride) return
    const existing = operationOverrides.value[shapeId] ?? {}
    if ((existing[key] ?? null) === kind) return
    pushUndo(captureHistorySnapshot())
    const next = { ...existing }
    if (kind) next[key] = kind
    else delete next[key]
    operationOverrides.value = { ...operationOverrides.value, [shapeId]: next }
  }

  function redo(): void {
    const next = redoStack.value.pop()
    if (!next) return
    undoStack.value.push({
      snapshot: captureHistorySnapshot(),
      kind: next.kind,
      drawingSessionId: next.drawingSessionId,
    })
    restoreHistorySnapshot(next)
  }

  return {
    drawing, drawingTool, activeStitchId, drawingDefinitions, drawingMarks, drawingBase, drawingDisplayMarks,
    drawingContourDisplays, drawingPreviewDisplays, showDrawingEdges,
    placementPreview, movingPlacementId, contourPreview, contourCandidate,
    paintDrawing, eraseDrawing, saveSample, deleteSample, startPlacement, confirmPlacement,
    cancelDrawingPreview, removePlacement, saveCustomStitch, setDrawingConvention, generateDrawingContours,
    enterDrawing, requestDrawingContours, clearDrawingContours, captureDrawingSample,
    projects,
    activeProjectId,
    activeProject,
    storageStatus,
    notice,
    showNotice,
    maxProjects: MAX_PROJECTS,
    gaugeInput,
    fabric,
    shapes,
    selectedShapeId,
    selectedPlanShapeId,
    zoom,
    cardPositions,
    setCardPosition,
    operationOverrides,
    setOperationOverride,
    minimumViewZoom,
    projectOpenRevision,
    direction,
    shapeDirections,
    shapeRoundingPolicies,
    rasterOptions,
    activeTool,
    viewMode,
    draftPoints,
    draftPathNodes,
    draftTool,
    gauge,
    fabricGrid,
    gridAssessment,
    selectedShape,
    rasterRows,
    shapePlans,
    selectedShapePlan,
    instructions,
    hasSeparatedRegions,
    hasUnfinishedDraft,
    canUndo: computed(() => undoStack.value.length > 0),
    canRedo: computed(() => redoStack.value.length > 0),
    beginShapeMutation,
    updateShapeLive,
    commitShapeMutation,
    cancelShapeMutation,
    replaceShape,
    setGaugeInputValue,
    setFabricValue,
    setRasterOptions,
    addShape,
    setShapeDirection,
    setShapeRoundingDirection,
    addDefaultShape,
    addPolygon,
    addPath,
    addDraftPoint,
    addDraftPathNode,
    finishPolygonDraft,
    finishPathDraft,
    cancelDrawing,
    deleteSelected,
    activateProject,
    createProject,
    replaceProject,
    renameProject,
    deleteProject,
    createProjectExport,
    readProjectSource,
    importProject,
    replaceWithImportedProject,
    recycledProjects,
    refreshRecycleBin,
    restoreRecycledProject,
    removeRecycledProject,
    undo,
    redo,
  }
})
