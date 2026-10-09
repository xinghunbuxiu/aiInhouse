<template>
  <div class="mx-auto max-w-7xl space-y-6">
    <div class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div class="flex flex-col gap-4 2xl:flex-row 2xl:items-end 2xl:justify-between">
        <div>
          <h2 class="text-2xl font-bold text-slate-900">
            {{ isEdit ? '编辑平面图' : '上传平面图' }}
          </h2>
          <p class="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
            先选择 2D 户型图识别墙体、房间、门窗和阳台等空间语义；确认识别结果后，再继续生成 3D 和全景交付。
          </p>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-2 2xl:w-[520px] 2xl:grid-cols-4">
          <div
            v-for="(item, index) in serialGuideCards"
            :key="item.key"
            class="rounded-2xl border border-slate-200 bg-slate-50 p-4"
          >
            <p class="text-xs uppercase tracking-[0.22em] text-slate-400">Stage {{ index + 1 }}</p>
            <p class="mt-2 text-sm font-semibold text-slate-900">{{ item.label }}</p>
            <p class="mt-2 text-xs leading-5 text-slate-500">{{ item.description }}</p>
          </div>
        </div>
      </div>
    </div>

    <div class="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
      <div class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <form @submit.prevent="handleSubmit" class="space-y-6">
        <div class="grid gap-4 md:grid-cols-3">
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700">楼盘筛选</label>
            <select
              v-model="filters.buildingId"
              class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              @change="handleBuildingChange"
            >
              <option value="">全部楼盘</option>
              <option v-for="building in buildings" :key="building.id" :value="String(building.id)">
                {{ building.name }}
              </option>
            </select>
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700">楼栋筛选</label>
            <select
              v-model="filters.blockId"
              :disabled="!filters.buildingId"
              class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
              @change="handleFloorFilterChange"
            >
              <option value="">全部楼栋</option>
              <option v-for="block in blocks" :key="block.id" :value="String(block.id)">
                {{ block.blockNumber }} 栋
              </option>
            </select>
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700">楼层筛选</label>
            <select
              v-model="filters.floorNumber"
              class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">全部楼层</option>
              <option v-for="floor in floorOptions" :key="floor" :value="String(floor)">
                {{ floor }} 层
              </option>
            </select>
          </div>
        </div>

        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700">所属房屋 *</label>
          <select
            v-model="form.houseId"
            required
            class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">请选择房屋</option>
            <option v-for="house in filteredHouses" :key="house.id" :value="String(house.id)">
              {{ house.locationLabel }}
            </option>
          </select>
          <p class="mt-2 text-xs text-gray-500">
            当前可选 {{ filteredHouses.length }} 套房屋。先按楼盘、楼栋、楼层筛选，会更容易找到对应户型。
          </p>
          <p v-if="filteredHouses.length === 0" class="mt-2 text-sm text-amber-600">
            这一层还没有房屋资料，请先去房屋管理补录楼层和房号。
          </p>
        </div>

        <div v-if="sameFloorReferencePlans.length > 0" class="rounded-lg border border-cyan-200 bg-cyan-50 p-4">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h3 class="font-semibold text-cyan-900">同楼层可参考的平面图</h3>
              <p class="mt-1 text-sm text-cyan-700">系统已根据楼盘、楼栋、楼层匹配到已有图纸，可用于核对当前房屋是否已有对应楼层平面图。</p>
            </div>
            <span class="rounded-full bg-white px-3 py-1 text-xs text-cyan-700">{{ sameFloorReferencePlans.length }} 份参考图</span>
          </div>
          <div class="mt-4 grid gap-3 md:grid-cols-2">
            <router-link
              v-for="plan in sameFloorReferencePlans"
              :key="plan.id"
              :to="`/admin/floor-plans/${plan.id}`"
              class="rounded-xl border border-cyan-200 bg-white p-4 transition hover:border-cyan-300 hover:bg-cyan-100/40"
            >
              <p class="font-medium text-gray-900">{{ plan.name || '未命名平面图' }}</p>
              <p class="mt-1 text-sm text-gray-600">{{ plan.locationLabel }}</p>
              <div class="mt-3 flex flex-wrap gap-2 text-xs">
                <span :class="['rounded-full px-2 py-1', plan.parseOk ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700']">
                  解析 {{ plan.parseOk ? 'OK' : '待确认' }}
                </span>
                <span :class="['rounded-full px-2 py-1', plan.threeDOk ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600']">
                  3D {{ plan.threeDOk ? 'OK' : '未生成' }}
                </span>
                <span :class="['rounded-full px-2 py-1', plan.panoramaOk ? 'bg-fuchsia-100 text-fuchsia-700' : 'bg-slate-100 text-slate-600']">
                  全景 {{ plan.panoramaOk ? 'OK' : '未生成' }}
                </span>
              </div>
            </router-link>
          </div>
        </div>

        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700">平面图名称 *</label>
          <input
            v-model="form.name"
            type="text"
            required
            class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="例如：原始平面图、装修方案A"
          />
        </div>

        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700">图纸来源</label>
          <div class="grid gap-3 md:grid-cols-2">
            <button
              type="button"
              @click="form.sourceType = 'digital'"
              :class="[
                'rounded-xl border p-4 text-left transition-colors',
                form.sourceType === 'digital' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'
              ]"
            >
              <p class="font-medium text-gray-900">电子图纸</p>
              <p class="mt-1 text-sm text-gray-500">适合 CAD 导出图、扫描件、开发商原始户型图</p>
            </button>
            <button
              type="button"
              @click="form.sourceType = 'hand_drawn'"
              :class="[
                'rounded-xl border p-4 text-left transition-colors',
                form.sourceType === 'hand_drawn' ? 'border-amber-500 bg-amber-50' : 'border-gray-200 bg-white hover:border-gray-300'
              ]"
            >
              <p class="font-medium text-gray-900">手绘草图</p>
              <p class="mt-1 text-sm text-gray-500">上传后优先走“转正式平面图”解析逻辑，适合物业补录和入户手记</p>
            </button>
          </div>
        </div>

        <div v-if="!isEdit">
          <label class="mb-2 block text-sm font-medium text-gray-700">上传平面图 *</label>
          <div
            class="cursor-pointer rounded-2xl border-2 border-dashed border-slate-300 bg-[radial-gradient(circle_at_top,#eff6ff_0%,#ffffff_68%)] p-8 text-center transition-colors hover:border-blue-500"
            @click="triggerFileInput"
            @drop.prevent="handleDrop"
            @dragover.prevent
          >
            <input
              ref="fileInput"
              type="file"
              accept="image/*,application/pdf"
              class="hidden"
              @change="handleFileChange"
            />
            <div v-if="!selectedFile" class="space-y-2">
              <span class="text-4xl">📤</span>
              <p class="text-gray-700">点击或拖拽文件到此处上传</p>
              <p class="text-sm text-gray-400">支持 JPG、PNG、PDF 格式，建议优先上传清晰原图</p>
            </div>
            <div v-else class="space-y-2">
              <span class="text-4xl">📄</span>
              <p class="font-medium text-gray-800">{{ selectedFile.name }}</p>
              <p class="text-sm text-gray-500">{{ formatFileSize(selectedFile.size) }}</p>
              <button type="button" @click.stop="clearFile" class="text-sm text-red-500 hover:text-red-700">
                移除文件
              </button>
            </div>
          </div>
        </div>

        <div v-if="!isEdit" class="rounded-lg bg-blue-50 p-4">
          <h3 class="mb-3 font-semibold text-blue-800">2D 识别选项</h3>
          <div class="space-y-3">
            <div class="flex items-center">
              <input id="autoParse" v-model="form.autoParse" type="checkbox" class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              <label for="autoParse" class="ml-2 text-sm text-gray-700">上传后立即识别墙体、房间、门窗、阳台和客厅等空间</label>
            </div>
            <div class="flex items-center">
              <input id="generate3D" v-model="form.generate3D" type="checkbox" class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              <label for="generate3D" class="ml-2 text-sm text-gray-700">识别完成后继续生成全屋 3D 图与 3D 配置</label>
            </div>
            <div class="flex items-center">
              <input id="generatePanorama" v-model="form.generatePanorama" type="checkbox" class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              <label for="generatePanorama" class="ml-2 text-sm text-gray-700">识别完成后继续生成全景配置数据</label>
            </div>
          </div>
        </div>

        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700">识别补充说明</label>
          <textarea
            v-model="form.processNotes"
            rows="3"
            class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            :placeholder="form.sourceType === 'hand_drawn' ? '例如：手绘图存在比例误差，请按三室两厅一卫识别；主卧朝南，厨房连生活阳台。' : '可选填写：例如重点识别门窗、阳台、承重墙等。'"
          />
        </div>

        <div v-if="form.generate3D || form.generatePanorama">
          <label class="mb-2 block text-sm font-medium text-gray-700">材质风格</label>
          <div class="grid grid-cols-2 gap-3 md:grid-cols-5">
            <button
              v-for="style in materialStyles"
              :key="style.value"
              type="button"
              @click="form.materialStyle = style.value"
              :class="[
                'rounded-lg border-2 p-3 text-center transition-colors',
                form.materialStyle === style.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
              ]"
            >
              <span class="mb-1 block text-2xl">{{ style.icon }}</span>
              <span class="text-sm">{{ style.label }}</span>
            </button>
          </div>
        </div>

        <div v-if="isProcessing" class="rounded-lg bg-gray-50 p-4">
          <h3 class="mb-3 font-semibold text-gray-800">处理进度</h3>
          <div class="space-y-3">
            <div v-for="(step, index) in processingSteps" :key="index" class="flex items-center">
              <span
                :class="[
                  'mr-3 flex h-6 w-6 items-center justify-center rounded-full text-sm',
                  step.status === 'completed' ? 'bg-green-500 text-white' : '',
                  step.status === 'processing' ? 'bg-blue-500 text-white' : '',
                  step.status === 'pending' ? 'bg-gray-300 text-gray-600' : ''
                ]"
              >
                {{ step.status === 'completed' ? '✓' : step.status === 'processing' ? '⟳' : index + 1 }}
              </span>
              <span :class="step.status === 'processing' ? 'text-sm font-medium text-gray-800' : 'text-sm text-gray-600'">
                {{ step.name }}
              </span>
            </div>
          </div>
        </div>

        <div v-if="!isEdit" class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          默认只创建 2D 识别任务：先抓墙体、房间、门窗，并标出阳台/客厅等语义结果。需要 3D 或全景时，可在识别结果页继续提交。
        </div>

        <div class="flex flex-col gap-4 sm:flex-row">
          <button
            type="submit"
            :disabled="isSubmitting || isProcessing || (!isEdit && !selectedFile)"
            class="flex-1 rounded-lg bg-blue-500 px-4 py-3 text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {{ isSubmitting || isProcessing ? '处理中...' : isEdit ? '保存修改' : '上传并识别 2D 图' }}
          </button>
          <router-link
            to="/admin/floor-plans"
            class="flex-1 rounded-lg bg-gray-300 px-4 py-3 text-center text-gray-700 transition-colors hover:bg-gray-400"
          >
            取消
          </router-link>
        </div>
        </form>
      </div>

      <div class="space-y-6">
        <div class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 class="text-lg font-semibold text-slate-900">当前房屋摘要</h3>
          <div class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <div class="rounded-2xl bg-slate-50 p-4">
              <p class="text-sm text-slate-500">所属房屋</p>
              <p class="mt-2 text-sm font-medium leading-6 text-slate-900">{{ selectedHouseLabel }}</p>
            </div>
            <div class="rounded-2xl bg-slate-50 p-4">
              <p class="text-sm text-slate-500">图纸来源</p>
              <p class="mt-2 text-sm font-medium text-slate-900">{{ form.sourceType === 'hand_drawn' ? '手绘草图' : '电子图纸' }}</p>
            </div>
            <div class="rounded-2xl bg-slate-50 p-4">
              <p class="text-sm text-slate-500">材质风格</p>
              <p class="mt-2 text-sm font-medium text-slate-900">{{ currentMaterialStyleLabel }}</p>
            </div>
            <div class="rounded-2xl bg-slate-50 p-4">
              <p class="text-sm text-slate-500">推荐链路</p>
              <p class="mt-2 text-sm leading-6 text-slate-900">{{ recommendedPipelineText }}</p>
            </div>
          </div>
        </div>

        <div class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h3 class="text-lg font-semibold text-slate-900">同楼层参考图</h3>
              <p class="mt-1 text-sm text-slate-500">优先查找同楼层已有图纸，避免重复上传。</p>
            </div>
            <span class="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{{ sameFloorReferencePlans.length }} 份</span>
          </div>
          <div v-if="sameFloorReferencePlans.length === 0" class="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-500">
            当前还没有找到同楼层可复用的平面图。你可以先上传原始图，再通过桌面端串行生成 CAD / 全屋 3D / 全景结果。
          </div>
          <div v-else class="mt-4 space-y-3">
            <router-link
              v-for="plan in sameFloorReferencePlans"
              :key="plan.id"
              :to="`/admin/floor-plans/${plan.id}`"
              class="block rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-slate-300 hover:bg-slate-100"
            >
              <p class="font-medium text-slate-900">{{ plan.name || '未命名平面图' }}</p>
              <p class="mt-1 text-sm text-slate-500">{{ plan.locationLabel }}</p>
              <div class="mt-3 flex flex-wrap gap-2 text-xs">
                <span :class="['rounded-full px-2 py-1', plan.parseOk ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700']">
                  解析 {{ plan.parseOk ? 'OK' : '待确认' }}
                </span>
                <span :class="['rounded-full px-2 py-1', plan.cadOk ? 'bg-slate-200 text-slate-700' : 'bg-slate-100 text-slate-500']">
                  CAD {{ plan.cadOk ? 'OK' : '未生成' }}
                </span>
                <span :class="['rounded-full px-2 py-1', plan.threeDOk ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600']">
                  3D {{ plan.threeDOk ? 'OK' : '未生成' }}
                </span>
                <span :class="['rounded-full px-2 py-1', plan.panoramaOk ? 'bg-fuchsia-100 text-fuchsia-700' : 'bg-slate-100 text-slate-600']">
                  全景 {{ plan.panoramaOk ? 'OK' : '未生成' }}
                </span>
              </div>
            </router-link>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { adminService } from '@/services/adminService'

