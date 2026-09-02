import { describe, expect, it } from 'vitest'
import { createCanvasExportLayout } from './canvasExportLayout'

describe('createCanvasExportLayout', () => {
  it('uses a large export canvas and centers the fabric', () => {
    const layout = createCanvasExportLayout({
      fabricWidthCm: 60,
      fabricHeightCm: 70,
      leftAnnotationHeights: [180, 220],
      rightAnnotationHeights: [160],
    })

    expect(layout.width).toBe(1800)
    expect(layout.height).toBeGreaterThanOrEqual(1000)
    expect(layout.pan.x).toBeCloseTo((layout.width - 60 * layout.zoom) / 2)
    expect(layout.pan.y).toBeCloseTo((layout.height - 70 * layout.zoom) / 2)
    expect(layout.pixelRatio).toBeGreaterThan(0)
    expect(layout.pixelRatio).toBeLessThanOrEqual(2)
  })

  it('grows vertically to fit every expanded annotation', () => {
    const annotationHeights = Array.from({ length: 12 }, () => 240)
    const layout = createCanvasExportLayout({
      fabricWidthCm: 60,
      fabricHeightCm: 70,
      leftAnnotationHeights: annotationHeights,
      rightAnnotationHeights: [],
    })

    expect(layout.height).toBe(3018)
  })

  it('grows horizontally when a very wide fabric cannot fit at minimum zoom', () => {
    const layout = createCanvasExportLayout({
      fabricWidthCm: 300,
      fabricHeightCm: 70,
      leftAnnotationHeights: [],
      rightAnnotationHeights: [],
    })

    expect(layout.width).toBeGreaterThan(1800)
    expect(layout.zoom).toBe(5)
  })

  it('reduces bitmap density for exceptionally tall exports', () => {
    const layout = createCanvasExportLayout({
      fabricWidthCm: 60,
      fabricHeightCm: 70,
      leftAnnotationHeights: Array.from({ length: 80 }, () => 240),
      rightAnnotationHeights: [],
    })

    expect(layout.pixelRatio).toBeLessThan(1)
    expect(layout.height * layout.pixelRatio).toBeLessThanOrEqual(16384)
  })
})
