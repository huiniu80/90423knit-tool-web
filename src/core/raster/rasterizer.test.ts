import { describe, expect, it } from 'vitest'
import { calculateGauge } from '../gauge/gauge'
import type { FabricCanvas } from '../gauge/gauge.types'
import type { Shape } from '../geometry/shape.types'
import { mergeRasterRows, rasterize, rasterizeShapes } from './rasterizer'

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

  it('复用单图形结果合并时与完整栅格化完全一致', () => {
    const shapes: Shape[] = [
      { id: 'a', type: 'rectangle', x: -1, y: 0, widthCm: 6, heightCm: 4 },
      { id: 'b', type: 'circle', center: { x: 6, y: 3 }, radiusCm: 2.5 },
      {
        id: 'c', type: 'polygon',
        points: [{ x: 10, y: 0 }, { x: 16, y: 0 }, { x: 13, y: 7 }],
      },
    ]
    const options = { mode: 'outside' as const, symmetryOptimization: false }
    const perShapeRows = shapes.map((shape) => rasterize(shape, gauge, canvas, options))

    expect(mergeRasterRows(perShapeRows, gauge, canvas)).toEqual(
      rasterizeShapes(shapes, gauge, canvas, options),
    )
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

  it('栅格化忠实读取两侧轮廓，右侧编辑不会再被左侧覆盖', () => {
    const shape: Shape = {
      id: 'editable-right-edge',
      type: 'path',
      closed: true,
      nodes: [
        { anchor: { x: 2, y: 0 } },
        { anchor: { x: 12, y: 0 } },
        { anchor: { x: 12, y: 6 } },
        { anchor: { x: 2, y: 6 } },
      ],
    }
    const before = rasterize(shape, gauge, canvas, {
      mode: 'center', symmetryOptimization: true,
    })[0]!
    const movedRight = rasterize({
      ...shape,
      nodes: shape.type === 'path'
        ? shape.nodes.map((node, index) => index === 1 || index === 2
          ? { ...node, anchor: { x: 13, y: node.anchor.y } }
          : node)
        : [],
    }, gauge, canvas, {
      mode: 'center', symmetryOptimization: true,
    })[0]!
    const withoutOptimization = rasterize(shape, gauge, canvas, {
      mode: 'center', symmetryOptimization: false,
    })[0]!

    expect(movedRight.stitchCount).toBe(before.stitchCount + 1)
    expect(before).toEqual(withoutOptimization)
  })

  it('开放路径按曲线经过的针格生成针格，闭合路径仍按面积计算', () => {
    const path: Shape = {
      id: 'path', type: 'path', closed: false,
      nodes: [
        { anchor: { x: 2, y: 0 }, outControl: { x: 2, y: 4 } },
        { anchor: { x: 8, y: 0 }, inControl: { x: 8, y: 4 } },
        { anchor: { x: 8, y: 6 } },
        { anchor: { x: 2, y: 6 } },
      ],
    }
    const openRows = rasterize(path, gauge, canvas, {
      mode: 'center', symmetryOptimization: true,
    })
    expect(openRows.some((row) => row.stitchCount > 0)).toBe(true)

    const closedRows = rasterize({ ...path, closed: true }, gauge, canvas, {
      mode: 'center', symmetryOptimization: true,
    })
    expect(closedRows.some((row) => row.stitchCount > 0)).toBe(true)
  })

  it('水平开放线生成单行连续针段', () => {
    const shape: Shape = {
      id: 'horizontal', type: 'path', closed: false,
      nodes: [{ anchor: { x: 2, y: 1.2 } }, { anchor: { x: 7.9, y: 1.2 } }],
    }
    const active = rasterize(shape, gauge, canvas, {
      mode: 'inside', symmetryOptimization: false,
    }).filter((row) => row.stitchCount > 0)
    expect(active).toHaveLength(1)
    expect(active[0]?.segments).toEqual([{ startStitch: 2, endStitch: 7 }])
  })

  it('竖直开放线在每个经过行保持单针宽', () => {
    const shape: Shape = {
      id: 'vertical', type: 'path', closed: false,
      nodes: [{ anchor: { x: 4.2, y: 0 } }, { anchor: { x: 4.2, y: 3 } }],
    }
    const active = rasterize(shape, gauge, canvas, {
      mode: 'outside', symmetryOptimization: false,
    }).filter((row) => row.stitchCount > 0)
    expect(active).toHaveLength(6)
    expect(active.every((row) => row.segments[0]?.startStitch === 4 && row.stitchCount === 1)).toBe(true)
  })

  it('斜线与弧线栅格连续且不受面积离散策略影响', () => {
    const arc: Shape = {
      id: 'arc', type: 'path', closed: false,
      nodes: [
        { anchor: { x: 2, y: 1 }, outControl: { x: 2, y: 7 } },
        { anchor: { x: 10, y: 1 }, inControl: { x: 10, y: 7 } },
      ],
    }
    const center = rasterize(arc, gauge, canvas, {
      mode: 'center', symmetryOptimization: true,
    })
    const inside = rasterize(arc, gauge, canvas, {
      mode: 'inside', symmetryOptimization: true,
    })
    expect(inside).toEqual(center)
    expect(center.filter((row) => row.stitchCount > 0).length).toBeGreaterThan(5)
  })

  it('开放线超出画布的部分被裁剪且不会沿边缘涂抹', () => {
    const shape: Shape = {
      id: 'clipped-line', type: 'path', closed: false,
      nodes: [{ anchor: { x: -20, y: 1.2 } }, { anchor: { x: 3.2, y: 1.2 } }],
    }
    const active = rasterize(shape, gauge, canvas, {
      mode: 'center', symmetryOptimization: false,
    }).filter((row) => row.stitchCount > 0)
    expect(active).toHaveLength(1)
    expect(active[0]?.segments).toEqual([{ startStitch: 0, endStitch: 3 }])
  })
})
