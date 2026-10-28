import type { Gauge } from '../gauge/gauge.types'
import type { ShapePlan } from '../../stores/editor.types'
import type { StitchDefinition, StitchMark } from './types'
import { occupied } from './drawing'

/** Defaults are derived from valid, aligned pieces, never from the drawn pattern. */
export function drawingBaseMarks(plans: ShapePlan[], gauge: Gauge): StitchMark[] {
  const owners = new Map<string, StitchMark | null>()
  for (const plan of plans.filter(p => p.isFabric && p.canExport)) {
    if (plan.rasterRows.some(row => {
      const offset = (row.originXCm ?? 0) / gauge.stitchWidthCm
      return row.stitchCount > 0 && Math.abs(offset - Math.round(offset)) > 1e-6
    })) continue
    for (const row of plan.rasterRows) {
      const offset = Math.round((row.originXCm ?? 0) / gauge.stitchWidthCm)
      for (const segment of row.segments) {
        for (let x = segment.startStitch; x <= segment.endStitch; x++) {
          const column = x + offset, key = `${column},${row.rowIndex}`
          owners.set(key, owners.has(key) ? null : {
            id: `default-${plan.shapeId}-${key}`, x: column, y: row.rowIndex, stitchId: 'knit',
          })
        }
      }
    }
  }
  return [...owners.values()].filter((mark): mark is StitchMark => mark !== null)
}

/** Explicit operations cover their entire span; uncovered piece cells remain knit. */
export function completeDrawingMarks(base: StitchMark[], explicit: StitchMark[], definitions: Map<string, StitchDefinition>): StitchMark[] {
  const covered = occupied(explicit, definitions)
  return [...base.filter(m => !covered.has(`${m.x},${m.y}`)), ...explicit]
}
