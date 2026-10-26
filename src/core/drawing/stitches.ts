import type { StitchDefinition } from './types'

const line = (...xy: number[]) => xy
const vertical = [line(50, 20, 50, 80)]
const horizontal = [line(25, 50, 75, 50)]
const twisted = [line(35, 15, 30, 25, 35, 38, 65, 60, 67, 73, 60, 85), line(65, 15, 70, 25, 65, 38, 35, 60, 33, 73, 40, 85)]
const circle = Array.from({ length: 25 }, (_, i) => [50 + 23 * Math.cos(i * Math.PI / 12), 50 + 23 * Math.sin(i * Math.PI / 12)]).flat()
const entry = (id: string, name: string, color: string | null, kind: StitchDefinition['kind'], span: number, input: number, output: number, paths: number[][], steps: string[]): StitchDefinition => ({ id, name, color, kind, span, input, output, paths, steps })
export const BUILTIN_STITCHES: StitchDefinition[] = [
  entry('knit', '下针', null, 'knit', 1, 1, 1, vertical, ['工作线放在针后。右针从左针第一针的前侧，由左向右穿入。', '工作线绕过右针，右针将新线圈拉出。', '旧线圈从左针滑落，新线圈留在右针上。']),
  entry('purl', '上针', '#C4AAA7', 'purl', 1, 1, 1, horizontal, ['工作线放在针前。右针从第一针前侧，由右向左穿入。', '工作线绕过右针，将新线圈向后拉出。', '旧线圈从左针滑落，新线圈留在右针上。']),
  entry('twist-knit', '扭下针', '#ABB8A5', 'twist', 1, 1, 1, twisted, ['工作线放在针后，右针穿入线圈后腿，交叉织下针。', '绕线并拉出新线圈，保持旧线圈两腿交叉。', '旧线圈滑落；新线圈留在右针上。']),
  entry('twist-purl', '扭上针', '#C3CBB7', 'twist', 1, 1, 1, [...twisted, line(25, 92, 75, 92)], ['工作线放在针前，右针从线圈后腿穿入织上针。', '绕线并拉出新线圈，使线圈两腿交叉。', '旧线圈滑落；新线圈留在右针上。']),
]
for (const [id, name, color, knitwise, front] of [
  ['slip-purl-front', '按上针方式滑针·线在前', '#AABBC7', false, true],
  ['slip-purl-back', '按上针方式滑针·线在后', '#C5D0D8', false, false],
  ['slip-knit-front', '按下针方式滑针·线在前', '#94AAB8', true, true],
  ['slip-knit-back', '按下针方式滑针·线在后', '#B6C7CB', true, false],
] as const) BUILTIN_STITCHES.push(entry(id, name, color, 'slip', 1, 1, 1,
  [line(28, 22, 50, 75, 72, 22), line(20, front ? 88 : 12, 80, front ? 88 : 12), ...(knitwise ? [line(42, 38, 58, 38)] : [])],
  [`工作线移到针${front ? '前' : '后'}。`, `右针按${knitwise ? '下' : '上'}针入针方向穿入第一针。`, '不绕线、不织新针，直接把线圈移到右针。']))
