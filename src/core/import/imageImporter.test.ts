import { describe, expect, it } from 'vitest'
import { getPathBounds } from '../geometry/path'
import type { ImageRaster } from './imageImport.types'
import {
  analyzeLineArt,
  calculateOtsuThreshold,
  calibrateContour,
  cropRasterToContent,
  rotateRaster,
} from './imageImporter'

function raster(width: number, height: number, background = 255): ImageRaster {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4
    data[offset] = background
    data[offset + 1] = background
    data[offset + 2] = background
    data[offset + 3] = 255
  }
  return { width, height, data }
}

function pixel(image: ImageRaster, x: number, y: number, value: number, alpha = 255): void {
  const offset = (y * image.width + x) * 4
  image.data[offset] = value
  image.data[offset + 1] = value
  image.data[offset + 2] = value
  image.data[offset + 3] = alpha
}

function rectangle(image: ImageRaster, left: number, top: number, right: number, bottom: number, value = 0): void {
  for (let x = left; x <= right; x += 1) {
    pixel(image, x, top, value)
    pixel(image, x, bottom, value)
  }
  for (let y = top; y <= bottom; y += 1) {
    pixel(image, left, y, value)
    pixel(image, right, y, value)
  }
}

const options = { threshold: 127, inverted: false, repairRadius: 0, rotation: 0 as const }

describe('线稿图片分析', () => {
  it('从白底黑线中提取封闭轮廓并过滤小噪点', () => {
    const image = raster(40, 30)
    rectangle(image, 5, 4, 34, 25)
    pixel(image, 1, 1, 0)
    const analysis = analyzeLineArt(image, options)
    expect(analysis.candidates).toHaveLength(1)
    expect(analysis.candidates[0]!.bounds).toEqual({ x: 6, y: 5, width: 28, height: 20 })
  })

  it('支持黑底白线与反转阈值', () => {
    const image = raster(30, 30, 0)
    rectangle(image, 4, 4, 25, 25, 255)
    const analysis = analyzeLineArt(image, { ...options, inverted: true })
    expect(analysis.candidates).toHaveLength(1)
  })

  it('透明背景按白色处理', () => {
    const image = raster(30, 30)
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) pixel(image, x, y, 0, 0)
    }
    rectangle(image, 5, 5, 24, 24)
    expect(analyzeLineArt(image, options).candidates).toHaveLength(1)
  })

  it('保留多个足够大的候选并按面积排序', () => {
    const image = raster(80, 50)
    rectangle(image, 3, 3, 35, 45)
    rectangle(image, 48, 10, 73, 39)
    const candidates = analyzeLineArt(image, options).candidates
    expect(candidates).toHaveLength(2)
    expect(candidates[0]!.area).toBeGreaterThan(candidates[1]!.area)
  })

  it('修补小断口并记录新增像素', () => {
    const image = raster(50, 40)
    rectangle(image, 7, 6, 42, 33)
    pixel(image, 24, 6, 255)
    pixel(image, 25, 6, 255)
    expect(analyzeLineArt(image, options).candidates).toHaveLength(0)
    const repaired = analyzeLineArt(image, { ...options, repairRadius: 2 })
    expect(repaired.candidates).toHaveLength(1)
    expect(repaired.candidates[0]!.repairedPixels.length).toBeGreaterThan(0)
  })

  it('抗锯齿灰线可通过阈值识别', () => {
    const image = raster(40, 40)
    rectangle(image, 5, 5, 34, 34, 80)
    expect(analyzeLineArt(image, { ...options, threshold: 120 }).candidates).toHaveLength(1)
  })

  it('无法闭合的线稿不产生候选', () => {
    const image = raster(40, 40)
    for (let x = 5; x < 35; x += 1) pixel(image, x, 20, 0)
    expect(analyzeLineArt(image, options).candidates).toHaveLength(0)
  })

  it('计算自动阈值并正确旋转像素', () => {
    expect(calculateOtsuThreshold(new Uint8Array([0, 0, 255, 255]))).toBe(0)
    const image = raster(2, 3)
    pixel(image, 0, 0, 10)
    const rotated = rotateRaster(image, 90)
    expect([rotated.width, rotated.height]).toEqual([3, 2])
    expect(rotated.data[(0 * rotated.width + 2) * 4]).toBe(10)
  })

  it('按角落背景自动裁去空白并保留边距', () => {
    const image = raster(60, 50)
    rectangle(image, 20, 15, 39, 34)
    const cropped = cropRasterToContent(image, 2)
    expect([cropped.width, cropped.height]).toEqual([24, 24])
  })
})

describe('轮廓尺寸校准', () => {
  it('按宽度保持比例、翻转 Y 轴并生成闭合路径节点', () => {
    const candidate = {
      id: 'test',
      points: [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 20 }, { x: 10, y: 20 }],
      bounds: { x: 10, y: 10, width: 20, height: 10 },
      area: 200,
      repairedPixels: [],
    }
    const calibrated = calibrateContour(candidate, {
      axis: 'width',
      valueCm: 40,
      stitchWidthCm: 0.5,
      rowHeightCm: 0.4,
    })
    expect(calibrated.widthCm).toBe(40)
    expect(calibrated.heightCm).toBe(20)
    expect(calibrated.nodes).toHaveLength(4)
    const bounds = getPathBounds({ id: 'test', type: 'path', closed: true, nodes: calibrated.nodes })
    expect(bounds).toEqual({ x: 0, y: 0, width: 40, height: 20 })
    expect(calibrated.nodes[0]!.anchor.y).toBeGreaterThan(calibrated.nodes[2]!.anchor.y)
  })

  it('限制复杂轮廓的节点数量', () => {
    const points = Array.from({ length: 200 }, (_, index) => {
      const angle = index / 200 * Math.PI * 2
      return { x: 100 + Math.cos(angle) * (50 + (index % 2) * 4), y: 100 + Math.sin(angle) * (50 + (index % 2) * 4) }
    })
    const result = calibrateContour({
      id: 'complex', points, bounds: { x: 46, y: 46, width: 108, height: 108 }, area: 9000, repairedPixels: [],
    }, { axis: 'height', valueCm: 30, stitchWidthCm: 0.4, rowHeightCm: 0.3, maxNodes: 48 })
    expect(result.nodes.length).toBeLessThanOrEqual(48)
    expect(result.isComplex).toBe(true)
  })
})
