export interface Point {
  x: number
  y: number
}

export interface HorizontalInterval {
  startX: number
  endX: number
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

interface BaseShape {
  id: string
  name?: string
}

export interface RectangleShape extends BaseShape {
  type: 'rectangle'
  x: number
  y: number
  widthCm: number
  heightCm: number
}

export interface TriangleShape extends BaseShape {
  type: 'triangle'
  points: [Point, Point, Point]
}

export interface CircleShape extends BaseShape {
  type: 'circle'
  center: Point
  radiusCm: number
}

export interface EllipseShape extends BaseShape {
  type: 'ellipse'
  center: Point
  radiusXcm: number
  radiusYcm: number
}

export interface PolygonShape extends BaseShape {
  type: 'polygon'
  points: Point[]
}

export interface PathNode {
  anchor: Point
  inControl?: Point
  outControl?: Point
}

export interface VerticalMirrorConstraint {
  type: 'vertical-mirror'
  axisX: number
}

export interface PathShape extends BaseShape {
  type: 'path'
  nodes: PathNode[]
  closed: boolean
  editConstraint?: VerticalMirrorConstraint
}

export type Shape =
  | RectangleShape
  | TriangleShape
  | CircleShape
  | EllipseShape
  | PolygonShape
  | PathShape

export type ShapeType = Shape['type']
