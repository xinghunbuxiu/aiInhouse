<template>
  <div class="space-y-6">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p class="text-sm text-slate-500">AI 可读素材与装修工序知识</p>
        <h1 class="mt-2 text-2xl font-semibold text-slate-950">装修素材库</h1>
      </div>
      <button
        type="button"
        class="w-fit rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white"
        @click="startCreate"
      >
        新增素材
      </button>
    </div>

    <div class="grid gap-4 lg:grid-cols-[280px_1fr]">
      <aside class="rounded-lg border border-slate-200 bg-white p-4">
        <p class="text-sm font-semibold text-slate-950">筛选</p>
        <label class="mt-4 block text-xs font-medium text-slate-500">分类</label>
        <select v-model="filters.category" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">全部分类</option>
          <option v-for="category in categories" :key="category" :value="category">{{ categoryLabel(category) }}</option>
        </select>

        <label class="mt-4 block text-xs font-medium text-slate-500">适用空间</label>
        <select v-model="filters.sceneType" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">全部空间</option>
          <option v-for="scene in sceneTypes" :key="scene" :value="scene">{{ sceneLabel(scene) }}</option>
        </select>

        <label class="mt-4 block text-xs font-medium text-slate-500">装修风格</label>
        <select v-model="filters.style" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">全部风格</option>
          <option v-for="style in styleTypes" :key="style" :value="style">{{ style }}</option>
        </select>

        <label class="mt-4 block text-xs font-medium text-slate-500">关键词</label>
        <input v-model="filters.q" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="刷墙、沙发、厨房..." />

        <button type="button" class="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" @click="loadAssets">刷新</button>

        <div class="mt-6 rounded-lg bg-slate-50 p-3 text-xs leading-6 text-slate-600">
          每个素材都要写清楚做什么、用在哪些场景、如何放置，AI 才能在生成 3D/效果图/VR 时正确选材。
        </div>
      </aside>

      <main class="space-y-4">
        <div class="rounded-lg border border-slate-200 bg-white p-4">
          <div class="flex items-center justify-between gap-4">
            <div>
              <p class="text-sm font-semibold text-slate-950">AI 上下文</p>
              <p class="mt-1 text-xs text-slate-500">当前素材会被整理为 AI 可读 JSON，用于装配计划和渲染器。</p>
            </div>
            <button type="button" class="rounded-lg border border-slate-300 px-3 py-2 text-sm" @click="loadAiContext">查看上下文</button>
          </div>
          <pre v-if="showContext" class="mt-4 max-h-72 overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-100">{{ aiContext }}</pre>
        </div>

        <div v-if="editing" class="rounded-lg border border-slate-200 bg-white p-5">
          <div class="flex items-center justify-between">
            <p class="text-lg font-semibold text-slate-950">{{ editingExisting ? '编辑素材' : '新增素材' }}</p>
            <button type="button" class="text-sm text-slate-500" @click="cancelEdit">取消</button>
          </div>

          <div class="mt-4 grid gap-4 md:grid-cols-2">
            <label class="block text-sm">
              <span class="text-slate-600">名称</span>
              <input v-model="form.name" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label class="block text-sm">
              <span class="text-slate-600">ID</span>
              <input v-model="form.id" :disabled="editingExisting" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100" />
            </label>
            <label class="block text-sm">
              <span class="text-slate-600">分类</span>
              <select v-model="form.category" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                <option v-for="category in categories" :key="category" :value="category">{{ categoryLabel(category) }}</option>
              </select>
            </label>
            <label class="block text-sm">
              <span class="text-slate-600">适用空间，逗号分隔</span>
              <input v-model="sceneTypesText" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label class="block text-sm md:col-span-2">
              <span class="text-slate-600">用途说明</span>
              <textarea v-model="form.usage" rows="2" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"></textarea>
            </label>
            <label class="block text-sm md:col-span-2">
              <span class="text-slate-600">放置规则</span>
              <input v-model="form.placement" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="apply_to_room_floor / place_in_front_of_sofa" />
            </label>
            <label class="block text-sm md:col-span-2">
              <span class="text-slate-600">AI 说明</span>
              <textarea v-model="form.aiDescription" rows="3" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"></textarea>
            </label>
            <label class="block text-sm md:col-span-2">
              <span class="text-slate-600">标签，逗号分隔</span>
              <input v-model="tagsText" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label class="block text-sm">
              <span class="text-slate-600">装修风格，逗号分隔</span>
              <input v-model="styleTagsText" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="现代简约,奶油风,新中式" />
            </label>
            <label class="block text-sm">
              <span class="text-slate-600">国内场景标签，逗号分隔</span>
              <input v-model="domesticTagsText" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="国内户型,商品房,全屋定制" />
            </label>
            <label class="block text-sm md:col-span-2">
              <span class="text-slate-600">属性 JSON</span>
              <textarea v-model="propertiesText" rows="4" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"></textarea>
            </label>
            <label class="block text-sm md:col-span-2">
              <span class="text-slate-600">PBR 贴图 JSON</span>
              <textarea v-model="pbrTexturesText" rows="4" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"></textarea>
            </label>
            <label class="block text-sm md:col-span-2">
              <span class="text-slate-600">素材地址</span>
              <input v-model="form.assetUrl" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="/uploads/xxx.glb 或贴图 URL" />
            </label>
            <label class="block text-sm">
              <span class="text-slate-600">来源类型</span>
              <input v-model="form.sourceType" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="procedural / imported / external_catalog" />
            </label>
            <label class="block text-sm">
              <span class="text-slate-600">来源 URL</span>
              <input v-model="form.sourceUrl" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="https://..." />
            </label>
            <label class="block text-sm md:col-span-2">
              <span class="text-slate-600">授权说明</span>
              <input v-model="form.license" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="CC0 / project-owned / commercial license..." />
            </label>
            <div class="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p class="text-sm font-semibold text-slate-900">上传资源</p>
              <div class="mt-3 grid gap-3 md:grid-cols-3">
                <label class="block text-xs text-slate-600">
                  3D模型 GLB/OBJ/FBX/Blend
                  <input type="file" class="mt-2 block w-full text-xs" @change="onFileChange('modelFile', $event)" />
                </label>
                <label class="block text-xs text-slate-600">
                  材质贴图 JPG/PNG/WebP
                  <input type="file" class="mt-2 block w-full text-xs" @change="onFileChange('textureFile', $event)" />
                </label>
                <label class="block text-xs text-slate-600">
                  预览图
                  <input type="file" class="mt-2 block w-full text-xs" @change="onFileChange('previewImage', $event)" />
                </label>
              </div>
              <button type="button" class="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" @click="uploadFiles">
                {{ uploading ? '上传中...' : '上传并填入资源地址' }}
              </button>
              <div class="mt-3 grid gap-2 text-xs text-slate-500">
                <p>模型：{{ form.modelUrl || '未上传' }}</p>
                <p>贴图：{{ form.textureUrl || '未上传' }}</p>
                <p>预览：{{ form.previewUrl || '未上传' }}</p>
              </div>
            </div>
          </div>

          <button type="button" class="mt-4 rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white" @click="saveAsset">
            保存素材
          </button>
        </div>

        <div class="grid gap-4 xl:grid-cols-2">
          <article v-for="asset in assets" :key="asset.id" class="rounded-lg border border-slate-200 bg-white p-5">
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="text-lg font-semibold text-slate-950">{{ asset.name }}</p>
                <p class="mt-1 text-xs text-slate-500">{{ asset.id }} · {{ categoryLabel(asset.category) }}</p>
              </div>
              <div class="flex gap-2">
                <button type="button" class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs" @click="startEdit(asset)">编辑</button>
                <button type="button" class="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600" @click="deleteAsset(asset)">删除</button>
              </div>
            </div>
            <p class="mt-4 text-sm leading-6 text-slate-600">{{ asset.usage }}</p>
            <div class="mt-4 flex flex-wrap gap-2">
              <span v-for="scene in asset.sceneTypes" :key="scene" class="rounded-full bg-cyan-50 px-2.5 py-1 text-xs text-cyan-700">{{ sceneLabel(scene) }}</span>
              <span v-for="style in asset.styleTags" :key="style" class="rounded-full bg-rose-50 px-2.5 py-1 text-xs text-rose-700">{{ style }}</span>
              <span v-for="tag in asset.domesticTags" :key="tag" class="rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">{{ tag }}</span>
              <span v-for="tag in asset.tags" :key="tag" class="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{{ tag }}</span>
            </div>
            <div class="mt-4 rounded-lg bg-slate-50 p-3">
              <p class="text-xs font-semibold text-slate-500">AI 说明</p>
              <p class="mt-2 text-sm leading-6 text-slate-700">{{ asset.aiDescription }}</p>
              <p class="mt-2 text-xs text-slate-500">放置规则：{{ asset.placement || '未设置' }}</p>
              <p class="mt-2 text-xs text-slate-500">来源：{{ asset.sourceType || 'manual' }} · {{ asset.license || '未填写授权' }}</p>
              <div class="mt-3 flex flex-wrap gap-2 text-xs">
                <span :class="resourceBadgeClass(asset.modelUrl)">模型 {{ asset.modelUrl ? '已配置' : '缺失' }}</span>
                <span :class="resourceBadgeClass(asset.textureUrl)">贴图 {{ asset.textureUrl ? '已配置' : '缺失' }}</span>
                <span :class="resourceBadgeClass(asset.pbrTextures?.baseColor)">PBR {{ asset.pbrTextures?.baseColor ? '已补全' : '缺失' }}</span>
                <span :class="resourceBadgeClass(asset.previewUrl)">预览 {{ asset.previewUrl ? '已配置' : '缺失' }}</span>
              </div>
            </div>
          </article>
        </div>
      </main>
    </div>
  </div>
