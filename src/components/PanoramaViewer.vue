<template>
  <div class="relative h-full w-full overflow-hidden rounded-2xl bg-slate-950 text-white">
    <div
      v-if="imageUrl"
      ref="viewer"
      class="h-full w-full"
    ></div>
    <div v-else-if="panoramaConfig" class="flex h-full min-h-[520px] flex-col bg-[radial-gradient(circle_at_top,#1d4ed8_0%,#0f172a_42%,#020617_100%)]">
      <div class="border-b border-white/10 px-6 py-5">
        <p class="text-xl font-semibold">VR 漫游配置预览</p>
        <p class="mt-2 text-sm leading-6 text-slate-300">
          当前已生成机位和热点配置，还没有渲染 2:1 全景图片。接入 Blender / Pannellum 图片后可直接替换为真实 720 全景漫游。
        </p>
      </div>

      <div class="grid flex-1 gap-4 p-6 lg:grid-cols-[1fr_320px]">
        <div class="relative min-h-[360px] overflow-hidden rounded-2xl border border-white/10 bg-black/20">
          <div class="absolute inset-8 rounded-full border border-cyan-300/30"></div>
          <div class="absolute inset-16 rounded-full border border-cyan-300/20"></div>
          <div class="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300 shadow-[0_0_30px_rgba(103,232,249,0.9)]"></div>
          <div
            v-for="(camera, index) in cameraPositions"
            :key="camera.id || index"
            class="absolute rounded-full border border-cyan-200 bg-cyan-300 px-3 py-1 text-xs font-semibold text-slate-950 shadow-lg"
            :style="cameraStyle(index)"
          >
            {{ camera.name || `机位 ${index + 1}` }}
          </div>
          <div
            v-for="(hotspot, index) in hotspots"
            :key="hotspot.id || index"
            class="absolute rounded-full border border-amber-200 bg-amber-300 px-3 py-1 text-xs font-semibold text-slate-950 shadow-lg"
            :style="hotspotStyle(hotspot, index)"
          >
            {{ hotspot.text || `热点 ${index + 1}` }}
          </div>
        </div>

        <div class="space-y-4 overflow-auto rounded-2xl border border-white/10 bg-white/10 p-4">
          <div>
            <p class="text-sm font-semibold text-slate-100">机位</p>
            <div class="mt-3 space-y-2">
              <div v-for="(camera, index) in cameraPositions" :key="camera.id || index" class="rounded-xl bg-white/10 px-3 py-2 text-sm text-slate-200">
                {{ camera.name || `机位 ${index + 1}` }}
              </div>
            </div>
          </div>
          <div>
            <p class="text-sm font-semibold text-slate-100">热点</p>
            <div class="mt-3 space-y-2">
              <div v-for="(hotspot, index) in hotspots" :key="hotspot.id || index" class="rounded-xl bg-white/10 px-3 py-2 text-sm text-slate-200">
                {{ hotspot.text || `热点 ${index + 1}` }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="flex h-full items-center justify-center bg-gray-100">
      <p class="text-gray-600">暂无全景数据</p>
    </div>
  </div>
</template>

<script>
import 'pannellum/build/pannellum.css'

export default {
  name: 'PanoramaViewer',
  props: {
    imageUrl: {
      type: String,
      default: ''
    },
    panoramaConfig: {
      type: Object,
      default: null
    }
  },
  data() {
    return {
      viewer: null
    }
  },
  computed: {
    cameraPositions() {
      return Array.isArray(this.panoramaConfig?.cameraPositions) ? this.panoramaConfig.cameraPositions : []
    },
    hotspots() {
      return Array.isArray(this.panoramaConfig?.hotspots) ? this.panoramaConfig.hotspots : []
    }
  },
  mounted() {
    this.initViewer()
  },
  beforeUnmount() {
    this.destroyViewer()
  },
  watch: {
    imageUrl() {
      this.$nextTick(this.initViewer)
    },
    panoramaConfig: {
      deep: true,
      handler() {
        this.$nextTick(this.initViewer)
      }
    }
  },
  methods: {
    cameraStyle(index) {
      const angle = (index / Math.max(this.cameraPositions.length, 1)) * Math.PI * 2 - Math.PI / 2
      return {
        left: `${50 + Math.cos(angle) * 30}%`,
        top: `${50 + Math.sin(angle) * 30}%`
      }
    },
    hotspotStyle(hotspot, index) {
      const yaw = Number(hotspot.position?.yaw ?? index * 60)
      const pitch = Number(hotspot.position?.pitch ?? 0)
      return {
        left: `${50 + Math.cos((yaw / 180) * Math.PI) * 36}%`,
        top: `${50 + Math.sin((yaw / 180) * Math.PI) * 28 - pitch}%`
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
