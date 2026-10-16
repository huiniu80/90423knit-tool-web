import type { Point } from '../core/geometry/shape.types'

export function cardToScreen(point: Point, pan: Point, zoom: number, fabricHeightCm: number): Point {
  return { x: pan.x + point.x * zoom, y: pan.y + (fabricHeightCm - point.y) * zoom }
}
export function cardFromScreen(point: Point, pan: Point, zoom: number, fabricHeightCm: number): Point {
  return { x: (point.x - pan.x) / zoom, y: fabricHeightCm - (point.y - pan.y) / zoom }
}
