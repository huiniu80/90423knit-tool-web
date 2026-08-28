export type RasterMode = 'center' | 'inside' | 'outside'

export interface RasterOptions {
  mode: RasterMode
  symmetryOptimization: boolean
}

export interface StitchSegment {
  startStitch: number
  endStitch: number
}

export interface RasterRow {
  rowIndex: number
  yCm: number
  segments: StitchSegment[]
  stitchCount: number
}
