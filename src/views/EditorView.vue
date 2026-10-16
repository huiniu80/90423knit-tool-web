<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import CanvasToolbar from '../components/CanvasToolbar.vue'
import GaugePanel from '../components/GaugePanel.vue'
import KnittingCanvas from '../components/KnittingCanvas.vue'
import ProjectLibraryDialog from '../components/ProjectLibraryDialog.vue'
import RowPlanDialog from '../components/RowPlanDialog.vue'
import ShapePropertyPanel from '../components/ShapePropertyPanel.vue'
import { useEditorStore } from '../stores/editor'
import { loadSidebarExpanded, saveSidebarExpanded } from './editorLayoutPreferences'

const store = useEditorStore()
const { activeProject, gridAssessment, hasUnfinishedDraft, projects, storageStatus, notice, shapePlans, projectOpenRevision } = storeToRefs(store)
const canvasRef = ref<InstanceType<typeof KnittingCanvas> | null>(null)
const sidebarExpanded = ref(loadSidebarExpanded())
const portraitLayout = ref(false)
let portraitQuery: MediaQueryList | null = null
function updatePortraitLayout(): void {
  portraitLayout.value = portraitQuery?.matches ?? false
  sidebarExpanded.value = portraitLayout.value ? false : loadSidebarExpanded()
  scheduleCanvasFit()
}
const projectLibraryOpen = ref(false)
const replacementMode = ref(false)
const rowPlanOpen = ref(false)
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
  if (!portraitLayout.value) saveSidebarExpanded(sidebarExpanded.value)
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

onMounted(() => {
  portraitQuery = window.matchMedia('(max-width: 900px) and (orientation: portrait)')
  portraitQuery.addEventListener('change', updatePortraitLayout)
  updatePortraitLayout()
})

onBeforeUnmount(() => {
  if (canvasFitTimer !== null) clearTimeout(canvasFitTimer)
  portraitQuery?.removeEventListener('change', updatePortraitLayout)
})
</script>

<template>
  <div class="app-shell">
    <p v-if="notice" class="editor-notice" role="status">{{ notice }}</p>
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
        <button class="library-button" type="button" @click="openLibrary(false)">
          我的方案库 <b>{{ projects.length }}/{{ store.maxProjects }}</b>
        </button>
        <button class="new-project-button" type="button" @click="createProject">
          {{ projects.length >= store.maxProjects ? '选择替换' : '＋ 新建方案' }}
        </button>
      </div>
    </header>
    <div v-if="storageStatus === 'error'" class="storage-backup-alert" role="alert">
      <span>保存失败，请立即导出备份</span>
      <button type="button" @click="openLibrary(false)">打开方案库导出备份</button>
    </div>

    <main :class="['editor-main', { 'sidebar-collapsed': !sidebarExpanded, 'portrait-layout': portraitLayout }]">
      <button v-if="portraitLayout && sidebarExpanded" class="sidebar-backdrop" type="button" aria-label="关闭参数栏" @click="toggleSidebar" />
      <aside id="editor-sidebar" class="left-panel" :aria-hidden="!sidebarExpanded"
        :inert="!sidebarExpanded">
        <button v-if="portraitLayout" class="sidebar-close" type="button" @click="toggleSidebar">关闭参数栏</button>
        <GaugePanel />
        <ShapePropertyPanel />
      </aside>

      <section class="workspace">
        <CanvasToolbar :sidebar-expanded="sidebarExpanded" @toggle-sidebar="toggleSidebar"
          @fit="canvasRef?.fitCanvas()" @export="canvasRef?.exportCanvas()" />
        <button class="row-plan-open" type="button" @click="rowPlanOpen = true">查看逐行操作表</button>
        <div v-if="shapePlans.some((plan) => plan.calculationMessage)" class="calculation-message" role="status">
          <p v-for="plan in shapePlans.filter((item) => item.calculationMessage)" :key="plan.shapeId">{{ plan.shapeName || '未命名轮廓' }}：{{ plan.calculationMessage }}</p>
        </div>
        <KnittingCanvas v-if="gridAssessment.status !== 'blocked'" :key="projectOpenRevision" ref="canvasRef" />
        <div v-else class="grid-blocked-placeholder" role="alert">
          <strong>已暂停生成编织图解</strong>
          <p>{{ gridAssessment.issues.find((issue) => issue.severity === 'error')?.message }}</p>
          <small>请在左侧调整小样密度或画布尺寸。方案数据仍会保留。</small>
        </div>
      </section>
    </main>
    <ProjectLibraryDialog :open="projectLibraryOpen" :replacement-mode="replacementMode"
      @close="projectLibraryOpen = false" @changed="scheduleCanvasFit" />
    <RowPlanDialog :open="rowPlanOpen" @close="rowPlanOpen = false" />
  </div>
</template>
