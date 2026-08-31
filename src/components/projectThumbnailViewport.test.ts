import { describe, expect, it } from 'vitest'
import type { Shape } from '../core/geometry/shape.types'
import { getProjectThumbnailViewBox } from './projectThumbnailViewport'

const fabric = { widthCm: 50, heightCm: 70 }

function parseViewBox(shapes: Shape[]): [number, number, number, number] {
  return getProjectThumbnailViewBox(shapes, fabric).split(' ').map(Number) as [number, number, number, number]
}

describe('方案缩略图自动取景', () => {
  it('空白方案仍展示完整画布', () => {
    expect(getProjectThumbnailViewBox([], fabric)).toBe('0 0 50 70')
  })

  it('画布底部的图形四周保留安全留白', () => {
    const triangle: Shape = {
      id: 'bottom',
      type: 'triangle',
      points: [{ x: 15, y: 0 }, { x: 35, y: 0 }, { x: 25, y: 12 }],
    }
    const [x, svgY, width, height] = parseViewBox([triangle])

    expect(x).toBeLessThan(15)
    expect(svgY).toBeLessThan(58)
    expect(x + width).toBeGreaterThan(35)
    expect(svgY + height).toBeGreaterThan(70)
  })

  it('多个图形按联合边界完整取景', () => {
    const shapes: Shape[] = [
      { id: 'left', type: 'rectangle', x: 2, y: 4, widthCm: 6, heightCm: 8 },
      { id: 'right', type: 'circle', center: { x: 43, y: 60 }, radiusCm: 4 },
    ]
    const [x, svgY, width, height] = parseViewBox(shapes)

    expect(x).toBeLessThan(2)
    expect(svgY).toBeLessThan(6)
    expect(x + width).toBeGreaterThan(47)
    expect(svgY + height).toBeGreaterThan(66)
  })

  it('退化为单点的路径也会得到有限且有面积的视窗', () => {
    const pointPath: Shape = {
      id: 'point', type: 'path', closed: false, nodes: [{ anchor: { x: 25, y: 35 } }],
    }
    const values = parseViewBox([pointPath])

    expect(values.every(Number.isFinite)).toBe(true)
    expect(values[2]).toBeGreaterThan(0)
    expect(values[3]).toBeGreaterThan(0)
  })
})
