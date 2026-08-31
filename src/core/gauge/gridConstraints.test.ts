import { describe, expect, it } from 'vitest'
import { GRID_LIMITS, assessGrid } from './gridConstraints'

const gauge = { sampleStitches: 10, sampleRows: 10, sampleWidthCm: 10, sampleHeightCm: 6 }
const fabric = { widthCm: 60, heightCm: 70 }

describe('编织网格规模评估', () => {
  it('接受默认毛衣画布并返回实际针格数', () => {
    expect(assessGrid(gauge, fabric)).toMatchObject({
      status: 'valid', columnCount: 60, rowCount: 117, cellCount: 7_020, issues: [],
    })
  })

  it('针数与行数必须是整数', () => {
    const result = assessGrid({ ...gauge, sampleStitches: 10.5 }, fabric)
    expect(result.status).toBe('blocked')
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'non_integer_count', field: 'sampleStitches' }))
  })

  it('拒绝单轴未超限但总针格超限的网格', () => {
    const result = assessGrid(
      { sampleStitches: 20, sampleRows: 20, sampleWidthCm: 2, sampleHeightCm: 2 },
      { widthCm: 145, heightCm: 145 },
    )
    expect(result).toMatchObject({ status: 'blocked', columnCount: 1_450, rowCount: 1_450 })
    expect(result.issues.some((issue) => issue.code === 'cells_exceeded')).toBe(true)
  })

  it('允许恰好等于总针格上限', () => {
    const result = assessGrid(
      { sampleStitches: 20, sampleRows: 10, sampleWidthCm: 2, sampleHeightCm: 1 },
      { widthCm: 200, heightCm: 100 },
    )
    expect(result.cellCount).toBe(GRID_LIMITS.cellsMax)
    expect(result.status).toBe('warning')
    expect(result.issues.every((issue) => issue.severity === 'warning')).toBe(true)
  })

  it('不常见密度只警告而不阻止', () => {
    const result = assessGrid(
      { sampleStitches: 11, sampleRows: 10, sampleWidthCm: 1, sampleHeightCm: 10 },
      { widthCm: 10, heightCm: 10 },
    )
    expect(result.status).toBe('warning')
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'density_unusual', severity: 'warning' }))
  })
})
