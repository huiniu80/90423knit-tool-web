import { getShapeBounds } from '../core/geometry/geometry'
import type { Bounds, Shape } from '../core/geometry/shape.types'
import type { FabricCanvas } from '../core/gauge/gauge.types'

const thumbnailAspectRatio = 134 / 98
const contentPaddingRatio = 0.12
const minimumContentRatio = 0.04

function unionBounds(shapes: readonly Shape[]): Bounds | null {
  if (!shapes.length) return null

  const bounds = shapes.map(getShapeBounds)
  const minX = Math.min(...bounds.map((item) => item.x))
  const minY = Math.min(...bounds.map((item) => item.y))
  const maxX = Math.max(...bounds.map((item) => item.x + item.width))
  const maxY = Math.max(...bounds.map((item) => item.y + item.height))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * 让方案库缩略图围绕全部图形自动取景。返回值使用 SVG 左上角原点坐标，
 * 但允许安全留白超出实际画布，避免位于画布边缘的描边被裁切。
 */
export function getProjectThumbnailViewBox(
  shapes: readonly Shape[],
  fabric: FabricCanvas,
): string {
  const content = unionBounds(shapes)
  if (!content) return `0 0 ${fabric.widthCm} ${fabric.heightCm}`

  const minimumWidth = fabric.widthCm * minimumContentRatio
  const minimumHeight = fabric.heightCm * minimumContentRatio
  let width = Math.max(content.width, minimumWidth)
  let height = Math.max(content.height, minimumHeight)
  const centerX = content.x + content.width / 2
  const centerY = content.y + content.height / 2
  const padding = Math.max(width, height) * contentPaddingRatio
  width += padding * 2
  height += padding * 2

  if (width / height < thumbnailAspectRatio) {
    width = height * thumbnailAspectRatio
  } else {
    height = width / thumbnailAspectRatio
  }

  const x = centerX - width / 2
  const modelY = centerY - height / 2
  const svgY = fabric.heightCm - modelY - height
  return `${x} ${svgY} ${width} ${height}`
}
