export interface StitchDefinition {
  id: string
  name: string
  color: string | null
  /** One operation spans this many chart cells, regardless of its needle counts. */
  span: number
  input: number
  output: number
  paths: number[][]
  steps: string[]
  kind: 'knit' | 'purl' | 'twist' | 'slip' | 'increase' | 'decrease' | 'cable' | 'custom'
  custom?: boolean
}
export interface StitchMark { id: string; x: number; y: number; stitchId: string; automatic?: boolean }
export interface PatternSample { id: string; name: string; width: number; height: number; marks: StitchMark[] }
export interface PatternPlacement extends PatternSample { x: number; y: number }
export interface DrawingDocument {
  version: 1
  marks: StitchMark[]
  automaticMarks?: StitchMark[]
  definitions: StitchDefinition[]
  samples: PatternSample[]
  placements: PatternPlacement[]
  generatedShapeIds: string[]
  convention: 'appearance' | 'operation' | null
}
export const emptyDrawing = (): DrawingDocument => ({ version: 1, marks: [], definitions: [], samples: [], placements: [], generatedShapeIds: [], convention: 'operation' })
export type DrawingTool = 'paint' | 'erase' | 'sample' | 'place'
