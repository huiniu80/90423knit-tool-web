import type {
  FabricCanvas,
  FabricGrid,
  Gauge,
  GaugeInput,
} from './gauge.types'

function assertPositiveFinite(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${fieldName} must be a positive finite number`)
  }
}

/**
 * 根据真实小样尺寸计算单针、单行尺寸及每厘米密度。
 * 该函数只处理 cm 和 stitch/row，不感知任何显示像素。
 */
export function calculateGauge(input: GaugeInput): Gauge {
  assertPositiveFinite(input.sampleStitches, 'sampleStitches')
  assertPositiveFinite(input.sampleRows, 'sampleRows')
  assertPositiveFinite(input.sampleWidthCm, 'sampleWidthCm')
  assertPositiveFinite(input.sampleHeightCm, 'sampleHeightCm')

  return {
    stitchWidthCm: input.sampleWidthCm / input.sampleStitches,
    rowHeightCm: input.sampleHeightCm / input.sampleRows,
    stitchesPerCm: input.sampleStitches / input.sampleWidthCm,
    rowsPerCm: input.sampleRows / input.sampleHeightCm,
  }
}

/** 将真实画布尺寸换算为最接近的整数针数与行数。 */
export function calculateFabricGrid(
  canvas: FabricCanvas,
  gauge: Gauge,
): FabricGrid {
  assertPositiveFinite(canvas.widthCm, 'widthCm')
  assertPositiveFinite(canvas.heightCm, 'heightCm')
  assertPositiveFinite(gauge.stitchWidthCm, 'stitchWidthCm')
  assertPositiveFinite(gauge.rowHeightCm, 'rowHeightCm')

  return {
    columnCount: Math.round(canvas.widthCm / gauge.stitchWidthCm),
    rowCount: Math.round(canvas.heightCm / gauge.rowHeightCm),
  }
}
