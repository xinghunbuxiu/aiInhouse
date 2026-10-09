<template>
  <div class="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 shadow-inner">
    <div class="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 px-4 py-3">
      <div class="min-w-0">
        <p class="text-sm font-semibold tracking-wide text-slate-100">Formal Plan</p>
        <p class="mt-1 text-xs leading-5 text-slate-400">基于 AI 识别结果自动生成的标准化平面图</p>
      </div>
      <div class="shrink-0 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-200">
        {{ roomCount }} 个房间
      </div>
    </div>

    <div v-if="hasDrawableContent" class="bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),_transparent_32%),linear-gradient(180deg,_#0f172a_0%,_#020617_100%)] p-3 sm:p-4">
      <svg
        ref="blueprintSvg"
        viewBox="0 0 800 560"
        class="aspect-[10/7] max-h-[360px] min-h-[220px] w-full rounded-xl border border-slate-800 bg-slate-950"
        role="img"
        aria-label="Formal floor plan blueprint"
        xmlns="http://www.w3.org/2000/svg"
        @mousemove="handlePointerMove"
        @mouseup="finishDrag"
        @mouseleave="finishDrag"
        @touchmove.prevent="handlePointerMove"
        @touchend="finishDrag"
      >
        <defs>
          <pattern id="formal-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(148,163,184,0.08)" stroke-width="1" />
          </pattern>
        </defs>

        <rect width="800" height="560" fill="url(#formal-grid)" />

        <g opacity="0.35">
          <line x1="30" y1="30" x2="770" y2="30" stroke="#38bdf8" stroke-width="1" />
          <line x1="30" y1="530" x2="770" y2="530" stroke="#38bdf8" stroke-width="1" />
          <line x1="30" y1="30" x2="30" y2="530" stroke="#38bdf8" stroke-width="1" />
          <line x1="770" y1="30" x2="770" y2="530" stroke="#38bdf8" stroke-width="1" />
        </g>

        <g>
          <rect
            v-for="(room, index) in normalizedRooms"
            :key="`room-${index}`"
            :x="room.x"
            :y="room.y"
            :width="room.width"
            :height="room.height"
            :fill="room.fill"
            stroke="#e2e8f0"
            stroke-width="2"
            rx="10"
          />

          <g v-for="(room, index) in normalizedRooms" :key="`room-label-${index}`">
            <text
              :x="room.x + room.width / 2"
              :y="room.y + room.height / 2 - 6"
              text-anchor="middle"
              fill="#f8fafc"
              font-size="18"
              font-weight="600"
            >
              {{ room.name }}
            </text>
            <text
              :x="room.x + room.width / 2"
              :y="room.y + room.height / 2 + 16"
              text-anchor="middle"
              fill="#cbd5e1"
              font-size="12"
            >
              {{ room.areaLabel }}
            </text>
          </g>
        </g>

        <g>
          <line
            v-for="(wall, index) in normalizedWalls"
            :key="`wall-${index}`"
            :x1="wall.x1"
            :y1="wall.y1"
            :x2="wall.x2"
            :y2="wall.y2"
            stroke="#f8fafc"
            :stroke-width="wall.strokeWidth"
            stroke-linecap="round"
          />
        </g>

        <g>
          <line
            v-for="(door, index) in normalizedDoors"
            :key="`door-${index}`"
            :x1="door.x1"
            :y1="door.y1"
            :x2="door.x2"
            :y2="door.y2"
            :stroke="door.stroke"
            :stroke-width="door.strokeWidth"
            stroke-linecap="round"
          />
          <line
            v-for="(windowItem, index) in normalizedWindows"
            :key="`window-${index}`"
            :x1="windowItem.x1"
            :y1="windowItem.y1"
            :x2="windowItem.x2"
            :y2="windowItem.y2"
            :stroke="windowItem.stroke"
            :stroke-width="windowItem.strokeWidth"
            stroke-linecap="round"
          />
          <g v-for="(opening, index) in reviewOpenings" :key="`review-opening-${index}`">
            <circle
              :cx="opening.cx"
              :cy="opening.cy"
              r="8"
              fill="#ef4444"
              stroke="#fee2e2"
              stroke-width="2"
              class="cursor-move"
              @mousedown.stop="startDrag(opening, $event)"
              @touchstart.stop.prevent="startDrag(opening, $event)"
            >
              <title>{{ opening.tooltip }}</title>
            </circle>
          </g>
        </g>
      </svg>
    </div>

    <div v-else class="px-4 py-14 text-center text-sm text-slate-400">
      暂无足够的解析数据，无法生成正式平面图预览
    </div>
  </div>
</template>

<script>
const DRAWING_BOX = {
  width: 800,
  height: 560,
  padding: 40
}

