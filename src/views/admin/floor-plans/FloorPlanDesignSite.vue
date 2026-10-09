<template>
  <div class="min-w-0 bg-slate-950 text-white">
    <div
      v-if="loading"
      class="flex min-h-[70vh] items-center justify-center text-sm text-slate-300"
    >
      正在生成装修交付页...
    </div>

    <div
      v-else-if="errorMessage"
      class="mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center justify-center px-6 text-center"
    >
      <p class="text-2xl font-semibold">装修交付页加载失败</p>
      <p class="mt-3 text-sm leading-6 text-slate-300">{{ errorMessage }}</p>
      <router-link
        :to="`/admin/floor-plans/${$route.params.id}`"
        class="mt-6 rounded-xl bg-white px-5 py-3 text-sm font-medium text-slate-950"
      >
        返回平面图详情
      </router-link>
    </div>

    <template v-else>
      <section class="relative min-h-[78vh] overflow-hidden">
        <img
          v-if="floorPlan.previewImageUrl"
          :src="floorPlan.previewImageUrl"
          alt="装修效果预览"
          class="absolute inset-0 h-full w-full object-cover opacity-55"
        />
        <div v-else class="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,#2563eb_0%,transparent_32%),linear-gradient(135deg,#020617_0%,#0f172a_48%,#312e81_100%)]"></div>
        <div class="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/78 to-slate-950/20"></div>

        <div class="relative z-10 mx-auto flex min-h-[78vh] max-w-7xl flex-col justify-end px-6 py-10 lg:px-10">
          <div class="mb-8 flex flex-wrap gap-3">
            <router-link
              :to="`/admin/floor-plans/${floorPlan.id}`"
              class="inline-flex w-fit items-center rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm text-slate-100 backdrop-blur transition hover:bg-white/15"
            >
              返回后台详情
            </router-link>
            <button
              type="button"
              class="inline-flex w-fit items-center rounded-full border border-cyan-200/40 bg-cyan-300 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-200"
              @click="exportStaticSite"
            >
              {{ exporting ? '导出中...' : '导出静态网页' }}
            </button>
          </div>

          <div class="max-w-4xl">
            <p class="text-sm uppercase tracking-[0.24em] text-cyan-200">AIInHouse Design Delivery</p>
            <h1 class="mt-4 text-4xl font-semibold leading-tight tracking-normal sm:text-5xl lg:text-6xl">
              {{ floorPlan.name || '全屋装修效果方案' }}
            </h1>
            <p class="mt-5 max-w-2xl text-base leading-8 text-slate-200">
              基于平面图识别、墙体拓扑和本地 3D 场景配置生成的全屋装修交付页。当前模板会自动填充户型结构、材质风格、3D 效果和 VR 漫游机位。
            </p>
          </div>

          <div class="mt-8 grid max-w-4xl gap-3 sm:grid-cols-3">
            <div class="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur">
              <p class="text-xs uppercase tracking-[0.18em] text-slate-300">Rooms</p>
              <p class="mt-2 text-3xl font-semibold">{{ roomCount }}</p>
            </div>
            <div class="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur">
              <p class="text-xs uppercase tracking-[0.18em] text-slate-300">Walls</p>
              <p class="mt-2 text-3xl font-semibold">{{ wallCount }}</p>
            </div>
            <div class="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur">
              <p class="text-xs uppercase tracking-[0.18em] text-slate-300">VR Cameras</p>
              <p class="mt-2 text-3xl font-semibold">{{ cameraCount }}</p>
            </div>
          </div>
        </div>
      </section>

      <section class="bg-white text-slate-950">
        <div class="mx-auto grid max-w-7xl gap-8 px-6 py-12 lg:grid-cols-[0.95fr_1.05fr] lg:px-10">
          <div class="min-w-0">
            <p class="text-sm uppercase tracking-[0.2em] text-slate-500">Design Style</p>
            <h2 class="mt-3 text-3xl font-semibold tracking-normal">装修设计板</h2>
            <p class="mt-4 text-sm leading-7 text-slate-600">
              模板会从 3D 配置读取风格、色彩和材质。后续接入真实渲染器时，这一块可以继续填充真实效果图、软装清单和预算版本。
            </p>

            <div class="mt-7 grid gap-3 sm:grid-cols-3">
              <div
                v-for="swatch in colorSwatches"
                :key="swatch.label"
                class="rounded-2xl border border-slate-200 bg-slate-50 p-4"
              >
                <div class="h-16 rounded-xl border border-black/5" :style="{ backgroundColor: swatch.color }"></div>
                <p class="mt-3 text-sm font-medium text-slate-900">{{ swatch.label }}</p>
                <p class="mt-1 text-xs text-slate-500">{{ swatch.color }}</p>
              </div>
            </div>

            <div class="mt-6 grid gap-3">
              <div
                v-for="material in materialCards"
                :key="material.label"
                class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div class="flex items-center justify-between gap-4">
                  <div>
                    <p class="text-sm font-semibold text-slate-900">{{ material.label }}</p>
                    <p class="mt-1 text-sm text-slate-500">{{ material.texture || '默认材质' }}</p>
                  </div>
                  <span class="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                    roughness {{ material.roughness ?? '-' }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div class="min-w-0 overflow-hidden rounded-3xl border border-slate-200 bg-slate-100 p-4">
            <FormalFloorPlanPreview :parse-data="floorPlan.parseData" />
          </div>
        </div>
      </section>

      <section class="bg-slate-100 text-slate-950">
        <div class="mx-auto max-w-7xl px-6 py-12 lg:px-10">
          <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p class="text-sm uppercase tracking-[0.2em] text-slate-500">3D Effect</p>
              <h2 class="mt-3 text-3xl font-semibold tracking-normal">全屋 3D 装修效果</h2>
            </div>
            <div class="flex flex-wrap gap-2">
              <a
                v-if="floorPlan.threeDConfigUrl"
                :href="floorPlan.threeDConfigUrl"
                target="_blank"
                rel="noreferrer"
                class="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700"
              >
                查看 3D 配置
              </a>
              <a
                v-if="sceneViewerUrl"
                :href="sceneViewerUrl"
                target="_blank"
                rel="noreferrer"
                class="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700"
              >
                查看装配预览
              </a>
              <a
                v-if="rendererSceneUrl"
                :href="rendererSceneUrl"
                target="_blank"
                rel="noreferrer"
                class="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700"
              >
                场景 JSON
              </a>
              <button
                type="button"
                class="rounded-xl bg-slate-950 px-4 py-2 text-sm text-white"
                @click="showFull3D = true"
              >
                全屏查看
              </button>
            </div>
          </div>

          <div
            v-if="effectImages.length"
            class="mt-6 grid gap-4 md:grid-cols-2"
          >
            <figure
              v-for="(image, index) in effectImages"
              :key="image"
              class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
            >
              <img
                :src="image"
                :alt="`装修效果图 ${index + 1}`"
                class="aspect-[16/10] w-full object-cover"
              />
              <figcaption class="px-5 py-4 text-sm text-slate-500">装修效果图 {{ index + 1 }}</figcaption>
            </figure>
          </div>

          <div class="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <ThreeDScene
              :parse-data="floorPlan.parseData"
              :scene-config="floorPlan.generated3DConfig"
              :material-data="{ style: floorPlan.materialStyle || 'modern' }"
            />
          </div>
        </div>
      </section>

      <section class="bg-slate-950 text-white">
        <div class="mx-auto max-w-7xl px-6 py-12 lg:px-10">
          <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p class="text-sm uppercase tracking-[0.2em] text-cyan-200">VR Tour</p>
              <h2 class="mt-3 text-3xl font-semibold tracking-normal">VR 全景漫游图</h2>
            </div>
            <a
              v-if="floorPlan.panoramaConfigUrl"
              :href="floorPlan.panoramaConfigUrl"
              target="_blank"
              rel="noreferrer"
              class="w-fit rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm text-white"
            >
              查看全景配置
            </a>
          </div>

          <div class="mt-6 overflow-hidden rounded-3xl border border-white/10">
            <PanoramaDeliveryPreview
              :panorama-config="floorPlan.panoramaConfig"
              :image-url="floorPlan.panoramaUrl"
            />
          </div>
        </div>
      </section>

      <section class="bg-white text-slate-950">
        <div class="mx-auto max-w-7xl px-6 py-12 lg:px-10">
          <p class="text-sm uppercase tracking-[0.2em] text-slate-500">Assembly Plan</p>
          <h2 class="mt-3 text-3xl font-semibold tracking-normal">装修工序与素材装配</h2>
          <p class="mt-4 max-w-3xl text-sm leading-7 text-slate-600">
            这里会把平面图识别结果拆成刷墙、铺地、吊顶、灯光、家具等步骤，并绑定素材库中 AI 可理解的素材说明。
          </p>
          <div class="mt-6 grid gap-4 lg:grid-cols-3">
            <div
              v-for="roomPlan in assemblyRoomPlans"
              :key="roomPlan.roomId"
              class="rounded-3xl border border-slate-200 bg-slate-50 p-5"
            >
              <p class="text-lg font-semibold text-slate-950">{{ roomPlan.roomName }}</p>
              <p class="mt-1 text-sm text-slate-500">{{ roomPlan.roomType }} · {{ roomPlan.area }} m²</p>
              <div class="mt-4 space-y-3">
                <div
                  v-for="step in roomPlan.steps"
                  :key="step.id"
                  class="rounded-2xl border border-slate-200 bg-white p-3"
                >
                  <p class="text-sm font-semibold text-slate-900">{{ step.name }}</p>
                  <p class="mt-1 text-xs leading-5 text-slate-500">{{ step.asset?.name || step.instruction }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="bg-white text-slate-950">
        <div class="mx-auto max-w-7xl px-6 py-12 lg:px-10">
          <p class="text-sm uppercase tracking-[0.2em] text-slate-500">Room Plan</p>
          <h2 class="mt-3 text-3xl font-semibold tracking-normal">房间装修建议</h2>
          <div class="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div
              v-for="room in roomCards"
              :key="room.id"
              class="rounded-3xl border border-slate-200 bg-slate-50 p-5"
            >
              <p class="text-lg font-semibold text-slate-950">{{ room.name }}</p>
              <p class="mt-2 text-sm text-slate-500">{{ room.typeLabel }} · {{ room.area }} m²</p>
              <p class="mt-4 text-sm leading-7 text-slate-600">{{ room.advice }}</p>
            </div>
          </div>
        </div>
      </section>

      <section class="bg-slate-100 text-slate-950">
        <div class="mx-auto max-w-7xl px-6 py-12 lg:px-10">
          <p class="text-sm uppercase tracking-[0.2em] text-slate-500">Render Pipeline</p>
          <h2 class="mt-3 text-3xl font-semibold tracking-normal">成熟渲染方案接入点</h2>
          <div class="mt-6 grid gap-4 md:grid-cols-3">
            <a
              v-for="engine in renderEngines"
              :key="engine.name"
              :href="engine.url"
              target="_blank"
              rel="noreferrer"
              class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <p class="text-lg font-semibold text-slate-950">{{ engine.name }}</p>
              <p class="mt-3 text-sm leading-7 text-slate-600">{{ engine.useCase }}</p>
            </a>
          </div>
        </div>
      </section>

      <div v-if="showFull3D" class="fixed inset-0 z-50 bg-slate-950 p-4">
        <div class="flex h-full flex-col overflow-hidden rounded-2xl bg-white">
          <div class="flex items-center justify-between border-b border-slate-200 px-5 py-4 text-slate-950">
            <p class="text-lg font-semibold">全屏 3D 装修效果</p>
            <button type="button" class="text-2xl text-slate-500" @click="showFull3D = false">×</button>
          </div>
          <div class="min-h-0 flex-1 p-4">
            <ThreeDScene
              :parse-data="floorPlan.parseData"
              :scene-config="floorPlan.generated3DConfig"
              :material-data="{ style: floorPlan.materialStyle || 'modern' }"
            />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
import FormalFloorPlanPreview from '@/components/FormalFloorPlanPreview.vue'
import PanoramaDeliveryPreview from '@/components/PanoramaDeliveryPreview.vue'
import ThreeDScene from '@/components/ThreeDScene.vue'
import { adminService, normalizeAssetUrl } from '@/services/adminService'

const ROOM_TYPE_LABELS = {
  living: '客厅',
  bedroom: '卧室',
  kitchen: '厨房',
  bathroom: '卫生间',
  dining: '餐厅',
  balcony: '阳台',
  space: '功能空间'
}

const DEFAULT_RENDER_ENGINES = [
  {
    name: 'Pannellum',
    url: 'https://pannellum.org/',
    useCase: '轻量开源 Web 全景查看器，适合直接交付 VR 漫游热点配置。'
  },
  {
    name: 'BlenderProc',
    url: 'https://github.com/DLR-RM/BlenderProc',
    useCase: '基于 Blender 的程序化真实渲染管线，适合批量生成装修效果图和 2:1 全景图。'
  },
  {
    name: 'Sweet Home 3D',
    url: 'https://www.sweethome3d.com/',
    useCase: '成熟开源室内设计建模工具，适合平面图到室内 3D 布置的人工/半自动工作流。'
  }
]

export default {
  name: 'FloorPlanDesignSite',
  components: {
    FormalFloorPlanPreview,
    PanoramaDeliveryPreview,
    ThreeDScene
  },
  data() {
    return {
      floorPlan: null,
      loading: true,
      errorMessage: '',
      showFull3D: false,
      exporting: false
    }
  },
  computed: {
    roomCount() {
      return this.floorPlan?.parseData?.rooms?.length || 0
    },
    wallCount() {
      return this.floorPlan?.parseData?.walls?.length || 0
    },
    cameraCount() {
      return this.floorPlan?.panoramaConfig?.cameraPositions?.length || 0
    },
    effectImages() {
      return this.floorPlan?.effectImageUrls || []
    },
    sceneViewerUrl() {
      return this.artifactUrl(this.floorPlan?.generated3DConfig?.deliverables?.sceneViewer)
    },
    rendererSceneUrl() {
      return this.artifactUrl(this.floorPlan?.generated3DConfig?.deliverables?.modelFiles?.[0])
    },
    renderEngines() {
      const rendererEngines = this.floorPlan?.generated3DConfig?.renderer?.recommendedEngines || []
      const viewerEngines = this.floorPlan?.panoramaConfig?.viewer?.recommendedEngines || []
      const engines = [...rendererEngines, ...viewerEngines, ...DEFAULT_RENDER_ENGINES]
      const seen = new Set()
      return engines.filter((engine) => {
        if (!engine?.name || seen.has(engine.name)) {
          return false
        }
        seen.add(engine.name)
        return true
      })
    },
    assemblyRoomPlans() {
      return this.floorPlan?.generated3DConfig?.assemblyPlan?.roomPlans
        || this.floorPlan?.generated3DConfig?.sceneAssemblyPlan?.roomPlans
        || []
    },
    colorSwatches() {
      const colors = this.floorPlan?.generated3DConfig?.colors || {}
      return [
        { label: '主色', color: colors.primary || '#c97342' },
        { label: '强调色', color: colors.accent || '#2f5d50' },
        { label: '基底色', color: colors.base || '#f4efe8' }
      ]
    },
    materialCards() {
      const materials = this.floorPlan?.generated3DConfig?.materials || {}
      return [
        { label: '地面', ...(materials.floor || {}) },
        { label: '墙面', ...(materials.wall || {}) },
        { label: '天花', ...(materials.ceiling || {}) }
      ]
    },
    roomCards() {
      return (this.floorPlan?.parseData?.rooms || []).map((room, index) => {
        const typeLabel = ROOM_TYPE_LABELS[room.type] || ROOM_TYPE_LABELS.space
        return {
          id: room.id || `room-${index + 1}`,
          name: room.name || `空间 ${index + 1}`,
          typeLabel,
          area: Number(room.area || 0),
          advice: this.roomAdvice(room, typeLabel)
        }
      })
    }
  },
  mounted() {
    this.fetchFloorPlan()
  },
  methods: {
    async fetchFloorPlan() {
      this.loading = true
      this.errorMessage = ''
      try {
        this.floorPlan = await adminService.getFloorPlan(this.$route.params.id)
      } catch (error) {
        this.errorMessage = error.response?.data?.message || error.message || '加载失败'
      } finally {
        this.loading = false
      }
    },
    roomAdvice(room, typeLabel) {
      const area = Number(room.area || 0)
      if (room.type === 'living' || typeLabel === '客厅') {
        return '建议以连续地面材质和主墙面为视觉中心，保留开阔动线，软装以低饱和色搭配重点灯光。'
      }
      if (room.type === 'kitchen' || typeLabel === '厨房') {
        return '建议采用耐污墙面和高显色照明，优先保证操作台、收纳和通风动线。'
      }
      if (room.type === 'bathroom' || typeLabel === '卫生间') {
        return '建议干湿分离，墙地面统一防滑材质，局部用镜柜和壁龛提升收纳效率。'
      }
      if (area > 30) {
        return '该空间面积较大，建议分区布置家具和灯光，避免中心空旷，同时保留主通道。'
      }
      return '建议以轻量家具和浅色材质提升空间感，重点确认门窗、插座和收纳位置。'
    },
    async exportStaticSite() {
      this.exporting = true
      try {
        const result = await adminService.exportFloorPlanDesignSite(this.floorPlan.id)
        const url = normalizeAssetUrl(result.url)
        window.open(url, '_blank', 'noreferrer')
      } catch (error) {
        alert(error.response?.data?.message || error.message || '导出静态网页失败')
      } finally {
        this.exporting = false
      }
    },
    artifactUrl(fileName) {
      if (!fileName || !this.floorPlan?.threeDConfigUrl) {
        return ''
      }
      if (/^(https?:)?\/\//.test(fileName) || fileName.startsWith('/')) {
        return normalizeAssetUrl(fileName)
      }
      return `${this.floorPlan.threeDConfigUrl.split('/').slice(0, -1).join('/')}/${fileName}`
    }
  }
}
</script>
