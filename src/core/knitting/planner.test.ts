import { describe, expect, it } from 'vitest'
import type { RasterRow } from '../raster/raster.types'
import {
  edgeShapingPlanToLabelLines,
  generateEdgeShapingPlan,
  generateInstructions,
  instructionToText,
} from './planner'

function row(rowIndex: number, startStitch: number, endStitch: number): RasterRow {
  return {
    rowIndex,
    yCm: rowIndex + 0.5,
    segments: [{ startStitch, endStitch }],
    stitchCount: endStitch - startStitch + 1,
  }
}

describe('Knitting Planner', () => {
  it('识别左减1针', () => {
    const result = generateInstructions([row(0, 10, 14), row(1, 11, 14)], 'bottom-up')
    expect(result[1]?.leftChange).toBe(-1)
    expect(result[1]?.rightChange).toBe(0)
  })

  it('识别右减1针', () => {
    const result = generateInstructions([row(0, 10, 14), row(1, 10, 13)], 'bottom-up')
    expect(result[1]?.leftChange).toBe(0)
    expect(result[1]?.rightChange).toBe(-1)
  })

  it('识别左右各加1针', () => {
    const result = generateInstructions([row(0, 10, 14), row(1, 9, 15)], 'bottom-up')
    expect(result[1]?.leftChange).toBe(1)
    expect(result[1]?.rightChange).toBe(1)
  })

  it('top-down 反转物理行顺序', () => {
    const rows = [row(3, 10, 14), row(4, 11, 13)]
    const result = generateInstructions(rows, 'top-down')
    expect(result.map((item) => item.sourceRowIndex)).toEqual([4, 3])
    expect(result[1]?.leftChange).toBe(1)
    expect(result[1]?.rightChange).toBe(1)
  })

  it('忽略织片前后的空画布行', () => {
    const empty: RasterRow = { rowIndex: 0, yCm: 0.5, segments: [], stitchCount: 0 }
    const result = generateInstructions([empty, row(1, 2, 4), { ...empty, rowIndex: 2 }], 'bottom-up')
    expect(result).toHaveLength(1)
    expect(instructionToText(result[0]!)).toBe('第1行：起3针')
  })

  it('多区间行标记为 V1 不支持', () => {
    const multiple: RasterRow = {
      rowIndex: 0,
      yCm: 0.5,
      segments: [{ startStitch: 0, endStitch: 2 }, { startStitch: 5, endStitch: 7 }],
      stitchCount: 6,
    }
    const result = generateInstructions([multiple], 'bottom-up')
    expect(result[0]?.supported).toBe(false)
    expect(instructionToText(result[0]!)).toContain('分离区域')
  })

  it('按单侧边界生成连续的 x-y-z 减针阶段', () => {
    const starts = [
      0,
      3, 3,
      6, 6,
      9, 9,
      12, 12,
      16, 16,
      20, 20,
      24,
    ]
    const rows = starts.map((startStitch, rowIndex) => row(rowIndex, startStitch, 40))
    const instructions = generateInstructions(rows, 'bottom-up')
    const plan = generateEdgeShapingPlan(instructions, 'left')

    expect(plan.rules).toEqual([
      { everyRows: 2, stitchCount: 3, repeatCount: 4, operation: 'decrease' },
      { everyRows: 2, stitchCount: 4, repeatCount: 3, operation: 'decrease' },
    ])
    expect(plan.totalRows).toBe(14)
    expect(plan.totalDecreasedStitches).toBe(24)
    expect(plan.totalIncreasedStitches).toBe(0)
  })

  it('左右边界分别计算，不合并针数', () => {
    const instructions = generateInstructions(
      [row(0, 3, 9), row(1, 2, 10), row(2, 1, 11)],
      'bottom-up',
    )

    expect(generateEdgeShapingPlan(instructions, 'left').rules).toEqual([
      { everyRows: 2, stitchCount: 1, repeatCount: 1, operation: 'increase' },
      { everyRows: 1, stitchCount: 1, repeatCount: 1, operation: 'increase' },
    ])
    expect(generateEdgeShapingPlan(instructions, 'right').rules).toEqual([
      { everyRows: 2, stitchCount: 1, repeatCount: 1, operation: 'increase' },
      { everyRows: 1, stitchCount: 1, repeatCount: 1, operation: 'increase' },
    ])
  })

  it('加针和减针阶段保持原有顺序', () => {
    const instructions = generateInstructions(
      [row(0, 3, 9), row(1, 2, 9), row(2, 3, 9)],
      'bottom-up',
    )
    const plan = generateEdgeShapingPlan(instructions, 'left')

    expect(plan.rules.map((rule) => rule.operation)).toEqual(['increase', 'decrease'])
    expect(plan.totalIncreasedStitches).toBe(1)
    expect(plan.totalDecreasedStitches).toBe(1)
  })

  it('分离区域不生成可能误导的 x-y-z 规律', () => {
    const multiple: RasterRow = {
      rowIndex: 1,
      yCm: 1.5,
      segments: [{ startStitch: 0, endStitch: 2 }, { startStitch: 5, endStitch: 7 }],
      stitchCount: 6,
    }
    const instructions = generateInstructions([row(0, 0, 7), multiple], 'bottom-up')
    const plan = generateEdgeShapingPlan(instructions, 'left')

    expect(plan.supported).toBe(false)
    expect(plan.rules).toEqual([])
  })

  it('将多阶段加减针规律格式化为画布标注文案', () => {
    expect(edgeShapingPlanToLabelLines({
      side: 'left',
      rules: [
        { everyRows: 2, stitchCount: 1, repeatCount: 4, operation: 'increase' },
        { everyRows: 3, stitchCount: 2, repeatCount: 2, operation: 'decrease' },
      ],
      totalRows: 14,
      totalIncreasedStitches: 4,
      totalDecreasedStitches: 4,
      supported: true,
    }, true)).toEqual(['加 2-1-4', '减 3-2-2'])
  })

  it('为无变化、分离区域和未落入针格提供明确标注', () => {
    const basePlan = generateEdgeShapingPlan(
      generateInstructions([row(0, 2, 5), row(1, 2, 5)], 'bottom-up'),
      'left',
    )
    expect(edgeShapingPlanToLabelLines(basePlan, true)).toEqual(['不加不减'])
    expect(edgeShapingPlanToLabelLines({ ...basePlan, supported: false }, true))
      .toEqual(['暂不支持归纳'])
    expect(edgeShapingPlanToLabelLines(basePlan, false)).toEqual(['未落入针格'])
  })

  it('画布标注跟随 Top-Down 方向重新归纳', () => {
    const rows = [row(0, 2, 6), row(1, 3, 6), row(2, 4, 6)]
    const bottomUp = generateEdgeShapingPlan(generateInstructions(rows, 'bottom-up'), 'left')
    const topDown = generateEdgeShapingPlan(generateInstructions(rows, 'top-down'), 'left')

    expect(edgeShapingPlanToLabelLines(bottomUp, true)).toEqual(['减 2-1-1', '减 1-1-1'])
    expect(edgeShapingPlanToLabelLines(topDown, true)).toEqual(['加 2-1-1', '加 1-1-1'])
  })
})
