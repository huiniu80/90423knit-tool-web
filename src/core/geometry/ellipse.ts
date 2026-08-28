import type { EllipseShape, HorizontalInterval } from './shape.types'

export function getEllipseIntervals(
  shape: EllipseShape,
  yCm: number,
): HorizontalInterval[] {
  const deltaY = yCm - shape.center.y
  const value = 1 - deltaY ** 2 / shape.radiusYcm ** 2
  if (value < 0) return []

  const deltaX = shape.radiusXcm * Math.sqrt(Math.max(0, value))
  return [
    {
      startX: shape.center.x - deltaX,
      endX: shape.center.x + deltaX,
    },
  ]
}
