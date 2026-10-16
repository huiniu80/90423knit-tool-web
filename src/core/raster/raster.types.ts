export type RasterMode = 'center' | 'inside' | 'outside'

export interface RasterOptions {
  mode: RasterMode
  symmetryOptimization: boolean
}

export interface ShapeRasterTarget {
  stitches: number | null
  rows: number | null
  direction: 'bottom-up' | 'top-down'
}

export interface StitchSegment {
  startStitch: number
  endStitch: number
}

export interface RasterRow {
  /** Per-piece lattice origin; mirrored pieces keep the original axis between needles. */
  originXCm?: number
  rowIndex: number
  yCm: number
  segments: StitchSegment[]
  stitchCount: number
}
