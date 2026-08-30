import { describe, expect, it } from 'vitest'
import { getHorizontalIntervals, getShapeBounds, resizeShapeToBounds } from './geometry'
import {
  bendPathSegment,
  bendPathSegmentWithSymmetry,
  detectPathSymmetry,
  evaluatePathSegment,
  findNearestOpenPathEndpoint,
  flattenPath,
  movePathControlWithSymmetry,
  movePathNodeWithSymmetry,
  removePathNodeWithSymmetry,
  splitPathSegment,
  splitPathSegmentWithSymmetry,
} from './path'
import type { PathShape, Shape } from './shape.types'

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

  it('开放路径不产生扫描区间，闭合直线路径可复用多边形扫描', () => {
    const path: Shape = {
      id: 'path', type: 'path', closed: false,
      nodes: [
        { anchor: { x: 1, y: 1 } }, { anchor: { x: 5, y: 1 } },
        { anchor: { x: 5, y: 5 } }, { anchor: { x: 1, y: 5 } },
      ],
    }
    expect(getHorizontalIntervals(path, 3)).toEqual([])
    expect(getHorizontalIntervals({ ...path, closed: true }, 3)).toEqual([{ startX: 1, endX: 5 }])
  })

  it('新路径点击位置接近已有开放路径端点时吸附到精确坐标', () => {
    const paths: PathShape[] = [
      {
        id: 'open', type: 'path', closed: false,
        nodes: [{ anchor: { x: 2, y: 3 } }, { anchor: { x: 8, y: 5 } }],
      },
      {
        id: 'closed', type: 'path', closed: true,
        nodes: [
          { anchor: { x: 10, y: 10 } },
          { anchor: { x: 12, y: 10 } },
          { anchor: { x: 11, y: 12 } },
        ],
      },
    ]
    const snap = findNearestOpenPathEndpoint(paths, { x: 8.2, y: 5.1 }, 0.3)
    expect(snap?.point).toEqual({ x: 8, y: 5 })
    expect(snap?.nodeIndex).toBe(1)
    expect(findNearestOpenPathEndpoint(paths, { x: 8.5, y: 5.5 }, 0.3)).toBeNull()
    expect(findNearestOpenPathEndpoint(paths, { x: 10, y: 10 }, 0.3)).toBeNull()
  })

  it('闭合凹路径在同一扫描行保留分离区间', () => {
    const path: Shape = {
      id: 'concave-path', type: 'path', closed: true,
      nodes: [
        { anchor: { x: 0, y: 0 } }, { anchor: { x: 6, y: 0 } },
        { anchor: { x: 6, y: 6 } }, { anchor: { x: 4, y: 6 } },
        { anchor: { x: 4, y: 2 } }, { anchor: { x: 2, y: 2 } },
        { anchor: { x: 2, y: 6 } }, { anchor: { x: 0, y: 6 } },
      ],
    }
    expect(getHorizontalIntervals(path, 4)).toEqual([
      { startX: 0, endX: 2 },
      { startX: 4, endX: 6 },
    ])
  })

  it('贝塞尔边界包含曲线极值而不是只包含锚点', () => {
    const path: Shape = {
      id: 'arc', type: 'path', closed: false,
      nodes: [
        { anchor: { x: 0, y: 0 }, outControl: { x: 0, y: 8 } },
        { anchor: { x: 10, y: 0 }, inControl: { x: 10, y: 8 } },
      ],
    }
    const bounds = getShapeBounds(path)
    expect(bounds.x).toBeCloseTo(0)
    expect(bounds.width).toBeCloseTo(10)
    expect(bounds.height).toBeCloseTo(6)
  })

  it('拖动边中点后曲线经过目标位置，并可独立保留控制手柄', () => {
    const path: Shape = {
      id: 'bend', type: 'path', closed: false,
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 8, y: 0 } }],
    }
    const bent = bendPathSegment(path, 0, { x: 4, y: 3 })
    expect(evaluatePathSegment(bent, 0, 0.5)).toEqual({ x: 4, y: 3 })
    expect(bent.nodes[0]?.outControl).toBeDefined()
    expect(bent.nodes[1]?.inControl).toBeDefined()
  })

  it('S 曲线自适应细分后保留两侧弯曲趋势', () => {
    const path: Shape = {
      id: 's-curve', type: 'path', closed: false,
      nodes: [
        { anchor: { x: 0, y: 0 }, outControl: { x: 3, y: 8 } },
        { anchor: { x: 10, y: 0 }, inControl: { x: 7, y: -8 } },
      ],
    }
    const points = flattenPath(path)
    expect(points.some((point) => point.y > 2)).toBe(true)
    expect(points.some((point) => point.y < -2)).toBe(true)
  })

  it('扫描线经过曲线水平切点时不产生重复区间', () => {
    const path: Shape = {
      id: 'tangent', type: 'path', closed: true,
      nodes: [
        { anchor: { x: 0, y: 0 }, outControl: { x: 0, y: 8 } },
        { anchor: { x: 8, y: 0 }, inControl: { x: 8, y: 8 } },
        { anchor: { x: 4, y: 0 } },
      ],
    }
    expect(getHorizontalIntervals(path, 6)).toEqual([])
    expect(getHorizontalIntervals(path, 5.5)).toHaveLength(1)
  })

  it('用 de Casteljau 插入锚点后曲线轮廓不变', () => {
    const path: Shape = {
      id: 'split', type: 'path', closed: false,
      nodes: [
        { anchor: { x: 0, y: 0 }, outControl: { x: 2, y: 6 } },
        { anchor: { x: 8, y: 0 }, inControl: { x: 6, y: -4 } },
      ],
    }
    const splitT = 0.4
    const result = splitPathSegment(path, 0, splitT)
    expect(result.path.nodes).toHaveLength(3)
    for (const t of [0.1, 0.3, 0.6, 0.9]) {
      const before = evaluatePathSegment(path, 0, t)
      const after = t <= splitT
        ? evaluatePathSegment(result.path, 0, t / splitT)
        : evaluatePathSegment(result.path, 1, (t - splitT) / (1 - splitT))
      expect(after.x).toBeCloseTo(before.x, 8)
      expect(after.y).toBeCloseTo(before.y, 8)
    }
  })

  it('整体缩放路径时锚点和控制点使用同一坐标变换', () => {
    const path: Shape = {
      id: 'resize-path', type: 'path', closed: false,
      nodes: [
        { anchor: { x: 0, y: 0 }, outControl: { x: 1, y: 2 } },
        { anchor: { x: 4, y: 0 }, inControl: { x: 3, y: 2 } },
      ],
    }
    const resized = resizeShapeToBounds(path, { x: 10, y: 20, width: 8, height: 6 })
    expect(resized.type).toBe('path')
    if (resized.type !== 'path') return
    expect(resized.nodes[0]?.anchor).toEqual({ x: 10, y: 20 })
    expect(resized.nodes[0]?.outControl).toEqual({ x: 12, y: 28 })
    expect(resized.nodes[1]?.anchor).toEqual({ x: 18, y: 20 })
  })

  it('对称闭合路径拖动任一侧锚点时同步镜像另一侧', () => {
    const path = symmetricGarmentPath()
    const symmetry = detectPathSymmetry(path, 0.01)
    expect(symmetry).not.toBeNull()

    const moved = movePathNodeWithSymmetry(path, 2, { x: 9, y: 6.5 }, symmetry)
    expect(moved.nodes[2]?.anchor).toEqual({ x: 9, y: 6.5 })
    expect(moved.nodes[8]?.anchor).toEqual({ x: 1, y: 6.5 })
    expect(symmetry?.axisX).toBe(5)
  })

  it('近似对称路径首次联动时平均校正全部节点并吸附半针中心轴', () => {
    const path = symmetricGarmentPath()
    path.nodes[8]!.anchor.x = 0.2
    path.nodes[7]!.anchor.x = 2.1
    const symmetry = detectPathSymmetry(path, 0.35, 0.5)
    expect(symmetry?.axisX).toBe(5)

    const moved = movePathNodeWithSymmetry(path, 2, { x: 9.5, y: 6 }, symmetry)
    expect(moved.nodes[8]?.anchor).toEqual({ x: 0.5, y: 6 })
    expect(moved.nodes[3]?.anchor.x).toBe(7.95)
    expect(moved.nodes[7]?.anchor.x).toBe(2.05)
  })

  it('对称路径的控制柄和配对曲线保持镜像方向', () => {
    const path = symmetricGarmentPath()
    const symmetry = detectPathSymmetry(path, 0.01)
    const controlled = movePathControlWithSymmetry(
      path,
      3,
      'outControl',
      { x: 7, y: 9 },
      symmetry,
    )
    expect(controlled.nodes[7]?.inControl).toEqual({ x: 3, y: 9 })

    const bent = bendPathSegmentWithSymmetry(path, 2, { x: 9, y: 7.5 }, symmetry)
    expect(evaluatePathSegment(bent, 2, 0.5)).toEqual({ x: 9, y: 7.5 })
    expect(evaluatePathSegment(bent, 7, 0.5)).toEqual({ x: 1, y: 7.5 })
  })

  it('对称路径插入和删除节点时成对处理且仍可重新识别', () => {
    const path = symmetricGarmentPath()
    const symmetry = detectPathSymmetry(path, 0.01)
    const split = splitPathSegmentWithSymmetry(path, 2, 0.4, symmetry)
    expect(split.path.nodes).toHaveLength(path.nodes.length + 2)
    expect(detectPathSymmetry(split.path, 0.01)).not.toBeNull()

    const removed = removePathNodeWithSymmetry(path, 3, symmetry)
    expect(removed.nodes).toHaveLength(path.nodes.length - 2)
    expect(detectPathSymmetry(removed, 0.01)).not.toBeNull()
  })

  it('不对称路径保持自由编辑，不会自动覆盖另一侧', () => {
    const path = symmetricGarmentPath()
    path.nodes[8]!.anchor.x = 0.8
    const symmetry = detectPathSymmetry(path, 0.01)
    expect(symmetry).toBeNull()

    const moved = movePathNodeWithSymmetry(path, 2, { x: 9, y: 6 }, symmetry)
    expect(moved.nodes[8]?.anchor).toEqual({ x: 0.8, y: 6 })
  })
})

function symmetricGarmentPath(): PathShape {
  return {
    id: 'symmetric-garment',
    type: 'path',
    closed: true,
    nodes: [
      { anchor: { x: 0, y: 0 } },
      { anchor: { x: 10, y: 0 } },
      { anchor: { x: 10, y: 6 } },
      { anchor: { x: 8, y: 8 } },
      { anchor: { x: 6, y: 8 } },
      { anchor: { x: 5, y: 6 } },
      { anchor: { x: 4, y: 8 } },
      { anchor: { x: 2, y: 8 } },
      { anchor: { x: 0, y: 6 } },
    ],
  }
}
