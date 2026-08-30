import { getPathBounds } from '../geometry/path'
import type { PathNode, Point } from '../geometry/shape.types'
import type {
  CalibratedContour,
  ContourCalibration,
  ContourCandidate,
  ImageImportAnalysis,
  ImageImportOptions,
  ImageRaster,
  ImageRotation,
  PixelBounds,
} from './imageImport.types'

function assertRaster(raster: ImageRaster): void {
  if (
    !Number.isInteger(raster.width)
    || !Number.isInteger(raster.height)
    || raster.width <= 0
    || raster.height <= 0
    || raster.data.length !== raster.width * raster.height * 4
  ) throw new Error('图片像素数据无效')
}

export function rotateRaster(raster: ImageRaster, rotation: ImageRotation): ImageRaster {
  assertRaster(raster)
  if (rotation === 0) return raster
  const width = rotation === 90 || rotation === 270 ? raster.height : raster.width
  const height = rotation === 90 || rotation === 270 ? raster.width : raster.height
  const data = new Uint8ClampedArray(width * height * 4)

  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const source = (y * raster.width + x) * 4
      let targetX = x
      let targetY = y
      if (rotation === 90) {
        targetX = raster.height - 1 - y
        targetY = x
      } else if (rotation === 180) {
        targetX = raster.width - 1 - x
        targetY = raster.height - 1 - y
      } else {
        targetX = y
        targetY = raster.width - 1 - x
      }
      const target = (targetY * width + targetX) * 4
      data[target] = raster.data[source]!
      data[target + 1] = raster.data[source + 1]!
      data[target + 2] = raster.data[source + 2]!
      data[target + 3] = raster.data[source + 3]!
    }
  }
  return { width, height, data }
}

export function cropRasterToContent(raster: ImageRaster, margin = 8): ImageRaster {
  assertRaster(raster)
  const values = grayscale(raster)
  const corners = [values[0]!, values[raster.width - 1]!, values[(raster.height - 1) * raster.width]!, values.at(-1)!]
  const background = corners.reduce((sum, value) => sum + value, 0) / corners.length
  let minX = raster.width
  let minY = raster.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      if (Math.abs(values[y * raster.width + x]! - background) < 18) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (maxX < minX || maxY < minY) return raster
  const left = Math.max(0, minX - margin)
  const top = Math.max(0, minY - margin)
  const right = Math.min(raster.width - 1, maxX + margin)
  const bottom = Math.min(raster.height - 1, maxY + margin)
  if (left === 0 && top === 0 && right === raster.width - 1 && bottom === raster.height - 1) return raster
  const width = right - left + 1
  const height = bottom - top + 1
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const sourceStart = ((top + y) * raster.width + left) * 4
    data.set(raster.data.subarray(sourceStart, sourceStart + width * 4), y * width * 4)
  }
  return { width, height, data }
}

function grayscale(raster: ImageRaster): Uint8Array {
  const output = new Uint8Array(raster.width * raster.height)
  for (let index = 0; index < output.length; index += 1) {
    const offset = index * 4
    const alpha = raster.data[offset + 3]! / 255
    const luminance = raster.data[offset]! * 0.2126
      + raster.data[offset + 1]! * 0.7152
      + raster.data[offset + 2]! * 0.0722
    output[index] = Math.round(luminance * alpha + 255 * (1 - alpha))
  }
  return output
}

export function calculateOtsuThreshold(values: Uint8Array): number {
  const histogram = new Uint32Array(256)
  values.forEach((value) => { histogram[value] = histogram[value]! + 1 })
  let totalSum = 0
  for (let value = 0; value < 256; value += 1) totalSum += value * histogram[value]!
  let backgroundWeight = 0
  let backgroundSum = 0
  let bestVariance = -1
  let bestThreshold = 127
  for (let threshold = 0; threshold < 255; threshold += 1) {
    const count = histogram[threshold]!
    backgroundWeight += count
    if (!backgroundWeight) continue
    const foregroundWeight = values.length - backgroundWeight
    if (!foregroundWeight) break
    backgroundSum += threshold * count
    const backgroundMean = backgroundSum / backgroundWeight
    const foregroundMean = (totalSum - backgroundSum) / foregroundWeight
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2
    if (variance > bestVariance) {
      bestVariance = variance
      bestThreshold = threshold
    }
  }
  return bestThreshold
}

