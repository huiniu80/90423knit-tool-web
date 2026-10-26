import type { DrawingCalculation } from '../core/drawing/calculation'
import type { DrawingDocument, StitchDefinition, StitchMark } from '../core/drawing/types'
import type { Shape } from '../core/geometry/shape.types'
import type { Gauge } from '../core/gauge/gauge.types'
import { drawStitch, stitchMap, stitchReading } from '../core/drawing/stitches'
import { flattenPath } from '../core/geometry/path'

export interface DrawingExport { name: string; drawing: DrawingDocument; calculation: DrawingCalculation; shapes: Shape[]; gauge: Gauge }
const font = (ctx: CanvasRenderingContext2D, size: number, bold = false) => { ctx.font = `${bold ? 'bold ' : ''}${size}px "Microsoft YaHei", "PingFang SC", sans-serif`; ctx.fillStyle = '#222'; ctx.textBaseline = 'top' }
function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, size: number, maxLines = Infinity) {
  font(ctx, size); let line = '', lines = 0
  for (const char of text) { if (ctx.measureText(line + char).width > width && line) { ctx.fillText(line, x, y + lines++ * (size + 5)); line = ''; if (lines >= maxLines) return lines * (size + 5) } line += char }
  if (line) ctx.fillText(line, x, y + lines++ * (size + 5)); return lines * (size + 5)
}
export function usedDefinitions(data: DrawingExport): StitchDefinition[] {
  const defs = stitchMap(data.drawing.definitions)
  return [...new Set(data.calculation.marks.map(m => m.stitchId))].map(id => defs.get(id)!)
}
function bounds(marks: StitchMark[], defs: Map<string, StitchDefinition>) {
  const minX = marks.reduce((n, m) => Math.min(n, m.x), Infinity), minY = marks.reduce((n, m) => Math.min(n, m.y), Infinity)
  const maxX = marks.reduce((n, m) => Math.max(n, m.x + defs.get(m.stitchId)!.span), 0), maxY = marks.reduce((n, m) => Math.max(n, m.y + 1), 0)
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}
function drawChart(ctx: CanvasRenderingContext2D, data: DrawingExport, region: { x: number; y: number; width: number; height: number }, x: number, y: number, size: number) {
  const defs = stitchMap(data.drawing.definitions)
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, region.width * size, region.height * size); ctx.clip()
  for (const m of data.calculation.marks) if (m.y >= region.y && m.y < region.y + region.height && m.x + defs.get(m.stitchId)!.span > region.x && m.x < region.x + region.width) drawStitch(ctx, defs.get(m.stitchId)!, x + (m.x - region.x) * size, y + (region.y + region.height - m.y - 1) * size, defs.get(m.stitchId)!.span * size, size)
  ctx.strokeStyle = '#aaa398'; ctx.lineWidth = 1; ctx.beginPath()
  for (let i = 0; i <= region.width; i++) { ctx.moveTo(x + i * size, y); ctx.lineTo(x + i * size, y + region.height * size) }
  for (let i = 0; i <= region.height; i++) { ctx.moveTo(x, y + i * size); ctx.lineTo(x + region.width * size, y + i * size) } ctx.stroke()
  ctx.strokeStyle = '#3b6655'; ctx.lineWidth = 2
  for (const shape of data.shapes) {
    let points = shape.type === 'path' ? flattenPath(shape) : shape.type === 'polygon' || shape.type === 'triangle' ? shape.points : null
    if (shape.type === 'rectangle') points = [{ x: shape.x, y: shape.y }, { x: shape.x + shape.widthCm, y: shape.y }, { x: shape.x + shape.widthCm, y: shape.y + shape.heightCm }, { x: shape.x, y: shape.y + shape.heightCm }]
    if (shape.type === 'circle' || shape.type === 'ellipse') points = Array.from({ length: 121 }, (_, i) => ({ x: shape.center.x + (shape.type === 'circle' ? shape.radiusCm : shape.radiusXcm) * Math.cos(i * Math.PI / 60), y: shape.center.y + (shape.type === 'circle' ? shape.radiusCm : shape.radiusYcm) * Math.sin(i * Math.PI / 60) }))
    if (!points) continue
    ctx.beginPath(); points.forEach((p, i) => { const px = x + (p.x / data.gauge.stitchWidthCm - region.x) * size, py = y + (region.y + region.height - p.y / data.gauge.rowHeightCm) * size; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py) }); ctx.closePath(); ctx.stroke()
  }
  ctx.restore(); font(ctx, Math.max(12, Math.min(20, size * 0.6)))
  for (let i = 0; i < region.width; i++) ctx.fillText(String(region.x + i + 1), x + i * size + 2, y + region.height * size + 6)
  for (let i = 0; i < region.height; i++) ctx.fillText(String(region.y + region.height - i), x - 42, y + i * size + 4)
}
function textHeight(ctx: CanvasRenderingContext2D, text: string, width: number, size: number): number {
  font(ctx, size); let line = '', count = 1
  for (const char of text) { if (ctx.measureText(line + char).width > width && line) { count++; line = '' } line += char }
  return count * (size + 5)
}
function legendItemHeight(ctx: CanvasRenderingContext2D, d: StitchDefinition, width: number): number {
  return Math.max(48, textHeight(ctx, d.name, width - 68, 18)) + 24 + Math.max(textHeight(ctx, stitchReading(d, 'appearance'), width - 68, 14), textHeight(ctx, stitchReading(d, 'operation'), width - 68, 14)) + 14
}
function legendChunks(ctx: CanvasRenderingContext2D, defs: StitchDefinition[], width: number, height: number): StitchDefinition[][] {
  const chunks: StitchDefinition[][] = []; let current: StitchDefinition[] = [], usedHeight = 0
  for (const d of defs) { const item = legendItemHeight(ctx, d, width); if (current.length && usedHeight + item > height) { chunks.push(current); current = []; usedHeight = 0 } current.push(d); usedHeight += item }
  if (current.length) chunks.push(current); return chunks
}
function legend(ctx: CanvasRenderingContext2D, defs: StitchDefinition[], x: number, y: number, width: number, convention: DrawingDocument['convention']) {
  font(ctx, 22, true); ctx.fillText('针法符号 · 中文图例', x, y)
  let top = y + 40
  defs.forEach(d => {
    drawStitch(ctx, d, x, top, 48, 48)
    ctx.strokeStyle = '#b9b1a5'; ctx.strokeRect(x, top, 48, 48)
    const nameHeight = wrap(ctx, d.name, x + 62, top, width - 68, 18)
    font(ctx, 14); ctx.fillText(`消耗${d.input}→生成${d.output}针 · 占${d.span}格`, x + 62, top + Math.max(48, nameHeight))
    wrap(ctx, stitchReading(d, convention), x + 62, top + Math.max(48, nameHeight) + 24, width - 68, 14)
    top += legendItemHeight(ctx, d, width)
  })
}
function heading(ctx: CanvasRenderingContext2D, data: DrawingExport, caption: string) {
  font(ctx, 28, true); ctx.fillText(data.name.slice(0, 50), 52, 28)
  font(ctx, 18); ctx.fillText(caption, 52, 70)
  wrap(ctx, data.drawing.convention === 'appearance' ? '图符表示织物正面外观。片织：奇数行从右往左，偶数行从左往右；反面行上下针反读。方向性动作结合针法说明。' : '图符表示每行实际执行的针法。片织：奇数行从右往左，偶数行从左往右。', 52, 104, ctx.canvas.width - 104, 17)
}
export async function drawingPng(data: DrawingExport): Promise<Blob> {
  if (data.calculation.issues.length) throw Error(data.calculation.issues[0])
  const defs = stitchMap(data.drawing.definitions), used = usedDefinitions(data), region = bounds(data.calculation.marks, defs)
  const cell = Math.min(40, Math.max(16, Math.floor(6000 / Math.max(region.width, region.height))))
  const c = document.createElement('canvas'); const measure = c.getContext('2d')!
  const columns = legendChunks(measure, used, 340, 3520)
  c.width = Math.max(800, 140 + region.width * cell + columns.length * 360); c.height = Math.max(300 + region.height * cell, 220 + Math.max(...columns.map(col => col.reduce((sum, d) => sum + legendItemHeight(measure, d, 340), 0))))
  if (c.width > 8192 || c.height > 8192 || c.width * c.height > 32_000_000) throw Error('图解较大，请使用分页 PDF 导出，保留可读的图符和中文图例。')
  const ctx = c.getContext('2d')!; ctx.fillStyle = '#fffdf8'; ctx.fillRect(0, 0, c.width, c.height)
  heading(ctx, data, `绘图图解（针行标号为画布坐标） · ${region.width} 针格 × ${region.height} 行 · 格尺寸 ${(region.width * data.gauge.stitchWidthCm).toFixed(1)} × ${(region.height * data.gauge.rowHeightCm).toFixed(1)} cm`)
  drawChart(ctx, data, region, 58, 210, cell)
  for (let col = 0; col < columns.length; col++) legend(ctx, columns[col], 100 + region.width * cell + col * 360, 180, 340, data.drawing.convention)
  return new Promise((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(Error('图片生成失败')), 'image/png'))
}
export async function drawingPdf(data: DrawingExport): Promise<Uint8Array> {
  if (data.calculation.issues.length) throw Error(data.calculation.issues[0])
  const { PDFDocument } = await import('pdf-lib'); const pdf = await PDFDocument.create()
  const defs = stitchMap(data.drawing.definitions), used = usedDefinitions(data), region = bounds(data.calculation.marks, defs)
  const chartColumns = 26, chartRows = 32
  const pages = Math.ceil(region.width / chartColumns) * Math.ceil(region.height / chartRows)
  if (pages > 1000) throw Error('图解分页超过 1000 页，请缩小导出设计范围。')
  async function page(render: (ctx: CanvasRenderingContext2D) => void) {
    const c = document.createElement('canvas'); c.width = 1240; c.height = 1754
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#fffdf8'; ctx.fillRect(0, 0, c.width, c.height); render(ctx)
    const blob = await new Promise<Blob>((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(Error('PDF 页面生成失败')), 'image/png'))
    const img = await pdf.embedPng(await blob.arrayBuffer()); const p = pdf.addPage([595.28, 841.89]); p.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 })
    c.width = 1; c.height = 1
  }
  let number = 0
  for (let y = 0; y < region.height; y += chartRows) for (let x = 0; x < region.width; x += chartColumns) {
    const tile = { x: region.x + x, y: region.y + y, width: Math.min(chartColumns, region.width - x), height: Math.min(chartRows, region.height - y) }
    const localDefs = [...new Set(data.calculation.marks.filter(m => m.y >= tile.y && m.y < tile.y + tile.height && m.x + defs.get(m.stitchId)!.span > tile.x && m.x < tile.x + tile.width).map(m => m.stitchId))].map(id => defs.get(id)!)
    const current = ++number
    await page(ctx => { heading(ctx, data, `绘图 ${current}/${pages} · 画布第 ${tile.x + 1}–${tile.x + tile.width} 针格 · 第 ${tile.y + 1}–${tile.y + tile.height} 行`); drawChart(ctx, data, tile, 58, 220, 30); const local = legendChunks(ctx, localDefs, 298, 1300)[0] ?? []; legend(ctx, local, 890, 240, 298, data.drawing.convention); if (local.length < localDefs.length) wrap(ctx, '其余针法见后附完整中文图例。', 890, 1580, 298, 16); wrap(ctx, '跨页的跨针图符须连同相邻页面查看。', 58, 1620, 780, 16); font(ctx, 16); ctx.fillText('完整针法图例与针数核对见后续页面。', 58, 1660) })
  }
  const measureCanvas = document.createElement('canvas'), measureContext = measureCanvas.getContext('2d')!
  const chunks = legendChunks(measureContext, used, 530, 1460)
  for (let i = 0; i < chunks.length; i += 2) await page(ctx => { heading(ctx, data, '完整中文针法图例'); legend(ctx, chunks[i], 60, 200, 530, data.drawing.convention); if (chunks[i + 1]) legend(ctx, chunks[i + 1], 660, 200, 530, data.drawing.convention) })
  for (const piece of data.calculation.pieces) for (let i = 0; i < piece.rows.length; i += 20) await page(ctx => {
    heading(ctx, data, `${piece.name} · 针数核对`); font(ctx, 19, true); ctx.fillText('行 / 图解格 / 消耗→产出 / 内部增减 / 边缘增减（首行为起针）', 58, 200)
    piece.rows.slice(i, i + 20).forEach((r, n) => { const y = 250 + n * 68; font(ctx, 18); ctx.fillText(`${r.row}（画布${r.canvasRow}） / ${r.cells} / ${r.input}→${r.output} / ${r.internalDelta} / ${r.edgeDelta}`, 58, y); wrap(ctx, r.actions.join('；') || '下针', 58, y + 24, 1100, 15, 1) })
    wrap(ctx, '按图中完整针法执行内部操作，边缘只处理衔接所需的剩余增减，不重复使用旧平针方案。图解格尺寸按输入密度换算；实际花样密度请以编织小样核对。', 58, 1660, 1100, 15)
  })
  return pdf.save()
}
export function downloadDrawing(blob: Blob, name: string, extension: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a')
  a.href = url; a.download = `${name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-') || '绘图图解'}.${extension}`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
