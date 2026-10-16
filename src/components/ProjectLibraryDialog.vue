<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { calculateFabricGrid, calculateGauge } from '../core/gauge/gauge'
import { assessGrid } from '../core/gauge/gridConstraints'
import { useEditorStore } from '../stores/editor'
import type { PersistedProject } from '../stores/editor.persistence'
import type { ExportedProjectFileV1 } from '../stores/projectTransfer'
import { parseProjectFile, serializeProjectFile } from '../stores/projectTransfer'
import ProjectThumbnail from './ProjectThumbnail.vue'
import HistoryComparisonDialog from './HistoryComparisonDialog.vue'

const props = defineProps<{ open: boolean; replacementMode: boolean }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const store = useEditorStore()
const editingId = ref<string | null>(null)
const editingName = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const pendingImport = ref<ExportedProjectFileV1 | null>(null)
const transferMessage = ref('')
const showingRecycleBin = ref(false)
const pendingRestoreId = ref<string | null>(null)
const historyProject = ref<PersistedProject | null>(null)

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
    pendingRestoreId.value = null
    showingRecycleBin.value = false
    historyProject.value = null
  } else {
    store.refreshRecycleBin()
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
  if (!window.confirm(`“${project.name}”将移入回收站并替换为空白方案。回收站最多保留 5 份、最长 30 天。继续吗？`)) return
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
  try {
    const file = store.createProjectExport(project.id)
    if (!file) throw Error('找不到方案')
    const blob = new Blob([serializeProjectFile(file)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${safeFileName(project.name)}-${file.exportedAt.slice(0, 10)}.knitplan`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    transferMessage.value = `已发起“${project.name}”的下载，请妥善保存文件。`
  } catch {
    transferMessage.value = '导出失败，请重试。当前源数据仍在页面中。'
  }
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
  } else if (result.status === 'grid-limit') {
    transferMessage.value = `导入失败：${result.assessment.issues.find((issue) => issue.severity === 'error')?.message ?? '方案网格超过安全上限。'}`
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
  if (selectedFile.size > 100_000_000) {
    transferMessage.value = '导入失败：文件过大，请使用较小的单份方案文件。'
    return
  }

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
  if (parsed.upgraded) store.showNotice('旧方案已安全升级，原文件未修改。新导出的文件不保证可由旧版软件打开。')

  const importedAssessment = assessGrid(
    parsed.file.project.document.gaugeInput,
    parsed.file.project.document.fabric,
  )
  if (importedAssessment.status === 'blocked') {
    transferMessage.value = `导入失败：${importedAssessment.issues.find((issue) => issue.severity === 'error')?.message ?? '方案网格超过安全上限。'}`
    return
  }

  transferMessage.value = ''
  showingRecycleBin.value = false
  pendingRestoreId.value = null
  if (store.projects.length >= store.maxProjects) {
    pendingImport.value = parsed.file
    return
  }
  if (!confirmDiscardDraft()) return
  handleImportResult(store.importProject(parsed.file, true))
}

function replaceWithImport(project: PersistedProject): void {
  if (!pendingImport.value || !confirmDiscardDraft()) return
  if (!window.confirm(`“${project.name}”将移入回收站并替换为“${pendingImport.value.project.name}”。继续吗？`)) return
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
  if (!window.confirm(`将“${project.name}”移入回收站？最多保留 5 份、最长 30 天，不属于内容撤销。`)) return
  if (store.deleteProject(project.id, true)) emit('changed')
}

function restoreProject(recordId: string, replacement?: PersistedProject): void {
  if (!confirmDiscardDraft()) return
  if (replacement && !window.confirm(`“${replacement.name}”将移入回收站并替换为恢复的方案。继续吗？`)) return
  const result = store.restoreRecycledProject(recordId, replacement?.id, true)
  if (result.status === 'capacity') {
    pendingRestoreId.value = recordId
    showingRecycleBin.value = false
    return
  }
  if (result.status === 'imported') {
    emit('changed')
    emit('close')
  } else if (result.status === 'not-found') {
    pendingRestoreId.value = null
    transferMessage.value = '记录已到期或不可恢复，原方案保持不变。'
  } else handleImportResult(result)
}

function permanentlyRemove(recordId?: string): void {
  if (!window.confirm(recordId ? '永久删除该记录？删除后无法恢复。' : '清空回收站？所有记录将永久删除，无法恢复。')) return
  if (!store.removeRecycledProject(recordId)) transferMessage.value = '保存失败，请立即导出备份。回收站记录仍保留。'
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="project-dialog-backdrop" @click.self="emit('close')">
      <section class="project-dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title">
        <header>
          <div>
            <span class="eyebrow">PROJECT LIBRARY</span>
            <h2 id="project-dialog-title">{{ importingAtCapacity || replacementMode || pendingRestoreId ? '选择要替换的方案' : showingRecycleBin ? '回收站' : '我的方案库' }}</h2>
            <p v-if="pendingRestoreId">方案库已满，请选择恢复时要替换的方案；取消后两边记录均保留。</p>
            <p v-else-if="importingAtCapacity">已达到 5 份上限，选择一份方案替换为“{{ pendingImport?.project.name }}”。</p>
            <p v-else>{{ replacementMode ? '已达到 5 份上限，选择一份方案替换为空白方案。' : '方案保存在当前浏览器中，可导出后在另一台电脑继续编辑。' }}</p>
          </div>
          <div class="project-dialog-actions">
            <button class="import-project-button" type="button" @click="fileInput?.click()">导入方案</button>
            <input ref="fileInput" class="visually-hidden" type="file" accept=".knitplan,application/json"
              aria-hidden="true" tabindex="-1"
              @change="importSelectedFile" />
          </div>
          <button class="dialog-close" type="button" aria-label="关闭我的方案库" @click="emit('close')">×</button>
        </header>

        <p v-if="transferMessage" class="project-transfer-message" role="status">{{ transferMessage }}</p>
        <p class="project-backup-note">方案仅保存在当前浏览器，清理浏览器数据可能导致丢失，请导出文件备份。</p>
        <p v-if="store.storageStatus === 'error'" class="project-transfer-message" role="alert">保存失败，请立即导出备份</p>
        <nav class="project-library-tabs" aria-label="方案与回收站">
          <button type="button" @click="showingRecycleBin = false; pendingRestoreId = null; pendingImport = null">正常方案 {{ store.projects.length }}/5</button>
          <button type="button" @click="showingRecycleBin = true; pendingRestoreId = null; pendingImport = null; store.refreshRecycleBin()">回收站 {{ store.recycledProjects.length }}/5</button>
          <button v-if="showingRecycleBin" type="button" :disabled="!store.recycledProjects.length" @click="permanentlyRemove()">清空回收站</button>
        </nav>

        <div v-if="!showingRecycleBin" class="project-list">
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
                <button v-if="pendingRestoreId" class="replace-action" type="button" @click="restoreProject(pendingRestoreId, project)">恢复并替换此方案</button>
                <button v-else-if="importingAtCapacity" class="replace-action" type="button"
                  @click="replaceWithImport(project)">用导入方案替换</button>
                <button v-else-if="replacementMode" class="replace-action" type="button"
                  @click="replaceWithBlank(project)">替换此方案</button>
                <button v-else type="button" :disabled="project.id === store.activeProjectId"
                  @click="openProject(project.id)">{{ project.id === store.activeProjectId ? '已打开' : '打开' }}</button>
                <button v-if="!importingAtCapacity && !replacementMode" type="button"
                  @click="exportProject(project)">导出方案</button>
                <button v-if="!importingAtCapacity && !replacementMode" type="button"
                  @click="historyProject = store.readProjectSource(project.id)">历史结果对照</button>
                <button v-if="!importingAtCapacity && !replacementMode" type="button" @click="beginRename(project)">重命名</button>
                <button v-if="!importingAtCapacity && !replacementMode" class="danger-action" type="button" :disabled="store.projects.length <= 1"
                  @click="deleteProject(project)">删除</button>
              </div>
            </div>
          </article>
        </div>
        <div v-else class="project-list">
          <p>仅保留最近 5 份，最长 30 天；到期或超量记录自动淘汰，请及时导出备份。</p>
          <p v-if="!store.recycledProjects.length">回收站为空。</p>
          <article v-for="record in store.recycledProjects" :key="record.id" class="project-card">
            <ProjectThumbnail :document="record.project.document" />
            <div class="project-card-content">
              <h3>{{ record.project.name }}</h3>
              <p>{{ metadata(record.project) }}</p>
              <small>{{ record.reason === 'delete' ? '删除' : '替换' }}于 {{ formatDate(record.movedAt) }} · 最长 30 天</small>
              <div class="project-card-actions">
                <button type="button" @click="restoreProject(record.id)">恢复方案</button>
                <button class="danger-action" type="button" @click="permanentlyRemove(record.id)">永久删除</button>
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>
  </Teleport>
  <HistoryComparisonDialog :project="historyProject" @close="historyProject = null" />
</template>
