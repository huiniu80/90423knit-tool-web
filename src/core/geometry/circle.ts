import type { CircleShape, HorizontalInterval } from './shape.types'

export function getCircleIntervals(
  shape: CircleShape,
  yCm: number,
): HorizontalInterval[] {
  const deltaY = yCm - shape.center.y
  if (Math.abs(deltaY) > shape.radiusCm) return []

  const deltaX = Math.sqrt(
    Math.max(0, shape.radiusCm ** 2 - deltaY ** 2),
  )
  return [
    {
      startX: shape.center.x - deltaX,
      endX: shape.center.x + deltaX,
    },
  ]
}
