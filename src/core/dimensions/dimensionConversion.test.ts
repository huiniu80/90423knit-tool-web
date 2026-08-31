import { describe, expect, it } from 'vitest'
import { calculateGauge } from '../gauge/gauge'
import { convertDimension, createShapeDimensionResults, formatCm } from './dimensionConversion'

describe('dimension conversion', () => {
  it('同时给出 19cm 在 2.8行/cm 下的上下取整及偏差', () => {
    const result = convertDimension('piece', 0, 'rows', 19, 2.8, null, { x: 0, y: 0 })
    expect(result.rawCount).toBeCloseTo(53.2)
    expect(result.floor).toMatchObject({ count: 53, actualCm: 53 / 2.8 })
    expect(result.floor.deviationCm).toBeCloseTo(-0.071428)
    expect(result.ceil.count).toBe(54)
    expect(result.ceil.deviationCm).toBeCloseTo(0.285714)
    expect(result.confirmed).toBe(false)
  })

  it('整数结果无需确认并去除厘米末尾零', () => {
    const result = convertDimension('piece', 0, 'stitches', 18, 2, null, { x: 0, y: 0 })
    expect(result.exact).toBe(true)
    expect(result.selected?.count).toBe(36)
    expect(formatCm(18.00)).toBe('18')
    expect(formatCm(18.125)).toBe('18.13')
  })

  it('斜线拆分横纵结果，水平线省略零纵向跨度', () => {
    const gauge = calculateGauge({ sampleStitches: 20, sampleRows: 28, sampleWidthCm: 10, sampleHeightCm: 10 })
    const diagonal = createShapeDimensionResults({
      id: 'diagonal', type: 'path', closed: false,
      nodes: [{ anchor: { x: 1, y: 2 } }, { anchor: { x: 5, y: 7 } }],
    }, gauge, { stitches: null, rows: null })
    const horizontal = createShapeDimensionResults({
      id: 'horizontal', type: 'path', closed: false,
      nodes: [{ anchor: { x: 1, y: 2 } }, { anchor: { x: 5, y: 2 } }],
    }, gauge, { stitches: null, rows: null })
    expect(diagonal.map((item) => item.axis)).toEqual(['stitches', 'rows'])
    expect(horizontal.map((item) => item.axis)).toEqual(['stitches'])
  })
})