const ROOM_TYPE_FILL = {
  living: 'rgba(56, 189, 248, 0.28)',
  bedroom: 'rgba(168, 85, 247, 0.22)',
  kitchen: 'rgba(34, 197, 94, 0.24)',
  bathroom: 'rgba(249, 115, 22, 0.24)',
  balcony: 'rgba(250, 204, 21, 0.2)'
}

export default {
  name: 'FormalFloorPlanPreview',
  props: {
    parseData: {
      type: Object,
      default: null
    }
  },
  emits: ['opening-updated'],
  data() {
    return {
      editedOpenings: {},
      draggingOpening: null
    }
  },
  computed: {
    editableParseData() {
      const mergeOpening = (opening) => ({
        ...opening,
        ...(this.editedOpenings[opening.id] || {})
      })

      return {
        ...(this.parseData || {}),
        doors: (this.parseData?.doors || []).map(mergeOpening),
        windows: (this.parseData?.windows || []).map(mergeOpening)
      }
    },
    roomCount() {
      return this.editableParseData?.rooms?.length || 0
    },
    bounds() {
      const points = []

      ;(this.editableParseData?.rooms || []).forEach((room) => {
        const x = Number(room.position?.x) || 0
        const y = Number(room.position?.y) || 0
        const width = Number(room.width) || 0
        const length = Number(room.length) || 0
        points.push({ x, y }, { x: x + width, y: y + length })
      })

      ;(this.editableParseData?.walls || []).forEach((wall) => {
        points.push(
          { x: Number(wall.start?.x) || 0, y: Number(wall.start?.y) || 0 },
          { x: Number(wall.end?.x) || 0, y: Number(wall.end?.y) || 0 }
        )
      })

      ;[...(this.editableParseData?.doors || []), ...(this.editableParseData?.windows || [])].forEach((item) => {
        points.push({
          x: Number(item.position?.x) || 0,
          y: Number(item.position?.y) || 0
        })
      })

      if (points.length === 0) {
        return {
          minX: 0,
          minY: 0,
          maxX: 10,
          maxY: 10,
          scale: 1
        }
      }

      const minX = Math.min(...points.map((point) => point.x))
      const minY = Math.min(...points.map((point) => point.y))
      const maxX = Math.max(...points.map((point) => point.x))
      const maxY = Math.max(...points.map((point) => point.y))
      const contentWidth = Math.max(1, maxX - minX)
      const contentHeight = Math.max(1, maxY - minY)
      const drawableWidth = DRAWING_BOX.width - DRAWING_BOX.padding * 2
      const drawableHeight = DRAWING_BOX.height - DRAWING_BOX.padding * 2
      const scale = Math.min(drawableWidth / contentWidth, drawableHeight / contentHeight)

      return {
        minX,
        minY,
        maxX,
        maxY,
        scale
      }
    },
    hasDrawableContent() {
      return this.normalizedRooms.length > 0 || this.normalizedWalls.length > 0
    },
    normalizedRooms() {
      return (this.editableParseData?.rooms || []).map((room) => {
        const width = Math.max(Number(room.width) || 0.8, 0.8)
        const length = Math.max(Number(room.length) || 0.8, 0.8)

        return {
          name: room.name || '未命名房间',
          areaLabel: `${Number(room.area) || 0} m²`,
          fill: ROOM_TYPE_FILL[room.type] || 'rgba(148, 163, 184, 0.18)',
          x: this.mapX(Number(room.position?.x) || 0),
          y: this.mapY(Number(room.position?.y) || 0),
          width: width * this.bounds.scale,
          height: length * this.bounds.scale
        }
      })
    },
    normalizedWalls() {
      return (this.editableParseData?.walls || []).map((wall) => ({
        x1: this.mapX(Number(wall.start?.x) || 0),
        y1: this.mapY(Number(wall.start?.y) || 0),
        x2: this.mapX(Number(wall.end?.x) || 0),
        y2: this.mapY(Number(wall.end?.y) || 0),
        strokeWidth: Math.max((Number(wall.thickness) || 0.18) * this.bounds.scale, 4)
      }))
    },
    normalizedDoors() {
      return (this.editableParseData?.doors || []).map((door) => this.normalizeOpening(door))
    },
    normalizedWindows() {
      return (this.editableParseData?.windows || []).map((windowItem) => this.normalizeOpening(windowItem))
    },
    reviewOpenings() {
      return [...this.normalizedDoors, ...this.normalizedWindows].filter((opening) => opening.needsReview)
    }
  },
  methods: {
    getSvgMarkup() {
      const svgElement = this.$refs.blueprintSvg
      return svgElement ? svgElement.outerHTML : ''
    },
    mapX(value) {
      return DRAWING_BOX.padding + (value - this.bounds.minX) * this.bounds.scale
    },
    mapY(value) {
      return DRAWING_BOX.padding + (value - this.bounds.minY) * this.bounds.scale
    },
    unmapX(value) {
      return (value - DRAWING_BOX.padding) / this.bounds.scale + this.bounds.minX
    },
    unmapY(value) {
      return (value - DRAWING_BOX.padding) / this.bounds.scale + this.bounds.minY
    },
    getPointerPoint(event) {
      const pointer = event.touches?.[0] || event
      const rect = this.$refs.blueprintSvg.getBoundingClientRect()
      const x = ((pointer.clientX - rect.left) / rect.width) * DRAWING_BOX.width
      const y = ((pointer.clientY - rect.top) / rect.height) * DRAWING_BOX.height
      return { x, y }
    },
    nearestWall(position) {
      let best = null
      ;(this.editableParseData?.walls || []).forEach((wall) => {
        const start = {
          x: Number(wall.start?.x) || 0,
          y: Number(wall.start?.y) || 0
        }
        const end = {
          x: Number(wall.end?.x) || 0,
          y: Number(wall.end?.y) || 0
        }
        const dx = end.x - start.x
        const dy = end.y - start.y
        const lengthSquared = dx * dx + dy * dy
        if (!lengthSquared) {
          return
        }
        const t = Math.max(0, Math.min(1, ((position.x - start.x) * dx + (position.y - start.y) * dy) / lengthSquared))
        const projected = {
          x: start.x + t * dx,
          y: start.y + t * dy
        }
        const distance = Math.hypot(position.x - projected.x, position.y - projected.y)
        if (!best || distance < best.distance) {
          best = {
            id: wall.id || '',
            orientation: Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical',
            projected,
            distance
          }
        }
      })

      return best
    },
    snapOpeningPosition(position) {
      const wall = this.nearestWall(position)
      if (!wall) {
        return {
          position,
          needsWallAttachmentReview: true,
          reviewReasons: ['no-wall-candidate'],
          wallDistance: null,
          attachedWallId: '',
          orientation: ''
        }
      }

      const maxSnapDistance = 48
      const snapped = wall.distance <= maxSnapDistance
      return {
        position: snapped
          ? {
              x: Number(wall.projected.x.toFixed(2)),
              y: Number(wall.projected.y.toFixed(2))
            }
          : position,
        attachedWallId: wall.id,
        wallDistance: Number(wall.distance.toFixed(2)),
        orientation: wall.orientation,
        needsWallAttachmentReview: !snapped,
        reviewReasons: snapped ? [] : [`far-from-wall:${Number(wall.distance.toFixed(1))}`]
      }
    },
    startDrag(opening, event) {
      this.draggingOpening = {
        id: opening.id,
        type: opening.type
      }
      this.handlePointerMove(event)
    },
    handlePointerMove(event) {
      if (!this.draggingOpening) {
        return
      }

      const point = this.getPointerPoint(event)
      const rawPosition = {
        x: Number(this.unmapX(point.x).toFixed(2)),
        y: Number(this.unmapY(point.y).toFixed(2))
      }
      const snapped = this.snapOpeningPosition(rawPosition)
      const existing = this.editedOpenings[this.draggingOpening.id] || {}
      this.editedOpenings = {
        ...this.editedOpenings,
        [this.draggingOpening.id]: {
          ...existing,
          ...snapped
        }
      }
    },
    finishDrag() {
      if (!this.draggingOpening) {
        return
      }

      const update = this.editedOpenings[this.draggingOpening.id]
      this.$emit('opening-updated', {
        id: this.draggingOpening.id,
        type: this.draggingOpening.type,
        ...update
      })
      this.draggingOpening = null
    },
    getEditedParseData() {
      return this.editableParseData
    },
    normalizeOpening(item) {
      const width = Math.max(Number(item.width) || 0.8, 0.5) * this.bounds.scale
      const x = this.mapX(Number(item.position?.x) || 0)
      const y = this.mapY(Number(item.position?.y) || 0)
      const isVertical = item.orientation === 'vertical' || Number(item.height || 0) > Number(item.width || 0)
      const half = width / 2
      const needsReview = Boolean(item.needsWallAttachmentReview)

      return {
        x1: isVertical ? x : x - half,
        y1: isVertical ? y - half : y,
        x2: isVertical ? x : x + half,
        y2: isVertical ? y + half : y,
        cx: x,
        cy: y,
        id: item.id,
        type: item.type,
        needsReview,
        stroke: needsReview ? '#ef4444' : item.type === 'window' ? '#38bdf8' : '#f59e0b',
        strokeWidth: needsReview ? 7 : item.type === 'window' ? 5 : 6,
        tooltip: `${item.id || item.type || 'opening'} ${needsReview ? '需复核' : 'OK'} ${item.reviewReasons?.join(', ') || ''}`.trim()
      }
    }
  }
}
</script>
