import { describe, expect, it } from 'vitest'
import { getHorizontalIntervals, getShapeBounds, resizeShapeToBounds } from './geometry'
import type { Shape } from './shape.types'

describe('Geometry Engine', () => {
  it('矩形返回稳定的单区间', () => {
    const shape: Shape = { id: 'r', type: 'rectangle', x: 2, y: 3, widthCm: 5, heightCm: 4 }
    expect(getHorizontalIntervals(shape, 5)).toEqual([{ startX: 2, endX: 7 }])
    expect(getHorizontalIntervals(shape, 8)).toEqual([])
  })

  it('等腰三角形的扫描结果左右对称', () => {
    const shape: Shape = {
      id: 't',
      type: 'triangle',
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }],
    }
    expect(getHorizontalIntervals(shape, 5)[0]).toEqual({ startX: 2.5, endX: 7.5 })
  })

  it('圆形中心扫描线最宽', () => {
    const shape: Shape = { id: 'c', type: 'circle', center: { x: 5, y: 5 }, radiusCm: 3 }
    expect(getHorizontalIntervals(shape, 5)).toEqual([{ startX: 2, endX: 8 }])
    expect(getHorizontalIntervals(shape, 8)[0]?.startX).toBeCloseTo(5)
  })

  it('椭圆使用独立的 x/y 半径', () => {
    const shape: Shape = {
      id: 'e', type: 'ellipse', center: { x: 10, y: 6 }, radiusXcm: 6, radiusYcm: 2,
    }
    expect(getHorizontalIntervals(shape, 6)).toEqual([{ startX: 4, endX: 16 }])
    expect(getHorizontalIntervals(shape, 9)).toEqual([])
  })

  it('凹多边形可返回多个区间', () => {
    const shape: Shape = {
      id: 'p',
      type: 'polygon',
      points: [
        { x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 6 },
        { x: 4, y: 6 }, { x: 4, y: 2 }, { x: 2, y: 2 },
        { x: 2, y: 6 }, { x: 0, y: 6 },
      ],
    }
    expect(getHorizontalIntervals(shape, 4)).toEqual([
      { startX: 0, endX: 2 },
      { startX: 4, endX: 6 },
    ])
  })

  it('水平边与扫描线经过顶点时不产生重复交点', () => {
    const shape: Shape = {
      id: 'p', type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }],
    }
    expect(getHorizontalIntervals(shape, 0)).toEqual([{ startX: 0, endX: 4 }])
    expect(getHorizontalIntervals(shape, 4)).toEqual([])
  })

  it('图形缩放后仍保存 cm 坐标而不是显示 scale', () => {
    const shape: Shape = { id: 'r', type: 'rectangle', x: 1, y: 2, widthCm: 3, heightCm: 4 }
    const resized = resizeShapeToBounds(shape, { x: 5, y: 6, width: 9, height: 8 })
    expect(getShapeBounds(resized)).toEqual({ x: 5, y: 6, width: 9, height: 8 })
  })
})
