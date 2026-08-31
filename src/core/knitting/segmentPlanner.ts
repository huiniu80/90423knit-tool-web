import type { FabricCanvas, Gauge } from '../gauge/gauge.types'
import type { ShapeBoundarySegment } from '../geometry/boundarySegments'
import {
  generateGarmentEdgeShapingSequence,
  generateInstructions,
  stepNumberLabel,
} from './planner'
import type {
  GarmentEdgeRole,
  KnitDirection,
  ShapingSequenceStep,
  ShapingSide,
} from './planner.types'
import { rasterize } from '../raster/rasterizer'
import type { RasterOptions, RasterRow } from '../raster/raster.types'
import { getShapeBounds } from '../geometry/geometry'

export interface SegmentShapingDescription {
  boundarySide: ShapingSide | 'both'
  lines: string[]
  markers: SegmentShapingMarker[]
}

export interface SegmentShapingMarker {
  label: string
  point: { x: number; y: number }
}

const shortEdgeLabels: Record<GarmentEdgeRole, string> = {
  'left-outer': '左外侧',
  'left-neck': '左肩领口侧',
  'right-neck': '右肩领口侧',
  'right-outer': '右外侧',
}

function nearestGarmentEdge(
  rows: readonly RasterRow[],
  anchor: { x: number; y: number },
  stitchWidthCm: number,
): GarmentEdgeRole | null {
  let nearestEdge: GarmentEdgeRole | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  const include = (edge: GarmentEdgeRole, x: number, y: number): void => {
    const distance = Math.hypot(anchor.x - x, anchor.y - y)
    if (distance < nearestDistance) {
      nearestEdge = edge
      nearestDistance = distance
    }
  }

  rows.forEach((row) => {
    const left = row.segments[0]
    const right = row.segments.at(-1)
    if (!left || !right) return
    include('left-outer', left.startStitch * stitchWidthCm, row.yCm)
    include('right-outer', (right.endStitch + 1) * stitchWidthCm, row.yCm)
    if (row.segments.length === 2) {
      include('left-neck', (left.endStitch + 1) * stitchWidthCm, row.yCm)
      include('right-neck', right.startStitch * stitchWidthCm, row.yCm)
    }
  })
  return nearestEdge
}

function edgePoint(
  row: RasterRow,
  edge: GarmentEdgeRole,
  stitchWidthCm: number,
): { x: number; y: number } | null {
  const left = row.segments[0]
  const right = row.segments.at(-1)
  if (!left || !right) return null
  switch (edge) {
    case 'left-outer':
      return { x: left.startStitch * stitchWidthCm, y: row.yCm }
    case 'right-outer':
      return { x: (right.endStitch + 1) * stitchWidthCm, y: row.yCm }
    case 'left-neck':
      return row.segments.length === 2
        ? { x: (left.endStitch + 1) * stitchWidthCm, y: row.yCm }
        : null
    case 'right-neck':
      return row.segments.length === 2
        ? { x: right.startStitch * stitchWidthCm, y: row.yCm }
        : null
  }
}

function rowRange(step: ShapingSequenceStep): string {
  const firstChangeRow = step.endRowNumber - step.everyRows * (step.repeatCount - 1)
  return firstChangeRow === step.endRowNumber
    ? `${step.endRowNumber}行`
    : `${firstChangeRow}–${step.endRowNumber}行`
}

function compactStepText(step: ShapingSequenceStep, includeEdge: boolean): string {
  const isOuterBindOff = step.operation === 'decrease'
    && (step.edge === 'left-outer' || step.edge === 'right-outer')
    && step.stitchCount > 1
  const operation = step.operation === 'increase' ? '加' : isOuterBindOff ? '平收' : '减'
  const edge = includeEdge ? `${shortEdgeLabels[step.edge]} · ` : ''
  if (step.repeatCount === 1) {
    return `${edge}第${rowRange(step)} · ${operation}${step.stitchCount}针1次`
  }
  return `${edge}第${rowRange(step)} · 每${step.everyRows}行${operation}${step.stitchCount}针×${step.repeatCount}`
}

function instructionRange(start: number, end: number): string {
  return start === end ? `第 ${start} 行` : `第 ${start}–${end} 行`
}

