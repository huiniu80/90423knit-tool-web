/** 用户测量的编织小样数据。 */
export interface GaugeInput {
  sampleStitches: number
  sampleRows: number
  sampleWidthCm: number
  sampleHeightCm: number
}

/** 由小样数据推导出的编织密度。 */
export interface Gauge {
  stitchWidthCm: number
  rowHeightCm: number
  stitchesPerCm: number
  rowsPerCm: number
}

/** 以真实厘米为单位的面料画布。 */
export interface FabricCanvas {
  widthCm: number
  heightCm: number
}

/** 真实画布按当前密度换算后的针格数。 */
export interface FabricGrid {
  columnCount: number
  rowCount: number
}
