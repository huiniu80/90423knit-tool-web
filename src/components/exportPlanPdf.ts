import { PDFDocument } from 'pdf-lib'
import type { CalculationSnapshot, SnapshotPiece } from '../core/knitting/calculationSnapshot'
import { rowOperationToText } from '../core/knitting/rowOperations'

/** A4 pages rendered at 144 dpi; fixed needle/row ranges make each grid independently countable. */
export async function exportPlanPdf(name: string, snapshot: CalculationSnapshot): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${name} - 编织图解`)
  pdf.setSubject(`计算规则 ${snapshot.ruleVersion}`)
  const canvas = document.createElement('canvas')
  canvas.width = 1190; canvas.height = 1684
  const maybeContext = canvas.getContext('2d')
  if (!maybeContext) throw Error('无法创建打印画布')
  const context: CanvasRenderingContext2D = maybeContext
  context.scale(2, 2)
  let pageNumber = 0
  let y = 0
  let continuedHeader = ''
  const beginPage = (title: string): void => {
    context.fillStyle = '#fff'; context.fillRect(0, 0, 595, 842)
    context.fillStyle = '#263d36'; context.font = 'bold 18px sans-serif'; context.fillText(title, 36, 45, 520)
    context.fillStyle = '#666'; context.font = '10px sans-serif'
    context.fillText(`${name} · 规则 ${snapshot.ruleVersion}`, 36, 66, 520)
    y = 96
    if (continuedHeader) {
      context.fillStyle = '#263d36'; context.font = 'bold 12px sans-serif'
      context.fillText(continuedHeader, 36, y); y += 28
    }
  }
  const finishPage = async (): Promise<void> => {
    pageNumber++
    context.fillStyle = '#666'; context.font = '10px sans-serif'
    context.fillText(`第 ${pageNumber} 页 · 针号按当前画布格编号 · 非实物 1:1 打印`, 36, 812)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw Error('打印页面生成失败')
    const png = await pdf.embedPng(await blob.arrayBuffer())
    pdf.addPage([595.28, 841.89]).drawImage(png, { x: 0, y: 0, width: 595.28, height: 841.89 })
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
  const lines = (text: string, size = 12): string[] => {
    context.font = `${size}px sans-serif`
    const result: string[] = []; let current = ''
    for (const char of text) {
      if (context.measureText(current + char).width > 520 && current) { result.push(current); current = '' }
      current += char
    }
    if (current) result.push(current)
    return result
  }
  const write = async (text: string, title = '编织说明', bold = false): Promise<void> => {
    for (const line of lines(text)) {
      if (y > 770) { await finishPage(); beginPage(title) }
      context.fillStyle = '#263d36'; context.font = `${bold ? 'bold ' : ''}12px sans-serif`
      context.fillText(line, 36, y); y += 19
    }
    y += 5
  }
  beginPage('编织图解与逐行操作')
  await write(`生成于 ${snapshot.calculatedAt.slice(0, 19).replace('T', ' ')} UTC`)
  await write(`密度：${snapshot.gauge.stitchesPerCm.toFixed(4)} 针/cm，${snapshot.gauge.rowsPerCm.toFixed(4)} 行/cm`)
  await write(`单针 ${snapshot.gauge.stitchWidthCm.toFixed(4)} cm · 单行 ${snapshot.gauge.rowHeightCm.toFixed(4)} cm`)
  await write('所有行前操作先同时完成，再编织对应行；结束平收不增加行数。')
  for (const warning of snapshot.warnings) await write(`提示：${warning}`)
  await write('当前输出为通用主体平针数量计划，未验证特定机器动作；请核对实际制作。')
  for (const piece of snapshot.pieces) if (piece.status) await write(`已排除 ${piece.name}：${piece.status}`)
  await finishPage()
  for (const piece of snapshot.pieces.filter(piece => !piece.status)) {
    beginPage(`${piece.name} · 尺寸与状态`)
    await write(`成衣外观：宽 ${piece.appearance.width.toFixed(2)} cm × 高 ${piece.appearance.height.toFixed(2)} cm`)
    await write(`取整计算尺寸：宽 ${piece.rounded.width.toFixed(2)} cm × 高 ${piece.rounded.height.toFixed(2)} cm`)
    await write(`整体目标 ${piece.stitches} 针 × ${piece.rows} 行；实际编织 ${piece.instructions.length} 行`)
    await write(`宽误差 ${(piece.rounded.width - piece.appearance.width).toFixed(2)} cm · 高误差 ${(piece.rounded.height - piece.appearance.height).toFixed(2)} cm`)
    await write('缝合补偿尚未加入，含缝合消耗的最终织片尺寸尚不可提供。')
    await finishPage()
    await writeGrid(piece)
    continuedHeader = '行号 / 本行针数与针位 / 从左到右的行前操作'
    beginPage(`${piece.name} · 逐行操作表`)
    for (const instruction of piece.instructions) {
      const title = `${piece.name} · 逐行操作表（续）`
      const needles = instruction.segments.map(s => `${s.startStitch + 1}-${s.endStitch + 1}`).join('、')
      const operations = instruction.operations?.map(rowOperationToText).join('；') || '不加不减'
      await write(`第 ${instruction.rowNumber} 行 · ${instruction.stitchCount} 针 [${needles}]：${operations}`, title)
      if (instruction.transition === 'split' || instruction.transition === 'cast-on-separated') await write('之后左右两段分别继续编织。', title)
      if (instruction.transition === 'join') await write('中间加针后连接左右两段。', title)
      if (instruction.finishOperations?.length) {
        await write(`织完第 ${instruction.rowNumber} 行后结束：`, title, true)
        for (const operation of instruction.finishOperations) await write(rowOperationToText(operation), title)
      }
    }
    await finishPage()
    continuedHeader = ''
  }
  return pdf.save()

  async function writeGrid(piece: SnapshotPiece): Promise<void> {
    const allSegments = piece.rasterRows.flatMap(row => row.segments)
    const firstNeedle = allSegments.reduce((min, s) => Math.min(min, s.startStitch), Infinity)
    const lastNeedle = allSegments.reduce((max, s) => Math.max(max, s.endStitch), -Infinity)
    const firstRow = piece.rasterRows[0]!.rowIndex
    const lastRow = piece.rasterRows.at(-1)!.rowIndex
    const maxColumns = 60, maxRows = 80, cell = 8
    for (let low = firstRow; low <= lastRow; low += maxRows) {
      const high = Math.min(lastRow, low + maxRows - 1)
      for (let left = firstNeedle; left <= lastNeedle; left += maxColumns) {
        const right = Math.min(lastNeedle, left + maxColumns - 1)
        beginPage(`${piece.name} · 针格分块`)
        context.font = '11px sans-serif'
        context.fillText(`针号 ${left + 1}-${right + 1} · 编织行 ${low - firstRow + 1}-${high - firstRow + 1} · 自下而上`, 36, 91)
        context.fillText(`本片格原点 X ${(piece.rasterRows[0]?.originXCm ?? 0).toFixed(4)} cm`, 36, 108)
        const x = 62, top = 126, width = (right - left + 1) * cell, height = (high - low + 1) * cell
        context.fillStyle = '#88afa1'
        for (const row of piece.rasterRows.filter(row => row.rowIndex >= low && row.rowIndex <= high)) {
          for (const segment of row.segments) {
            const start = Math.max(left, segment.startStitch), end = Math.min(right, segment.endStitch)
            if (start <= end) context.fillRect(x + (start - left) * cell, top + (high - row.rowIndex) * cell, (end - start + 1) * cell, cell)
          }
        }
        context.strokeStyle = '#8a8a8a'; context.lineWidth = 0.4; context.beginPath()
        for (let col = 0; col <= right - left + 1; col++) { context.moveTo(x + col * cell, top); context.lineTo(x + col * cell, top + height) }
        for (let line = 0; line <= high - low + 1; line++) { context.moveTo(x, top + line * cell); context.lineTo(x + width, top + line * cell) }
        context.stroke(); context.fillStyle = '#263d36'; context.font = '9px sans-serif'
        for (let row = high; row >= low; row--) if (row === high || row === low || (row - firstRow + 1) % 5 === 0) context.fillText(String(row - firstRow + 1), 36, top + (high - row) * cell + 7)
        for (let col = left; col <= right; col++) if (col === left || col === right || (col + 1) % 10 === 0) context.fillText(String(col + 1), x + (col - left) * cell, top - 5)
        await finishPage()
      }
    }
  }
}
