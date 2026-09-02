import { describe, expect, it } from 'vitest'
import type { PathShape } from './shape.types'
import { snapCm, snapPoint, tidyPathToGrid } from './snapping'

describe('geometry snapping', () => {
  it('按 0.5cm 吸附并消除负零', () => {
    expect(snapCm(22.93)).toBe(23)
    expect(snapCm(22.26)).toBe(22.5)
    expect(Object.is(snapCm(-0.1), -0)).toBe(false)
  })

  it('接近水平或垂直时严格对齐参考点', () => {
    expect(snapPoint({ x: 23.12, y: 5.32 }, [{ x: 0, y: 5 }])).toEqual({
      point: { x: 23, y: 5 }, axis: 'horizontal', guideValue: 5,
    })
    expect(snapPoint({ x: 8.2, y: 20.1 }, [{ x: 8, y: 0 }])).toEqual({
      point: { x: 8, y: 20 }, axis: 'vertical', guideValue: 8,
    })
  })

  it('明显斜线只吸附网格，关闭方向吸附时也不拉直', () => {
    expect(snapPoint({ x: 5.2, y: 2.2 }, [{ x: 0, y: 0 }]).point).toEqual({ x: 5, y: 2 })
    expect(snapPoint({ x: 5.2, y: 0.2 }, [{ x: 0, y: 0 }], false)).toEqual({
      point: { x: 5, y: 0 }, axis: null, guideValue: null,
    })
  })

  it('整理旧路径时拉直直边并保留控制柄相对锚点的位置', () => {
    const path: PathShape = {
      id: 'legacy', type: 'path', closed: false,
      nodes: [
        { anchor: { x: 0.12, y: 1.08 } },
        { anchor: { x: 22.93, y: 1.2 }, outControl: { x: 23.4, y: 3.2 } },
        { anchor: { x: 25.12, y: 6.08 }, inControl: { x: 24.2, y: 5.7 } },
      ],
    }

    const tidied = tidyPathToGrid(path)
    expect(tidied.nodes[0]?.anchor).toEqual({ x: 0, y: 1 })
    expect(tidied.nodes[1]?.anchor).toEqual({ x: 23, y: 1 })
    expect(tidied.nodes[2]?.anchor).toEqual({ x: 25, y: 6 })
    expect(tidied.nodes[1]?.outControl).toEqual({ x: 23.47, y: 3 })
  })
})
