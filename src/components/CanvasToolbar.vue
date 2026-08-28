<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useEditorStore } from '../stores/editor'
import type { EditorTool } from '../stores/editor.types'

const emit = defineEmits<{ fit: [] }>()
const store = useEditorStore()
const { activeTool, canUndo, canRedo, zoom, viewMode } = storeToRefs(store)

const tools: Array<{ id: EditorTool; icon: string; label: string }> = [
  { id: 'select', icon: '↖', label: '选择' },
  { id: 'pan', icon: '✋', label: '平移' },
  { id: 'polygon', icon: '⬠', label: '多边形' },
  { id: 'rectangle', icon: '▭', label: '矩形' },
  { id: 'triangle', icon: '△', label: '三角形' },
  { id: 'circle', icon: '○', label: '圆' },
  { id: 'ellipse', icon: '⬭', label: '椭圆' },
]

function chooseTool(tool: EditorTool): void {
  if (tool === 'rectangle' || tool === 'triangle' || tool === 'circle' || tool === 'ellipse') {
    store.addDefaultShape(tool)
    return
  }
  activeTool.value = tool
}

function changeZoom(delta: number): void {
  zoom.value = Math.min(60, Math.max(5, zoom.value + delta))
}
</script>

<template>
  <div class="canvas-toolbar" role="toolbar" aria-label="画布工具">
    <div class="tool-group shape-tools">
      <button v-for="tool in tools" :key="tool.id" type="button"
        :class="['tool-button', { active: activeTool === tool.id }]"
        :title="tool.label" @click="chooseTool(tool.id)">
        <span>{{ tool.icon }}</span><small>{{ tool.label }}</small>
      </button>
    </div>
    <div class="toolbar-divider" />
    <div class="tool-group history-tools">
      <button class="icon-button" type="button" title="撤销" :disabled="!canUndo" @click="store.undo()">↶</button>
      <button class="icon-button" type="button" title="重做" :disabled="!canRedo" @click="store.redo()">↷</button>
      <button class="icon-button danger" type="button" title="删除所选图形" @click="store.deleteSelected()">⌫</button>
    </div>
    <div class="toolbar-spacer" />
    <div class="segmented-control compact" aria-label="显示模式">
      <button :class="{ active: viewMode === 'outline' }" @click="viewMode = 'outline'">轮廓</button>
      <button :class="{ active: viewMode === 'grid' }" @click="viewMode = 'grid'">针格</button>
      <button :class="{ active: viewMode === 'overlay' }" @click="viewMode = 'overlay'">对比</button>
    </div>
    <div class="zoom-control">
      <button type="button" @click="changeZoom(-2)">−</button>
      <span>{{ Math.round(zoom * 5) }}%</span>
      <button type="button" @click="changeZoom(2)">+</button>
      <button class="fit-button" type="button" @click="emit('fit')">适应</button>
    </div>
  </div>
</template>
