import { describe, expect, it } from 'vitest'
import { drawingContourDisplays, insideDisplayContour } from './contourDisplay'
import { traceContours } from './drawing'
import { rasterize } from '../raster/rasterizer'
import { hasSelfIntersection } from '../geometry/shapeValidation'
import type { Gauge } from '../gauge/gauge.types'
import type { PathShape } from '../geometry/shape.types'

const gauge: Gauge = { stitchWidthCm: .4, rowHeightCm: .6, stitchesPerCm: 2.5, rowsPerCm: 1 / .6 }
function paths(region: Set<string>): PathShape[] {
  return traceContours(region).map((loop, i) => ({ id: `piece-${i}`, type: 'path', closed: true, nodes: loop.map(p => ({ anchor: { x: p.x * gauge.stitchWidthCm, y: p.y * gauge.rowHeightCm } })) }))
}
function corners(region: Set<string>) {
  return [...region].flatMap(key => { const [x, y] = key.split(',').map(Number); return [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]].map(([x, y]) => ({ x: x * gauge.stitchWidthCm, y: y * gauge.rowHeightCm })) })
}
const raster = (source: PathShape[]) => source.map(s => rasterize(s, gauge, { widthCm: 20, heightCm: 20 }, { mode: 'center', symmetryOptimization: false }))

describe('圆滑轮廓仅用于显示', () => {
  it('圆滑阶梯椭圆，完整包住边缘针格，原坐标与每行针数保持', () => {
    const region = new Set<string>()
    const widths = [3, 5, 7, 9, 11, 13, 13, 11, 9, 7, 5, 3]
    widths.forEach((width, row) => { for (let x = 0; x < width; x++) region.add(`${8 - Math.floor(width / 2) + x},${row + 3}`) })
    const sources = paths(region), saved = JSON.stringify(sources), before = raster(sources)
    const [outline] = drawingContourDisplays(sources, gauge)
    expect(outline.fallback).toBeNull()
    expect(outline.path.nodes.some(n => n.inControl && n.outControl)).toBe(true)
    expect(outline.path.nodes.length).toBeLessThan(sources[0].nodes.length)
    expect(hasSelfIntersection(outline.path)).toBe(false)
    expect(corners(region).every(p => insideDisplayContour(outline.points, p))).toBe(true)
    expect(JSON.stringify(sources)).toBe(saved)
    expect(raster(sources)).toEqual(before)
  })
  it('窄凹口保持开放，圆滑不剪掉已有针格', () => {
    const region = new Set<string>()
    for (let y = 3; y < 9; y++) for (let x = 3; x < 10; x++) if (!(x === 6 && y >= 5)) region.add(`${x},${y}`)
    const [outline] = drawingContourDisplays(paths(region), gauge)
    expect(outline.fallback).toBeNull()
    expect(corners(region).every(p => insideDisplayContour(outline.points, p))).toBe(true)
    for (let y = 5; y < 9; y++) expect(insideDisplayContour(outline.points, { x: 6.5 * gauge.stitchWidthCm, y: (y + .5) * gauge.rowHeightCm })).toBe(false)
    expect(hasSelfIntersection(outline.path)).toBe(false)
  })
  it('分离区域保持独立，对角接触用原边缘且有说明', () => {
    const separate = paths(new Set(['2,2', '8,8']))
    const separated = drawingContourDisplays(separate, gauge)
    expect(separated).toHaveLength(2)
    expect(separated.every(c => !c.fallback)).toBe(true)
    const diagonal = paths(new Set(['2,2', '3,3']))
    const touching = drawingContourDisplays(diagonal, gauge)
    expect(touching).toHaveLength(2)
    expect(touching.every(c => c.fallback && c.path === c.source)).toBe(true)
  })
  it('兼容顺时针路径，拒绝自相交或未闭合的圆滑候选', () => {
    const [source] = paths(new Set(['2,2', '3,2', '2,3', '3,3']))
    source.nodes.reverse()
    const [outline] = drawingContourDisplays([source], gauge)
    expect(outline.fallback).toBeNull()
    expect(corners(new Set(['2,2', '3,2', '2,3', '3,3'])).every(p => insideDisplayContour(outline.points, p))).toBe(true)
    const crossed: PathShape = { id: 'cross', type: 'path', closed: true, nodes: [[1, 1], [3, 3], [1, 3], [3, 1]].map(([x, y]) => ({ anchor: { x, y } })) }
    expect(drawingContourDisplays([crossed], gauge)[0].path).toBe(crossed)
    expect(drawingContourDisplays([{ ...source, closed: false }], gauge)[0].fallback).toBeTruthy()
  })
})
