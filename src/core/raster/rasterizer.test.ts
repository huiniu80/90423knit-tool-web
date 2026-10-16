import { describe, expect, it } from 'vitest'
import { calculateGauge } from '../gauge/gauge'
import type { FabricCanvas } from '../gauge/gauge.types'
import type { Shape, PathShape } from '../geometry/shape.types'
import { mergeRasterRows, rasterize, rasterizeShapes } from './rasterizer'

const gauge = calculateGauge({
  sampleStitches: 10,
  sampleRows: 10,
  sampleWidthCm: 10,
  sampleHeightCm: 6,
})
const canvas: FabricCanvas = { widthCm: 30, heightCm: 30 }

describe('Rasterizer', () => {
  it('任意既有轴的镜像针格每行偶数、左右成对且源轮廓不动', () => {
    const shape: PathShape = { id: 'mirror', type: 'path', closed: true,
      editConstraint: { type: 'vertical-mirror', axisX: 10.3 }, nodes: [
        { anchor: { x: 5.3, y: 2 } }, { anchor: { x: 15.3, y: 2 } },
        { anchor: { x: 13.3, y: 8 } }, { anchor: { x: 7.3, y: 8 } },
      ] }
    const original = JSON.stringify(shape)
    for (const stitchWidthCm of [1, 0.7, 1.3]) {
      const currentGauge = { ...gauge, stitchWidthCm, stitchesPerCm: 1 / stitchWidthCm }
      const rows = rasterize(shape, currentGauge, canvas, { mode: 'center', symmetryOptimization: false }, { stitches: 10, rows: 10, direction: 'bottom-up' })
      for (const row of rows.filter(row => row.stitchCount)) {
        expect(row.stitchCount % 2).toBe(0)
        const left = row.segments[0]!
        const right = row.segments.at(-1)!
        expect((row.originXCm ?? 0) + (left.startStitch + right.endStitch + 1) * stitchWidthCm / 2).toBeCloseTo(10.3)
      }
      expect(JSON.stringify(shape)).toBe(original)
    }
  })
  it('边界恰好通过针格中心时，整数总宽高不会重复计入另一端', () => {
    const shape: Shape = { id: 'aligned', type: 'rectangle', x: 2.5, y: 0.3, widthCm: 3, heightCm: 3 }
    const active = rasterize(shape, gauge, canvas, { mode: 'center', symmetryOptimization: false },
      { stitches: 3, rows: 5, direction: 'bottom-up' }).filter(row => row.stitchCount > 0)
    expect(active).toHaveLength(5)
    expect(active.every(row => row.stitchCount === 3)).toBe(true)
  })
  it('旧策略参数不能改变当前中心针格结果', () => {
    const shape: Shape = { id: 'r', type: 'rectangle', x: 0.2, y: 0, widthCm: 2.1, heightCm: 3 }
    const center = rasterize(shape, gauge, canvas, { mode: 'center', symmetryOptimization: false })
    expect(center[0]?.segments).toEqual([{ startStitch: 0, endStitch: 1 }])
    for (const mode of ['inside', 'outside'] as const) {
      expect(rasterize(shape, gauge, canvas, { mode, symmetryOptimization: false })).toEqual(center)
    }
  })
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

  it('越界织片整体暂停，移回后恢复且不改写源轮廓', () => {
    const shape: Shape = { id: 'r', type: 'rectangle', x: -4, y: 0, widthCm: 8, heightCm: 1 }
    const options = {
      mode: 'outside', symmetryOptimization: false,
    } as const
    expect(rasterize(shape, gauge, canvas, options)).toEqual([])
    expect(rasterize({ ...shape, x: 0 }, gauge, canvas, options)[0]?.stitchCount).toBe(8)
    expect(shape.x).toBe(-4)
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

  it('确认取整后控制针格宽高，旧方向参数也固定底边', () => {
    const preciseGauge = calculateGauge({
      sampleStitches: 20, sampleRows: 28, sampleWidthCm: 10, sampleHeightCm: 10,
    })
    const shape: Shape = { id: 'r', type: 'rectangle', x: 5, y: 4, widthCm: 18.2, heightCm: 19 }
    const floorRows = rasterize(shape, preciseGauge, canvas, {
      mode: 'center', symmetryOptimization: true,
    }, { stitches: 36, rows: 53, direction: 'bottom-up' }).filter((row) => row.stitchCount > 0)
    const ceilRows = rasterize(shape, preciseGauge, canvas, {
      mode: 'center', symmetryOptimization: true,
    }, { stitches: 37, rows: 54, direction: 'top-down' }).filter((row) => row.stitchCount > 0)

    expect(floorRows).toHaveLength(53)
    expect(floorRows.every((row) => row.stitchCount === 36)).toBe(true)
    expect(ceilRows).toHaveLength(54)
    expect(ceilRows.every((row) => row.stitchCount === 37)).toBe(true)
    expect(ceilRows[0]?.rowIndex).toBe(floorRows[0]?.rowIndex)
    expect(ceilRows.at(-1)?.rowIndex).toBe((floorRows.at(-1)?.rowIndex ?? 0) + 1)
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

  it('开放曲线无针格，闭合后按面积计算', () => {
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
    expect(openRows).toEqual([])

    const closedRows = rasterize({ ...path, closed: true }, gauge, canvas, {
      mode: 'center', symmetryOptimization: true,
    })
    expect(closedRows.some((row) => row.stitchCount > 0)).toBe(true)
  })

  it('水平开放线不生成针格', () => {
    const shape: Shape = {
      id: 'horizontal', type: 'path', closed: false,
      nodes: [{ anchor: { x: 2, y: 1.2 } }, { anchor: { x: 7.9, y: 1.2 } }],
    }
    const active = rasterize(shape, gauge, canvas, {
      mode: 'inside', symmetryOptimization: false,
    }).filter((row) => row.stitchCount > 0)
    expect(active).toEqual([])
  })

  it('竖直开放线不生成针格', () => {
    const shape: Shape = {
      id: 'vertical', type: 'path', closed: false,
      nodes: [{ anchor: { x: 4.2, y: 0 } }, { anchor: { x: 4.2, y: 3 } }],
    }
    const active = rasterize(shape, gauge, canvas, {
      mode: 'outside', symmetryOptimization: false,
    }).filter((row) => row.stitchCount > 0)
    expect(active).toEqual([])
  })

  it('开放弧线不因旧策略生成轨迹', () => {
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
    expect(center).toEqual([])
  })

  it('越界开放线不生成裁剪轨迹', () => {
    const shape: Shape = {
      id: 'clipped-line', type: 'path', closed: false,
      nodes: [{ anchor: { x: -20, y: 1.2 } }, { anchor: { x: 3.2, y: 1.2 } }],
    }
    const active = rasterize(shape, gauge, canvas, {
      mode: 'center', symmetryOptimization: false,
    }).filter((row) => row.stitchCount > 0)
    expect(active).toEqual([])
  })
  it('源轮廓在画布内但取整后越界时仍暂停', () => {
    const shape: Shape = { id: 'rounding', type: 'rectangle', x: 0.1, y: 0, widthCm: 2.1, heightCm: 1 }
    expect(rasterize(shape, gauge, canvas, { mode: 'center', symmetryOptimization: false }, { stitches: 3, rows: null, direction: 'bottom-up' })).toEqual([])
    expect(rasterize(shape, gauge, canvas, { mode: 'center', symmetryOptimization: false }, { stitches: 2, rows: null, direction: 'bottom-up' })[0]?.stitchCount).toBe(2)
  })
  it('无效轮廓不影响其他独立织片的总览结果', () => {
    const valid: Shape = { id: 'valid', type: 'rectangle', x: 2, y: 0, widthCm: 3, heightCm: 3 }
    const invalid: Shape = { id: 'invalid', type: 'polygon', points: [{ x: 3, y: 1 }, { x: 8, y: 8 }, { x: 3, y: 8 }, { x: 8, y: 1 }] }
    const options = { mode: 'center', symmetryOptimization: false } as const
    expect(rasterize(invalid, gauge, canvas, options)).toEqual([])
    expect(rasterizeShapes([valid, invalid], gauge, canvas, options)).toEqual(rasterize(valid, gauge, canvas, options))
  })
})
