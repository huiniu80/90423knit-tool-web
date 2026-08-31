<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import CanvasToolbar from '../components/CanvasToolbar.vue'
import GaugePanel from '../components/GaugePanel.vue'
import KnittingCanvas from '../components/KnittingCanvas.vue'
import ProjectLibraryDialog from '../components/ProjectLibraryDialog.vue'
import ShapePropertyPanel from '../components/ShapePropertyPanel.vue'
import { useEditorStore } from '../stores/editor'
import { loadSidebarExpanded, saveSidebarExpanded } from './editorLayoutPreferences'

const store = useEditorStore()
const { activeProject, gridAssessment, hasUnfinishedDraft, projects, storageStatus } = storeToRefs(store)
const canvasRef = ref<InstanceType<typeof KnittingCanvas> | null>(null)
const sidebarExpanded = ref(loadSidebarExpanded())
const projectLibraryOpen = ref(false)
const replacementMode = ref(false)
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

function confirmDiscardDraft(): boolean {
  return !hasUnfinishedDraft.value || window.confirm('当前有尚未完成的路径草稿，新建后草稿不会保存。继续吗？')
}

function openLibrary(replace = false): void {
  replacementMode.value = replace
  projectLibraryOpen.value = true
}

function createProject(): void {
  if (projects.value.length >= store.maxProjects) {
    openLibrary(true)
    return
  }
  if (!confirmDiscardDraft()) return
  if (store.createProject(true)) scheduleCanvasFit()
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
      <div class="project-header-controls">
        <div class="current-project" :title="activeProject?.name">
          <span>当前方案</span>
          <strong>{{ activeProject?.name ?? '未命名方案' }}</strong>
        </div>
        <span v-if="storageStatus === 'error'" class="storage-error" role="status">本地保存失败</span>
        <button class="library-button" type="button" @click="openLibrary(false)">
          我的方案库 <b>{{ projects.length }}/{{ store.maxProjects }}</b>
        </button>
        <button class="new-project-button" type="button" @click="createProject">
          {{ projects.length >= store.maxProjects ? '选择替换' : '＋ 新建方案' }}
        </button>
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
        <KnittingCanvas v-if="gridAssessment.status !== 'blocked'" ref="canvasRef" />
        <div v-else class="grid-blocked-placeholder" role="alert">
          <strong>已暂停生成编织图解</strong>
          <p>{{ gridAssessment.issues.find((issue) => issue.severity === 'error')?.message }}</p>
          <small>请在左侧调整小样密度或画布尺寸。方案数据仍会保留。</small>
        </div>
      </section>
    </main>
    <ProjectLibraryDialog :open="projectLibraryOpen" :replacement-mode="replacementMode"
      @close="projectLibraryOpen = false" @changed="scheduleCanvasFit" />
  </div>
</template>