function thresholdMask(values: Uint8Array, threshold: number, inverted: boolean): Uint8Array {
  const output = new Uint8Array(values.length)
  for (let index = 0; index < values.length; index += 1) {
    output[index] = (inverted ? values[index]! >= threshold : values[index]! <= threshold) ? 1 : 0
  }
  return output
}

function integralImage(mask: Uint8Array, width: number, height: number): Uint32Array {
  const stride = width + 1
  const integral = new Uint32Array(stride * (height + 1))
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0
    for (let x = 0; x < width; x += 1) {
      rowSum += mask[y * width + x]!
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1]! + rowSum
    }
  }
  return integral
}

function neighborhoodCount(
  integral: Uint32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
): { count: number; area: number } {
  const stride = width + 1
  const left = Math.max(0, x - radius)
  const top = Math.max(0, y - radius)
  const right = Math.min(width - 1, x + radius)
  const bottom = Math.min(height - 1, y + radius)
  const count = integral[(bottom + 1) * stride + right + 1]!
    - integral[top * stride + right + 1]!
    - integral[(bottom + 1) * stride + left]!
    + integral[top * stride + left]!
  return { count, area: (right - left + 1) * (bottom - top + 1) }
}

function morph(mask: Uint8Array, width: number, height: number, radius: number, dilate: boolean): Uint8Array {
  if (radius <= 0) return mask.slice()
  const integral = integralImage(mask, width, height)
  const output = new Uint8Array(mask.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const { count, area } = neighborhoodCount(integral, width, height, x, y, radius)
      output[y * width + x] = dilate ? Number(count > 0) : Number(count === area)
    }
  }
  return output
}

function closeMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  return morph(morph(mask, width, height, radius, true), width, height, radius, false)
}

function findInteriorMask(foreground: Uint8Array, width: number, height: number): Uint8Array {
  const outside = new Uint8Array(foreground.length)
  const queue = new Int32Array(foreground.length)
  let head = 0
  let tail = 0
  const enqueue = (index: number): void => {
    if (!foreground[index] && !outside[index]) {
      outside[index] = 1
      queue[tail++] = index
    }
  }
  for (let x = 0; x < width; x += 1) {
    enqueue(x)
    enqueue((height - 1) * width + x)
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width)
    enqueue(y * width + width - 1)
  }
  while (head < tail) {
    const index = queue[head++]!
    const x = index % width
    const y = Math.floor(index / width)
    if (x > 0) enqueue(index - 1)
    if (x + 1 < width) enqueue(index + 1)
    if (y > 0) enqueue(index - width)
    if (y + 1 < height) enqueue(index + width)
  }
  const interior = new Uint8Array(foreground.length)
  for (let index = 0; index < interior.length; index += 1) {
    interior[index] = Number(!foreground[index] && !outside[index])
  }
  return interior
}

interface Component {
  pixels: number[]
  bounds: PixelBounds
}

function components(mask: Uint8Array, width: number, height: number, minimumArea: number): Component[] {
  const visited = new Uint8Array(mask.length)
  const result: Component[] = []
  const queue: number[] = []
  for (let seed = 0; seed < mask.length; seed += 1) {
    if (!mask[seed] || visited[seed]) continue
    queue.length = 0
    queue.push(seed)
    visited[seed] = 1
    const pixels: number[] = []
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0
    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head]!
      pixels.push(index)
      const x = index % width
      const y = Math.floor(index / width)
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      const neighbors = [x > 0 ? index - 1 : -1, x + 1 < width ? index + 1 : -1, y > 0 ? index - width : -1, y + 1 < height ? index + width : -1]
      for (const neighbor of neighbors) {
        if (neighbor >= 0 && mask[neighbor] && !visited[neighbor]) {
          visited[neighbor] = 1
          queue.push(neighbor)
        }
      }
    }
    if (pixels.length >= minimumArea) {
      result.push({ pixels, bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } })
    }
  }
  return result
}

interface Edge { start: Point; end: Point }

