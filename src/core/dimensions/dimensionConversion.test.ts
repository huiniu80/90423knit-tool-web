import { describe, expect, it } from 'vitest'
import { calculateGauge } from '../gauge/gauge'
import { convertDimension, createShapeDimensionResults, formatCm, selectedShapeCounts } from './dimensionConversion'
import type { PathShape } from '../geometry/shape.types'

describe('dimension conversion', () => {
  it('镜像整体宽选择正偶数，半值向上、最低两针，普通形状仍可奇数', () => {
    const currentGauge = calculateGauge({ sampleStitches: 10, sampleRows: 10, sampleWidthCm: 10, sampleHeightCm: 10 })
    const shape: PathShape = { id: 'm', type: 'path', closed: true, editConstraint: { type: 'vertical-mirror', axisX: 3.5 },
      nodes: [{ anchor: { x: 1, y: 1 } }, { anchor: { x: 6, y: 1 } }, { anchor: { x: 3.5, y: 5 } }] }
    expect(selectedShapeCounts(shape, currentGauge, { stitches: null, rows: null }).stitches).toBe(6)
    expect(selectedShapeCounts(shape, currentGauge, { stitches: 'floor', rows: null }).stitches).toBe(4)
    expect(selectedShapeCounts({ ...shape, editConstraint: undefined }, currentGauge, { stitches: null, rows: null }).stitches).toBe(5)
    expect(convertDimension('m', -1, 'stitches', 0.2, 1, 'floor', { x: 0, y: 0 }, 2).selected?.count).toBe(2)
  })
  it('半值向上、零候选排除且手动方向不绕过最低有效值', () => {
    expect(convertDimension('p', -1, 'rows', 2.5, 1, null, { x: 0, y: 0 }).selected?.count).toBe(3)
    const tiny = convertDimension('p', -1, 'stitches', 0.2, 1, 'floor', { x: 0, y: 0 })
    expect(tiny.floor.valid).toBe(false)
    expect(tiny.selected?.count).toBe(1)
    expect(convertDimension('p', -1, 'rows', 2.2, 1, 'ceil', { x: 0, y: 0 }).selected?.count).toBe(3)
  })
  it('局部跨度直接读取整体派生轮廓，不分别取整且原轮廓不变', () => {
    const gauge = calculateGauge({ sampleStitches: 10, sampleRows: 10, sampleWidthCm: 10, sampleHeightCm: 10 })
    const shape = { id: 'p', type: 'path' as const, closed: true, nodes: [
      { anchor: { x: 1, y: 1 } }, { anchor: { x: 3.2, y: 1 } }, { anchor: { x: 4.4, y: 4.4 } }, { anchor: { x: 1, y: 4.4 } },
    ] }
    const original = JSON.stringify(shape)
    const results = createShapeDimensionResults(shape, gauge, { stitches: null, rows: null })
    const local = results.find((item) => item.segmentIndex === 0 && item.axis === 'stitches')!
    expect(local.selected!.actualCm).toBeCloseTo(2.2 * 3 / 3.4)
    expect(local.selected!.count).not.toBe(Math.round(local.selected!.count))
    expect(selectedShapeCounts(shape, gauge, { stitches: null, rows: null })).toEqual({ stitches: 3, rows: 3 })
    expect(JSON.stringify(shape)).toBe(original)
  })
  it('同时给出 19cm 在 2.8行/cm 下的上下取整及偏差', () => {
    const result = convertDimension('piece', 0, 'rows', 19, 2.8, null, { x: 0, y: 0 })
    expect(result.rawCount).toBeCloseTo(53.2)
    expect(result.floor).toMatchObject({ count: 53, actualCm: 53 / 2.8 })
    expect(result.floor.deviationCm).toBeCloseTo(-0.071428)
    expect(result.ceil.count).toBe(54)
    expect(result.ceil.deviationCm).toBeCloseTo(0.285714)
    expect(result.confirmed).toBe(true)
    expect(result.selected?.count).toBe(53)
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
      id: 'diagonal', type: 'path', closed: true,
      nodes: [{ anchor: { x: 1, y: 2 } }, { anchor: { x: 5, y: 7 } }, { anchor: { x: 1, y: 7 } }],
    }, gauge, { stitches: null, rows: null }).filter((item) => item.segmentIndex === 0)
    const horizontal = createShapeDimensionResults({
      id: 'horizontal', type: 'path', closed: true,
      nodes: [{ anchor: { x: 1, y: 2 } }, { anchor: { x: 5, y: 2 } }, { anchor: { x: 1, y: 7 } }],
    }, gauge, { stitches: null, rows: null }).filter((item) => item.segmentIndex === 0)
    expect(diagonal.map((item) => item.axis)).toEqual(['stitches', 'rows'])
    expect(horizontal.map((item) => item.axis)).toEqual(['stitches'])
  })

  it('直线的纵向误差不足半行时按水平线量衣', () => {
    const gauge = calculateGauge({
      sampleStitches: 11, sampleRows: 10, sampleWidthCm: 10, sampleHeightCm: 6,
    })
    const results = createShapeDimensionResults({
      id: 'almost-horizontal', type: 'path', closed: true,
      nodes: [{ anchor: { x: 1, y: 2 } }, { anchor: { x: 25.82, y: 2.18 } }, { anchor: { x: 1, y: 7 } }],
    }, gauge, { stitches: null, rows: null }).filter((item) => item.segmentIndex === 0)

    expect(results.map((item) => item.axis)).toEqual(['stitches'])
  })

  it('半行误差仍保留行数换算，曲线不应用水平容差', () => {
    const gauge = calculateGauge({
      sampleStitches: 20, sampleRows: 20, sampleWidthCm: 10, sampleHeightCm: 10,
    })
    const atBoundary = createShapeDimensionResults({
      id: 'half-row', type: 'path', closed: true,
      nodes: [{ anchor: { x: 1, y: 2 } }, { anchor: { x: 5, y: 2.25 } }, { anchor: { x: 1, y: 7 } }],
    }, gauge, { stitches: null, rows: null }).filter((item) => item.segmentIndex === 0)
    const shallowCurve = createShapeDimensionResults({
      id: 'shallow-curve', type: 'path', closed: true,
      nodes: [
        { anchor: { x: 1, y: 2 }, outControl: { x: 2, y: 2.1 } },
        { anchor: { x: 5, y: 2.1 }, inControl: { x: 4, y: 2.1 } },
        { anchor: { x: 1, y: 7 } },
      ],
    }, gauge, { stitches: null, rows: null }).filter((item) => item.segmentIndex === 0)

    expect(atBoundary.map((item) => item.axis)).toEqual(['stitches', 'rows'])
    expect(shallowCurve.map((item) => item.axis)).toEqual(['stitches', 'rows'])
  })
  it('开放轮廓不提供局部取整或整体针行目标', () => {
    const shape = { id: 'open', type: 'path', closed: false, nodes: [{ anchor: { x: 1, y: 2 } }, { anchor: { x: 5, y: 7 } }] } as const
    const gauge = calculateGauge({ sampleStitches: 20, sampleRows: 28, sampleWidthCm: 10, sampleHeightCm: 10 })
    const path = { ...shape, nodes: [...shape.nodes] }
    expect(createShapeDimensionResults(path, gauge, { stitches: 'ceil', rows: 'floor' })).toEqual([])
    expect(selectedShapeCounts(path, gauge, { stitches: 'ceil', rows: 'floor' })).toEqual({ stitches: null, rows: null })
  })
})
