import type { RasterRow, StitchSegment } from '../raster/raster.types'
import type {
  EdgeShapingPlan,
  KnitDirection,
  KnittingInstruction,
  ShapingRule,
  ShapingOperation,
  ShapingSide,
} from './planner.types'

function activeSpan(rows: RasterRow[]): RasterRow[] {
  const first = rows.findIndex((row) => row.stitchCount > 0)
  let last = -1
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if ((rows[index]?.stitchCount ?? 0) > 0) {
      last = index
      break
    }
  }
  return first === -1 ? [] : rows.slice(first, last + 1)
}

function firstSegment(segments: StitchSegment[]): StitchSegment | undefined {
  return segments.length === 1 ? segments[0] : undefined
}

export function generateInstructions(
  rasterRows: RasterRow[],
  direction: KnitDirection,
): KnittingInstruction[] {
  const physicalRows = activeSpan(rasterRows)
  const ordered = direction === 'bottom-up' ? physicalRows : [...physicalRows].reverse()

  return ordered.map((row, index) => {
    const previous = index > 0 ? ordered[index - 1] : undefined
    const currentSegment = firstSegment(row.segments)
    const previousSegment = previous ? firstSegment(previous.segments) : undefined
    const supported = row.segments.length <= 1 && (!previous || previous.segments.length <= 1)
    const isCastOn = Boolean(currentSegment && !previousSegment)

    return {
      rowNumber: index + 1,
      sourceRowIndex: row.rowIndex,
      stitchCount: row.stitchCount,
      segments: row.segments,
      leftChange:
        currentSegment && previousSegment
          ? previousSegment.startStitch - currentSegment.startStitch
          : 0,
      rightChange:
        currentSegment && previousSegment
          ? currentSegment.endStitch - previousSegment.endStitch
          : 0,
      isCastOn,
      supported,
    }
  })
}

function describeChange(side: '左侧' | '右侧', value: number): string | null {
  if (value > 0) return `${side}加${value}针`
  if (value < 0) return `${side}减${Math.abs(value)}针`
  return null
}

export function instructionToText(instruction: KnittingInstruction): string {
  if (!instruction.supported) return `第${instruction.rowNumber}行：包含分离区域，暂不支持自动编织操作`
  if (instruction.isCastOn) return `第${instruction.rowNumber}行：起${instruction.stitchCount}针`
  if (instruction.stitchCount === 0) return `第${instruction.rowNumber}行：断开编织区域`

  const changes = [
    describeChange('左侧', instruction.leftChange),
    describeChange('右侧', instruction.rightChange),
  ].filter(Boolean)
  return `第${instruction.rowNumber}行：${changes.length ? changes.join('，') : '不加不减'}`
}

export function generateEdgeShapingPlan(
  instructions: readonly KnittingInstruction[],
  side: ShapingSide,
): EdgeShapingPlan {
  const rules: EdgeShapingPlan['rules'] = []
  let previousChangeRow = 0
  let totalIncreasedStitches = 0
  let totalDecreasedStitches = 0

  for (const instruction of instructions) {
    if (!instruction.supported) {
      return {
        side,
        rules: [],
        totalRows: 0,
        totalIncreasedStitches: 0,
        totalDecreasedStitches: 0,
        supported: false,
      }
    }

    const change = side === 'left' ? instruction.leftChange : instruction.rightChange
    if (change === 0) continue

    const operation: ShapingOperation = change > 0 ? 'increase' : 'decrease'
    const everyRows = instruction.rowNumber - previousChangeRow
    const stitchCount = Math.abs(change)
    previousChangeRow = instruction.rowNumber

    if (operation === 'increase') totalIncreasedStitches += stitchCount
    else totalDecreasedStitches += stitchCount

    const previousRule = rules.at(-1)
    if (
      previousRule
      && previousRule.operation === operation
      && previousRule.everyRows === everyRows
      && previousRule.stitchCount === stitchCount
    ) {
      previousRule.repeatCount += 1
    } else {
      rules.push({ everyRows, stitchCount, repeatCount: 1, operation })
    }
  }

  return {
    side,
    rules,
    totalRows: rules.reduce(
      (sum, rule) => sum + rule.everyRows * rule.repeatCount,
      0,
    ),
    totalIncreasedStitches,
    totalDecreasedStitches,
    supported: true,
  }
}

export function shapingRuleToLabel(rule: ShapingRule): string {
  const operation = rule.operation === 'increase' ? '加' : '减'
  return `${operation} ${rule.everyRows}-${rule.stitchCount}-${rule.repeatCount}`
}

export function edgeShapingPlanToLabelLines(
  plan: EdgeShapingPlan,
  hasInstructions: boolean,
): string[] {
  if (!hasInstructions) return ['未落入针格']
  if (!plan.supported) return ['暂不支持归纳']
  if (!plan.rules.length) return ['不加不减']
  return plan.rules.map(shapingRuleToLabel)
}
