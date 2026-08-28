import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { calculateFabricGrid, calculateGauge } from '../core/gauge/gauge'
import type { GaugeInput, FabricCanvas } from '../core/gauge/gauge.types'
import type { Point, Shape, ShapeType } from '../core/geometry/shape.types'
import { generateInstructions } from '../core/knitting/planner'
import type { KnitDirection } from '../core/knitting/planner.types'
import { rasterizeShapes } from '../core/raster/rasterizer'
import type { RasterOptions } from '../core/raster/raster.types'
import type { EditorTool, KnittingProject, ViewMode } from './editor.types'

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const cloneShapes = (value: Shape[]): Shape[] => clonePlain(value)

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
  const zoom = ref(20)
  const direction = ref<KnitDirection>('bottom-up')
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
    rasterizeShapes(shapes.value, gauge.value, fabric.value, rasterOptions.value),
  )
  const instructions = computed(() =>
    generateInstructions(rasterRows.value, direction.value),
  )
  const hasSeparatedRegions = computed(() =>
    rasterRows.value.some((row) => row.segments.length > 1),
  )

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
    activeTool.value = 'select'
  }

  function addDefaultShape(type: Exclude<ShapeType, 'polygon'>): void {
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

  function deleteSelected(): void {
    if (!selectedShapeId.value) return
    pushUndo(shapes.value)
    shapes.value = shapes.value.filter((shape) => shape.id !== selectedShapeId.value)
    selectedShapeId.value = shapes.value.at(-1)?.id ?? null
  }

  function undo(): void {
    const previous = undoStack.value.pop()
    if (!previous) return
    redoStack.value.push(cloneShapes(shapes.value))
    shapes.value = cloneShapes(previous)
    if (!shapes.value.some((shape) => shape.id === selectedShapeId.value)) {
      selectedShapeId.value = shapes.value.at(-1)?.id ?? null
    }
  }

  function redo(): void {
    const next = redoStack.value.pop()
    if (!next) return
    undoStack.value.push(cloneShapes(shapes.value))
    shapes.value = cloneShapes(next)
  }

  function exportProject(): KnittingProject {
    return {
      version: 1,
      gauge: clonePlain(gaugeInput.value),
      canvas: clonePlain(fabric.value),
      direction: direction.value,
      rasterOptions: clonePlain(rasterOptions.value),
      shapes: cloneShapes(shapes.value),
    }
  }

  function importProject(project: KnittingProject): void {
    if (project.version !== 1 || !Array.isArray(project.shapes)) {
      throw new Error('不支持的项目文件版本')
    }
    calculateGauge(project.gauge)
    calculateFabricGrid(project.canvas, calculateGauge(project.gauge))
    pushUndo(shapes.value)
    gaugeInput.value = clonePlain(project.gauge)
    fabric.value = clonePlain(project.canvas)
    direction.value = project.direction
    rasterOptions.value = clonePlain(project.rasterOptions)
    shapes.value = cloneShapes(project.shapes)
    selectedShapeId.value = shapes.value[0]?.id ?? null
  }

  return {
    gaugeInput,
    fabric,
    shapes,
    selectedShapeId,
    zoom,
    direction,
    rasterOptions,
    activeTool,
    viewMode,
    gauge,
    fabricGrid,
    selectedShape,
    rasterRows,
    instructions,
    hasSeparatedRegions,
    canUndo: computed(() => undoStack.value.length > 0),
    canRedo: computed(() => redoStack.value.length > 0),
    beginShapeMutation,
    updateShapeLive,
    commitShapeMutation,
    replaceShape,
    addShape,
    addDefaultShape,
    addPolygon,
    deleteSelected,
    undo,
    redo,
    exportProject,
    importProject,
  }
})
