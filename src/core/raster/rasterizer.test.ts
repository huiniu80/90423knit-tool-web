import { describe, expect, it } from 'vitest'
import { calculateGauge } from '../gauge/gauge'
import type { FabricCanvas } from '../gauge/gauge.types'
import type { Shape } from '../geometry/shape.types'
import { rasterize, rasterizeShapes } from './rasterizer'

const gauge = calculateGauge({
  sampleStitches: 10,
  sampleRows: 10,
  sampleWidthCm: 10,
  sampleHeightCm: 6,
})
const canvas: FabricCanvas = { widthCm: 30, heightCm: 30 }

describe('Rasterizer', () => {
  it('每行使用行中心作为扫描位置', () => {
    const shape: Shape = { id: 'r', type: 'rectangle', x: 0, y: 0, widthCm: 3, heightCm: 3 }
    const rows = rasterize(shape, gauge, canvas, { mode: 'center', symmetryOptimization: true })
    expect(rows[0]?.yCm).toBe(0.3)
    expect(rows[1]?.yCm).toBeCloseTo(0.9)
  })

  it('3cm × 3cm 矩形生成 3针 × 5行', () => {
    const shape: Shape = { id: 'r', type: 'rectangle', x: 2, y: 0, widthCm: 3, heightCm: 3 }
    const activeRows = rasterize(shape, gauge, canvas, {
      mode: 'center', symmetryOptimization: true,
    }).filter((row) => row.stitchCount > 0)

    expect(activeRows).toHaveLength(5)
    expect(activeRows.every((row) => row.stitchCount === 3)).toBe(true)
    expect(activeRows[0]?.segments).toEqual([{ startStitch: 2, endStitch: 4 }])
  })

  it('边界外的针格会被裁剪', () => {
    const shape: Shape = { id: 'r', type: 'rectangle', x: -4, y: 0, widthCm: 8, heightCm: 1 }
    const first = rasterize(shape, gauge, canvas, {
      mode: 'outside', symmetryOptimization: false,
    })[0]
    expect(first?.segments).toEqual([{ startStitch: 0, endStitch: 3 }])
  })

  it('多个重叠图形的针格会合并', () => {
    const shapes: Shape[] = [
      { id: 'a', type: 'rectangle', x: 0, y: 0, widthCm: 3, heightCm: 1 },
      { id: 'b', type: 'rectangle', x: 2, y: 0, widthCm: 3, heightCm: 1 },
    ]
    const first = rasterizeShapes(shapes, gauge, canvas, {
      mode: 'center', symmetryOptimization: true,
    })[0]
    expect(first?.segments).toEqual([{ startStitch: 0, endStitch: 4 }])
    expect(first?.stitchCount).toBe(5)
  })

  it('分离区域从底层开始保留多个 segment', () => {
    const shapes: Shape[] = [
      { id: 'a', type: 'rectangle', x: 0, y: 0, widthCm: 2, heightCm: 1 },
      { id: 'b', type: 'rectangle', x: 5, y: 0, widthCm: 2, heightCm: 1 },
    ]
    const first = rasterizeShapes(shapes, gauge, canvas, {
      mode: 'center', symmetryOptimization: true,
    })[0]
    expect(first?.segments).toEqual([
      { startStitch: 0, endStitch: 1 },
      { startStitch: 5, endStitch: 6 },
    ])
  })

  it('圆形的中心行针数大于边缘行且上下对称', () => {
    const shape: Shape = { id: 'c', type: 'circle', center: { x: 10, y: 6 }, radiusCm: 3 }
    const active = rasterize(shape, gauge, canvas, {
      mode: 'center', symmetryOptimization: true,
    }).filter((row) => row.stitchCount > 0)
    expect(active[Math.floor(active.length / 2)]?.stitchCount).toBeGreaterThan(active[0]?.stitchCount ?? 0)
    expect(active.map((row) => row.stitchCount)).toEqual(
      active.map((row) => row.stitchCount).reverse(),
    )
  })
})
