<template>
  <div class="overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-inner">
    <div class="relative min-h-[640px] overflow-hidden bg-slate-950">
      <div
        v-if="imageUrl"
        ref="viewer"
        class="absolute inset-0 h-full w-full"
      ></div>
      <div
        v-else
        class="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(14,165,233,0.22),_transparent_40%),linear-gradient(180deg,_rgba(15,23,42,0.9),_rgba(2,6,23,1))]"
      ></div>

      <div class="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/70 via-black/20 to-transparent p-5">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="text-xs uppercase tracking-[0.28em] text-cyan-100/80">AIInHouse VR Tour</p>
            <p class="mt-2 text-2xl font-semibold text-white">{{ activeCamera.name }}</p>
            <p class="mt-1 text-sm text-slate-200">{{ description || '全屋装修全景漫游预览' }}</p>
          </div>
          <div class="rounded-full border border-white/20 bg-black/35 px-4 py-2 text-sm text-white backdrop-blur">
            {{ cameraPositions.length }} 个视角 · {{ hotspots.length }} 个热点
          </div>
        </div>
      </div>

      <div
        v-if="!imageUrl"
        class="relative z-10 flex min-h-[640px] flex-col justify-between p-5 pt-36"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="rounded-xl border border-white/10 bg-slate-900/65 px-4 py-3 backdrop-blur">
            <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Current Camera</p>
            <p class="mt-2 text-lg font-semibold text-white">{{ activeCamera.name }}</p>
            <p class="mt-1 text-xs text-slate-300">
              位置 ({{ activeCamera.position?.x ?? 0 }}, {{ activeCamera.position?.y ?? 0 }}, {{ activeCamera.position?.z ?? 0 }})
            </p>
          </div>
        </div>
      </div>

      <div class="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-5">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div class="flex min-w-0 gap-3 overflow-x-auto pb-1">
            <button
              v-for="(camera, index) in cameraPositions"
              :key="camera.id || camera.name"
              type="button"
              @click="selectCamera(camera)"
              :class="[
                'group grid w-36 shrink-0 gap-2 rounded-2xl border p-2 text-left transition',
                activeCameraId === (camera.id || camera.name)
                  ? 'border-cyan-300 bg-cyan-300/20 text-white'
                  : 'border-white/15 bg-white/10 text-slate-200 hover:bg-white/15'
              ]"
            >
              <span class="block h-16 rounded-xl border border-white/10 bg-[linear-gradient(135deg,#0f172a,#334155_48%,#c8a676)]"></span>
              <span class="truncate text-sm font-medium">{{ camera.name || `视角 ${index + 1}` }}</span>
            </button>
          </div>

          <div class="w-full rounded-2xl border border-white/15 bg-black/35 p-4 text-white backdrop-blur lg:w-80">
            <p class="text-sm font-semibold">热点导航</p>
            <div class="mt-3 grid gap-2">
              <button
                v-for="(hotspot, index) in hotspots"
                :key="`${hotspot.id || hotspot.text || 'list'}-${index}`"
                type="button"
                class="flex items-center justify-between rounded-xl bg-white/10 px-3 py-2 text-left text-sm transition hover:bg-white/15"
                @click="selectHotspot(hotspot)"
              >
                <span class="truncate">{{ hotspot.text || hotspot.id || '未命名热点' }}</span>
                <span class="ml-3 text-xs text-cyan-100">{{ hotspot.target || 'info' }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import 'pannellum/build/pannellum.css'

export default {
  name: 'PanoramaDeliveryPreview',
  emits: ['select-hotspot'],
  props: {
    panoramaConfig: {
      type: Object,
      default: null
    },
    imageUrl: {
      type: String,
      default: ''
    }
  },
  data() {
    return {
      activeCameraId: '',
      viewer: null
    }
  },
  computed: {
    cameraPositions() {
      return this.panoramaConfig?.cameraPositions || []
    },
    hotspots() {
      return this.panoramaConfig?.hotspots || []
    },
    description() {
      return this.panoramaConfig?.description || ''
    },
    activeCamera() {
      return this.cameraPositions.find((item) => (item.id || item.name) === this.activeCameraId) || this.cameraPositions[0] || {
        name: '默认视角',
        position: { x: 0, y: 0, z: 0 }
      }
    }
  },
  mounted() {
    this.syncActiveCamera()
    this.initViewer()
  },
  beforeUnmount() {
    this.destroyViewer()
  },
  watch: {
    panoramaConfig: {
      deep: true,
      handler() {
        this.syncActiveCamera()
        this.$nextTick(this.initViewer)
      }
    },
    imageUrl() {
      this.$nextTick(this.initViewer)
    }
  },
  methods: {
    syncActiveCamera() {
      const firstCamera = this.cameraPositions[0]
      this.activeCameraId = firstCamera ? firstCamera.id || firstCamera.name : ''
    },
    selectCamera(camera) {
      this.activeCameraId = camera.id || camera.name
      if (this.viewer && camera.lookAt) {
        const yaw = Number(camera.lookAt.yaw ?? camera.lookAt.x ?? 0)
        const pitch = Number(camera.lookAt.pitch ?? camera.lookAt.y ?? 0)
        this.viewer.lookAt(pitch, yaw)
      }
    },
    selectHotspot(hotspot) {
      this.$emit('select-hotspot', hotspot)
      if (this.viewer) {
        const yaw = Number(hotspot.position?.yaw ?? hotspot.yaw ?? 0)
        const pitch = Number(hotspot.position?.pitch ?? hotspot.pitch ?? 0)
        this.viewer.lookAt(pitch, yaw)
      }
    },
    async initViewer() {
      if (!this.imageUrl || !this.$refs.viewer) {
        this.destroyViewer()
        return
      }

      this.destroyViewer()
      await import('pannellum')
      const hotspots = this.hotspots.map((hotspot, index) => ({
        pitch: Number(hotspot.position?.pitch ?? hotspot.pitch ?? 0),
        yaw: Number(hotspot.position?.yaw ?? hotspot.yaw ?? index * 45),
        type: 'info',
        text: hotspot.text || hotspot.id || `热点 ${index + 1}`
      }))

      this.viewer = window.pannellum.viewer(this.$refs.viewer, {
        type: 'equirectangular',
        panorama: this.imageUrl,
        autoLoad: true,
        autoRotate: -1,
        showControls: true,
        compass: true,
        hfov: 105,
        showZoomCtrl: true,
        showFullscreenCtrl: true,
        hotSpots: hotspots
      })
    },
    destroyViewer() {
      if (this.viewer?.destroy) {
        this.viewer.destroy()
      }
      this.viewer = null
    }
  }
}
</script>
