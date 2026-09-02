import { describe, expect, it } from 'vitest'
import { avoidPinnedCardCollisions } from './annotationCardLayout'

describe('avoidPinnedCardCollisions', () => {
  it('保留固定卡片坐标并让自动卡片避让', () => {
    const result = avoidPinnedCardCollisions([
      { key: 'top', x: 14, y: 14, width: 264, height: 70, isPinned: false },
      { key: 'pinned', x: 14, y: 100, width: 264, height: 80, isPinned: true },
      { key: 'expanded', x: 14, y: 150, width: 264, height: 160, isPinned: false },
    ], { top: 14, bottom: 500, gap: 10 })

    expect(result.find((card) => card.key === 'pinned')?.y).toBe(100)
    expect(result.find((card) => card.key === 'expanded')?.y).toBe(190)
  })

  it('横向没有相交的卡片互不影响', () => {
    const result = avoidPinnedCardCollisions([
      { key: 'left', x: 14, y: 100, width: 264, height: 100, isPinned: true },
      { key: 'right', x: 400, y: 100, width: 264, height: 100, isPinned: false },
    ], { top: 14, bottom: 500, gap: 10 })

    expect(result.find((card) => card.key === 'right')?.y).toBe(100)
  })

  it('优先选择距离自动排版位置最近的可用空间', () => {
    const result = avoidPinnedCardCollisions([
      { key: 'pinned', x: 14, y: 180, width: 264, height: 80, isPinned: true },
      { key: 'automatic', x: 14, y: 200, width: 264, height: 60, isPinned: false },
    ], { top: 14, bottom: 500, gap: 10 })

    expect(result.find((card) => card.key === 'automatic')?.y).toBe(270)
  })
})
