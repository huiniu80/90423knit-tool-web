import { describe, expect, it } from 'vitest'
import { calculateFabricGrid, calculateGauge } from './gauge'
import type { FabricCanvas, GaugeInput } from './gauge.types'

const acceptanceGaugeInput: GaugeInput = {
  sampleStitches: 10,
  sampleRows: 10,
  sampleWidthCm: 10,
  sampleHeightCm: 6,
}

describe('calculateGauge', () => {
  it('计算文档验收小样的单针和单行尺寸', () => {
    const gauge = calculateGauge(acceptanceGaugeInput)

    expect(gauge.stitchWidthCm).toBe(1)
    expect(gauge.rowHeightCm).toBe(0.6)
    expect(gauge.stitchesPerCm).toBe(1)
    expect(gauge.rowsPerCm).toBeCloseTo(5 / 3)
  })

  it('支持不同针数、行数与物理尺寸的小样', () => {
    const gauge = calculateGauge({
      sampleStitches: 24,
      sampleRows: 32,
      sampleWidthCm: 10,
      sampleHeightCm: 10,
    })

    expect(gauge.stitchWidthCm).toBeCloseTo(10 / 24)
    expect(gauge.rowHeightCm).toBeCloseTo(10 / 32)
    expect(gauge.stitchesPerCm).toBe(2.4)
    expect(gauge.rowsPerCm).toBe(3.2)
  })

  it.each([
    ['sampleStitches', { ...acceptanceGaugeInput, sampleStitches: 0 }],
    ['sampleRows', { ...acceptanceGaugeInput, sampleRows: -1 }],
    ['sampleWidthCm', { ...acceptanceGaugeInput, sampleWidthCm: Number.NaN }],
    ['sampleHeightCm', { ...acceptanceGaugeInput, sampleHeightCm: Infinity }],
  ])('拒绝无效的 %s', (fieldName, input) => {
    expect(() => calculateGauge(input)).toThrow(fieldName)
  })
})

describe('calculateFabricGrid', () => {
  it('将 30cm × 30cm 画布换算为 30针 × 50行', () => {
    const gauge = calculateGauge(acceptanceGaugeInput)
    const canvas: FabricCanvas = { widthCm: 30, heightCm: 30 }

    expect(calculateFabricGrid(canvas, gauge)).toEqual({
      columnCount: 30,
      rowCount: 50,
    })
  })

  it('按文档约定将非整数针格四舍五入', () => {
    const gauge = calculateGauge(acceptanceGaugeInput)

    expect(
      calculateFabricGrid({ widthCm: 10.49, heightCm: 6.31 }, gauge),
    ).toEqual({ columnCount: 10, rowCount: 11 })
  })

  it.each([
    ['widthCm', { widthCm: 0, heightCm: 30 }],
    ['heightCm', { widthCm: 30, heightCm: -1 }],
  ])('拒绝无效的画布 %s', (fieldName, canvas) => {
    const gauge = calculateGauge(acceptanceGaugeInput)

    expect(() => calculateFabricGrid(canvas, gauge)).toThrow(fieldName)
  })
})
