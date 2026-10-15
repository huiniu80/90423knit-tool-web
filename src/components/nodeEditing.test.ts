import { describe, expect, it } from 'vitest'
import { deleteEditableNode, insertEdgeNode, nearestEditableEdge } from './nodeEditing'
import { evaluatePathSegment } from '../core/geometry/path'
import type { PathShape, PolygonShape } from '../core/geometry/shape.types'

describe('可见节点编辑入口', () => {
  it('曲线插点保持原曲线，节点删除遵守开放与闭合下限', () => {
    const path: PathShape = { id: 'curve', type: 'path', closed: false, nodes: [
      { anchor: { x: 1, y: 1 }, outControl: { x: 1, y: 8 } },
      { anchor: { x: 9, y: 1 }, inControl: { x: 9, y: 8 } },
    ] }
    const edge = nearestEditableEdge(path, evaluatePathSegment(path, 0, 0.5))
    const result = insertEdgeNode(path, edge)
    expect(result.index).toBe(1)
    const split = result.shape as PathShape
    for (const t of [0.1, 0.25, 0.7, 0.9]) {
      const actual = t < edge.t ? evaluatePathSegment(split, 0, t / edge.t) : evaluatePathSegment(split, 1, (t - edge.t) / (1 - edge.t))
      const original = evaluatePathSegment(path, 0, t)
      expect(actual.x).toBeCloseTo(original.x, 5)
      expect(actual.y).toBeCloseTo(original.y, 5)
    }
    expect(deleteEditableNode(path, 0)).toBe(path)
    const triangle = { ...path, closed: true, nodes: [...path.nodes, { anchor: { x: 5, y: 10 } }] }
    expect(deleteEditableNode(triangle, 0)).toBe(triangle)
    const deleted = deleteEditableNode(split, 1) as PathShape
    expect(deleted.nodes.map((node) => node.anchor)).toEqual(path.nodes.map((node) => node.anchor))
    expect(deleted.nodes).toHaveLength(2)
  })
  it('多边形插入投影点且不会减少到三个点以下，拒绝过期选中边', () => {
    const shape: PolygonShape = { id: 'p', type: 'polygon', points: [{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 5, y: 8 }] }
    const edge = nearestEditableEdge(shape, { x: 4, y: 1.3 })
    expect(edge.point).toEqual({ x: 4, y: 1 })
    expect(insertEdgeNode(shape, edge).shape).toMatchObject({ points: [shape.points[0], edge.point, ...shape.points.slice(1)] })
    expect(deleteEditableNode(shape, 1)).toBe(shape)
    expect(insertEdgeNode(shape, { ...edge, shapeId: 'deleted' }).index).toBe(-1)
  })
})
