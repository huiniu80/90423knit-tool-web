import { describe, expect, it } from 'vitest'
import { findNearestBoundarySegment, getShapeBoundarySegments } from './boundarySegments'
import type { PathShape } from './shape.types'

describe('轮廓线段', () => {
  const path: PathShape = {
    id: 'neckline',
    type: 'path',
    closed: false,
    nodes: [
      { anchor: { x: 2, y: 8 }, outControl: { x: 3, y: 2 } },
      { anchor: { x: 8, y: 8 }, inControl: { x: 7, y: 2 } },
      { anchor: { x: 10, y: 10 } },
    ],
  }

  it('每对相邻锚点生成一个线段并保留贝塞尔控制点', () => {
    const segments = getShapeBoundarySegments(path)
    expect(segments).toHaveLength(2)
    expect(segments[0]?.rasterShape).toMatchObject({
      type: 'path',
      closed: false,
      nodes: [
        { anchor: { x: 2, y: 8 }, outControl: { x: 3, y: 2 } },
        { anchor: { x: 8, y: 8 }, inControl: { x: 7, y: 2 } },
      ],
    })
  })

  it('点击位置会命中最近的具体线段', () => {
    expect(findNearestBoundarySegment(path, { x: 5, y: 3 })?.segmentIndex).toBe(0)
    expect(findNearestBoundarySegment(path, { x: 9.5, y: 9.5 })?.segmentIndex).toBe(1)
  })

  it('闭合多边形包含最后一点到第一点的线段', () => {
    const segments = getShapeBoundarySegments({
      id: 'polygon',
      type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 2 }],
    })
    expect(segments).toHaveLength(3)
    expect(segments[2]?.rasterShape).toMatchObject({
      type: 'path',
      nodes: [{ anchor: { x: 1, y: 2 } }, { anchor: { x: 0, y: 0 } }],
    })
  })
})
