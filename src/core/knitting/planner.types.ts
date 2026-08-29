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

export type ShapingSide = 'left' | 'right'
export type ShapingOperation = 'increase' | 'decrease'

export interface ShapingRule {
  everyRows: number
  stitchCount: number
  repeatCount: number
  operation: ShapingOperation
}

export interface EdgeShapingPlan {
  side: ShapingSide
  rules: ShapingRule[]
  totalRows: number
  totalIncreasedStitches: number
  totalDecreasedStitches: number
  supported: boolean
}
