import type { Shape } from '../core/geometry/shape.types'
import type { KnitDirection } from '../core/knitting/planner.types'
import type { KnittingInstruction } from '../core/knitting/planner.types'
import type { RasterRow } from '../core/raster/raster.types'
import type { PathNode } from '../core/geometry/shape.types'

export type EditorTool =
  | 'select'
  | 'pan'
  | 'polygon'
  | 'path'
  | 'rectangle'
  | 'triangle'
  | 'circle'
  | 'ellipse'

export type ViewMode = 'outline' | 'grid' | 'overlay'

export interface ShapePlan {
  shapeId: string
  shapeName?: string
  shapeType: Shape['type']
  direction: KnitDirection
  rasterRows: RasterRow[]
  instructions: KnittingInstruction[]
  totalStitches: number
  hasSeparatedRegions: boolean
  isFabric: boolean
}

export interface ImportedPathCommit {
  nodes: PathNode[]
  widthCm: number
  heightCm: number
  targetShapeId: string | null
  name?: string
}
