import { computed, onScopeDispose, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { calculateFabricGrid, calculateGauge } from '../core/gauge/gauge'
import type { GaugeInput, FabricCanvas } from '../core/gauge/gauge.types'
import type { PathNode, PathShape, Point, Shape, ShapeType } from '../core/geometry/shape.types'
import { joinConnectedOpenPaths } from '../core/geometry/path'
import { generateInstructions } from '../core/knitting/planner'
import type { KnitDirection } from '../core/knitting/planner.types'
import { mergeRasterRows, rasterize, rasterizeShapes } from '../core/raster/rasterizer'
import type { RasterOptions, RasterRow } from '../core/raster/raster.types'
import type {
  EditorTool,
  ShapePlan,
  ViewMode,
} from './editor.types'
import {
  EDITOR_DOCUMENT_VERSION,
  getBrowserEditorStorage,
  installEditorAutoSave,
  loadEditorDocument,
} from './editor.persistence'
import type { PageLifecycleTarget, PersistedEditorDocument } from './editor.persistence'

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const cloneShapes = (value: Shape[]): Shape[] => clonePlain(value)

interface HistorySnapshot {
  gaugeInput: GaugeInput
  fabric: FabricCanvas
  shapes: Shape[]
  shapeDirections: Record<string, KnitDirection>
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

function starterShapes(): Shape[] {
  return [
    {
      id: createId(),
      name: '验收三角形',
      type: 'triangle',
      points: [
        { x: 10, y: 8 },
        { x: 13, y: 8 },
        { x: 10, y: 11 },
      ],
    },
  ]
}

export const useEditorStore = defineStore('editor', () => {
  const storage = getBrowserEditorStorage()
  const persistedDocument = loadEditorDocument(storage)
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
  const initialShapes = persistedDocument ? cloneShapes(persistedDocument.shapes) : starterShapes()
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
  const selectedShapeId = ref<string | null>(
    validInitialSelection(persistedDocument?.selectedShapeId ?? initialShapes[0]?.id ?? null),
  )
  const selectedPlanShapeId = ref<string | null>(
    validInitialSelection(persistedDocument?.selectedPlanShapeId ?? selectedShapeId.value),
  )
  const zoom = ref(20)
  const shapeDirections = ref<Record<string, KnitDirection>>(
    clonePlain(persistedDocument?.shapeDirections ?? {}),
  )
  const rasterOptions = ref<RasterOptions>(
    clonePlain(persistedDocument?.rasterOptions ?? defaultRasterOptions),
  )
  const activeTool = ref<EditorTool>('path')
  const viewMode = ref<ViewMode>('overlay')
  const draftPoints = ref<Point[]>([])
  const draftPathNodes = ref<PathNode[]>([])
  const draftTool = ref<'polygon' | 'path' | null>(null)
  const drawingSessionId = ref<string | null>(null)

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
  const selectedShape = computed(
    () => shapes.value.find((shape) => shape.id === selectedShapeId.value) ?? null,
  )
  const shapeRasterRows = computed(() => {
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
      const cached = rasterCache.get(shape.id)
      if (cached?.shape === shape && cached.rasterKey === rasterKey) {
        return { shape, rows: cached.rows, isFabric }
      }
      const rows = isFabric
        ? rasterize(shape, gauge.value, fabric.value, rasterOptions.value)
        : rasterizeShapes([], gauge.value, fabric.value, rasterOptions.value)
      rasterCache.set(shape.id, { shape, rasterKey, rows })
      return { shape, rows, isFabric }
    })
  })
  const rasterRows = computed(() => mergeRasterRows(
    shapeRasterRows.value.filter((item) => item.isFabric).map((item) => item.rows),
    gauge.value,
    fabric.value,
  ))
  function directionForShape(shapeId: string): KnitDirection {
    return shapeDirections.value[shapeId] ?? 'bottom-up'
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
    const shapeDirection = directionForShape(shape.id)
    const cachedInstructions = instructionCache.get(shape.id)
    const planInstructions = cachedInstructions?.rows === rows
      && cachedInstructions.direction === shapeDirection
      ? cachedInstructions.instructions
      : generateInstructions(rows, shapeDirection)
    if (planInstructions !== cachedInstructions?.instructions) {
      instructionCache.set(shape.id, { rows, direction: shapeDirection, instructions: planInstructions })
    }
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

  function createPersistedDocument(): PersistedEditorDocument {
    const shapeIds = new Set(shapes.value.map((shape) => shape.id))
    const validSelection = (shapeId: string | null): string | null => (
      shapeId && shapeIds.has(shapeId) ? shapeId : shapes.value.at(-1)?.id ?? null
    )
    const validDirections = Object.fromEntries(
      Object.entries(shapeDirections.value).filter(([shapeId]) => shapeIds.has(shapeId)),
    )

    return {
      version: EDITOR_DOCUMENT_VERSION,
      savedAt: new Date().toISOString(),
      gaugeInput: clonePlain(gaugeInput.value),
      fabric: clonePlain(fabric.value),
      shapes: cloneShapes(shapes.value),
      shapeDirections: validDirections,
      rasterOptions: clonePlain(rasterOptions.value),
      selectedShapeId: validSelection(selectedShapeId.value),
      selectedPlanShapeId: validSelection(selectedPlanShapeId.value),
    }
  }

  const pageLifecycleTarget: PageLifecycleTarget | null = typeof window === 'undefined'
    ? null
    : window
  const autoSave = installEditorAutoSave({
    createDocument: createPersistedDocument,
    storage,
    pageLifecycleTarget,
  })
  watch(
    [
      gaugeInput,
      fabric,
      shapeDirections,
      rasterOptions,
      selectedShapeId,
      selectedPlanShapeId,
      shapesRevision,
    ],
    autoSave.schedule,
    { deep: true },
  )
  onScopeDispose(autoSave.dispose)

  function captureHistorySnapshot(): HistorySnapshot {
    return {
      gaugeInput: clonePlain(gaugeInput.value),
      fabric: clonePlain(fabric.value),
      shapes: cloneShapes(shapes.value),
      shapeDirections: clonePlain(shapeDirections.value),
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
    let shapesChanged = false
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
    }
    mutationStart = null
  }

  function replaceShape(nextShape: Shape): void {
    beginShapeMutation()
    updateShapeLive(nextShape)
    commitShapeMutation()
  }

  function setGaugeInputValue(key: keyof GaugeInput, value: number): void {
    if (gaugeInput.value[key] === value) return
    pushUndo(captureHistorySnapshot())
    gaugeInput.value = { ...gaugeInput.value, [key]: value }
  }

  function setFabricValue(key: keyof FabricCanvas, value: number): void {
    if (fabric.value[key] === value) return
    pushUndo(captureHistorySnapshot())
    fabric.value = { ...fabric.value, [key]: value }
  }

  function setRasterOptions(nextOptions: Partial<RasterOptions>): void {
    const next = { ...rasterOptions.value, ...nextOptions }
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

  function setShapeDirection(shapeId: string, nextDirection: KnitDirection): void {
    if (!shapes.value.some((shape) => shape.id === shapeId)) return
    if (directionForShape(shapeId) === nextDirection) return
    pushUndo(captureHistorySnapshot())
    shapeDirections.value = {
      ...shapeDirections.value,
      [shapeId]: nextDirection,
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
    if (sessionId) {
      undoStack.value = undoStack.value.filter((entry) => entry.drawingSessionId !== sessionId)
      redoStack.value = redoStack.value.filter((entry) => entry.drawingSessionId !== sessionId)
    }
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
    selectedShapeId.value = shapes.value.at(-1)?.id ?? null
    ensureSelectedPlan()
    shapesRevision.value += 1
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
    gaugeInput,
    fabric,
    shapes,
    selectedShapeId,
    selectedPlanShapeId,
    zoom,
    direction,
    shapeDirections,
    rasterOptions,
    activeTool,
    viewMode,
    draftPoints,
    draftPathNodes,
    draftTool,
    gauge,
    fabricGrid,
    selectedShape,
    rasterRows,
    shapePlans,
    selectedShapePlan,
    instructions,
    hasSeparatedRegions,
    canUndo: computed(() => undoStack.value.length > 0),
    canRedo: computed(() => redoStack.value.length > 0),
    beginShapeMutation,
    updateShapeLive,
    commitShapeMutation,
    replaceShape,
    setGaugeInputValue,
    setFabricValue,
    setRasterOptions,
    addShape,
    setShapeDirection,
    addDefaultShape,
    addPolygon,
    addPath,
    addDraftPoint,
    addDraftPathNode,
    finishPolygonDraft,
    finishPathDraft,
    cancelDrawing,
    deleteSelected,
    undo,
    redo,
  }
})
