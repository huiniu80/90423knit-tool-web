<script setup lang="ts">
import type { StitchDefinition } from '../core/drawing/types'
defineProps<{ definition: StitchDefinition }>()
</script>
<template>
  <svg class="stitch-symbol" viewBox="0 0 100 100" :aria-label="definition.name" role="img" :style="{ background: definition.color ?? 'transparent' }">
    <polyline v-for="(path, i) in definition.paths" :key="i" :points="path.join(' ')" fill="none" stroke="#000" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>
<style scoped>.stitch-symbol { width: 44px; height: 44px; flex-shrink: 0; border: 1px solid #d3cdc2; border-radius: 4px; }</style>
