<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { calculateFabricGrid, calculateGauge } from '../core/gauge/gauge'
import { useEditorStore } from '../stores/editor'
import type { PersistedProject } from '../stores/editor.persistence'
import type { ExportedProjectFileV1 } from '../stores/projectTransfer'
import { parseProjectFile, serializeProjectFile } from '../stores/projectTransfer'
import ProjectThumbnail from './ProjectThumbnail.vue'

const props = defineProps<{ open: boolean; replacementMode: boolean }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const store = useEditorStore()
const editingId = ref<string | null>(null)
const editingName = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const pendingImport = ref<ExportedProjectFileV1 | null>(null)
const transferMessage = ref('')

const importingAtCapacity = computed(() => pendingImport.value !== null)

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

watch(() => props.open, (open) => {
  if (!open) {
    pendingImport.value = null
    transferMessage.value = ''
  }
})

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

function safeFileName(name: string): string {
  const normalized = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '')
  return normalized || '未命名方案'
}

function exportProject(project: PersistedProject): void {
  if (project.id === store.activeProjectId && store.hasUnfinishedDraft
    && !window.confirm('未完成的路径草稿不会包含在方案文件中。仍要导出吗？')) return
  const file = store.createProjectExport(project.id)
  if (!file) {
    transferMessage.value = '导出失败：找不到该方案。'
    return
  }
  const blob = new Blob([serializeProjectFile(file)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${safeFileName(project.name)}-${file.exportedAt.slice(0, 10)}.knitplan`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  transferMessage.value = `已导出“${project.name}”。`
}

function importErrorMessage(reason: 'invalid-json' | 'invalid-file' | 'unsupported-version'): string {
  if (reason === 'unsupported-version') return '导入失败：该方案文件版本暂不支持。'
  if (reason === 'invalid-json') return '导入失败：文件内容已损坏或不是有效的 JSON。'
  return '导入失败：这不是有效的编织方案文件，或方案数据不完整。'
}

function handleImportResult(result: ReturnType<typeof store.importProject>): void {
  if (result.status === 'imported') {
    emit('changed')
    emit('close')
  } else if (result.status === 'storage-error') {
    transferMessage.value = '导入失败：浏览器本地保存不可用，原方案未被替换。'
  } else if (result.status === 'draft') {
    transferMessage.value = '已取消导入，未完成的路径草稿仍然保留。'
  } else {
    transferMessage.value = '导入失败，请重试。'
  }
}

async function importSelectedFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const selectedFile = input.files?.[0]
  input.value = ''
  if (!selectedFile) return

  let serialized: string
  try {
    serialized = await selectedFile.text()
  } catch {
    transferMessage.value = '导入失败：无法读取所选文件。'
    return
  }
  const parsed = parseProjectFile(serialized)
  if (!parsed.ok) {
    transferMessage.value = importErrorMessage(parsed.reason)
    return
  }

  transferMessage.value = ''
  if (store.projects.length >= store.maxProjects) {
    pendingImport.value = parsed.file
    return
  }
  if (!confirmDiscardDraft()) return
  handleImportResult(store.importProject(parsed.file, true))
}

function replaceWithImport(project: PersistedProject): void {
  if (!pendingImport.value || !confirmDiscardDraft()) return
  if (!window.confirm(`“${project.name}”将被导入的“${pendingImport.value.project.name}”永久替换，且不能撤销。继续吗？`)) return
  handleImportResult(store.replaceWithImportedProject(project.id, pendingImport.value, true))
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
            <h2 id="project-dialog-title">{{ importingAtCapacity ? '选择要替换的方案' : replacementMode ? '选择要替换的方案' : '方案库' }}</h2>
            <p v-if="importingAtCapacity">已达到 5 份上限，选择一份方案替换为“{{ pendingImport?.project.name }}”。</p>
            <p v-else>{{ replacementMode ? '已达到 5 份上限，选择一份方案替换为空白方案。' : '方案保存在当前浏览器中，可导出后在另一台电脑继续编辑。' }}</p>
          </div>
          <div class="project-dialog-actions">
            <button class="import-project-button" type="button" @click="fileInput?.click()">导入方案</button>
            <input ref="fileInput" class="visually-hidden" type="file" accept=".knitplan,application/json"
              aria-hidden="true" tabindex="-1"
              @change="importSelectedFile" />
          </div>
          <button class="dialog-close" type="button" aria-label="关闭方案库" @click="emit('close')">×</button>
        </header>

        <p v-if="transferMessage" class="project-transfer-message" role="status">{{ transferMessage }}</p>

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
                <button v-if="importingAtCapacity" class="replace-action" type="button"
                  @click="replaceWithImport(project)">用导入方案替换</button>
                <button v-else-if="replacementMode" class="replace-action" type="button"
                  @click="replaceWithBlank(project)">替换此方案</button>
                <button v-else type="button" :disabled="project.id === store.activeProjectId"
                  @click="openProject(project.id)">{{ project.id === store.activeProjectId ? '已打开' : '打开' }}</button>
                <button v-if="!importingAtCapacity && !replacementMode" type="button"
                  @click="exportProject(project)">导出方案</button>
                <button v-if="!importingAtCapacity && !replacementMode" type="button" @click="beginRename(project)">重命名</button>
                <button v-if="!importingAtCapacity && !replacementMode" class="danger-action" type="button" :disabled="store.projects.length <= 1"
                  @click="deleteProject(project)">删除</button>
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>
  </Teleport>
</template>
