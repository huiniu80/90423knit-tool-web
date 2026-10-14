import { describe, expect, it } from 'vitest'
import type { Shape, Point } from './shape.types'
import { hasSelfIntersection, shapeCalculationIssue } from './shapeValidation'

const canvas = { widthCm: 30, heightCm: 30 }
function polygon(points: Point[]): Shape { return { id: 'test', type: 'polygon', points } }
describe('织片轮廓有效性', () => {
  it('识别交叉、非相邻接触和相邻回折，允许凹形及尖角', () => {
    expect(hasSelfIntersection(polygon([{ x: 1, y: 1 }, { x: 8, y: 8 }, { x: 1, y: 8 }, { x: 8, y: 1 }]))).toBe(true)
    expect(hasSelfIntersection(polygon([{ x: 1, y: 1 }, { x: 8, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 8 }]))).toBe(true)
    expect(hasSelfIntersection(polygon([{ x: 1, y: 1 }, { x: 8, y: 1 }, { x: 8, y: 8 }, { x: 4, y: 4 }, { x: 1, y: 8 }]))).toBe(false)
  })
  it('曲线穿过闭合边时拒绝，修正后恢复', () => {
    const shape: Shape = { id: 'curve', type: 'path', closed: true, nodes: [
      { anchor: { x: 2, y: 2 }, outControl: { x: 2, y: 18 } },
      { anchor: { x: 10, y: 2 }, inControl: { x: 10, y: 18 } },
      { anchor: { x: 10, y: 8 } }, { anchor: { x: 2, y: 8 } },
    ] }
    expect(shapeCalculationIssue(shape, canvas)).toBe('self-intersection')
    expect(shapeCalculationIssue({ ...shape, nodes: shape.nodes.map((node) => ({ anchor: node.anchor })) }, canvas)).toBe(null)
  })
  it.each([{ x: -0.1, y: 1 }, { x: 29, y: 1 }, { x: 1, y: -0.1 }, { x: 1, y: 29 }])('四边越界均拒绝 %o', ({ x, y }) => {
    expect(shapeCalculationIssue({ id: 'r', type: 'rectangle', x, y, widthCm: 2, heightCm: 2 }, canvas)).toBe('out-of-bounds')
  })
  it('轮廓贴边有效，扩大画布恢复且原数据不变', () => {
    const shape: Shape = { id: 'r', type: 'rectangle', x: 28, y: 28, widthCm: 3, heightCm: 2 }
    expect(shapeCalculationIssue(shape, canvas)).toBe('out-of-bounds')
    expect(shapeCalculationIssue(shape, { widthCm: 31, heightCm: 30 })).toBe(null)
    expect(shape.widthCm).toBe(3)
  })
})
