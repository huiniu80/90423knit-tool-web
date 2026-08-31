export interface MarkerLayoutBounds {
  left: number
  top: number
  right: number
  bottom: number
}

export interface MarkerLayoutInput {
  id: string
  label: string
  anchorX: number
  anchorY: number
  radius: number
  side: 'left' | 'right'
}

export interface CircleObstacle {
  x: number
  y: number
  radius: number
}

export interface RectangleObstacle {
  x: number
  y: number
  width: number
  height: number
}

export interface MarkerLayoutOptions {
  bounds: MarkerLayoutBounds
  circleObstacles?: CircleObstacle[]
  rectangleObstacles?: RectangleObstacle[]
  gap?: number
  searchStep?: number
}

export interface PositionedMarker extends MarkerLayoutInput {
  x: number
  y: number
}

interface Offset {
  dx: number
  dy: number
}

const defaultGap = 4
const defaultSearchStep = 8

function circleFitsBounds(
  x: number,
  y: number,
  radius: number,
  bounds: MarkerLayoutBounds,
): boolean {
  return x - radius >= bounds.left
    && x + radius <= bounds.right
    && y - radius >= bounds.top
    && y + radius <= bounds.bottom
}

function circlesOverlap(
  x: number,
  y: number,
  radius: number,
  obstacle: CircleObstacle,
  gap: number,
): boolean {
  return Math.hypot(x - obstacle.x, y - obstacle.y) < radius + obstacle.radius + gap
}

function circleOverlapsRectangle(
  x: number,
  y: number,
  radius: number,
  rectangle: RectangleObstacle,
  gap: number,
): boolean {
  const nearestX = Math.max(rectangle.x, Math.min(x, rectangle.x + rectangle.width))
  const nearestY = Math.max(rectangle.y, Math.min(y, rectangle.y + rectangle.height))
  return Math.hypot(x - nearestX, y - nearestY) < radius + gap
}

function ringOffsets(level: number, outward: number): Offset[] {
  const offsets: Offset[] = []
  for (let dx = -level; dx <= level; dx += 1) {
    offsets.push({ dx, dy: -level }, { dx, dy: level })
  }
  for (let dy = -level + 1; dy < level; dy += 1) {
    offsets.push({ dx: -level, dy }, { dx: level, dy })
  }
  return offsets.sort((left, right) => {
    const leftDistance = left.dx ** 2 + left.dy ** 2
    const rightDistance = right.dx ** 2 + right.dy ** 2
    if (leftDistance !== rightDistance) return leftDistance - rightDistance
    const leftInward = left.dx * outward < 0 ? 1 : 0
    const rightInward = right.dx * outward < 0 ? 1 : 0
    if (leftInward !== rightInward) return leftInward - rightInward
    if (Math.abs(left.dy) !== Math.abs(right.dy)) return Math.abs(left.dy) - Math.abs(right.dy)
    if (left.dy !== right.dy) return left.dy - right.dy
    return outward > 0 ? right.dx - left.dx : left.dx - right.dx
  })
}

/**
 * 在整张画布上为编号标记寻找最近的无碰撞位置。输入顺序不会影响结果，
 * 这样缩放或重算时标记不会因为响应式数组顺序变化而跳动。
 */
export function layoutMarkersGlobally(
  markers: MarkerLayoutInput[],
  options: MarkerLayoutOptions,
): PositionedMarker[] {
  const gap = options.gap ?? defaultGap
  const searchStep = options.searchStep ?? defaultSearchStep
  const circleObstacles = options.circleObstacles ?? []
  const rectangleObstacles = options.rectangleObstacles ?? []
  const placed: PositionedMarker[] = []
  const maximumLevel = Math.ceil(Math.max(
    options.bounds.right - options.bounds.left,
    options.bounds.bottom - options.bounds.top,
  ) / searchStep)
  const ordered = [...markers].sort((left, right) =>
    left.anchorY - right.anchorY
      || left.anchorX - right.anchorX
      || left.id.localeCompare(right.id),
  )

  for (const marker of ordered) {
    const outward = marker.side === 'left' ? -1 : 1
    const positionIsFree = (x: number, y: number) =>
      circleFitsBounds(x, y, marker.radius, options.bounds)
      && circleObstacles.every((obstacle) =>
        !circlesOverlap(x, y, marker.radius, obstacle, gap),
      )
      && placed.every((other) =>
        !circlesOverlap(x, y, marker.radius, {
          x: other.x,
          y: other.y,
          radius: other.radius,
        }, gap),
      )
      && rectangleObstacles.every((obstacle) =>
        !circleOverlapsRectangle(x, y, marker.radius, obstacle, gap),
      )

    let position = positionIsFree(marker.anchorX, marker.anchorY)
      ? { x: marker.anchorX, y: marker.anchorY }
      : null

    for (let level = 1; !position && level <= maximumLevel; level += 1) {
      const offset = ringOffsets(level, outward).find(({ dx, dy }) =>
        positionIsFree(
          marker.anchorX + dx * searchStep,
          marker.anchorY + dy * searchStep,
        ),
      )
      if (offset) {
        position = {
          x: marker.anchorX + offset.dx * searchStep,
          y: marker.anchorY + offset.dy * searchStep,
        }
      }
    }

    // 极小视口中若确实没有可容纳所有圆圈的位置，仍返回受边界约束的位置。
    // 正常编辑器尺寸下，完整画布搜索会在到达这里前找到可用位置。
    const fallback = position ?? {
      x: Math.max(
        options.bounds.left + marker.radius,
        Math.min(marker.anchorX, options.bounds.right - marker.radius),
      ),
      y: Math.max(
        options.bounds.top + marker.radius,
        Math.min(marker.anchorY, options.bounds.bottom - marker.radius),
      ),
    }
    placed.push({ ...marker, ...fallback })
  }

  return placed
}
