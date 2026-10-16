import { describe, expect, it } from 'vitest'
import { cardFromScreen, cardToScreen } from './cardCoordinates'

describe('编织卡画布相对坐标', () => {
  it('换倍率、画布位置和高度后保持相同相对位置，负坐标可表示画布外卡片', () => {
    const screen = { x: 80, y: 200 }
    const relative = cardFromScreen(screen, { x: 100, y: 50 }, 5, 70)
    expect(relative).toEqual({ x: -4, y: 40 })
    expect(cardToScreen(relative, { x: 100, y: 50 }, 5, 70)).toEqual(screen)
    expect(cardToScreen(relative, { x: 200, y: 80 }, 10, 100)).toEqual({ x: 160, y: 680 })
  })
})
