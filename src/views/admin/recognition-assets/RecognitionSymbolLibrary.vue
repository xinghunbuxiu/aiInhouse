<template>
  <div class="space-y-6">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p class="text-sm text-slate-500">平面图制图标准 · 识别图元本体</p>
        <h1 class="mt-2 text-2xl font-semibold text-slate-950">识别图例库</h1>
        <p class="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          {{ catalog.description || '按建筑制图惯例整理墙、门窗、柱、标注等图元，供识别 scanner 与人工复核共用。' }}
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="rounded-lg border border-slate-300 px-3 py-2 text-sm" @click="loadCatalog">
          刷新
        </button>
        <button type="button" class="rounded-lg border border-slate-300 px-3 py-2 text-sm" @click="showPipeline = !showPipeline">
          {{ showPipeline ? '收起解析顺序' : '查看解析顺序' }}
        </button>
      </div>
    </div>

    <div v-if="error" class="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      {{ error }}
    </div>

    <div v-if="!loading && categoryStats.length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
      <button
        v-for="item in categoryStats"
        :key="item.id"
        type="button"
        class="rounded-lg border bg-white p-3 text-left transition hover:border-slate-400"
        :class="filters.category === item.id ? 'border-slate-950 ring-1 ring-slate-950' : 'border-slate-200'"
        @click="selectCategory(item.id)"
      >
        <p class="text-xs text-slate-500">{{ item.name }}</p>
        <p class="mt-1 text-xl font-semibold text-slate-950">{{ item.count }}</p>
        <p class="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{{ item.layerLabel }}</p>
      </button>
    </div>

    <div v-if="showPipeline" class="rounded-lg border border-slate-200 bg-white p-4">
      <p class="text-sm font-semibold text-slate-950">推荐解析顺序</p>
      <p class="mt-1 text-xs text-slate-500">先排除标注噪声，再结构墙与洞口，最后空间语义与家具。</p>
      <ol class="mt-3 flex flex-wrap gap-2">
        <li
          v-for="(step, index) in catalog.parsePipeline || []"
          :key="step"
          class="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700"
        >
          {{ index + 1 }}. {{ categoryLabel(step) }}
        </li>
      </ol>
      <div class="mt-4 grid gap-2 md:grid-cols-2">
        <div
          v-for="ref in catalog.standardRefs || []"
          :key="ref.id"
          class="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600"
        >
          <span class="font-semibold text-slate-800">{{ ref.id }}</span>
          · {{ ref.name }}
          <span v-if="ref.note"> — {{ ref.note }}</span>
        </div>
      </div>
    </div>

    <div class="grid gap-4 lg:grid-cols-[280px_1fr]">
      <aside class="rounded-lg border border-slate-200 bg-white p-4">
        <p class="text-sm font-semibold text-slate-950">筛选</p>

        <label class="mt-4 block text-xs font-medium text-slate-500">分类</label>
        <select v-model="filters.category" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" @change="applyFilters">
          <option value="">全部分类</option>
          <option v-for="category in catalog.categories || []" :key="category.id" :value="category.id">
            {{ category.name }}（{{ category.symbolCount ?? countByCategory(category.id) }}）
          </option>
        </select>

        <label class="mt-4 block text-xs font-medium text-slate-500">Scanner</label>
        <select v-model="filters.scannerId" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" @change="applyFilters">
          <option value="">全部 scanner</option>
          <option v-for="scannerId in scannerIds" :key="scannerId" :value="scannerId">{{ scannerId }}</option>
        </select>

        <label class="mt-4 block text-xs font-medium text-slate-500">关键词</label>
        <input
          v-model="filters.q"
          class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="承重墙、门弧、尺寸线..."
          @keyup.enter="applyFilters"
        />

        <button type="button" class="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" @click="applyFilters">
          应用筛选
        </button>

        <div class="mt-6 space-y-2">
          <p class="text-xs font-medium text-slate-500">分类说明</p>
          <button
            v-for="category in catalog.categories || []"
            :key="`desc-${category.id}`"
            type="button"
            class="block w-full rounded-lg px-3 py-2 text-left text-xs leading-5 transition"
            :class="filters.category === category.id ? 'bg-slate-950 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'"
            @click="selectCategory(category.id)"
          >
            <span class="font-semibold">{{ category.name }}</span>
            <span class="mt-1 block opacity-80">{{ category.description }}</span>
          </button>
        </div>
      </aside>

      <main class="space-y-4">
        <div class="flex items-center justify-between text-sm text-slate-500">
          <span>共 {{ filteredSymbols.length }} 个图元 · 资产版本 {{ catalog.version || '-' }}</span>
          <span v-if="catalog.updatedAt">更新于 {{ formatDate(catalog.updatedAt) }}</span>
        </div>

        <div v-if="loading" class="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          正在加载识别资产...
        </div>

        <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <button
            v-for="symbol in filteredSymbols"
            :key="symbol.id"
            type="button"
            class="rounded-lg border bg-white p-4 text-left transition hover:border-slate-400"
            :class="selectedId === symbol.id ? 'border-slate-950 ring-1 ring-slate-950' : 'border-slate-200'"
            @click="selectSymbol(symbol.id)"
          >
            <div class="flex h-28 items-center justify-center rounded-md bg-slate-50" v-html="symbol.glyphSvg"></div>
            <div class="mt-3 flex items-start justify-between gap-2">
              <div>
                <p class="font-semibold text-slate-950">{{ symbol.name }}</p>
                <p class="mt-1 text-xs text-slate-500">{{ symbol.id }}</p>
              </div>
              <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                {{ categoryLabel(symbol.category) }}
              </span>
            </div>
            <p class="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">{{ symbol.commercialNotes }}</p>
          </button>
        </div>

        <div v-if="selected" class="rounded-lg border border-slate-200 bg-white p-5">
          <div class="flex flex-col gap-4 lg:flex-row">
            <div class="flex h-40 w-full items-center justify-center rounded-lg bg-slate-50 lg:w-56" v-html="selected.glyphSvg"></div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <h2 class="text-xl font-semibold text-slate-950">{{ selected.name }}</h2>
                <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{{ categoryLabel(selected.category) }}</span>
                <span class="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">{{ selected.modelRole }}</span>
              </div>
              <p class="mt-2 text-sm text-slate-600">{{ selected.commercialNotes }}</p>
              <div class="mt-3 flex flex-wrap gap-2">
                <span
                  v-for="alias in selected.aliases || []"
                  :key="alias"
                  class="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600"
                >{{ alias }}</span>
              </div>
            </div>
          </div>

          <div class="mt-5 grid gap-4 md:grid-cols-2">
            <section class="rounded-lg bg-slate-50 p-4">
              <p class="text-sm font-semibold text-slate-950">绘制规则</p>
              <dl class="mt-3 space-y-2 text-xs leading-5 text-slate-600">
                <div><dt class="inline font-medium text-slate-800">线型：</dt><dd class="inline">{{ selected.drawingRules?.lineStyle || '-' }}</dd></div>
                <div><dt class="inline font-medium text-slate-800">相对厚度：</dt><dd class="inline">{{ selected.drawingRules?.relativeThickness || '-' }}</dd></div>
                <div><dt class="inline font-medium text-slate-800">填充：</dt><dd class="inline">{{ selected.drawingRules?.fill || '-' }}</dd></div>
                <div>
                  <dt class="font-medium text-slate-800">常见变体</dt>
                  <dd class="mt-1 flex flex-wrap gap-1">
                    <span
                      v-for="variant in selected.drawingRules?.commonVariants || []"
                      :key="variant"
                      class="rounded bg-white px-2 py-0.5 text-slate-700"
                    >{{ variant }}</span>
                  </dd>
                </div>
              </dl>
            </section>

            <section class="rounded-lg bg-slate-50 p-4">
              <p class="text-sm font-semibold text-slate-950">识别提示</p>
              <dl class="mt-3 space-y-2 text-xs leading-5 text-slate-600">
                <div>
                  <dt class="font-medium text-slate-800">视觉特征</dt>
                  <dd class="mt-1 flex flex-wrap gap-1">
                    <span
                      v-for="feature in selected.recognitionHints?.visualFeatures || []"
                      :key="feature"
                      class="rounded bg-white px-2 py-0.5 text-slate-700"
                    >{{ feature }}</span>
                  </dd>
                </div>
                <div>
                  <dt class="font-medium text-slate-800">几何先验</dt>
                  <dd class="mt-1 flex flex-wrap gap-1">
                    <span
                      v-for="prior in selected.recognitionHints?.geometryPriors || []"
                      :key="prior"
                      class="rounded bg-white px-2 py-0.5 text-slate-700"
                    >{{ prior }}</span>
                  </dd>
                </div>
                <div>
                  <dt class="font-medium text-slate-800">应拒绝</dt>
                  <dd class="mt-1 flex flex-wrap gap-1">
                    <span
                      v-for="reject in selected.recognitionHints?.rejectIf || []"
                      :key="reject"
                      class="rounded bg-rose-50 px-2 py-0.5 text-rose-700"
                    >{{ reject }}</span>
                    <span v-if="!(selected.recognitionHints?.rejectIf || []).length" class="text-slate-400">无</span>
                  </dd>
                </div>
                <div>
                  <dt class="inline font-medium text-slate-800">绑定 scanner：</dt>
                  <dd class="inline">{{ (selected.scannerIds || []).join(', ') || '-' }}</dd>
                </div>
                <div>
                  <dt class="inline font-medium text-slate-800">输出字段：</dt>
                  <dd class="inline">{{ selected.outputField || '-' }}</dd>
                </div>
              </dl>
            </section>
          </div>

          <div v-if="(selected.related || []).length" class="mt-5">
            <p class="text-sm font-semibold text-slate-950">同类图元</p>
            <div class="mt-2 flex flex-wrap gap-2">
              <button
                v-for="item in selected.related"
                :key="item.id"
                type="button"
                class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:border-slate-400"
                @click="selectSymbol(item.id)"
              >
                {{ item.name }}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<script>
