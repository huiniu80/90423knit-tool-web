import type { GaugeInput, FabricCanvas } from '../core/gauge/gauge.types'
import type { Shape } from '../core/geometry/shape.types'
import type { KnitDirection } from '../core/knitting/planner.types'
import type { KnittingInstruction } from '../core/knitting/planner.types'
import type { RasterOptions } from '../core/raster/raster.types'
import type { RasterRow } from '../core/raster/raster.types'

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
}

export interface KnittingProject {
  version: 3
  gauge: GaugeInput
  canvas: FabricCanvas
  shapeDirections: Record<string, KnitDirection>
  rasterOptions: RasterOptions
  shapes: Shape[]
}

interface LegacyKnittingProject extends Omit<KnittingProject, 'version' | 'shapeDirections'> {
  version: 1 | 2
  direction: KnitDirection
}

export type ImportableKnittingProject = KnittingProject | LegacyKnittingProject
