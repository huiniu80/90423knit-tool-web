import type { StitchSegment } from '../raster/raster.types'

export type KnitDirection = 'bottom-up' | 'top-down'

export interface KnittingInstruction {
  rowNumber: number
  sourceRowIndex: number
  stitchCount: number
  segments: StitchSegment[]
  leftChange: number
  rightChange: number
  isCastOn: boolean
  supported: boolean
}