import adminService from '@/services/adminService'

export default {
  name: 'RecognitionSymbolLibrary',
  data() {
    return {
      loading: false,
      error: '',
      showPipeline: true,
      catalog: {
        version: '',
        description: '',
        categories: [],
        parsePipeline: [],
        standardRefs: [],
        symbols: []
      },
      filters: {
        category: '',
        scannerId: '',
        q: ''
      },
      filteredSymbols: [],
      selectedId: '',
      selected: null
    }
  },
  computed: {
    categoryStats() {
      const layerLabels = {
        structural: '结构层',
        openings: '洞口层',
        spaces: '空间层',
        symbols: '图例层',
        evidence: '证据层'
      }
      return (this.catalog.categories || [])
        .map((category) => ({
          id: category.id,
          name: category.name,
          layer: category.layer,
          layerLabel: layerLabels[category.layer] || category.layer || '',
          count: category.symbolCount ?? this.countByCategory(category.id)
        }))
        .filter((item) => item.count > 0)
        .sort((a, b) => b.count - a.count)
    },
    scannerIds() {
      const ids = new Set()
      for (const symbol of this.catalog.symbols || []) {
        for (const scannerId of symbol.scannerIds || []) {
          ids.add(scannerId)
        }
      }
      return [...ids].sort()
    }
  },
  async created() {
    await this.loadCatalog()
  },
  methods: {
    categoryLabel(id) {
      const found = (this.catalog.categories || []).find((item) => item.id === id)
      return found?.name || id
    },
    countByCategory(categoryId) {
      return (this.catalog.symbols || []).filter((item) => item.category === categoryId).length
    },
    formatDate(value) {
      if (!value) return '-'
      try {
        return new Date(value).toLocaleString()
      } catch (error) {
        return value
      }
    },
    async loadCatalog() {
      this.loading = true
      this.error = ''
      try {
        const data = await adminService.getRecognitionAssets()
        this.catalog = {
          ...data,
          symbols: data.symbols || []
        }
        // enrich category counts if missing
        this.catalog.categories = (data.categories || []).map((category) => ({
          ...category,
          symbolCount: category.symbolCount ?? this.countByCategory(category.id)
        }))
        this.applyFilters()
        if (!this.selectedId && this.filteredSymbols[0]) {
          await this.selectSymbol(this.filteredSymbols[0].id)
        }
      } catch (error) {
        this.error = error?.response?.data?.message || error.message || '加载识别资产失败'
      } finally {
        this.loading = false
      }
    },
    applyFilters() {
      const keyword = String(this.filters.q || '').trim().toLowerCase()
      this.filteredSymbols = (this.catalog.symbols || []).filter((symbol) => {
        if (this.filters.category && symbol.category !== this.filters.category) return false
        if (this.filters.scannerId && !(symbol.scannerIds || []).includes(this.filters.scannerId)) return false
        if (!keyword) return true
        const haystack = [
          symbol.id,
          symbol.name,
          ...(symbol.aliases || []),
          symbol.modelRole,
          symbol.commercialNotes,
          ...(symbol.recognitionHints?.visualFeatures || [])
        ].join(' ').toLowerCase()
        return haystack.includes(keyword)
      })
    },
    selectCategory(categoryId) {
      this.filters.category = this.filters.category === categoryId ? '' : categoryId
      this.applyFilters()
    },
    async selectSymbol(id) {
      this.selectedId = id
      try {
        this.selected = await adminService.getRecognitionAsset(id)
      } catch (error) {
        this.selected = (this.catalog.symbols || []).find((item) => item.id === id) || null
      }
    }
  }
}
</script>
