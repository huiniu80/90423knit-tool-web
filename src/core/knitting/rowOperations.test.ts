import { describe, expect, it } from 'vitest'
import { generateInstructions, generateGarmentEdgeShapingSequence } from './planner'
import { validateRowOperations } from './rowOperations'
import type { RasterRow, StitchSegment } from '../raster/raster.types'
function row(rowIndex: number, segments: StitchSegment[]): RasterRow {
  return { rowIndex, yCm: rowIndex + 0.5, segments, stitchCount: segments.reduce((count, s) => count + s.endStitch - s.startStitch + 1, 0) }
}
describe('权威逐行操作', () => {
  it.each([1, 2, 3, 4])('单侧减少 %i 针按阈值分类，同一行另一侧独立处理', count => {
    const instructions = generateInstructions([row(0, [{ startStitch: 0, endStitch: 19 }]),
      row(1, [{ startStitch: count, endStitch: 18 }])], 'bottom-up')
    expect(instructions[1]?.operations?.map(o => [o.edge, o.kind, o.count])).toEqual([
      ['left-outer', count < 4 ? 'decrease' : 'bind-off', count], ['right-outer', 'decrease', 1],
    ])
    expect(instructions.every(i => i.supported && !i.conflict)).toBe(true)
  })
  it('分段中间平收与外侧非重叠操作同时成立，针段结束一针仍平收', () => {
    const instructions = generateInstructions([row(0, [{ startStitch: 0, endStitch: 9 }]),
      row(1, [{ startStitch: 1, endStitch: 1 }, { startStitch: 3, endStitch: 8 }]),
      row(2, [{ startStitch: 3, endStitch: 8 }])], 'bottom-up')
    expect(instructions[1]?.operations?.map(o => [o.edge, o.count])).toEqual([['left-outer', 1], ['center', 1], ['right-outer', 1]])
    expect(instructions[2]?.operations?.[0]).toMatchObject({ kind: 'bind-off', count: 1, canOverride: false })
    expect(instructions[2]?.transition).toBe('continue')
    expect(instructions[2]?.finishOperations?.[0]).toMatchObject({ kind: 'bind-off', count: 6 })
    expect(instructions).toHaveLength(3)
  })
  it('覆盖只改工艺，摘要按实际行分组，内侧独立减少不重复解释中间平收', () => {
    const rows = [row(0, [{ startStitch: 0, endStitch: 9 }]),
      row(1, [{ startStitch: 0, endStitch: 3 }, { startStitch: 6, endStitch: 9 }]),
      row(2, [{ startStitch: 0, endStitch: 2 }, { startStitch: 7, endStitch: 9 }])]
    const automatic = generateInstructions(rows, 'bottom-up')
    const overridden = generateInstructions(rows, 'bottom-up', { '3:left-neck': 'bind-off' })
    expect(overridden[2]?.operations?.map(o => [o.edge, o.kind, o.count])).toEqual([
      ['left-neck', 'bind-off', 1], ['right-neck', 'decrease', 1],
    ])
    expect(overridden.map(i => i.segments)).toEqual(automatic.map(i => i.segments))
    expect(generateGarmentEdgeShapingSequence(overridden, 'left-neck')[0]).toMatchObject({ technique: 'bind-off', endRowNumber: 3, stitchCount: 1 })
  })
  it('重复占针、超量、与保留区域重叠拦截并标明原因', () => {
    const before = [{ startStitch: 0, endStitch: 9 }]
    const after = [{ startStitch: 2, endStitch: 8 }]
    const operations = generateInstructions([row(0, before), row(1, after)], 'bottom-up')[1]!.operations!
    expect(validateRowOperations(before, after, operations)).toBeNull()
    expect(validateRowOperations(before, after, [...operations, operations[0]!])).toContain('重复占用')
    expect(validateRowOperations(before, after, [{ ...operations[0]!, count: 12 }, operations[1]!])).toContain('数量超过')
    expect(validateRowOperations(before, after, [{ ...operations[0]!, endStitch: 2, count: 3 }, operations[1]!])).toContain('保留针位重叠')
  })
})
