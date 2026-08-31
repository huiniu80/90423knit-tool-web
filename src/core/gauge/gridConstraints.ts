import type { FabricCanvas, GaugeInput } from './gauge.types'

export const GRID_LIMITS = {
  sampleCountMax: 5_000,
  sampleSizeMinCm: 0.1,
  sampleSizeMaxCm: 300,
  fabricSizeMinCm: 1,
  fabricSizeMaxCm: 300,
  columnsMax: 2_000,
  rowsMax: 3_000,
  cellsWarning: 500_000,
  cellsMax: 2_000_000,
  stitchesPerCmWarningMin: 0.5,
  stitchesPerCmWarningMax: 10,
  rowsPerCmWarningMin: 0.5,
  rowsPerCmWarningMax: 15,
} as const

export type GridAssessmentStatus = 'valid' | 'warning' | 'blocked'
export type GridAssessmentIssueCode =
  | 'non_integer_count'
  | 'field_out_of_range'
  | 'density_unusual'
  | 'columns_exceeded'
  | 'rows_exceeded'
  | 'cells_exceeded'
  | 'cells_warning'

export interface GridAssessmentIssue {
  code: GridAssessmentIssueCode
  severity: 'warning' | 'error'
  message: string
  field?: keyof GaugeInput | keyof FabricCanvas
}

export interface GridAssessment {
  status: GridAssessmentStatus
  columnCount: number
  rowCount: number
  cellCount: number
  stitchesPerCm: number
  rowsPerCm: number
  issues: GridAssessmentIssue[]
}

function formatInteger(value: number): string {
  return Number.isFinite(value) ? Math.round(value).toLocaleString('zh-CN') : '无效'
}

function fieldRangeIssue(
  field: keyof GaugeInput | keyof FabricCanvas,
  label: string,
  value: number,
  minimum: number,
  maximum: number,
): GridAssessmentIssue | null {
  if (Number.isFinite(value) && value >= minimum && value <= maximum) return null
  return {
    code: 'field_out_of_range',
    severity: 'error',
    field,
    message: `${label}必须在 ${minimum}～${maximum} 之间。`,
  }
}

/** 在任何响应式状态变更和栅格分配发生前评估候选编织网格。 */
export function assessGrid(gaugeInput: GaugeInput, fabric: FabricCanvas): GridAssessment {
  const issues: GridAssessmentIssue[] = []
  const countFields = [
    ['sampleStitches', '小样针数', gaugeInput.sampleStitches],
    ['sampleRows', '小样行数', gaugeInput.sampleRows],
  ] as const

  for (const [field, label, value] of countFields) {
    const rangeIssue = fieldRangeIssue(field, label, value, 1, GRID_LIMITS.sampleCountMax)
    if (rangeIssue) issues.push(rangeIssue)
    else if (!Number.isInteger(value)) {
      issues.push({
        code: 'non_integer_count',
        severity: 'error',
        field,
        message: `${label}必须是整数。`,
      })
    }
  }

  const dimensionFields = [
    ['sampleWidthCm', '小样宽度', gaugeInput.sampleWidthCm, GRID_LIMITS.sampleSizeMinCm, GRID_LIMITS.sampleSizeMaxCm],
    ['sampleHeightCm', '小样高度', gaugeInput.sampleHeightCm, GRID_LIMITS.sampleSizeMinCm, GRID_LIMITS.sampleSizeMaxCm],
    ['widthCm', '画布宽度', fabric.widthCm, GRID_LIMITS.fabricSizeMinCm, GRID_LIMITS.fabricSizeMaxCm],
    ['heightCm', '画布高度', fabric.heightCm, GRID_LIMITS.fabricSizeMinCm, GRID_LIMITS.fabricSizeMaxCm],
  ] as const
  for (const [field, label, value, minimum, maximum] of dimensionFields) {
    const issue = fieldRangeIssue(field, label, value, minimum, maximum)
    if (issue) issues.push(issue)
  }

  const stitchesPerCm = gaugeInput.sampleStitches / gaugeInput.sampleWidthCm
  const rowsPerCm = gaugeInput.sampleRows / gaugeInput.sampleHeightCm
  const columnCount = Math.round(fabric.widthCm * stitchesPerCm)
  const rowCount = Math.round(fabric.heightCm * rowsPerCm)
  const cellCount = columnCount * rowCount

  if (!issues.some((issue) => issue.severity === 'error')) {
    if (columnCount > GRID_LIMITS.columnsMax) {
      issues.push({
        code: 'columns_exceeded', severity: 'error',
        message: `当前设置会生成 ${formatInteger(columnCount)} 针，超过 ${formatInteger(GRID_LIMITS.columnsMax)} 针上限。请减小画布宽度或降低横向密度。`,
      })
    }
    if (rowCount > GRID_LIMITS.rowsMax) {
      issues.push({
        code: 'rows_exceeded', severity: 'error',
        message: `当前设置会生成 ${formatInteger(rowCount)} 行，超过 ${formatInteger(GRID_LIMITS.rowsMax)} 行上限。请减小画布高度或降低纵向密度。`,
      })
    }
    if (cellCount > GRID_LIMITS.cellsMax) {
      issues.push({
        code: 'cells_exceeded', severity: 'error',
        message: `当前网格为 ${formatInteger(columnCount)} 针 × ${formatInteger(rowCount)} 行，共 ${formatInteger(cellCount)} 个针格，超过 ${formatInteger(GRID_LIMITS.cellsMax)} 针格上限。`,
      })
    }

    if (stitchesPerCm < GRID_LIMITS.stitchesPerCmWarningMin || stitchesPerCm > GRID_LIMITS.stitchesPerCmWarningMax) {
      issues.push({
        code: 'density_unusual', severity: 'warning',
        message: `横向密度为 ${stitchesPerCm.toFixed(2)} 针/cm，明显偏离常见范围，请确认小样数据。`,
      })
    }
    if (rowsPerCm < GRID_LIMITS.rowsPerCmWarningMin || rowsPerCm > GRID_LIMITS.rowsPerCmWarningMax) {
      issues.push({
        code: 'density_unusual', severity: 'warning',
        message: `纵向密度为 ${rowsPerCm.toFixed(2)} 行/cm，明显偏离常见范围，请确认小样数据。`,
      })
    }
    if (cellCount > GRID_LIMITS.cellsWarning && cellCount <= GRID_LIMITS.cellsMax) {
      issues.push({
        code: 'cells_warning', severity: 'warning',
        message: `当前图解约包含 ${formatInteger(cellCount)} 个针格，复杂曲线编辑和图解生成可能变慢。`,
      })
    }
  }

  const status: GridAssessmentStatus = issues.some((issue) => issue.severity === 'error')
    ? 'blocked'
    : issues.some((issue) => issue.severity === 'warning') ? 'warning' : 'valid'
  return { status, columnCount, rowCount, cellCount, stitchesPerCm, rowsPerCm, issues }
}
