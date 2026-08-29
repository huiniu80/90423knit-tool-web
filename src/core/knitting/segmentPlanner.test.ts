import { describe, expect, it } from 'vitest'
import { getShapeBoundarySegments } from '../geometry/boundarySegments'
import type { PathShape } from '../geometry/shape.types'
import { describeBoundarySegmentShaping } from './segmentPlanner'

describe('分段加减针说明', () => {
  it('闭合织片的 U 形领口按整片截面生成减针说明', () => {
    const path: PathShape = {
      id: 'u-neck',
      type: 'path',
      closed: true,
      nodes: [
        { anchor: { x: 0, y: 0 } },
        { anchor: { x: 12, y: 0 } },
        { anchor: { x: 12, y: 11 } },
        { anchor: { x: 9, y: 11 }, outControl: { x: 9, y: 3 } },
        { anchor: { x: 3, y: 11 }, inControl: { x: 3, y: 3 } },
        { anchor: { x: 0, y: 11 } },
      ],
    }
    const segment = getShapeBoundarySegments(path)[3]!
    const description = describeBoundarySegmentShaping(
      segment,
      'bottom-up',
      { stitchWidthCm: 1, rowHeightCm: 1, stitchesPerCm: 1, rowsPerCm: 1 },
      { widthCm: 12, heightCm: 12 },
      { mode: 'center', symmetryOptimization: true },
      6,
    )

    expect(description.boundarySide).toBe('both')
    expect(description.lines.some((line) => line.includes('领口起始'))).toBe(true)
    expect(description.lines.some((line) => line.includes('左肩领口侧'))).toBe(true)
    expect(description.lines.some((line) => line.includes('右肩领口侧'))).toBe(true)
    expect(description.lines.some((line) => line.includes('减'))).toBe(true)
    expect(description.lines.some((line) => line.includes('加'))).toBe(false)
    expect(description.lines.some((line) => line.includes('按 ①'))).toBe(true)
    expect(description.markers[0]?.label).toBe('①')
    expect(description.markers.every((marker, index) =>
      index === 0 || marker.point.y >= description.markers[index - 1]!.point.y,
    )).toBe(true)
  })

  it('开放曲线不再被当成织片', () => {
    const path: PathShape = {
      id: 'open', type: 'path', closed: false,
      nodes: [{ anchor: { x: 2, y: 2 } }, { anchor: { x: 8, y: 8 } }],
    }
    const description = describeBoundarySegmentShaping(
      getShapeBoundarySegments(path)[0]!,
      'bottom-up',
      { stitchWidthCm: 1, rowHeightCm: 1, stitchesPerCm: 1, rowsPerCm: 1 },
      { widthCm: 12, heightCm: 12 },
      { mode: 'center', symmetryOptimization: true },
      6,
    )
    expect(description.lines).toEqual(['开放路径不形成织片'])
  })
})
