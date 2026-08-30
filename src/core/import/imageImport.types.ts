import type { PathNode, Point } from '../geometry/shape.types'

export interface ImageRaster {
  width: number
  height: number
  data: Uint8ClampedArray
}

export type ImageRotation = 0 | 90 | 180 | 270

export interface ImageImportOptions {
  threshold: number
  inverted: boolean
  repairRadius: number
  rotation: ImageRotation
}

export interface PixelBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ContourCandidate {
  id: string
  points: Point[]
  bounds: PixelBounds
  area: number
  repairedPixels: Point[]
}

export interface ImageImportAnalysis {
  raster: ImageRaster
  foregroundMask: Uint8Array
  repairedMask: Uint8Array
  candidates: ContourCandidate[]
  automaticThreshold: number
}

export interface CalibratedContour {
  widthCm: number
  heightCm: number
  nodes: PathNode[]
  fittingErrorCm: number
  isComplex: boolean
}

export interface ContourCalibration {
  axis: 'width' | 'height'
  valueCm: number
  stitchWidthCm: number
  rowHeightCm: number
  maxNodes?: number
}