function instructionRowsInBounds(
  instructions: readonly ReturnType<typeof generateInstructions>[number][],
  rows: readonly RasterRow[],
  bounds: ReturnType<typeof getShapeBounds>,
  rowHeightCm: number,
): Array<ReturnType<typeof generateInstructions>[number]> {
  const rowByIndex = new Map(rows.map((row) => [row.rowIndex, row]))
  const tolerance = rowHeightCm * 0.15
  return instructions.filter((instruction) => {
    const row = rowByIndex.get(instruction.sourceRowIndex)
    return row && row.yCm >= bounds.y - tolerance
      && row.yCm <= bounds.y + bounds.height + tolerance
  })
}

function edgeStitchCount(row: RasterRow | undefined, edge: GarmentEdgeRole): number {
  if (!row?.segments.length) return 0
  const segment = edge === 'left-outer' || edge === 'left-neck'
    ? row.segments[0]
    : row.segments.at(-1)
  return segment ? segment.endStitch - segment.startStitch + 1 : 0
}

export function describeBoundarySegmentShaping(
  segment: ShapeBoundarySegment,
  direction: KnitDirection,
  gauge: Gauge,
  canvas: FabricCanvas,
  rasterOptions: RasterOptions,
  outlineCenterX: number,
): SegmentShapingDescription {
  if (segment.sourceShape.type === 'path' && !segment.sourceShape.closed) {
    return {
      boundarySide: 'both',
      lines: ['开放路径不形成织片'],
      markers: [],
    }
  }

  const rows = rasterize(segment.sourceShape, gauge, canvas, rasterOptions)
  const instructions = generateInstructions(rows, direction)
  const activeRows = rows.filter((row) => row.stitchCount > 0)
  if (!activeRows.length) return { boundarySide: 'both', lines: ['未落入针格'], markers: [] }

  const bounds = getShapeBounds(segment.rasterShape)
  const firstRow = direction === 'bottom-up' ? activeRows[0] : activeRows.at(-1)
  const lastRow = direction === 'bottom-up' ? activeRows.at(-1) : activeRows[0]
  const isHorizontal = bounds.height <= gauge.rowHeightCm * 0.55
  if (isHorizontal && firstRow && Math.abs(segment.anchor.y - firstRow.yCm) <= gauge.rowHeightCm) {
    const castOnLabel = direction === 'bottom-up' ? '下摆起针' : '肩部起针'
    return {
      boundarySide: 'both',
      lines: [
        `${castOnLabel} · 共起 ${firstRow.stitchCount} 针`,
        `第 1 行开始 · ${direction === 'bottom-up' ? '自下而上编织' : '自上而下编织'}`,
      ],
      markers: [],
    }
  }
  if (isHorizontal && lastRow && Math.abs(segment.anchor.y - lastRow.yCm) <= gauge.rowHeightCm) {
    if (direction === 'bottom-up' && lastRow.segments.length === 2) {
      const side = segment.anchor.x <= outlineCenterX ? '左肩' : '右肩'
      const segmentIndex = side === '左肩' ? 0 : 1
      const shoulderStitches = lastRow.segments[segmentIndex]
        ? lastRow.segments[segmentIndex]!.endStitch - lastRow.segments[segmentIndex]!.startStitch + 1
        : 0
      const panelRole = side === '左肩' ? 'left-shoulder' : 'right-shoulder'
      const lastChangeRow = [...instructions].reverse().find((instruction) =>
        instruction.panelChanges.some((change) =>
          change.panel === panelRole && (change.leftChange !== 0 || change.rightChange !== 0),
        ),
      )?.rowNumber ?? instructions.find((instruction) => instruction.transition === 'split')?.rowNumber ?? 0
      const flatStart = Math.min(instructions.length, lastChangeRow + 1)
      const flatRows = Math.max(0, instructions.length - flatStart + 1)
      return {
        boundarySide: 'both',
        lines: [
          `${side} · 保留 ${shoulderStitches} 针`,
          flatRows > 0
            ? `${instructionRange(flatStart, instructions.length)} · 不加不减（平织 ${flatRows} 行）`
            : '肩线处直接收针',
          `织完平收 ${shoulderStitches} 针`,
        ],
        markers: [],
      }
    }
    return { boundarySide: 'both', lines: [`结束边 · 平收 ${lastRow.stitchCount} 针`], markers: [] }
  }

  const edge = nearestGarmentEdge(rows, segment.anchor, gauge.stitchWidthCm)
  if (!edge) return { boundarySide: 'both', lines: ['未识别织片边界'], markers: [] }
  const split = instructions.find((instruction) => instruction.transition === 'split')
  const isNeck = edge === 'left-neck' || edge === 'right-neck'
  const spansNeck = isNeck
    && bounds.x <= outlineCenterX
    && bounds.x + bounds.width >= outlineCenterX
  const edges: GarmentEdgeRole[] = spansNeck ? ['left-neck', 'right-neck'] : [edge]
  const allEdgeSteps = edges.flatMap((currentEdge) =>
    generateGarmentEdgeShapingSequence(instructions, currentEdge),
  )
  const stepsInBounds = allEdgeSteps.filter((step) => {
    const row = rows.find((item) => item.rowIndex === step.startSourceRowIndex)
    return row && row.yCm >= bounds.y - gauge.rowHeightCm
      && row.yCm <= bounds.y + bounds.height + gauge.rowHeightCm
  })
  // 同一个袖窿或领口可能由多个几何线段组成。只要当前线段命中了该部位的
  // 任一减针点，就给出该部位的完整规律，画布层再归并相同卡片。
  const steps = (stepsInBounds.length ? allEdgeSteps : []).sort((left, right) =>
    left.startRowNumber - right.startRowNumber || edges.indexOf(left.edge) - edges.indexOf(right.edge),
  )
  const numberedSteps = steps.map((step, index) => ({ ...step, order: index + 1 }))
  const orderText = numberedSteps.map((step) => stepNumberLabel(step.order)).join(' → ')
  const totalChangedStitches = numberedSteps.reduce(
    (sum, step) => sum + step.stitchCount * step.repeatCount,
    0,
  )
  const outerTitle = edge === 'left-outer' ? '左袖窿' : edge === 'right-outer' ? '右袖窿' : null
  const lines = numberedSteps.length
    ? [
        `${outerTitle ?? (edges.length > 1 ? '圆领塑形' : shortEdgeLabels[edge])} · 按 ${orderText} 编织`,
        ...numberedSteps.map((step) =>
          `${stepNumberLabel(step.order)}. ${compactStepText(step, edges.length > 1)}`,
        ),
        ...(edges.length === 1 ? [`该侧共${numberedSteps[0]?.operation === 'increase' ? '加' : '减'} ${totalChangedStitches} 针`] : []),
      ]
    : []
  if (isNeck && split) {
    lines.unshift(
      `领口起始 · 第 ${split.rowNumber} 行中间收 ${Math.abs(split.centerChange)} 针`,
      `左肩留 ${edgeStitchCount(rows.find((row) => row.rowIndex === split.sourceRowIndex), 'left-neck')} 针 · 右肩留 ${edgeStitchCount(rows.find((row) => row.rowIndex === split.sourceRowIndex), 'right-neck')} 针`,
      '左右肩从此分开编织，领口侧镜像减针',
    )
  }

  if (!lines.length) {
    const boundedInstructions = instructionRowsInBounds(instructions, rows, bounds, gauge.rowHeightCm)
    const firstInstruction = boundedInstructions[0]
    const lastInstruction = boundedInstructions.at(-1)
    const firstOuterChange = instructions.find((instruction) =>
      instruction.leftChange !== 0 || instruction.rightChange !== 0,
    )?.rowNumber
    const side = edge === 'left-outer' ? '左侧' : edge === 'right-outer' ? '右侧' : shortEdgeLabels[edge]
    const part = firstOuterChange && (lastInstruction?.rowNumber ?? 0) < firstOuterChange
      ? `${side}身体`
      : `${side}边界`
    const row = firstInstruction
      ? rows.find((item) => item.rowIndex === firstInstruction.sourceRowIndex)
      : undefined
    const stitches = edgeStitchCount(row, edge)
    const rowCount = firstInstruction && lastInstruction
      ? lastInstruction.rowNumber - firstInstruction.rowNumber + 1
      : 0
    lines.push(
      firstInstruction && lastInstruction
        ? `${part} · ${instructionRange(firstInstruction.rowNumber, lastInstruction.rowNumber)}`
        : `${part}`,
      `${stitches || firstInstruction?.stitchCount || 0} 针 · 不加不减（平织 ${rowCount} 行）`,
    )
  }

  const markers = numberedSteps.flatMap((step) => {
    const row = rows.find((item) => item.rowIndex === step.startSourceRowIndex)
    const point = row ? edgePoint(row, step.edge, gauge.stitchWidthCm) : null
    // 画布圆点本身已经提供了圆形语义，使用普通数字可避免“圆中套圆”影响辨认。
    return point ? [{ label: String(step.order), point }] : []
  })

  return {
    boundarySide: 'both',
    lines,
    markers,
  }
}
