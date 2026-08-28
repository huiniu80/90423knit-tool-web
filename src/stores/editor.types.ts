import type { GaugeInput, FabricCanvas } from '../core/gauge/gauge.types'
import type { Shape } from '../core/geometry/shape.types'
import type { KnitDirection } from '../core/knitting/planner.types'
import type { RasterOptions } from '../core/raster/raster.types'

export type EditorTool =
  | 'select'
  | 'pan'
  | 'polygon'
  | 'rectangle'
  | 'triangle'
  | 'circle'
  | 'ellipse'

export type ViewMode = 'outline' | 'grid' | 'overlay'

export interface KnittingProject {
  version: 1
  gauge: GaugeInput
  canvas: FabricCanvas
  direction: KnitDirection
  rasterOptions: RasterOptions
  shapes: Shape[]
}