function traceComponent(component: Component, width: number, height: number): Point[] {
  const mask = new Uint8Array(width * height)
  component.pixels.forEach((index) => { mask[index] = 1 })
  const edges: Edge[] = []
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && Boolean(mask[y * width + x])
  component.pixels.forEach((index) => {
    const x = index % width
    const y = Math.floor(index / width)
    if (!inside(x, y - 1)) edges.push({ start: { x, y }, end: { x: x + 1, y } })
    if (!inside(x + 1, y)) edges.push({ start: { x: x + 1, y }, end: { x: x + 1, y: y + 1 } })
    if (!inside(x, y + 1)) edges.push({ start: { x: x + 1, y: y + 1 }, end: { x, y: y + 1 } })
    if (!inside(x - 1, y)) edges.push({ start: { x, y: y + 1 }, end: { x, y } })
  })
  const outgoing = new Map<string, Edge[]>()
  edges.forEach((edge) => {
    const key = `${edge.start.x},${edge.start.y}`
    const list = outgoing.get(key) ?? []
    list.push(edge)
    outgoing.set(key, list)
  })
  const unused = new Set(edges)
  const loops: Point[][] = []
  while (unused.size) {
    const first = unused.values().next().value as Edge
    const loop: Point[] = [first.start]
    let edge: Edge | undefined = first
    while (edge && unused.delete(edge)) {
      loop.push(edge.end)
      if (edge.end.x === first.start.x && edge.end.y === first.start.y) break
      edge = (outgoing.get(`${edge.end.x},${edge.end.y}`) ?? []).find((candidate) => unused.has(candidate))
    }
    if (loop.length >= 4 && loop.at(-1)!.x === loop[0]!.x && loop.at(-1)!.y === loop[0]!.y) {
      loop.pop()
      loops.push(loop)
    }
  }
  const signedArea = (points: Point[]): number => points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]!
    return sum + point.x * next.y - next.x * point.y
  }, 0) / 2
  return loops.sort((left, right) => Math.abs(signedArea(right)) - Math.abs(signedArea(left)))[0] ?? []
}

export function analyzeLineArt(source: ImageRaster, options: ImageImportOptions): ImageImportAnalysis {
  assertRaster(source)
  const raster = rotateRaster(source, options.rotation)
  const values = grayscale(raster)
  const automaticThreshold = calculateOtsuThreshold(values)
  const threshold = Math.max(0, Math.min(255, Math.round(options.threshold)))
  const foregroundMask = thresholdMask(values, threshold, options.inverted)
  const repairRadius = Math.max(0, Math.min(8, Math.round(options.repairRadius)))
  const repairedMask = closeMask(foregroundMask, raster.width, raster.height, repairRadius)
  const interior = findInteriorMask(repairedMask, raster.width, raster.height)
  const minimumArea = Math.max(4, Math.ceil(raster.width * raster.height * 0.0025))
  const repairedPoints: Point[] = []
  for (let index = 0; index < repairedMask.length; index += 1) {
    if (repairedMask[index] && !foregroundMask[index]) repairedPoints.push({ x: index % raster.width, y: Math.floor(index / raster.width) })
  }
  const candidates: ContourCandidate[] = components(interior, raster.width, raster.height, minimumArea)
    .map((component, index) => {
      const bounds = component.bounds
      return {
        id: `contour-${index}-${bounds.x}-${bounds.y}-${bounds.width}-${bounds.height}`,
        points: traceComponent(component, raster.width, raster.height),
        bounds,
        area: component.pixels.length,
        repairedPixels: repairedPoints.filter((point) => point.x >= bounds.x - repairRadius && point.x <= bounds.x + bounds.width + repairRadius && point.y >= bounds.y - repairRadius && point.y <= bounds.y + bounds.height + repairRadius),
      }
    })
    .filter((candidate) => candidate.points.length >= 4)
    .sort((left, right) => right.area - left.area)
  return { raster, foregroundMask, repairedMask, candidates, automaticThreshold }
}

function pointLineDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const denominator = dx * dx + dy * dy
  const t = denominator ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / denominator)) : 0
  return Math.hypot(point.x - start.x - dx * t, point.y - start.y - dy * t)
}

function simplifyOpen(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points.map((point) => ({ ...point }))
  let maximumDistance = 0
  let splitIndex = 0
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = pointLineDistance(points[index]!, points[0]!, points.at(-1)!)
    if (distance > maximumDistance) {
      maximumDistance = distance
      splitIndex = index
    }
  }
  if (maximumDistance <= tolerance) return [{ ...points[0]! }, { ...points.at(-1)! }]
  return [
    ...simplifyOpen(points.slice(0, splitIndex + 1), tolerance).slice(0, -1),
    ...simplifyOpen(points.slice(splitIndex), tolerance),
  ]
}

