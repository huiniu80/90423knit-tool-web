<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useEditorStore } from '../stores/editor'
import type { EditorTool } from '../stores/editor.types'

const emit = defineEmits<{ fit: [] }>()
const store = useEditorStore()
const { activeTool, canUndo, canRedo, selectedShape, zoom, viewMode } = storeToRefs(store)

const tools: Array<{ id: EditorTool; icon: string; label: string }> = [
  { id: 'select', icon: '↖', label: '选择' },
  { id: 'pan', icon: '✋', label: '平移' },
  { id: 'path', icon: '⌁', label: '路径' },
]

function chooseTool(tool: EditorTool): void {
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
        :title="tool.id === 'pan' ? '平移所选路径' : tool.label" @click="chooseTool(tool.id)">
        <span>{{ tool.icon }}</span><small>{{ tool.label }}</small>
      </button>
    </div>
    <div class="toolbar-divider" />
    <div class="tool-group history-tools" aria-label="历史操作">
      <button class="history-button" type="button" title="撤销（Ctrl/⌘ Z）" aria-label="撤销"
        aria-keyshortcuts="Control+Z Meta+Z" :disabled="!canUndo" @click="store.undo()">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 7 4 12l5 5" />
          <path d="M4 12h8a7 7 0 0 1 7 7" />
        </svg>
      </button>
      <button class="history-button" type="button" title="重做（Ctrl/⌘ Shift Z）" aria-label="重做"
        aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y" :disabled="!canRedo"
        @click="store.redo()">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m15 7 5 5-5 5" />
          <path d="M20 12h-8a7 7 0 0 0-7 7" />
        </svg>
      </button>
      <button class="history-button history-button--danger" type="button" title="删除所选图形"
        aria-label="删除所选图形" aria-keyshortcuts="Delete Backspace" :disabled="!selectedShape"
        @click="store.deleteSelected()">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h16" />
          <path d="M9 7V4h6v3" />
          <path d="m7 7 1 13h8l1-13" />
          <path d="M10 11v5M14 11v5" />
        </svg>
      </button>
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
