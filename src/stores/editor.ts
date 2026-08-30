import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { calculateFabricGrid, calculateGauge } from '../core/gauge/gauge'
import type { GaugeInput, FabricCanvas } from '../core/gauge/gauge.types'
import type { PathNode, Point, Shape, ShapeType } from '../core/geometry/shape.types'
import { generateInstructions } from '../core/knitting/planner'
import type { KnitDirection } from '../core/knitting/planner.types'
import { rasterize, rasterizeShapes } from '../core/raster/rasterizer'
import type { RasterOptions } from '../core/raster/raster.types'
import type {
  EditorTool,
  ShapePlan,
  ViewMode,
} from './editor.types'

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const cloneShapes = (value: Shape[]): Shape[] => clonePlain(value)

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
  const gaugeInput = ref<GaugeInput>({
    sampleStitches: 10,
    sampleRows: 10,
    sampleWidthCm: 10,
    sampleHeightCm: 6,
  })
  const fabric = ref<FabricCanvas>({ widthCm: 30, heightCm: 30 })
  const shapes = ref<Shape[]>(starterShapes())
  const selectedShapeId = ref<string | null>(shapes.value[0]?.id ?? null)
  const selectedPlanShapeId = ref<string | null>(shapes.value[0]?.id ?? null)
  const zoom = ref(20)
  const shapeDirections = ref<Record<string, KnitDirection>>({})
  const rasterOptions = ref<RasterOptions>({
    mode: 'center',
    symmetryOptimization: true,
  })
  const activeTool = ref<EditorTool>('select')
  const viewMode = ref<ViewMode>('overlay')

  const undoStack = ref<Shape[][]>([])
  const redoStack = ref<Shape[][]>([])
  let mutationStart: Shape[] | null = null

  const gauge = computed(() => calculateGauge(gaugeInput.value))
  const fabricGrid = computed(() => calculateFabricGrid(fabric.value, gauge.value))
  const selectedShape = computed(
    () => shapes.value.find((shape) => shape.id === selectedShapeId.value) ?? null,
  )
  const rasterRows = computed(() =>
    rasterizeShapes(
      shapes.value.filter(isFabricShape),
      gauge.value,
      fabric.value,
      rasterOptions.value,
    ),
  )
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
  const shapePlans = computed<ShapePlan[]>(() => shapes.value.map((shape) => {
    const isFabric = isFabricShape(shape)
    const rows = isFabric
      ? rasterize(shape, gauge.value, fabric.value, rasterOptions.value)
      : rasterizeShapes([], gauge.value, fabric.value, rasterOptions.value)
    const shapeDirection = directionForShape(shape.id)
    const planInstructions = generateInstructions(rows, shapeDirection)
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

  function pushUndo(snapshot: Shape[]): void {
    undoStack.value.push(cloneShapes(snapshot))
    if (undoStack.value.length > 100) undoStack.value.shift()
    redoStack.value = []
  }

  function beginShapeMutation(): void {
    if (!mutationStart) mutationStart = cloneShapes(shapes.value)
  }

  function updateShapeLive(nextShape: Shape): void {
    const index = shapes.value.findIndex((shape) => shape.id === nextShape.id)
    if (index !== -1) shapes.value[index] = nextShape
  }

  function commitShapeMutation(): void {
    if (!mutationStart) return
    if (JSON.stringify(mutationStart) !== JSON.stringify(shapes.value)) pushUndo(mutationStart)
    mutationStart = null
  }

  function replaceShape(nextShape: Shape): void {
    beginShapeMutation()
    updateShapeLive(nextShape)
    commitShapeMutation()
  }

  function addShape(shape: Shape): void {
    pushUndo(shapes.value)
    shapes.value.push(shape)
    selectedShapeId.value = shape.id
    selectedPlanShapeId.value = shape.id
    activeTool.value = 'select'
  }

  function setShapeDirection(shapeId: string, nextDirection: KnitDirection): void {
    if (!shapes.value.some((shape) => shape.id === shapeId)) return
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

  function addPath(nodes: PathNode[], closed: boolean): void {
    addShape({
      id: createId(),
      name: closed ? '自定义闭合路径' : '自定义开放路径',
      type: 'path',
      nodes,
      closed,
    })
  }

  function deleteSelected(): void {
    if (!selectedShapeId.value) return
    pushUndo(shapes.value)
    shapes.value = shapes.value.filter((shape) => shape.id !== selectedShapeId.value)
    selectedShapeId.value = shapes.value.at(-1)?.id ?? null
    ensureSelectedPlan()
  }

  function undo(): void {
    const previous = undoStack.value.pop()
    if (!previous) return
    redoStack.value.push(cloneShapes(shapes.value))
    shapes.value = cloneShapes(previous)
    if (!shapes.value.some((shape) => shape.id === selectedShapeId.value)) {
      selectedShapeId.value = shapes.value.at(-1)?.id ?? null
    }
    ensureSelectedPlan()
  }

  function redo(): void {
    const next = redoStack.value.pop()
    if (!next) return
    undoStack.value.push(cloneShapes(shapes.value))
    shapes.value = cloneShapes(next)
    ensureSelectedPlan()
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
    addShape,
    setShapeDirection,
    addDefaultShape,
    addPolygon,
    addPath,
    deleteSelected,
    undo,
    redo,
  }
})
