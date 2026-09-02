export interface PositionedAnnotationCard {
  key: string
  x: number
  y: number
  width: number
  height: number
  isPinned: boolean
}

interface AnnotationCardBounds {
  top: number
  bottom: number
  gap: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function cardsCollide(
  first: PositionedAnnotationCard,
  second: PositionedAnnotationCard,
  gap: number,
): boolean {
  const horizontallyOverlaps = first.x < second.x + second.width
    && first.x + first.width > second.x
  const verticallyOverlaps = first.y < second.y + second.height + gap
    && first.y + first.height + gap > second.y
  return horizontallyOverlaps && verticallyOverlaps
}

/**
 * Keeps manually positioned cards fixed and moves automatic cards to the nearest
 * free vertical slot. Pinned cards are intentionally allowed to overlap each
 * other because moving one would violate the user's explicit placement.
 */
export function avoidPinnedCardCollisions<T extends PositionedAnnotationCard>(
  cards: readonly T[],
  bounds: AnnotationCardBounds,
): T[] {
  const positionedByKey = new Map<string, T>()
  const placed: T[] = []

  for (const card of cards.filter((item) => item.isPinned)) {
    const positioned = {
      ...card,
      y: clamp(card.y, bounds.top, bounds.bottom - card.height),
    }
    positionedByKey.set(card.key, positioned)
    placed.push(positioned)
  }

  const automaticCards = cards
    .filter((item) => !item.isPinned)
    .sort((left, right) => left.y - right.y)

  for (const card of automaticCards) {
    const preferredY = clamp(card.y, bounds.top, bounds.bottom - card.height)
    const candidates = new Set<number>([
      preferredY,
      bounds.top,
      bounds.bottom - card.height,
    ])
    for (const obstacle of placed) {
      candidates.add(obstacle.y + obstacle.height + bounds.gap)
      candidates.add(obstacle.y - card.height - bounds.gap)
    }

    const availableY = [...candidates]
      .filter((y) => y >= bounds.top && y + card.height <= bounds.bottom)
      .filter((y) => !placed.some((obstacle) => cardsCollide({ ...card, y }, obstacle, bounds.gap)))
      .sort((left, right) => Math.abs(left - preferredY) - Math.abs(right - preferredY) || left - right)[0]

    const positioned = { ...card, y: availableY ?? preferredY }
    positionedByKey.set(card.key, positioned)
    placed.push(positioned)
  }

  return cards.map((card) => positionedByKey.get(card.key) ?? { ...card })
}
