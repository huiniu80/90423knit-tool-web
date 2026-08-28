import { getCircleIntervals } from './circle'
import { getEllipseIntervals } from './ellipse'
import { getPolygonIntervals } from './polygon'
import { getRectangleIntervals } from './rectangle'
import { getTriangleIntervals } from './triangle'
import type {
  Bounds,
  HorizontalInterval,
  Point,
  Shape,
} from './shape.types'

export function getHorizontalIntervals(
  shape: Shape,
  yCm: number,
): HorizontalInterval[] {
  switch (shape.type) {
    case 'rectangle':
      return getRectangleIntervals(shape, yCm)
    case 'triangle':
      return getTriangleIntervals(shape, yCm)
    case 'circle':
      return getCircleIntervals(shape, yCm)
    case 'ellipse':
      return getEllipseIntervals(shape, yCm)
    case 'polygon':
      return getPolygonIntervals(shape.points, yCm)
  }
}

function boundsFromPoints(points: readonly Point[]): Bounds {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  }
}

export function getShapeBounds(shape: Shape): Bounds {
  switch (shape.type) {
    case 'rectangle':
      return { x: shape.x, y: shape.y, width: shape.widthCm, height: shape.heightCm }
    case 'circle':
      return {
        x: shape.center.x - shape.radiusCm,
        y: shape.center.y - shape.radiusCm,
        width: shape.radiusCm * 2,
        height: shape.radiusCm * 2,
      }
    case 'ellipse':
      return {
        x: shape.center.x - shape.radiusXcm,
        y: shape.center.y - shape.radiusYcm,
        width: shape.radiusXcm * 2,
        height: shape.radiusYcm * 2,
      }
    case 'triangle':
    case 'polygon':
      return boundsFromPoints(shape.points)
  }
}

export function translateShape(shape: Shape, deltaX: number, deltaY: number): Shape {
  switch (shape.type) {
    case 'rectangle':
      return { ...shape, x: shape.x + deltaX, y: shape.y + deltaY }
    case 'circle':
    case 'ellipse':
      return {
        ...shape,
        center: { x: shape.center.x + deltaX, y: shape.center.y + deltaY },
      }
    case 'triangle':
      return {
        ...shape,
        points: shape.points.map((point) => ({
          x: point.x + deltaX,
          y: point.y + deltaY,
        })) as [Point, Point, Point],
      }
    case 'polygon':
      return {
        ...shape,
        points: shape.points.map((point) => ({
          x: point.x + deltaX,
          y: point.y + deltaY,
        })),
      }
  }
}

export function resizeShapeToBounds(shape: Shape, next: Bounds): Shape {
  const current = getShapeBounds(shape)
  const safeWidth = Math.max(0.1, next.width)
  const safeHeight = Math.max(0.1, next.height)
  const scaleX = current.width === 0 ? 1 : safeWidth / current.width
  const scaleY = current.height === 0 ? 1 : safeHeight / current.height
  const resizePoint = (point: Point): Point => ({
    x: next.x + (point.x - current.x) * scaleX,
    y: next.y + (point.y - current.y) * scaleY,
  })

  switch (shape.type) {
    case 'rectangle':
      return { ...shape, x: next.x, y: next.y, widthCm: safeWidth, heightCm: safeHeight }
    case 'circle': {
      const diameter = Math.max(0.1, Math.min(safeWidth, safeHeight))
      return {
        ...shape,
        center: { x: next.x + diameter / 2, y: next.y + diameter / 2 },
        radiusCm: diameter / 2,
      }
    }
    case 'ellipse':
      return {
        ...shape,
        center: { x: next.x + safeWidth / 2, y: next.y + safeHeight / 2 },
        radiusXcm: safeWidth / 2,
        radiusYcm: safeHeight / 2,
      }
    case 'triangle':
      return {
        ...shape,
        points: shape.points.map(resizePoint) as [Point, Point, Point],
      }
    case 'polygon':
      return { ...shape, points: shape.points.map(resizePoint) }
  }
}
