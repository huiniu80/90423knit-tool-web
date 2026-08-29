import { describe, expect, it } from 'vitest'
import { getShapeBoundarySegments } from '../geometry/boundarySegments'
import type { PathShape } from '../geometry/shape.types'
import { describeBoundarySegmentShaping } from './segmentPlanner'

describe('分段加减针说明', () => {
  it('两锚点 U 形弧线合并为一张包含左右支的说明', () => {
    const path: PathShape = {
      id: 'u-neck',
      type: 'path',
      closed: false,
      nodes: [
        { anchor: { x: 2, y: 9 }, outControl: { x: 3, y: 2 } },
        { anchor: { x: 10, y: 9 }, inControl: { x: 9, y: 2 } },
      ],
    }
    const segment = getShapeBoundarySegments(path)[0]!
    const description = describeBoundarySegmentShaping(
      segment,
      'bottom-up',
      { stitchWidthCm: 1, rowHeightCm: 1, stitchesPerCm: 1, rowsPerCm: 1 },
      { widthCm: 12, heightCm: 12 },
      { mode: 'center', symmetryOptimization: true },
      6,
    )

    expect(description.boundarySide).toBe('both')
    expect(description.lines.some((line) => line.startsWith('左支 ·'))).toBe(true)
    expect(description.lines.some((line) => line.startsWith('右支 ·'))).toBe(true)
    expect(description.lines.some((line) => line.includes('暂不支持归纳'))).toBe(false)
  })
})
