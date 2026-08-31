import type { RasterRow, StitchSegment } from '../raster/raster.types'
import type {
  EdgeShapingPlan,
  GarmentEdgeRole,
  GarmentEdgeShapingPlan,
  KnitDirection,
  KnittingInstruction,
  ShapingRule,
  ShapingSequenceStep,
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

export function generateInstructions(
  rasterRows: RasterRow[],
  direction: KnitDirection,
): KnittingInstruction[] {
  const physicalRows = activeSpan(rasterRows)
  const ordered = direction === 'bottom-up' ? physicalRows : [...physicalRows].reverse()

  return ordered.map((row, index) => {
    const previous = index > 0 ? ordered[index - 1] : undefined
    const current = row.segments
    const before = previous?.segments ?? []
    const supported = current.length <= 2 && before.length <= 2
    const isCastOn = !previous
    const panelChanges: KnittingInstruction['panelChanges'] = []
    let transition: KnittingInstruction['transition'] = 'continue'
    let centerChange = 0
    let leftChange = 0
    let rightChange = 0

    if (!supported) {
      transition = 'unsupported'
    } else if (!previous) {
      transition = current.length === 2 ? 'cast-on-separated' : 'cast-on'
    } else if (before.length === 1 && current.length === 1) {
      leftChange = before[0]!.startStitch - current[0]!.startStitch
      rightChange = current[0]!.endStitch - before[0]!.endStitch
      panelChanges.push({ panel: 'body', leftChange, rightChange })
    } else if (before.length === 1 && current.length === 2) {
      transition = 'split'
      leftChange = before[0]!.startStitch - current[0]!.startStitch
      rightChange = current[1]!.endStitch - before[0]!.endStitch
      centerChange = -(current[1]!.startStitch - current[0]!.endStitch - 1)
      panelChanges.push(
        { panel: 'left-shoulder', leftChange, rightChange: 0 },
        { panel: 'right-shoulder', leftChange: 0, rightChange },
      )
    } else if (before.length === 2 && current.length === 2) {
      const leftOuter = before[0]!.startStitch - current[0]!.startStitch
      const leftNeck = current[0]!.endStitch - before[0]!.endStitch
      const rightNeck = before[1]!.startStitch - current[1]!.startStitch
      const rightOuter = current[1]!.endStitch - before[1]!.endStitch
      leftChange = leftOuter
      rightChange = rightOuter
      panelChanges.push(
        { panel: 'left-shoulder', leftChange: leftOuter, rightChange: leftNeck },
        { panel: 'right-shoulder', leftChange: rightNeck, rightChange: rightOuter },
      )
    } else if (before.length === 2 && current.length === 1) {
      transition = 'join'
      leftChange = before[0]!.startStitch - current[0]!.startStitch
      rightChange = current[0]!.endStitch - before[1]!.endStitch
      centerChange = before[1]!.startStitch - before[0]!.endStitch - 1
      panelChanges.push({ panel: 'body', leftChange, rightChange })
    } else {
      transition = 'unsupported'
    }

    return {
      rowNumber: index + 1,
      sourceRowIndex: row.rowIndex,
      stitchCount: row.stitchCount,
      segments: row.segments,
      leftChange,
      rightChange,
      isCastOn,
      supported: supported && transition !== 'unsupported',
      transition,
      centerChange,
      panelChanges,
    }
  })
}

function describeChange(side: string, value: number): string | null {
  if (value > 0) return `${side}加${value}针`
  if (value < 0) return `${side}减${Math.abs(value)}针`
  return null
}

export function instructionToText(instruction: KnittingInstruction): string {
  if (!instruction.supported) return `第${instruction.rowNumber}行：同时出现三块以上织片，需要手动确认结构`
  if (instruction.transition === 'cast-on-separated') {
    const [left, right] = instruction.segments
    return `第${instruction.rowNumber}行：左片起${segmentStitchCount(left)}针，右片起${segmentStitchCount(right)}针，分开编织`
  }
  if (instruction.isCastOn) return `第${instruction.rowNumber}行：下摆起${instruction.stitchCount}针`
  if (instruction.stitchCount === 0) return `第${instruction.rowNumber}行：断开编织区域`

  if (instruction.transition === 'split') {
    const [left, right] = instruction.segments
    return `第${instruction.rowNumber}行：织左肩${segmentStitchCount(left)}针，中间收${Math.abs(instruction.centerChange)}针，织右肩${segmentStitchCount(right)}针；之后左右肩分开编织`
  }
  if (instruction.transition === 'join') {
    return `第${instruction.rowNumber}行：中间加起${instruction.centerChange}针，连接左右织片`
  }

  if (instruction.segments.length === 2) {
    const labels = instruction.panelChanges.flatMap((change) => {
      const panel = change.panel === 'left-shoulder' ? '左肩' : '右肩'
      const leftEdge = change.panel === 'left-shoulder' ? '外侧' : '领口侧'
      const rightEdge = change.panel === 'left-shoulder' ? '领口侧' : '外侧'
      return [
        describeChange(`${panel}${leftEdge}`, change.leftChange),
        describeChange(`${panel}${rightEdge}`, change.rightChange),
      ].filter((value): value is string => Boolean(value))
    })
    return `第${instruction.rowNumber}行：${labels.length ? labels.join('，') : '左右肩均不加不减'}`
  }

  const changes = [
    describeChange('左侧', instruction.leftChange),
    describeChange('右侧', instruction.rightChange),
  ].filter(Boolean)
  return `第${instruction.rowNumber}行：${changes.length ? changes.join('，') : '不加不减'}`
}

function segmentStitchCount(segment: StitchSegment | undefined): number {
  return segment ? segment.endStitch - segment.startStitch + 1 : 0
}

const garmentEdgeLabels: Record<GarmentEdgeRole, string> = {
  'left-outer': '左外侧边界',
  'left-neck': '左肩领口侧',
  'right-neck': '右肩领口侧',
  'right-outer': '右外侧边界',
}

function garmentEdgeChange(
  instruction: KnittingInstruction,
  edge: GarmentEdgeRole,
): number {
  const panel = edge === 'left-outer' || edge === 'left-neck'
    ? instruction.panelChanges.find((item) =>
      item.panel === 'left-shoulder' || (edge === 'left-outer' && item.panel === 'body'),
    )
    : instruction.panelChanges.find((item) =>
      item.panel === 'right-shoulder' || (edge === 'right-outer' && item.panel === 'body'),
    )
  if (!panel) return 0
  return edge === 'left-outer' || edge === 'right-neck'
    ? panel.leftChange
    : panel.rightChange
}

export function generateGarmentEdgeShapingPlan(
  instructions: readonly KnittingInstruction[],
  edge: GarmentEdgeRole,
): GarmentEdgeShapingPlan {
  if (instructions.some((instruction) => !instruction.supported)) {
    return {
      edge,
      label: garmentEdgeLabels[edge],
      rules: [],
      totalRows: 0,
      totalIncreasedStitches: 0,
      totalDecreasedStitches: 0,
      supported: false,
    }
  }
  const sequence = generateGarmentEdgeShapingSequence(instructions, edge)
  const rules: ShapingRule[] = sequence.map((step) => ({
    everyRows: step.everyRows,
    stitchCount: step.stitchCount,
    repeatCount: step.repeatCount,
    operation: step.operation,
  }))
  const totalIncreasedStitches = sequence
    .filter((step) => step.operation === 'increase')
    .reduce((sum, step) => sum + step.stitchCount * step.repeatCount, 0)
  const totalDecreasedStitches = sequence
    .filter((step) => step.operation === 'decrease')
    .reduce((sum, step) => sum + step.stitchCount * step.repeatCount, 0)

  return {
    edge,
    label: garmentEdgeLabels[edge],
    rules,
    totalRows: rules.reduce((sum, rule) => sum + rule.everyRows * rule.repeatCount, 0),
    totalIncreasedStitches,
    totalDecreasedStitches,
    supported: true,
  }
}

export function generateGarmentEdgeShapingSequence(
  instructions: readonly KnittingInstruction[],
  edge: GarmentEdgeRole,
): ShapingSequenceStep[] {
  if (instructions.some((instruction) => !instruction.supported)) return []
  const sequence: ShapingSequenceStep[] = []
  const isNeckEdge = edge === 'left-neck' || edge === 'right-neck'
  let previousChangeRow = isNeckEdge
    ? instructions.find((instruction) => instruction.transition === 'split')?.rowNumber ?? 0
    : 0

  for (const instruction of instructions) {
    const change = garmentEdgeChange(instruction, edge)
    if (!change) continue
    const operation: ShapingOperation = change > 0 ? 'increase' : 'decrease'
    const everyRows = instruction.rowNumber - previousChangeRow
    const previousStep = sequence.at(-1)
    if (
      previousStep
      && previousStep.operation === operation
      && previousStep.everyRows === everyRows
      && previousStep.stitchCount === Math.abs(change)
    ) {
      previousStep.repeatCount += 1
      previousStep.endRowNumber = instruction.rowNumber
      previousStep.endSourceRowIndex = instruction.sourceRowIndex
    } else {
      sequence.push({
        order: sequence.length + 1,
        edge,
        label: garmentEdgeLabels[edge],
        startRowNumber: previousChangeRow + 1,
        endRowNumber: instruction.rowNumber,
        startSourceRowIndex: instruction.sourceRowIndex,
        endSourceRowIndex: instruction.sourceRowIndex,
        everyRows,
        stitchCount: Math.abs(change),
        repeatCount: 1,
        operation,
      })
    }
    previousChangeRow = instruction.rowNumber
  }
  return sequence
}

export function stepNumberLabel(order: number): string {
  return String(order)
}

export function shapingSequenceStepToText(step: ShapingSequenceStep): string {
  const operation = step.operation === 'increase' ? '加' : '减'
  const range = step.startRowNumber === step.endRowNumber
    ? `第 ${step.startRowNumber} 行`
    : `第 ${step.startRowNumber}–${step.endRowNumber} 行`
  return `${range}：每 ${step.everyRows} 行${operation} ${step.stitchCount} 针，共 ${step.repeatCount} 次`
}

export function generateGarmentEdgeShapingPlans(
  instructions: readonly KnittingInstruction[],
): GarmentEdgeShapingPlan[] {
  return (Object.keys(garmentEdgeLabels) as GarmentEdgeRole[])
    .map((edge) => generateGarmentEdgeShapingPlan(instructions, edge))
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
  plan: EdgeShapingPlan | GarmentEdgeShapingPlan,
  hasInstructions: boolean,
): string[] {
  if (!hasInstructions) return ['未落入针格']
  if (!plan.supported) return ['暂不支持归纳']
  if (!plan.rules.length) return ['不加不减']
  return plan.rules.map(shapingRuleToLabel)
}
