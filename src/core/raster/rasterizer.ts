import type { FabricCanvas, Gauge } from '../gauge/gauge.types'
import { calculateFabricGrid } from '../gauge/gauge'
import { getHorizontalIntervals } from '../geometry/geometry'
import type { HorizontalInterval, Shape } from '../geometry/shape.types'
import type {
  RasterMode,
  RasterOptions,
  RasterRow,
  StitchSegment,
} from './raster.types'

const EPSILON = 1e-9

function intervalToSegment(
  interval: HorizontalInterval,
  stitchWidthCm: number,
  mode: RasterMode,
): StitchSegment {
  switch (mode) {
    case 'inside':
      return {
        startStitch: Math.ceil(interval.startX / stitchWidthCm - EPSILON),
        endStitch: Math.floor(interval.endX / stitchWidthCm + EPSILON) - 1,
      }
    case 'outside':
      return {
        startStitch: Math.floor(interval.startX / stitchWidthCm),
        endStitch: Math.ceil(interval.endX / stitchWidthCm - EPSILON) - 1,
      }
    case 'center':
      return {
        startStitch: Math.ceil(interval.startX / stitchWidthCm - 0.5 - EPSILON),
        endStitch: Math.floor(interval.endX / stitchWidthCm - 0.5 + EPSILON),
      }
  }
}

function mergeAndClipSegments(
  segments: StitchSegment[],
  columnCount: number,
): StitchSegment[] {
  const clipped = segments
    .map((segment) => ({
      startStitch: Math.max(0, segment.startStitch),
      endStitch: Math.min(columnCount - 1, segment.endStitch),
    }))
    .filter((segment) => segment.startStitch <= segment.endStitch)
    .sort((a, b) => a.startStitch - b.startStitch)

  const merged: StitchSegment[] = []
  for (const segment of clipped) {
    const previous = merged.at(-1)
    if (previous && segment.startStitch <= previous.endStitch + 1) {
      previous.endStitch = Math.max(previous.endStitch, segment.endStitch)
    } else {
      merged.push({ ...segment })
    }
  }
  return merged
}

export function rasterizeShapes(
  shapes: readonly Shape[],
  gauge: Gauge,
  canvas: FabricCanvas,
  options: RasterOptions,
): RasterRow[] {
  const { columnCount, rowCount } = calculateFabricGrid(canvas, gauge)

  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const yCm = (rowIndex + 0.5) * gauge.rowHeightCm
    const segments = mergeAndClipSegments(
      shapes.flatMap((shape) =>
        getHorizontalIntervals(shape, yCm).map((interval) =>
          intervalToSegment(interval, gauge.stitchWidthCm, options.mode),
        ),
      ),
      columnCount,
    )

    return {
      rowIndex,
      yCm,
      segments,
      stitchCount: segments.reduce(
        (sum, segment) => sum + segment.endStitch - segment.startStitch + 1,
        0,
      ),
    }
  })
}

export function rasterize(
  shape: Shape,
  gauge: Gauge,
  canvas: FabricCanvas,
  options: RasterOptions,
): RasterRow[] {
  return rasterizeShapes([shape], gauge, canvas, options)
}
