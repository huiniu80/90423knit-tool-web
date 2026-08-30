<script setup lang="ts">
import { ref } from 'vue'
import CanvasToolbar from '../components/CanvasToolbar.vue'
import GaugePanel from '../components/GaugePanel.vue'
import KnittingCanvas from '../components/KnittingCanvas.vue'
import ShapePropertyPanel from '../components/ShapePropertyPanel.vue'

const canvasRef = ref<InstanceType<typeof KnittingCanvas> | null>(null)
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

    <main class="editor-main">
      <aside class="left-panel">
        <GaugePanel />
        <ShapePropertyPanel />
      </aside>

      <section class="workspace">
        <CanvasToolbar @fit="canvasRef?.fitCanvas()" @export="canvasRef?.exportCanvas()" />
        <KnittingCanvas ref="canvasRef" />
      </section>
    </main>
  </div>
</template>