function createPipelineStage(status, message = '') {
  return {
    status,
    message,
    updatedAt: new Date().toISOString()
  }
}

export default {
  name: 'FloorPlanForm',
  data() {
    return {
      buildings: [],
      blocks: [],
      houses: [],
      floorPlans: [],
      filters: {
        buildingId: '',
        blockId: '',
        floorNumber: ''
      },
      materialStyles: [
        { value: 'modern', label: '现代', icon: '🏢' },
        { value: 'classic', label: '经典', icon: '🏛️' },
        { value: 'minimalist', label: '极简', icon: '⬜' },
        { value: 'industrial', label: '工业', icon: '🏭' },
        { value: 'scandinavian', label: '北欧', icon: '🌲' }
      ],
      form: {
        houseId: '',
        name: '',
        sourceType: 'digital',
        processNotes: '',
        autoParse: true,
        generate3D: false,
        generatePanorama: false,
        materialStyle: 'modern'
      },
      selectedFile: null,
      isProcessing: false,
      isSubmitting: false,
      processingSteps: [
        { name: '上传 2D 户型图', status: 'pending' },
        { name: '创建 2D 识别任务', status: 'pending' },
        { name: '等待桌面 Worker 识别墙体/房间/门窗', status: 'pending' },
        { name: '可选生成全屋 3D 图', status: 'pending' },
        { name: '可选生成全景配置', status: 'pending' }
      ]
    }
  },
  computed: {
    serialGuideCards() {
      return [
        { key: 'source', label: '选择 2D 图', description: '上传开发商原图、扫描件或手绘稿。' },
        { key: 'recognition', label: '识别结构', description: '抓墙体、房间、门窗和阳台候选。' },
        { key: 'review', label: '复核语义', description: '重点核对阳台、客厅、餐厅等空间名称。' },
        { key: 'threeD', label: '进入 3D', description: '确认 2D 识别后再生成 3D 和全景。' }
      ]
    },
    isEdit() {
      return this.$route.params.id !== undefined
    },
    filteredHouses() {
      return this.houses.filter((house) => {
        const buildingMatched = !this.filters.buildingId || String(house.building_id) === String(this.filters.buildingId)
        const blockMatched = !this.filters.blockId || String(house.block_id) === String(this.filters.blockId)
        const floorMatched = !this.filters.floorNumber || String(house.floor) === String(this.filters.floorNumber)

        return buildingMatched && blockMatched && floorMatched
      })
    },
    floorOptions() {
      const floors = this.houses
        .filter((house) => {
          const buildingMatched = !this.filters.buildingId || String(house.building_id) === String(this.filters.buildingId)
          const blockMatched = !this.filters.blockId || String(house.block_id) === String(this.filters.blockId)
          return buildingMatched && blockMatched && house.floor !== null && house.floor !== undefined && house.floor !== ''
        })
        .map((house) => Number(house.floor))
        .filter((value) => !Number.isNaN(value))

      return [...new Set(floors)].sort((a, b) => b - a)
    },
    selectedHouseLabel() {
      const house = this.houses.find((item) => String(item.id) === String(this.form.houseId))
      return house ? house.locationLabel : '未关联房屋'
    },
    selectedHouse() {
      return this.houses.find((item) => String(item.id) === String(this.form.houseId)) || null
    },
    currentMaterialStyleLabel() {
      return this.materialStyles.find((item) => item.value === this.form.materialStyle)?.label || '现代'
    },
    recommendedPipelineText() {
      if (this.form.sourceType === 'hand_drawn') {
        return '先识别手绘图中的墙体闭合关系、房间边界和空间名称，确认后再进入 3D。'
      }

      return '先识别电子图纸中的墙体、房间、门窗、阳台和客厅；识别结果确认后再继续生成 3D。'
    },
    sameFloorReferencePlans() {
      if (!this.selectedHouse) {
        return []
      }

      return this.floorPlans
        .filter((plan) => {
          if (String(plan.house_id) === String(this.selectedHouse.id)) {
            return false
          }

          const sameBuilding = String(plan.building_id || '') === String(this.selectedHouse.building_id || '')
          const sameBlock = String(plan.block_id || '') === String(this.selectedHouse.block_id || '')
          const sameFloor = String(plan.floorNumber || '') === String(this.selectedHouse.floor || '')
          return sameBuilding && sameBlock && sameFloor
        })
        .slice(0, 4)
    }
  },
  async mounted() {
    await this.bootstrapOptions()

    const houseId = this.$route.query.houseId
    const buildingId = this.$route.query.buildingId
    const blockId = this.$route.query.blockId
    const floorNumber = this.$route.query.floorNumber

    if (buildingId && !this.isEdit) {
      this.filters.buildingId = String(buildingId)
      await this.fetchBlocks(this.filters.buildingId)
    }

    if (blockId && !this.isEdit) {
      this.filters.blockId = String(blockId)
    }

    if (floorNumber && !this.isEdit) {
      this.filters.floorNumber = String(floorNumber)
    }

    if (houseId && !this.isEdit) {
      this.form.houseId = String(houseId)
      this.syncFiltersFromSelectedHouse()
    }

    if (this.isEdit) {
      await this.fetchFloorPlan()
    }
  },
  methods: {
    async bootstrapOptions() {
      await Promise.all([
        this.fetchBuildings(),
        this.fetchHouses(),
        this.fetchFloorPlans()
      ])
    },
    async fetchBuildings() {
      try {
        this.buildings = await adminService.getBuildings()
      } catch (error) {
        console.error('获取楼盘列表失败:', error)
      }
    },
    async fetchHouses() {
      try {
        this.houses = await adminService.getHouses()
      } catch (error) {
        console.error('获取房屋列表失败:', error)
      }
    },
    async fetchFloorPlans() {
      try {
        this.floorPlans = await adminService.getFloorPlans()
      } catch (error) {
        console.error('获取平面图列表失败:', error)
      }
    },
    async handleBuildingChange() {
      this.filters.blockId = ''
      this.filters.floorNumber = ''

      if (!this.filters.buildingId) {
        this.blocks = []
      } else {
        await this.fetchBlocks(this.filters.buildingId)
      }

      if (!this.filteredHouses.some((house) => String(house.id) === String(this.form.houseId))) {
        this.form.houseId = ''
      }
    },
    handleFloorFilterChange() {
      this.filters.floorNumber = ''

      if (!this.filteredHouses.some((house) => String(house.id) === String(this.form.houseId))) {
        this.form.houseId = ''
      }
    },
    async fetchBlocks(buildingId) {
      try {
        this.blocks = await adminService.getBlocksByBuilding(buildingId)
      } catch (error) {
        console.error('获取楼栋列表失败:', error)
        this.blocks = []
      }
    },
    async syncFiltersFromSelectedHouse() {
      const house = this.selectedHouse
      if (!house) {
        return
      }

      this.filters.buildingId = String(house.building_id || '')

      if (this.filters.buildingId) {
        await this.fetchBlocks(this.filters.buildingId)
      }

      this.filters.blockId = house.block_id ? String(house.block_id) : ''
      this.filters.floorNumber = house.floor ? String(house.floor) : ''
    },
    async fetchFloorPlan() {
      try {
        const floorPlan = await adminService.getFloorPlan(this.$route.params.id)
        this.form = {
          houseId: String(floorPlan.house_id),
          name: floorPlan.name || '',
          sourceType: floorPlan.sourceType || 'digital',
          processNotes: floorPlan.processNotes || '',
          autoParse: floorPlan.parse_status === 'completed',
          generate3D: true,
          generatePanorama: Boolean(floorPlan.panoramaUrl),
          materialStyle: 'modern'
        }
        await this.syncFiltersFromSelectedHouse()
      } catch (error) {
        console.error('获取平面图信息失败:', error)
      }
    },
    triggerFileInput() {
      this.$refs.fileInput.click()
    },
    handleFileChange(event) {
      const file = event.target.files[0]
      if (file) {
        this.selectedFile = file
      }
    },
    handleDrop(event) {
      const file = event.dataTransfer.files[0]
      if (file && (file.type.startsWith('image/') || file.type === 'application/pdf')) {
        this.selectedFile = file
      }
    },
    clearFile() {
      this.selectedFile = null
      this.$refs.fileInput.value = ''
    },
    formatFileSize(bytes) {
      if (bytes === 0) {
        return '0 Bytes'
      }
      const k = 1024
      const sizes = ['Bytes', 'KB', 'MB', 'GB']
      const i = Math.floor(Math.log(bytes) / Math.log(k))
      return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
    },
    async handleSubmit() {
      if (!this.isEdit && !this.selectedFile) {
        alert('请选择要上传的平面图文件')
        return
      }

      this.isSubmitting = true

      try {
        if (this.isEdit) {
          const currentFloorPlan = await adminService.getFloorPlan(this.$route.params.id)
          await adminService.updateFloorPlan(this.$route.params.id, {
            house_id: this.form.houseId,
            name: this.form.name,
            parse_result: JSON.stringify({
              ...(currentFloorPlan.parseData || {}),
              meta: {
                sourceType: this.form.sourceType,
                convertedToFormal: this.form.sourceType === 'hand_drawn',
                processNotes: this.form.processNotes || '',
                updatedAt: new Date().toISOString()
              }
            })
          })
          this.$router.push('/admin/floor-plans')
        } else {
          await this.processFloorPlan()
        }
      } catch (error) {
        console.error('保存平面图失败:', error)
        alert(error.response?.data?.message || '保存失败')
      } finally {
        this.isSubmitting = false
      }
    },
    async processFloorPlan() {
      this.isProcessing = true
      this.processingSteps.forEach((step) => {
        step.status = 'pending'
      })

      let floorPlanId = null
      let parseResult = null

      try {
        this.processingSteps[0].status = 'processing'
        const uploadResult = await adminService.uploadFloorPlan(this.selectedFile)
        this.processingSteps[0].status = 'completed'

        const createResult = await adminService.createFloorPlan({
          house_id: this.form.houseId,
          name: this.form.name,
          image_url: uploadResult.publicPath || uploadResult.path,
          thumbnail_url: uploadResult.publicPath || uploadResult.path,
          file_size: uploadResult.size,
          file_type: uploadResult.mimetype,
          parse_status: this.form.autoParse ? 'processing' : 'pending',
          parse_result: JSON.stringify({
            meta: {
              sourceType: this.form.sourceType,
              convertedToFormal: this.form.sourceType === 'hand_drawn',
              processNotes: this.form.processNotes || '',
              processedAt: new Date().toISOString(),
              pipeline: {
                parse: createPipelineStage('pending', this.form.autoParse ? '等待桌面 Worker 识别 2D 图纸' : '未启用自动识别'),
                cad: createPipelineStage('pending', '等待 2D 识别结果确认后生成 CAD / 正式图'),
                threeD: createPipelineStage(this.form.generate3D ? 'pending' : 'pending', this.form.generate3D ? '等待生成全屋 3D 装修效果' : '未启用 3D 生成'),
                panorama: createPipelineStage(this.form.generatePanorama ? 'pending' : 'pending', this.form.generatePanorama ? '等待生成全景 VR 配置' : '未启用全景生成')
              }
            }
          })
        })

        floorPlanId = createResult.data.id

        this.processingSteps[1].status = 'processing'
        const jobType = this.form.generate3D || this.form.generatePanorama ? 'full_pipeline' : 'parse_floor_plan'
        const jobResult = await adminService.createAiJob({
          floor_plan_id: floorPlanId,
          job_type: jobType,
          priority: 80,
          input_payload: {
            sourceType: this.form.sourceType,
            processNotes: this.form.processNotes || '',
            style: this.form.materialStyle,
            autoParse: this.form.autoParse,
            generate3D: this.form.generate3D,
            generatePanorama: this.form.generatePanorama,
            targetOutputs: [
              'formal_plan',
              'cad',
              ...(this.form.generate3D ? ['decorated_3d_effect'] : []),
              ...(this.form.generatePanorama ? ['panorama_vr'] : [])
            ],
            sourceFile: {
              url: uploadResult.url,
              publicPath: uploadResult.publicPath,
              mimetype: uploadResult.mimetype,
              size: uploadResult.size
            }
          }
        })
        this.processingSteps[1].status = 'completed'
        this.processingSteps[2].status = 'completed'
        if (this.form.generate3D) {
          this.processingSteps[3].status = 'processing'
        }
        if (this.form.generatePanorama) {
          this.processingSteps[4].status = 'processing'
        }

        alert(`2D 图已上传，已创建 ${jobResult.data?.job_no || '识别'} 任务。桌面 Worker 完成后会回传墙体、房间、门窗和语义识别结果。`)
        this.$router.push(`/admin/floor-plans/${floorPlanId}`)
      } catch (error) {
        console.error('平面图处理失败:', error)
        if (floorPlanId) {
          try {
            const failedResult = parseResult
              ? {
                  ...parseResult,
                  meta: {
                    ...(parseResult.meta || {}),
                    pipeline: {
                      ...(parseResult.meta?.pipeline || {}),
                      parse: this.processingSteps[1].status === 'processing' ? createPipelineStage('failed', error.message || 'AI 解析失败') : (parseResult.meta?.pipeline?.parse || createPipelineStage('success', 'AI 解析完成')),
                      cad: parseResult.meta?.pipeline?.cad || createPipelineStage('success', '已整理正式图基础结构，待桌面端输出 CAD/DXF'),
                      threeD: this.processingSteps[3].status === 'processing' ? createPipelineStage('failed', error.message || '全屋 3D 图生成失败') : (parseResult.meta?.pipeline?.threeD || createPipelineStage('pending', '等待生成全屋 3D 图')),
                      panorama: this.processingSteps[4].status === 'processing' ? createPipelineStage('failed', error.message || '全景配置生成失败') : (parseResult.meta?.pipeline?.panorama || createPipelineStage('pending', '等待生成全景配置'))
                    }
                  }
                }
              : null

            await adminService.updateFloorPlan(floorPlanId, {
              parse_status: 'failed',
              ...(failedResult ? { parse_result: JSON.stringify(failedResult) } : {})
            })
          } catch (updateError) {
            console.error('更新失败状态失败:', updateError)
          }
        }
        throw error
      } finally {
        this.isProcessing = false
      }
    }
  },
  watch: {
    'form.houseId': {
      async handler(value) {
        if (!value) {
          return
        }

        await this.syncFiltersFromSelectedHouse()
      }
    }
  }
}
</script>