</template>

<script>
import { adminService } from '@/services/adminService'

const EMPTY_FORM = {
  id: '',
  name: '',
  category: 'furniture',
  usage: '',
  sceneTypes: [],
  placement: '',
  aiDescription: '',
  tags: [],
  styleTags: [],
  domesticTags: [],
  properties: {},
  pbrTextures: {},
  assetUrl: '',
  modelUrl: '',
  textureUrl: '',
  previewUrl: '',
  sourceType: 'manual',
  sourceUrl: '',
  license: ''
}

export default {
  name: 'DesignAssetLibrary',
  data() {
    return {
      assets: [],
      filters: { category: '', sceneType: '', style: '', q: '' },
      categories: ['wall_finish', 'floor_finish', 'ceiling_finish', 'furniture', 'lighting', 'cabinet', 'soft_decor', 'sanitary', 'opening', 'asset_source'],
      sceneTypes: ['living', 'bedroom', 'kitchen', 'bathroom', 'dining', 'balcony', 'space'],
      styleTypes: ['现代简约', '奶油风', '新中式', '现代轻奢', '北欧原木', '日式原木', '工业风'],
      editing: false,
      editingExisting: false,
      form: { ...EMPTY_FORM },
      sceneTypesText: '',
      tagsText: '',
      styleTagsText: '',
      domesticTagsText: '',
      propertiesText: '{}',
      pbrTexturesText: '{}',
      pendingFiles: {},
      uploading: false,
      showContext: false,
      aiContext: ''
    }
  },
  mounted() {
    this.loadAssets()
  },
  methods: {
    async loadAssets() {
      this.assets = await adminService.getDesignAssets(this.filters)
    },
    async loadAiContext() {
      const context = await adminService.getDesignAssetAiContext()
      this.aiContext = JSON.stringify(context, null, 2)
      this.showContext = true
    },
    startCreate() {
      this.editing = true
      this.editingExisting = false
      this.form = { ...EMPTY_FORM }
      this.sceneTypesText = 'living,bedroom,space'
      this.tagsText = ''
      this.styleTagsText = '现代简约'
      this.domesticTagsText = '国内户型,商品房'
      this.propertiesText = '{}'
      this.pbrTexturesText = '{}'
    },
    startEdit(asset) {
      this.editing = true
      this.editingExisting = true
      this.form = JSON.parse(JSON.stringify(asset))
      this.sceneTypesText = (asset.sceneTypes || []).join(',')
      this.tagsText = (asset.tags || []).join(',')
      this.styleTagsText = (asset.styleTags || []).join(',')
      this.domesticTagsText = (asset.domesticTags || []).join(',')
      this.propertiesText = JSON.stringify(asset.properties || {}, null, 2)
      this.pbrTexturesText = JSON.stringify(asset.pbrTextures || {}, null, 2)
    },
    cancelEdit() {
      this.editing = false
    },
    async saveAsset() {
      const payload = {
        ...this.form,
        sceneTypes: this.sceneTypesText.split(',').map((item) => item.trim()).filter(Boolean),
        tags: this.tagsText.split(',').map((item) => item.trim()).filter(Boolean),
        styleTags: this.styleTagsText.split(',').map((item) => item.trim()).filter(Boolean),
        domesticTags: this.domesticTagsText.split(',').map((item) => item.trim()).filter(Boolean),
        properties: JSON.parse(this.propertiesText || '{}'),
        pbrTextures: JSON.parse(this.pbrTexturesText || '{}')
      }

      if (this.editingExisting) {
        await adminService.updateDesignAsset(payload.id, payload)
      } else {
        await adminService.createDesignAsset(payload)
      }

      this.editing = false
      await this.loadAssets()
    },
    onFileChange(field, event) {
      this.pendingFiles[field] = event.target.files?.[0] || null
    },
    async uploadFiles() {
      this.uploading = true
      try {
        const result = await adminService.uploadDesignAssetFiles(this.pendingFiles)
        this.form = {
          ...this.form,
          modelUrl: result.modelUrl || this.form.modelUrl,
          textureUrl: result.textureUrl || this.form.textureUrl,
          previewUrl: result.previewUrl || this.form.previewUrl,
          assetUrl: result.modelUrl || result.textureUrl || result.previewUrl || this.form.assetUrl
        }
        this.pendingFiles = {}
      } finally {
        this.uploading = false
      }
    },
    async deleteAsset(asset) {
      if (!window.confirm(`删除素材 ${asset.name}？`)) {
        return
      }
      await adminService.deleteDesignAsset(asset.id)
      await this.loadAssets()
    },
    categoryLabel(category) {
      return {
        wall_finish: '墙面',
        floor_finish: '地面',
        ceiling_finish: '吊顶/天花',
        furniture: '家具',
        lighting: '灯光',
        cabinet: '柜体/收纳'
      }[category] || category
    },
    sceneLabel(scene) {
      return {
        living: '客厅',
        bedroom: '卧室',
        kitchen: '厨房',
        bathroom: '卫生间',
        dining: '餐厅',
        balcony: '阳台',
        space: '通用空间'
      }[scene] || scene
    },
    resourceBadgeClass(value) {
      return [
        'rounded-full px-2.5 py-1',
        value ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
      ]
    }
  }
}
</script>
