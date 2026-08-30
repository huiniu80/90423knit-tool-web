<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import CanvasToolbar from '../components/CanvasToolbar.vue'
import GaugePanel from '../components/GaugePanel.vue'
import KnittingCanvas from '../components/KnittingCanvas.vue'
import ShapePropertyPanel from '../components/ShapePropertyPanel.vue'
import { loadSidebarExpanded, saveSidebarExpanded } from './editorLayoutPreferences'

const canvasRef = ref<InstanceType<typeof KnittingCanvas> | null>(null)
const sidebarExpanded = ref(loadSidebarExpanded())
let canvasFitTimer: ReturnType<typeof setTimeout> | null = null

function scheduleCanvasFit(): void {
  if (canvasFitTimer !== null) clearTimeout(canvasFitTimer)
  nextTick(() => {
    canvasFitTimer = setTimeout(() => {
      canvasRef.value?.fitCanvas()
      canvasFitTimer = null
    }, 200)
  })
}

function toggleSidebar(): void {
  sidebarExpanded.value = !sidebarExpanded.value
  saveSidebarExpanded(sidebarExpanded.value)
  scheduleCanvasFit()
}

onMounted(scheduleCanvasFit)

onBeforeUnmount(() => {
  if (canvasFitTimer !== null) clearTimeout(canvasFitTimer)
})
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="brand-lockup">
        <span class="brand-mark" aria-hidden="true">
          <img src="/logo.png" alt="" />
        </span>
        <div>
          <h1>编织图形转针法</h1>
          <p>Knitting Shape Planner</p>
        </div>
      </div>
    </header>

    <main :class="['editor-main', { 'sidebar-collapsed': !sidebarExpanded }]">
      <aside id="editor-sidebar" class="left-panel" :aria-hidden="!sidebarExpanded"
        :inert="!sidebarExpanded">
        <GaugePanel />
        <ShapePropertyPanel />
      </aside>

      <section class="workspace">
        <CanvasToolbar :sidebar-expanded="sidebarExpanded" @toggle-sidebar="toggleSidebar"
          @fit="canvasRef?.fitCanvas()" @export="canvasRef?.exportCanvas()" />
        <KnittingCanvas ref="canvasRef" />
      </section>
    </main>
  </div>
</template>
