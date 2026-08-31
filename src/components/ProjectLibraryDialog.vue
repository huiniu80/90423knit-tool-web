<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { calculateFabricGrid, calculateGauge } from '../core/gauge/gauge'
import { useEditorStore } from '../stores/editor'
import type { PersistedProject } from '../stores/editor.persistence'
import ProjectThumbnail from './ProjectThumbnail.vue'

const props = defineProps<{ open: boolean; replacementMode: boolean }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const store = useEditorStore()
const editingId = ref<string | null>(null)
const editingName = ref('')

const sortedProjects = computed(() => [...store.projects].sort((a, b) => {
  if (a.id === store.activeProjectId) return -1
  if (b.id === store.activeProjectId) return 1
  return b.updatedAt.localeCompare(a.updatedAt)
}))

function metadata(project: PersistedProject): string {
  const gauge = calculateGauge(project.document.gaugeInput)
  const grid = calculateFabricGrid(project.document.fabric, gauge)
  return `${project.document.fabric.widthCm} × ${project.document.fabric.heightCm} cm · ${grid.columnCount} 针 × ${grid.rowCount} 行 · ${project.document.shapes.length} 个图形`
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

function confirmDiscardDraft(): boolean {
  return !store.hasUnfinishedDraft || window.confirm('当前有尚未完成的路径草稿，切换后草稿不会保存。继续吗？')
}

function openProject(projectId: string): void {
  if (projectId === store.activeProjectId) {
    emit('close')
    return
  }
  if (!confirmDiscardDraft()) return
  if (store.activateProject(projectId, true)) {
    emit('changed')
    emit('close')
  }
}

function replaceWithBlank(project: PersistedProject): void {
  if (!confirmDiscardDraft()) return
  if (!window.confirm(`“${project.name}”将被永久替换为空白方案，且不能撤销。继续吗？`)) return
  if (store.replaceProject(project.id, true)) {
    emit('changed')
    emit('close')
  }
}

function beginRename(project: PersistedProject): void {
  editingId.value = project.id
  editingName.value = project.name
  nextTick(() => {
    const input = document.querySelector<HTMLInputElement>('.project-name-row input')
    input?.focus()
    input?.select()
  })
}

function finishRename(): void {
  if (editingId.value && editingName.value.trim()) {
    store.renameProject(editingId.value, editingName.value)
  }
  editingId.value = null
}

function deleteProject(project: PersistedProject): void {
  if (store.projects.length <= 1) return
  if (project.id === store.activeProjectId && !confirmDiscardDraft()) return
  if (!window.confirm(`确定删除“${project.name}”吗？此操作不能撤销。`)) return
  if (store.deleteProject(project.id, true)) emit('changed')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="project-dialog-backdrop" @mousedown.self="emit('close')">
      <section class="project-dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title">
        <header>
          <div>
            <span class="eyebrow">PROJECT LIBRARY</span>
            <h2 id="project-dialog-title">{{ replacementMode ? '选择要替换的方案' : '方案库' }}</h2>
            <p>{{ replacementMode ? '已达到 5 份上限，选择一份方案替换为空白方案。' : '所有方案都保存在当前浏览器中。' }}</p>
          </div>
          <button class="dialog-close" type="button" aria-label="关闭方案库" @click="emit('close')">×</button>
        </header>

        <div class="project-list">
          <article v-for="project in sortedProjects" :key="project.id"
            :class="['project-card', { active: project.id === store.activeProjectId }]">
            <ProjectThumbnail :document="project.document" />
            <div class="project-card-content">
              <div class="project-name-row">
                <input v-if="editingId === project.id" v-model="editingName"
                  maxlength="40" aria-label="方案名称" @keydown.enter="finishRename" @keydown.esc="editingId = null"
                  @blur="finishRename" />
                <h3 v-else>{{ project.name }}</h3>
                <span v-if="project.id === store.activeProjectId">当前</span>
              </div>
              <p>{{ metadata(project) }}</p>
              <small>修改于 {{ formatDate(project.updatedAt) }}</small>
              <div class="project-card-actions">
                <button v-if="replacementMode" class="replace-action" type="button"
                  @click="replaceWithBlank(project)">替换此方案</button>
                <button v-else type="button" :disabled="project.id === store.activeProjectId"
                  @click="openProject(project.id)">{{ project.id === store.activeProjectId ? '已打开' : '打开' }}</button>
                <button type="button" @click="beginRename(project)">重命名</button>
                <button class="danger-action" type="button" :disabled="store.projects.length <= 1"
                  @click="deleteProject(project)">删除</button>
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>
  </Teleport>
</template>