BUILTIN_STITCHES.push(
  entry('yarn-over', '挂针', '#D6C6AA', 'increase', 1, 0, 1, [circle], ['不消耗左针旧针，将工作线绕到右针上形成一个新线圈。', '继续下一针；挂针会增加一针，并通常形成孔眼。']),
  entry('m1l', '左倾加针', '#C5B493', 'increase', 1, 0, 1, [line(50, 20, 50, 80), line(50, 50, 25, 30)], ['左针从前往后挑起两针之间的横线。', '从挑起横线的后腿织下针，增加一针，消除孔眼。']),
  entry('m1r', '右倾加针', '#DED1BA', 'increase', 1, 0, 1, [line(50, 20, 50, 80), line(50, 50, 75, 30)], ['左针从后往前挑起两针之间的横线。', '从挑起横线的前腿织下针，增加一针，消除孔眼。']),
  entry('kfb', '一针织前后两次', '#B9A98F', 'increase', 1, 1, 2, [line(50, 80, 50, 50, 28, 20), line(50, 50, 72, 20)], ['先从同一针前腿织一下针，旧针留在左针。', '再从同一针后腿织一下针，最后滑落旧针；一针变两针。']),
)
for (const [id, name, color, input, left, purl, center] of [
  ['ssk', '下针两针并一·左倾', '#B6A6BB', 2, true, false, false],
  ['k2tog', '下针两针并一·右倾', '#C8BCCF', 2, false, false, false],
  ['ssp', '上针两针并一·左倾', '#A798AF', 2, true, true, false],
  ['p2tog', '上针两针并一·右倾', '#D8CBDC', 2, false, true, false],
  ['sssk', '三针并一·左倾', '#BBB0C3', 3, true, false, false],
  ['k3tog', '三针并一·右倾', '#9D8EA9', 3, false, false, false],
  ['cdd', '三针并一·居中', '#D3C5D2', 3, false, false, true],
] as const) {
  const steps = center ? ['按下针方式把前两针一起滑到右针。', '织下一针下针。', '把刚滑过的两针一起套过新针；三针变一针，居中减两针。']
    : left ? (purl ? ['把前两针分别按下针方式滑过，再放回左针，调整针脚方向。', '工作线放前，从两针后腿一起织上针；两针变一针。'] : [`把前${input === 2 ? '两' : '三'}针分别按下针方式滑到右针。`, '左针穿入这些线圈，从后腿将它们一起织下针。'])
    : [`右针按${purl ? '上' : '下'}针方式同时穿入左针前${input === 2 ? '两' : '三'}针。`, `绕线拉出一个新线圈，全部旧针滑落；${input}针变一针。`]
  BUILTIN_STITCHES.push(entry(id, name, color, 'decrease', input, input, 1,
    center ? [line(25, 20, 50, 50, 75, 20), line(50, 20, 50, 80)] : [line(left ? 75 : 25, 20, left ? 25 : 75, 80), ...(input === 3 ? [line(left ? 60 : 40, 20, left ? 15 : 85, 70)] : []), ...(purl ? [line(20, 90, 80, 90)] : [])], steps))
}
for (const [n, left, color] of [[2, true, '#C7AD9E'], [2, false, '#DCC4B3'], [4, true, '#B99C8B'], [4, false, '#CDB7A6'], [6, true, '#AC9385'], [6, false, '#E1CDBF']] as const) {
  const half = n / 2
  BUILTIN_STITCHES.push(entry(`cable-${n}-${left ? 'l' : 'r'}`, `${['', '', '两', '', '四', '', '六'][n]}针${left ? '左' : '右'}交叉`, color, 'cable', n, n, n,
    left ? [line(10, 80, 90, 20), line(10, 20, 43, 45), line(57, 55, 90, 80)] : [line(10, 20, 90, 80), line(10, 80, 43, 55), line(57, 45, 90, 20)],
    [`前${half}针移到麻花针，置于织物${left ? '前' : '后'}方。`, `织左针接下来的${half}针下针。`, `再织麻花针上的${half}针下针；交叉${n}针，针数不变。`]))
}
export const stitchMap = (custom: StitchDefinition[] = []) => new Map([...BUILTIN_STITCHES, ...custom].map(s => [s.id, s]))
export function centerSymbol(paths: number[][]): number[][] {
  const xs = paths.flatMap(p => p.filter((_, i) => i % 2 === 0)), ys = paths.flatMap(p => p.filter((_, i) => i % 2 === 1))
  if (!xs.length) return []
  const minX = xs.reduce((n, v) => Math.min(n, v), Infinity), maxX = xs.reduce((n, v) => Math.max(n, v), -Infinity), minY = ys.reduce((n, v) => Math.min(n, v), Infinity), maxY = ys.reduce((n, v) => Math.max(n, v), -Infinity)
  const scale = 70 / Math.max(maxX - minX, maxY - minY, 1)
  return paths.map(p => p.map((n, i) => 50 + (n - (i % 2 ? (minY + maxY) / 2 : (minX + maxX) / 2)) * scale))
}

/** Shared black symbol renderer for chart, sample, library and export. */
export function drawStitch(ctx: CanvasRenderingContext2D, def: StitchDefinition, x: number, y: number, w: number, h: number): void {
  if (def.color) { ctx.fillStyle = def.color; ctx.fillRect(x, y, w, h) }
  ctx.save(); ctx.translate(x, y); ctx.scale(w / 100, h / 100)
  ctx.strokeStyle = '#000'; ctx.lineWidth = Math.max(3, 100 / Math.min(w, h)); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  for (const path of def.paths) {
    ctx.beginPath(); for (let i = 0; i < path.length; i += 2) { if (i) ctx.lineTo(path[i], path[i + 1]); else ctx.moveTo(path[i], path[i + 1]) } ctx.stroke()
  }
  ctx.restore()
}
