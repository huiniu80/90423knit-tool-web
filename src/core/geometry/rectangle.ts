import type { HorizontalInterval, RectangleShape } from './shape.types'

export function getRectangleIntervals(
  shape: RectangleShape,
  yCm: number,
): HorizontalInterval[] {
  if (yCm < shape.y || yCm > shape.y + shape.heightCm) return []
  return [{ startX: shape.x, endX: shape.x + shape.widthCm }]
}
