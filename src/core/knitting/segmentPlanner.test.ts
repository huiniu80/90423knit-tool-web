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
    expect(description.lines.some((line) => line.includes('分开编织'))).toBe(true)
    expect(description.lines.some((line) => line.includes('左肩领口侧'))).toBe(true)
    expect(description.lines.some((line) => line.includes('右肩领口侧'))).toBe(true)
    expect(description.lines.some((line) => line.includes('减'))).toBe(true)
    expect(description.lines.some((line) => line.includes('加'))).toBe(false)
    expect(description.lines.some((line) => line.includes('按 1 →'))).toBe(true)
    expect(description.lines.some((line) => line.startsWith('1. '))).toBe(true)
    expect(description.markers[0]?.label).toBe('1')
    expect(description.markers.every((marker, index) =>
      index === 0 || marker.point.y >= description.markers[index - 1]!.point.y,
    )).toBe(true)
  })

  it('身体直边标明实际平织行数和不加不减', () => {
    const path: PathShape = {
      id: 'body',
      type: 'path',
      closed: true,
      nodes: [
        { anchor: { x: 2, y: 2 } },
        { anchor: { x: 10, y: 2 } },
        { anchor: { x: 10, y: 8 } },
        { anchor: { x: 2, y: 8 } },
      ],
    }
    const segment = getShapeBoundarySegments(path)[1]!
    const description = describeBoundarySegmentShaping(
      segment,
      'bottom-up',
      { stitchWidthCm: 1, rowHeightCm: 1, stitchesPerCm: 1, rowsPerCm: 1 },
      { widthCm: 12, heightCm: 12 },
      { mode: 'center', symmetryOptimization: true },
      6,
    )

    expect(description.lines.some((line) => line.includes('不加不减'))).toBe(true)
    expect(description.lines.some((line) => line.includes('平织 6 行'))).toBe(true)
  })

  it('任意图形的外侧加减针使用中性边界名称', () => {
    const path: PathShape = {
      id: 'tapered-shape',
      type: 'path',
      closed: true,
      nodes: [
        { anchor: { x: 0, y: 0 } },
        { anchor: { x: 12, y: 0 } },
        { anchor: { x: 9, y: 10 } },
        { anchor: { x: 3, y: 10 } },
      ],
    }
    const segments = getShapeBoundarySegments(path)
    const descriptions = [segments[1]!, segments[3]!].map((segment) =>
      describeBoundarySegmentShaping(
        segment,
        'bottom-up',
        { stitchWidthCm: 1, rowHeightCm: 1, stitchesPerCm: 1, rowsPerCm: 1 },
        { widthCm: 12, heightCm: 12 },
        { mode: 'center', symmetryOptimization: true },
        6,
      ),
    )
    const lines = descriptions.flatMap((description) => description.lines)

    expect(lines.some((line) => line.includes('左侧边界塑形'))).toBe(true)
    expect(lines.some((line) => line.includes('右侧边界塑形'))).toBe(true)
    expect(lines.every((line) => !line.includes('袖窿'))).toBe(true)
  })

  it('左右镜像模式的领口只归纳左侧规律', () => {
    const path: PathShape = {
      id: 'mirrored-neck',
      type: 'path',
      closed: true,
      editConstraint: { type: 'vertical-mirror', axisX: 5 },
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
    const leftNeckSegment = getShapeBoundarySegments(path)[5]!
    const description = describeBoundarySegmentShaping(
      leftNeckSegment,
      'bottom-up',
      { stitchWidthCm: 1, rowHeightCm: 1, stitchesPerCm: 1, rowsPerCm: 1 },
      { widthCm: 10, heightCm: 10 },
      { mode: 'center', symmetryOptimization: true },
      5,
    )

    expect(description.lines.some((line) => line.includes('领口侧镜像减针'))).toBe(true)
    expect(description.lines.every((line) => !line.includes('圆领塑形'))).toBe(true)
    expect(description.lines.every((line) => !line.includes('右肩领口侧'))).toBe(true)
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