function simplifyClosed(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 4) return points.map((point) => ({ ...point }))
  let splitIndex = 1
  let maximumDistance = 0
  for (let index = 1; index < points.length; index += 1) {
    const distance = Math.hypot(points[index]!.x - points[0]!.x, points[index]!.y - points[0]!.y)
    if (distance > maximumDistance) {
      maximumDistance = distance
      splitIndex = index
    }
  }
  const firstHalf = simplifyOpen(points.slice(0, splitIndex + 1), tolerance)
  const secondHalf = simplifyOpen([...points.slice(splitIndex), points[0]!], tolerance)
  return [...firstHalf.slice(0, -1), ...secondHalf.slice(0, -1)]
}

function smoothNode(points: readonly Point[], index: number): boolean {
  const previous = points[(index - 1 + points.length) % points.length]!
  const current = points[index]!
  const next = points[(index + 1) % points.length]!
  const first = { x: previous.x - current.x, y: previous.y - current.y }
  const second = { x: next.x - current.x, y: next.y - current.y }
  const denominator = Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y)
  if (!denominator) return false
  const angle = Math.acos(Math.max(-1, Math.min(1, (first.x * second.x + first.y * second.y) / denominator)))
  return angle > Math.PI * 0.78
}

function toBezierNodes(points: readonly Point[]): PathNode[] {
  return points.map((point, index) => {
    if (!smoothNode(points, index)) return { anchor: { ...point } }
    const previous = points[(index - 1 + points.length) % points.length]!
    const next = points[(index + 1) % points.length]!
    const tangent = { x: (next.x - previous.x) / 6, y: (next.y - previous.y) / 6 }
    return {
      anchor: { ...point },
      inControl: { x: point.x - tangent.x, y: point.y - tangent.y },
      outControl: { x: point.x + tangent.x, y: point.y + tangent.y },
    }
  })
}

function normalizeNodes(nodes: PathNode[], widthCm: number, heightCm: number): PathNode[] {
  const path = { id: 'calibration', type: 'path' as const, nodes, closed: true }
  const bounds = getPathBounds(path)
  const scaleX = bounds.width ? widthCm / bounds.width : 1
  const scaleY = bounds.height ? heightCm / bounds.height : 1
  const transform = (point: Point): Point => ({ x: (point.x - bounds.x) * scaleX, y: (point.y - bounds.y) * scaleY })
  return nodes.map((node) => ({
    anchor: transform(node.anchor),
    inControl: node.inControl ? transform(node.inControl) : undefined,
    outControl: node.outControl ? transform(node.outControl) : undefined,
  }))
}

export function calibrateContour(candidate: ContourCandidate, calibration: ContourCalibration): CalibratedContour {
  if (!Number.isFinite(calibration.valueCm) || calibration.valueCm <= 0) throw new Error('请输入有效的实际尺寸')
  if (candidate.bounds.width <= 0 || candidate.bounds.height <= 0) throw new Error('轮廓尺寸无效')
  const aspectRatio = candidate.bounds.width / candidate.bounds.height
  const widthCm = calibration.axis === 'width' ? calibration.valueCm : calibration.valueCm * aspectRatio
  const heightCm = calibration.axis === 'height' ? calibration.valueCm : calibration.valueCm / aspectRatio
  const scaleX = widthCm / candidate.bounds.width
  const scaleY = heightCm / candidate.bounds.height
  const points = candidate.points.map((point) => ({
    x: (point.x - candidate.bounds.x) * scaleX,
    y: (candidate.bounds.y + candidate.bounds.height - point.y) * scaleY,
  }))
  const fittingErrorCm = Math.min(0.05, Math.min(calibration.stitchWidthCm, calibration.rowHeightCm) / 4)
  const maxNodes = calibration.maxNodes ?? 48
  let tolerance = fittingErrorCm
  let simplified = simplifyClosed(points, tolerance)
  while (simplified.length > maxNodes && tolerance < Math.max(widthCm, heightCm)) {
    tolerance *= 1.35
    simplified = simplifyClosed(points, tolerance)
  }
  if (simplified.length < 3) throw new Error('轮廓过于简单，无法生成闭合路径')
  const nodes = normalizeNodes(toBezierNodes(simplified), widthCm, heightCm)
  return {
    widthCm,
    heightCm,
    nodes,
    fittingErrorCm: tolerance,
    isComplex: tolerance > fittingErrorCm * 1.01,
  }
}
