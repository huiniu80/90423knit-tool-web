<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEditorStore } from '../stores/editor'
import type { PatternSample, StitchDefinition } from '../core/drawing/types'
import { PRESETS, createPreset } from '../core/drawing/drawing'
import StitchSymbol from './StitchSymbol.vue'
import StitchTutorial from './StitchTutorial.vue'
import CustomStitchDialog from './CustomStitchDialog.vue'
import PatternSampleDialog from './PatternSampleDialog.vue'
import { stitchReading } from '../core/drawing/stitches'
const store = useEditorStore()
const hovered = ref<string | null>(null), search = ref('')
const selected = computed(() => store.drawingDefinitions.get(hovered.value ?? store.activeStitchId)!)
const definitions = computed(() => [...store.drawingDefinitions.values()].filter(d => d.name.includes(search.value) || (search.value === '扭针' && d.kind === 'twist') || (search.value === '麻花' && d.kind === 'cable')))
const customOpen = ref(false), customSource = ref<StitchDefinition>()
const sampleOpen = ref(false), sampleSource = ref<PatternSample>(), placementId = ref<string>()
function choose(d: StitchDefinition) { store.activeStitchId = d.id; store.activeTool = 'stitch'; store.drawingTool = 'paint' }
function edit(sample?: PatternSample, id?: string) { sampleSource.value = sample; placementId.value = id; sampleOpen.value = true }
function preset(id: string) { if (!store.drawing.convention) { store.showNotice('请先在绘图工具区选择图符读法，再预览组合花样。'); return } edit(createPreset(id, store.drawing.convention)) }
</script>
<template>
  <section class="stitch-library">
    <h2>针法库</h2>
    <p>点选针法后在格子里绘制。当前：{{ store.drawingDefinitions.get(store.activeStitchId)?.name }}</p>
    <label>查找中文针法<input v-model="search" placeholder="例如：扭针、交叉" /></label>
    <details open><summary>内置及自定义针法（{{ definitions.length }}）</summary>
      <div class="stitch-library-grid">
        <button v-for="d in definitions" :key="d.id" :title="d.name" :aria-pressed="store.activeStitchId === d.id" :class="{ active: store.activeStitchId === d.id }" @mouseenter="hovered = d.id" @mouseleave="hovered = null" @click="choose(d)"><StitchSymbol :definition="d" /><span>{{ d.name }}</span></button>
      </div>
    </details>
    <p class="stitch-selection" aria-live="polite"><strong>{{ store.drawingDefinitions.get(store.activeStitchId)?.name }}</strong><span>占 {{ store.drawingDefinitions.get(store.activeStitchId)?.span }} 格 · 消耗 {{ store.drawingDefinitions.get(store.activeStitchId)?.input }} 针 → 生成 {{ store.drawingDefinitions.get(store.activeStitchId)?.output }} 针</span></p>
    <button @click="customSource = undefined; customOpen = true">＋ 自定义针法</button>
    <button v-if="selected.custom" @click="customSource = selected; customOpen = true">另存新版针法</button>
    <StitchTutorial :definition="selected" :initially-open="false" />
    <p>{{ stitchReading(selected, store.drawing.convention) }}</p>
    <h2>花样小样</h2>
    <p>先画一小块，再复制到图解；可独立移动和修改。</p>
    <button @click="edit()">＋ 绘制小样</button>
    <details><summary>常用组合针法</summary><button v-for="p in PRESETS" :key="p.id" @click="preset(p.id)">{{ p.name }} · 预览</button></details>
    <article v-for="sample in store.drawing.samples" :key="sample.id"><strong>{{ sample.name }}</strong><small>{{ sample.width }} 针格 × {{ sample.height }} 行</small><div class="drawing-buttons"><button @click="edit(sample)">编辑</button><button @click="store.startPlacement(sample)">复制到图解</button><button @click="store.deleteSample(sample.id)">删除小样</button></div></article>
    <h3 v-if="store.drawing.placements.length">图解里的花样副本</h3>
    <article v-for="p in store.drawing.placements" :key="p.id"><strong>{{ p.name }}</strong><small>第 {{ p.x + 1 }} 针格 · 第 {{ p.y + 1 }} 行</small><div class="drawing-buttons"><button @click="store.startPlacement(p, p.id)">移动</button><button @click="edit(p, p.id)">修改针法</button><button @click="store.startPlacement(p)">再复制</button><button @click="store.removePlacement(p.id)">删除副本</button></div></article>
    <CustomStitchDialog v-if="customOpen" :source="customSource" @close="customOpen = false" />
    <PatternSampleDialog v-if="sampleOpen" :source="sampleSource" :placement-id="placementId" @close="sampleOpen = false" />
  </section>
</template>
<style scoped>
.stitch-library { padding: 12px; border-top: 1px solid #d3c9bb; }
.stitch-library h2 { font-size: 16px; margin: 12px 0 8px; }
.stitch-library summary { min-height: 44px; padding: 10px 0; }
.stitch-library article { padding: 12px 0; border-bottom: 1px solid #ddd; }
.stitch-library small { display: block; }
.stitch-library details > button { display: block; width: 100%; margin-bottom: 6px; }
.stitch-library-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; max-height: 220px; padding: 2px; margin-bottom: 8px; }
.stitch-library-grid button { flex-direction: column; justify-content: center; gap: 2px; height: 52px; padding: 3px; min-width: 44px; font-size: 11px; line-height: 14px; }
.stitch-library-grid button span { width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; }
.stitch-library-grid :deep(.stitch-symbol) { width: 28px; height: 28px; }
.stitch-selection { font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.stitch-selection strong, .stitch-selection span { display: block; }
@media (max-width: 900px) { .stitch-library { scroll-margin-top: 68px; } }
</style>
