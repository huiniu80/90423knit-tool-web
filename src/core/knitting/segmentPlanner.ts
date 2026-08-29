import type { FabricCanvas, Gauge } from '../gauge/gauge.types'
import type { ShapeBoundarySegment } from '../geometry/boundarySegments'
import { generateInstructions, generateEdgeShapingPlan, edgeShapingPlanToLabelLines } from './planner'
import type { KnitDirection, ShapingSide } from './planner.types'
import { rasterize } from '../raster/rasterizer'
import type { RasterOptions, RasterRow, StitchSegment } from '../raster/raster.types'

export interface SegmentShapingDescription {
  boundarySide: ShapingSide | 'both'
  lines: string[]
}

function trackRows(rows: readonly RasterRow[], side: ShapingSide): RasterRow[] {
  return rows.map((row) => {
    const source = side === 'left' ? row.segments[0] : row.segments.at(-1)
    const segment: StitchSegment[] = source ? [{ ...source }] : []
    return {
      ...row,
      segments: segment,
      stitchCount: source ? source.endStitch - source.startStitch + 1 : 0,
    }
  })
}

function planLines(
  rows: readonly RasterRow[],
  direction: KnitDirection,
  side: ShapingSide,
): string[] {
  const instructions = generateInstructions([...rows], direction)
  return edgeShapingPlanToLabelLines(
    generateEdgeShapingPlan(instructions, side),
    instructions.length > 0,
  )
}

function prefixedLines(prefix: string, lines: readonly string[]): string[] {
  return lines.map((line) => `${prefix} · ${line}`)
}

export function describeBoundarySegmentShaping(
  segment: ShapeBoundarySegment,
  direction: KnitDirection,
  gauge: Gauge,
  canvas: FabricCanvas,
  rasterOptions: RasterOptions,
  outlineCenterX: number,
): SegmentShapingDescription {
  const rows = rasterize(segment.rasterShape, gauge, canvas, rasterOptions)
  const hasSeparatedTracks = rows.some((row) => row.segments.length > 1)
  if (segment.spansBothSides || hasSeparatedTracks) {
    const sourceRows = hasSeparatedTracks ? null : rows
    return {
      boundarySide: 'both',
      lines: [
        ...prefixedLines('左支', planLines(sourceRows ?? trackRows(rows, 'left'), direction, 'left')),
        ...prefixedLines('右支', planLines(sourceRows ?? trackRows(rows, 'right'), direction, 'right')),
      ],
    }
  }

  const boundarySide: ShapingSide = segment.anchor.x <= outlineCenterX ? 'left' : 'right'
  return {
    boundarySide,
    lines: planLines(rows, direction, boundarySide),
  }
}
