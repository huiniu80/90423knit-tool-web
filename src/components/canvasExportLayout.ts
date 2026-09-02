export interface CanvasExportLayoutInput {
  fabricWidthCm: number
  fabricHeightCm: number
  leftAnnotationHeights: number[]
  rightAnnotationHeights: number[]
}

export interface CanvasExportLayout {
  width: number
  height: number
  zoom: number
  pan: { x: number; y: number }
  pixelRatio: number
}

const BASE_WIDTH = 1800
const BASE_HEIGHT = 1000
const MIN_ZOOM = 5
const MAX_ZOOM = 48
const ANNOTATION_WIDTH = 264
const ANNOTATION_MARGIN = 14
const ANNOTATION_GAP = 10
const ANNOTATION_FABRIC_GAP = 42
const FABRIC_VERTICAL_PADDING = 72
const MAX_BITMAP_EDGE = 16384
const MAX_BITMAP_PIXELS = 48_000_000

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function annotationStackHeight(heights: number[]): number {
  if (!heights.length) return 0
  return heights.reduce((sum, height) => sum + height, 0)
    + (heights.length - 1) * ANNOTATION_GAP
    + ANNOTATION_MARGIN * 2
}

function safePixelRatio(width: number, height: number): number {
  return Math.min(
    2,
    MAX_BITMAP_EDGE / width,
    MAX_BITMAP_EDGE / height,
    Math.sqrt(MAX_BITMAP_PIXELS / (width * height)),
  )
}

export function createCanvasExportLayout(input: CanvasExportLayoutInput): CanvasExportLayout {
  const reservedWidth = (ANNOTATION_MARGIN + ANNOTATION_WIDTH + ANNOTATION_FABRIC_GAP) * 2
  const width = Math.ceil(Math.max(BASE_WIDTH, input.fabricWidthCm * MIN_ZOOM + reservedWidth))
  const zoom = clamp((width - reservedWidth) / input.fabricWidthCm, MIN_ZOOM, MAX_ZOOM)
  const fabricWidth = input.fabricWidthCm * zoom
  const fabricHeight = input.fabricHeightCm * zoom
  const height = Math.ceil(Math.max(
    BASE_HEIGHT,
    fabricHeight + FABRIC_VERTICAL_PADDING * 2,
    annotationStackHeight(input.leftAnnotationHeights),
    annotationStackHeight(input.rightAnnotationHeights),
  ))

  return {
    width,
    height,
    zoom,
    pan: {
      x: (width - fabricWidth) / 2,
      y: (height - fabricHeight) / 2,
    },
    pixelRatio: safePixelRatio(width, height),
  }
}
