import { describe, expect, it } from 'vitest'
import type { RasterRow } from '../raster/raster.types'
import { generateInstructions, instructionToText } from './planner'

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
})
