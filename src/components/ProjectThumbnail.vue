<script setup lang="ts">
import { computed } from 'vue'
import type { Shape } from '../core/geometry/shape.types'
import type { PersistedEditorDocument } from '../stores/editor.persistence'
import { getProjectThumbnailViewBox } from './projectThumbnailViewport'

const props = defineProps<{ document: PersistedEditorDocument }>()

const viewBox = computed(() => getProjectThumbnailViewBox(
  props.document.shapes,
  props.document.fabric,
))

function y(value: number): number {
  return props.document.fabric.heightCm - value
}

function pathData(shape: Extract<Shape, { type: 'path' }>): string {
  const first = shape.nodes[0]
  if (!first) return ''
  const commands = [`M ${first.anchor.x} ${y(first.anchor.y)}`]
  const count = shape.closed ? shape.nodes.length : shape.nodes.length - 1
  for (let index = 0; index < count; index += 1) {
    const current = shape.nodes[index]
    const next = shape.nodes[(index + 1) % shape.nodes.length]
    const out = current.outControl ?? current.anchor
    const incoming = next.inControl ?? next.anchor
    commands.push(`C ${out.x} ${y(out.y)} ${incoming.x} ${y(incoming.y)} ${next.anchor.x} ${y(next.anchor.y)}`)
  }
  if (shape.closed) commands.push('Z')
  return commands.join(' ')
}

const renderedShapes = computed(() => props.document.shapes.map((shape) => {
  switch (shape.type) {
    case 'rectangle':
      return { id: shape.id, tag: 'rect', attrs: { x: shape.x, y: y(shape.y + shape.heightCm), width: shape.widthCm, height: shape.heightCm } }
    case 'circle':
      return { id: shape.id, tag: 'circle', attrs: { cx: shape.center.x, cy: y(shape.center.y), r: shape.radiusCm } }
    case 'ellipse':
      return { id: shape.id, tag: 'ellipse', attrs: { cx: shape.center.x, cy: y(shape.center.y), rx: shape.radiusXcm, ry: shape.radiusYcm } }
    case 'triangle':
    case 'polygon':
      return { id: shape.id, tag: 'polygon', attrs: { points: shape.points.map((point) => `${point.x},${y(point.y)}`).join(' ') } }
    case 'path':
      return { id: shape.id, tag: 'path', attrs: { d: pathData(shape) } }
  }
}))
</script>

<template>
  <div class="project-thumbnail" aria-hidden="true">
    <svg :viewBox="viewBox"
      preserveAspectRatio="xMidYMid meet">
      <component :is="shape.tag" v-for="shape in renderedShapes" :key="shape.id" v-bind="shape.attrs"
        fill="rgba(52, 88, 78, .12)" stroke="currentColor" vector-effect="non-scaling-stroke" />
    </svg>
    <span v-if="!document.shapes.length">空白方案</span>
  </div>
</template>
