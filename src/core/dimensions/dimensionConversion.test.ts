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

  it('直线的纵向误差不足半行时按水平线量衣', () => {
    const gauge = calculateGauge({
      sampleStitches: 11, sampleRows: 10, sampleWidthCm: 10, sampleHeightCm: 6,
    })
    const results = createShapeDimensionResults({
      id: 'almost-horizontal', type: 'path', closed: false,
      nodes: [{ anchor: { x: 1, y: 2 } }, { anchor: { x: 25.82, y: 2.18 } }],
    }, gauge, { stitches: null, rows: null })

    expect(results.map((item) => item.axis)).toEqual(['stitches'])
  })

  it('半行误差仍保留行数换算，曲线不应用水平容差', () => {
    const gauge = calculateGauge({
      sampleStitches: 20, sampleRows: 20, sampleWidthCm: 10, sampleHeightCm: 10,
    })
    const atBoundary = createShapeDimensionResults({
      id: 'half-row', type: 'path', closed: false,
      nodes: [{ anchor: { x: 1, y: 2 } }, { anchor: { x: 5, y: 2.25 } }],
    }, gauge, { stitches: null, rows: null })
    const shallowCurve = createShapeDimensionResults({
      id: 'shallow-curve', type: 'path', closed: false,
      nodes: [
        { anchor: { x: 1, y: 2 }, outControl: { x: 2, y: 2.1 } },
        { anchor: { x: 5, y: 2.1 }, inControl: { x: 4, y: 2.1 } },
      ],
    }, gauge, { stitches: null, rows: null })

    expect(atBoundary.map((item) => item.axis)).toEqual(['stitches', 'rows'])
    expect(shallowCurve.map((item) => item.axis)).toEqual(['stitches', 'rows'])
  })
})
