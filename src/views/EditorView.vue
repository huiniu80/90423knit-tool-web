<script setup lang="ts">
import { ref } from 'vue'
import CanvasToolbar from '../components/CanvasToolbar.vue'
import GaugePanel from '../components/GaugePanel.vue'
import InstructionPanel from '../components/InstructionPanel.vue'
import KnittingCanvas from '../components/KnittingCanvas.vue'
import ShapePropertyPanel from '../components/ShapePropertyPanel.vue'
import { useEditorStore } from '../stores/editor'
import type { KnittingProject } from '../stores/editor.types'

const store = useEditorStore()
const canvasRef = ref<InstanceType<typeof KnittingCanvas> | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const notice = ref('')
let noticeTimer: number | undefined

function showNotice(message: string): void {
  notice.value = message
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => (notice.value = ''), 2600)
}

function exportJson(): void {
  const blob = new Blob([JSON.stringify(store.exportProject(), null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `编织图形-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
  showNotice('项目 JSON 已导出')
}

async function importJson(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const project = JSON.parse(await file.text()) as KnittingProject
    store.importProject(project)
    showNotice('项目已成功导入')
  } catch (error) {
    showNotice(error instanceof Error ? error.message : '项目文件无法读取')
  } finally {
    input.value = ''
  }
}
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="brand-lockup">
        <span class="brand-mark">◒</span>
        <div>
          <h1>编织图形转针法</h1>
          <p>Knitting Shape Planner</p>
        </div>
      </div>
      <div class="header-status"><span /> 本地计算 · 数据不上传</div>
      <div class="header-actions">
        <input ref="fileInput" class="visually-hidden" type="file" accept="application/json,.json" @change="importJson" />
        <button class="header-button" type="button" @click="fileInput?.click()">↑ 导入 JSON</button>
        <button class="header-button primary" type="button" @click="exportJson">↓ 导出项目</button>
      </div>
    </header>

    <main class="editor-main">
      <aside class="left-panel">
        <GaugePanel />
        <ShapePropertyPanel />
      </aside>

      <section class="workspace">
        <CanvasToolbar @fit="canvasRef?.fitCanvas()" />
        <KnittingCanvas ref="canvasRef" />
      </section>
    </main>

    <InstructionPanel />
    <Transition name="toast"><div v-if="notice" class="toast-message">{{ notice }}</div></Transition>
  </div>
</template>
