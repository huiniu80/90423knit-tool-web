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
  transition: InstructionTransition
  centerChange: number
  panelChanges: PanelChange[]
}

export type InstructionTransition =
  | 'cast-on'
  | 'cast-on-separated'
  | 'continue'
  | 'split'
  | 'join'
  | 'unsupported'

export type PanelRole = 'body' | 'left-shoulder' | 'right-shoulder'

export interface PanelChange {
  panel: PanelRole
  leftChange: number
  rightChange: number
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

export type GarmentEdgeRole =
  | 'left-outer'
  | 'left-neck'
  | 'right-neck'
  | 'right-outer'

export interface GarmentEdgeShapingPlan
  extends Omit<EdgeShapingPlan, 'side'> {
  edge: GarmentEdgeRole
  label: string
}
