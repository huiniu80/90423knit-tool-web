import { describe, expect, it } from 'vitest'
import type { MarkerLayoutInput, PositionedMarker } from './markerLayout'
import { layoutMarkersGlobally } from './markerLayout'

const bounds = { left: 0, top: 0, right: 500, bottom: 400 }

function expectMarkersSeparated(markers: PositionedMarker[], gap = 4): void {
  markers.forEach((marker, index) => {
    markers.slice(index + 1).forEach((other) => {
      expect(Math.hypot(marker.x - other.x, marker.y - other.y)).toBeGreaterThanOrEqual(
        marker.radius + other.radius + gap,
      )
    })
  })
}

describe('画布编号标记全局布局', () => {
  it('跨边界段的同点标记也会统一避让并保持确定性', () => {
    const markers: MarkerLayoutInput[] = [
      { id: 'segment-a-1', label: '1', anchorX: 240, anchorY: 180, radius: 12, side: 'left' },
      { id: 'segment-b-1', label: '1', anchorX: 240, anchorY: 180, radius: 12, side: 'right' },
      { id: 'segment-c-12', label: '12', anchorX: 240, anchorY: 180, radius: 14, side: 'right' },
    ]
    const first = layoutMarkersGlobally(markers, { bounds })
    const reordered = layoutMarkersGlobally([...markers].reverse(), { bounds })

    expectMarkersSeparated(first)
    expect(reordered).toEqual(first)
    expect(first.some((marker) => marker.x !== marker.anchorX || marker.y !== marker.anchorY)).toBe(true)
  })

  it('密集的一位数和两位数编号全部处于画布内且互不覆盖', () => {
    const markers = Array.from({ length: 29 }, (_, index): MarkerLayoutInput => ({
      id: `marker-${String(index).padStart(2, '0')}`,
      label: String(index + 1),
      anchorX: 250 + (index % 3) * 3,
      anchorY: 190 + (index % 5) * 3,
      radius: index >= 9 ? 14 : 12,
      side: index % 2 ? 'left' : 'right',
    }))
    const result = layoutMarkersGlobally(markers, { bounds })

    expectMarkersSeparated(result)
    result.forEach((marker) => {
      expect(marker.x - marker.radius).toBeGreaterThanOrEqual(bounds.left)
      expect(marker.x + marker.radius).toBeLessThanOrEqual(bounds.right)
      expect(marker.y - marker.radius).toBeGreaterThanOrEqual(bounds.top)
      expect(marker.y + marker.radius).toBeLessThanOrEqual(bounds.bottom)
    })
  })

  it('避让黑色段号和说明卡片，并保留真实针位锚点', () => {
    const [marker] = layoutMarkersGlobally([
      { id: 'marker', label: '8', anchorX: 30, anchorY: 30, radius: 12, side: 'left' },
    ], {
      bounds,
      circleObstacles: [{ x: 30, y: 30, radius: 12 }],
      rectangleObstacles: [{ x: 0, y: 0, width: 80, height: 400 }],
    })

    expect(marker).toMatchObject({ anchorX: 30, anchorY: 30 })
    expect(marker!.x).toBeGreaterThanOrEqual(96)
    expect(Math.hypot(marker!.x - 30, marker!.y - 30)).toBeGreaterThan(0)
  })

  it('靠近画布边缘时向可视区域内避让', () => {
    const result = layoutMarkersGlobally([
      { id: 'edge-a', label: '1', anchorX: 2, anchorY: 2, radius: 12, side: 'left' },
      { id: 'edge-b', label: '2', anchorX: 2, anchorY: 2, radius: 12, side: 'left' },
    ], { bounds })

    expectMarkersSeparated(result)
    result.forEach((marker) => {
      expect(marker.x).toBeGreaterThanOrEqual(marker.radius)
      expect(marker.y).toBeGreaterThanOrEqual(marker.radius)
    })
  })
})
