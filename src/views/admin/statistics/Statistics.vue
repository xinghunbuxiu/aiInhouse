<template>
  <div class="space-y-6">
    <section class="rounded-2xl bg-gradient-to-r from-slate-900 via-blue-900 to-cyan-800 p-6 text-white shadow-lg">
      <div class="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div class="max-w-3xl">
          <p class="text-sm uppercase tracking-[0.28em] text-cyan-200">AI In House</p>
          <h1 class="mt-3 text-3xl font-bold">本地房产业务经营看板</h1>
          <p class="mt-3 text-sm leading-6 text-slate-200">
            这里统一查看楼盘、楼栋、房屋和平面图交付进度，同时可以直接进入新增、上传、交付和巡检流程。
          </p>
        </div>

        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <router-link
            v-for="action in quickActions"
            :key="action.label"
            :to="action.to"
            class="rounded-xl border border-white/15 bg-white/10 p-4 transition hover:bg-white/20"
          >
            <p class="text-2xl">{{ action.icon }}</p>
            <p class="mt-3 text-sm font-medium">{{ action.label }}</p>
            <p class="mt-1 text-xs text-slate-200">{{ action.description }}</p>
          </router-link>
        </div>
      </div>
    </section>

    <div class="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-5">
      <div class="rounded-lg bg-white p-6 shadow">
        <div class="flex items-center">
          <div class="rounded-full bg-blue-100 p-3 text-blue-600">
            <span class="text-2xl">🏢</span>
          </div>
          <div class="ml-4">
            <p class="text-sm text-gray-600">楼盘总数</p>
            <p class="text-2xl font-bold text-gray-800">{{ stats.buildings }}</p>
          </div>
        </div>
      </div>

      <div class="rounded-lg bg-white p-6 shadow">
        <div class="flex items-center">
          <div class="rounded-full bg-cyan-100 p-3 text-cyan-600">
            <span class="text-2xl">🏬</span>
          </div>
          <div class="ml-4">
            <p class="text-sm text-gray-600">楼栋总数</p>
            <p class="text-2xl font-bold text-gray-800">{{ stats.blocks }}</p>
          </div>
        </div>
      </div>

      <div class="rounded-lg bg-white p-6 shadow">
        <div class="flex items-center">
          <div class="rounded-full bg-green-100 p-3 text-green-600">
            <span class="text-2xl">🏠</span>
          </div>
          <div class="ml-4">
            <p class="text-sm text-gray-600">房屋总数</p>
            <p class="text-2xl font-bold text-gray-800">{{ stats.houses }}</p>
          </div>
        </div>
      </div>

      <div class="rounded-lg bg-white p-6 shadow">
        <div class="flex items-center">
          <div class="rounded-full bg-purple-100 p-3 text-purple-600">
            <span class="text-2xl">📐</span>
          </div>
          <div class="ml-4">
            <p class="text-sm text-gray-600">平面图总数</p>
            <p class="text-2xl font-bold text-gray-800">{{ stats.floorPlans }}</p>
          </div>
        </div>
      </div>

      <div class="rounded-lg bg-white p-6 shadow">
        <div class="flex items-center">
          <div class="rounded-full bg-amber-100 p-3 text-amber-600">
            <span class="text-2xl">🎨</span>
          </div>
          <div class="ml-4">
            <p class="text-sm text-gray-600">AI完成率</p>
            <p class="text-2xl font-bold text-gray-800">{{ performance.successRate }}%</p>
          </div>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
      <div class="rounded-lg bg-white p-6 shadow">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="text-lg font-semibold text-gray-800">业务推进摘要</h3>
          <span class="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">首页总控</span>
        </div>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div
            v-for="item in businessHighlights"
            :key="item.label"
            class="rounded-xl border border-gray-200 p-4"
          >
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm text-gray-600">{{ item.label }}</span>
              <span :class="['rounded-full px-3 py-1 text-sm', item.tone]">{{ item.value }}</span>
            </div>
            <p class="mt-3 text-sm text-gray-500">{{ item.description }}</p>
          </div>
        </div>
      </div>

      <div class="rounded-lg bg-white p-6 shadow">
        <h3 class="mb-4 text-lg font-semibold text-gray-800">交付入口</h3>
        <div class="space-y-4">
          <router-link
            to="/admin/floor-plans/create"
            class="block rounded-xl border border-purple-200 bg-purple-50 p-4 transition hover:bg-purple-100"
          >
            <p class="font-medium text-purple-900">上传平面图</p>
            <p class="mt-1 text-sm text-purple-700">支持电子图纸与手绘原稿，进入 AI 解析与正式图转换。</p>
          </router-link>
          <router-link
            to="/admin/floor-plans"
            class="block rounded-xl border border-blue-200 bg-blue-50 p-4 transition hover:bg-blue-100"
          >
            <p class="font-medium text-blue-900">交付中心</p>
            <p class="mt-1 text-sm text-blue-700">继续处理 3D 配置、全景配置、交付快照和版本对比。</p>
          </router-link>
          <router-link
            to="/admin/houses"
            class="block rounded-xl border border-emerald-200 bg-emerald-50 p-4 transition hover:bg-emerald-100"
          >
            <p class="font-medium text-emerald-900">房屋台账</p>
            <p class="mt-1 text-sm text-emerald-700">回查楼盘、楼栋、户型归属，补齐 AI 交付前置数据。</p>
          </router-link>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div class="rounded-lg bg-white p-6 shadow xl:col-span-2">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="text-lg font-semibold text-gray-800">楼盘经营概览</h3>
          <span class="rounded-full bg-slate-50 px-3 py-1 text-sm text-slate-500">按房屋数据计算</span>
        </div>

        <div class="space-y-4">
          <div v-for="building in buildingStats" :key="building.id" class="rounded-lg border border-gray-200 p-4">
            <div class="mb-3 flex items-center justify-between">
              <div>
                <p class="font-semibold text-gray-900">{{ building.name }}</p>
                <p class="mt-1 text-sm text-gray-500">
                  {{ building.blocks }} 栋 · {{ building.total }} 套房屋 · 均价面积 {{ building.avgArea }} m²
                </p>
              </div>
              <span class="rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-600">
                AI覆盖 {{ building.aiCoverage }}%
              </span>
            </div>

            <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div class="rounded-lg bg-green-50 p-3">
                <p class="text-xs text-green-600">在售</p>
                <p class="mt-1 text-lg font-bold text-green-800">{{ building.available }}</p>
              </div>
              <div class="rounded-lg bg-red-50 p-3">
                <p class="text-xs text-red-600">已售</p>
                <p class="mt-1 text-lg font-bold text-red-800">{{ building.sold }}</p>
              </div>
              <div class="rounded-lg bg-yellow-50 p-3">
                <p class="text-xs text-yellow-700">预留</p>
                <p class="mt-1 text-lg font-bold text-yellow-800">{{ building.reserved }}</p>
              </div>
            </div>

            <div class="mt-4">
              <div class="mb-2 flex justify-between text-xs text-gray-500">
                <span>房屋 AI 覆盖率</span>
                <span>{{ building.floorPlans }}/{{ building.total }}</span>
              </div>
              <div class="h-3 rounded-full bg-gray-100">
                <div class="h-3 rounded-full bg-gradient-to-r from-blue-500 to-cyan-400" :style="{ width: `${building.aiCoverage}%` }"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="space-y-6">
        <div class="rounded-lg bg-white p-6 shadow">
          <h3 class="mb-4 text-lg font-semibold text-gray-800">平面图处理状态</h3>
          <div class="grid grid-cols-2 gap-4">
            <div class="rounded-lg bg-yellow-50 p-4 text-center">
              <p class="text-3xl font-bold text-yellow-600">{{ floorPlanStats.pending }}</p>
              <p class="text-sm text-yellow-800">待处理</p>
            </div>
            <div class="rounded-lg bg-blue-50 p-4 text-center">
              <p class="text-3xl font-bold text-blue-600">{{ floorPlanStats.processing }}</p>
              <p class="text-sm text-blue-800">处理中</p>
            </div>
            <div class="rounded-lg bg-green-50 p-4 text-center">
              <p class="text-3xl font-bold text-green-600">{{ floorPlanStats.completed }}</p>
              <p class="text-sm text-green-800">已完成</p>
            </div>
            <div class="rounded-lg bg-red-50 p-4 text-center">
              <p class="text-3xl font-bold text-red-600">{{ floorPlanStats.failed }}</p>
              <p class="text-sm text-red-800">失败</p>
            </div>
          </div>
        </div>

        <div class="rounded-lg bg-white p-6 shadow">
          <h3 class="mb-4 text-lg font-semibold text-gray-800">系统健康</h3>
          <div class="space-y-4">
            <div v-for="item in systemStatus" :key="item.label" class="flex items-center justify-between">
              <span class="text-gray-600">{{ item.label }}</span>
              <span :class="['rounded-full px-3 py-1 text-sm', item.tone]">{{ item.status }}</span>
            </div>
          </div>
        </div>

        <div class="rounded-lg bg-white p-6 shadow">
          <h3 class="mb-4 text-lg font-semibold text-gray-800">处理效率</h3>
          <div class="grid grid-cols-1 gap-4">
            <div class="rounded-lg bg-slate-50 p-4">
              <p class="text-sm text-gray-600">楼盘平均楼栋数</p>
              <p class="mt-1 text-2xl font-bold text-slate-800">{{ performance.avgBlocksPerBuilding }}</p>
            </div>
            <div class="rounded-lg bg-slate-50 p-4">
              <p class="text-sm text-gray-600">每栋平均房屋数</p>
              <p class="mt-1 text-2xl font-bold text-slate-800">{{ performance.avgHousesPerBlock }}</p>
            </div>
            <div class="rounded-lg bg-slate-50 p-4">
              <p class="text-sm text-gray-600">已完成AI平面图</p>
              <p class="mt-1 text-2xl font-bold text-slate-800">{{ performance.completedFloorPlans }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div class="rounded-lg bg-white p-6 shadow">
        <h3 class="mb-4 text-lg font-semibold text-gray-800">最近业务活动</h3>
        <div class="space-y-3">
          <div
            v-for="activity in recentActivities"
            :key="activity.id"
            class="flex items-center rounded-lg bg-gray-50 p-4"
          >
            <span class="mr-3 text-2xl">{{ activity.icon }}</span>
            <div class="flex-1">
              <p class="text-sm font-medium text-gray-800">{{ activity.title }}</p>
              <p class="text-xs text-gray-500">{{ activity.time }}</p>
            </div>
          </div>
          <div v-if="recentActivities.length === 0" class="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
            暂无业务活动数据
          </div>
        </div>
      </div>

      <div class="rounded-lg bg-white p-6 shadow">
        <h3 class="mb-4 text-lg font-semibold text-gray-800">AI结果成熟度</h3>
        <div class="space-y-4">
          <div class="rounded-lg border border-gray-200 p-4">
            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-600">完成解析</span>
              <span class="text-sm font-medium text-gray-800">{{ aiMaturity.parsed }}/{{ stats.floorPlans }}</span>
            </div>
            <div class="mt-2 h-3 rounded-full bg-gray-100">
              <div class="h-3 rounded-full bg-green-500" :style="{ width: `${aiMaturity.parsedRate}%` }"></div>
            </div>
          </div>
          <div class="rounded-lg border border-gray-200 p-4">
            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-600">生成3D配置</span>
              <span class="text-sm font-medium text-gray-800">{{ aiMaturity.with3DConfig }}/{{ stats.floorPlans }}</span>
            </div>
            <div class="mt-2 h-3 rounded-full bg-gray-100">
              <div class="h-3 rounded-full bg-blue-500" :style="{ width: `${aiMaturity.with3DConfigRate}%` }"></div>
            </div>
          </div>
          <div class="rounded-lg border border-gray-200 p-4">
            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-600">生成全景配置</span>
              <span class="text-sm font-medium text-gray-800">{{ aiMaturity.withPanoramaConfig }}/{{ stats.floorPlans }}</span>
            </div>
            <div class="mt-2 h-3 rounded-full bg-gray-100">
              <div class="h-3 rounded-full bg-purple-500" :style="{ width: `${aiMaturity.withPanoramaConfigRate}%` }"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { adminService } from '@/services/adminService'

export default {
  name: 'Statistics',
  data() {
    return {
      stats: {
        buildings: 0,
        blocks: 0,
        houses: 0,
        floorPlans: 0
      },
      buildingStats: [],
      floorPlanStats: {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0
      },
      recentActivities: [],
      quickActions: [],
      businessHighlights: [],
      performance: {
        successRate: 0,
        avgBlocksPerBuilding: 0,
        avgHousesPerBlock: 0,
        completedFloorPlans: 0
      },
      aiMaturity: {
        parsed: 0,
        parsedRate: 0,
        with3DConfig: 0,
        with3DConfigRate: 0,
        withPanoramaConfig: 0,
        withPanoramaConfigRate: 0
      },
      systemStatus: [
        { label: '后台 API', status: '检测中', tone: 'bg-gray-100 text-gray-700' },
        { label: '数据库连接', status: '待确认', tone: 'bg-gray-100 text-gray-700' },
        { label: 'AI 解析链路', status: '待联调', tone: 'bg-yellow-100 text-yellow-800' }
      ]
    }
  },
  computed: {
    currentRole() {
      try {
        const rawUser = localStorage.getItem('user')
        const currentUser = rawUser ? JSON.parse(rawUser) : null
        return currentUser?.role || 'user'
      } catch (error) {
        console.warn('读取当前用户角色失败:', error)
        return 'user'
      }
    }
  },
  mounted() {
    this.initializeQuickActions()
    this.fetchStatistics()
  },
  methods: {
    initializeQuickActions() {
      const actions = [
        { label: '新增楼盘', to: '/admin/buildings/create', icon: '🏢', description: '录入新社区或项目' },
        { label: '新增房屋', to: '/admin/houses/create', icon: '🏠', description: '补录房屋与户型信息' },
        { label: '上传图纸', to: '/admin/floor-plans/create', icon: '📐', description: '进入 AI 交付流程' }
      ]

      if (this.currentRole === 'admin') {
        actions.push({ label: '新增用户', to: '/admin/users/create', icon: '👤', description: '维护后台账号与权限' })
      } else {
        actions.push({ label: '查看交付', to: '/admin/floor-plans', icon: '🎯', description: '跟进图纸处理与导出' })
      }

      this.quickActions = actions
    },
    async fetchStatistics() {
      try {
        const [buildings, houses, floorPlans, health] = await Promise.all([
          adminService.getBuildings(),
          adminService.getHouses(),
          adminService.getFloorPlans(),
          adminService.getHealth().catch(() => null)
        ])

        const blocks = await fetchBlocksForBuildings(buildings)

        this.stats = {
          buildings: buildings.length,
          blocks: blocks.length,
          houses: houses.length,
          floorPlans: floorPlans.length
        }

        this.floorPlanStats = {
          pending: floorPlans.filter((item) => item.parse_status === 'pending').length,
          processing: floorPlans.filter((item) => item.parse_status === 'processing').length,
          completed: floorPlans.filter((item) => item.parse_status === 'completed').length,
          failed: floorPlans.filter((item) => item.parse_status === 'failed').length
        }

        this.buildingStats = buildings.map((building) => {
          const buildingBlocks = blocks.filter((block) => String(block.buildingId) === String(building.id))
          const buildingHouses = houses.filter((house) => String(house.building_id) === String(building.id))
          const buildingFloorPlans = floorPlans.filter((plan) => String(plan.house_id) && buildingHouses.some((house) => String(house.id) === String(plan.house_id)))
          const total = buildingHouses.length
          const available = buildingHouses.filter((house) => house.status === 'available').length
          const sold = buildingHouses.filter((house) => house.status === 'sold').length
          const reserved = buildingHouses.filter((house) => house.status === 'reserved').length
          const avgArea = total > 0
            ? (buildingHouses.reduce((sum, house) => sum + (Number(house.area) || 0), 0) / total).toFixed(1)
            : '0.0'
          const aiCoverage = total > 0 ? Math.round((buildingFloorPlans.length / total) * 100) : 0

          return {
            id: building.id,
            name: building.name,
            blocks: buildingBlocks.length,
            total,
            available,
            sold,
            reserved,
            floorPlans: buildingFloorPlans.length,
            avgArea,
            aiCoverage
          }
        }).sort((a, b) => b.total - a.total)

        const parsed = floorPlans.filter((item) => item.parseData).length
        const with3DConfig = floorPlans.filter((item) => item.generated3DConfig).length
        const withPanoramaConfig = floorPlans.filter((item) => item.panoramaConfig).length
        const totalFloorPlans = floorPlans.length || 1

        this.aiMaturity = {
          parsed,
          parsedRate: Math.round((parsed / totalFloorPlans) * 100),
          with3DConfig,
          with3DConfigRate: Math.round((with3DConfig / totalFloorPlans) * 100),
          withPanoramaConfig,
          withPanoramaConfigRate: Math.round((withPanoramaConfig / totalFloorPlans) * 100)
        }

        this.performance = {
          successRate: Math.round((this.floorPlanStats.completed / totalFloorPlans) * 100),
          avgBlocksPerBuilding: buildings.length > 0 ? (blocks.length / buildings.length).toFixed(1) : '0.0',
          avgHousesPerBlock: blocks.length > 0 ? (houses.length / blocks.length).toFixed(1) : '0.0',
          completedFloorPlans: this.floorPlanStats.completed
        }

        this.businessHighlights = [
          {
            label: '后台接口状态',
            value: health?.success ? '正常' : '异常',
            tone: health?.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800',
            description: health?.success ? '服务、数据库和后台接口当前连通。' : '接口当前不可用，建议先检查后端服务与数据库连通性。'
          },
          {
            label: 'AI 交付进度',
            value: `${this.floorPlanStats.completed}/${statsValue(this.stats.floorPlans)}`,
            tone: 'bg-blue-100 text-blue-800',
            description: '已完成解析并产出交付信息的平面图数量。'
          },
          {
            label: '手绘转正式图',
            value: `${floorPlans.filter((item) => item.sourceType === 'hand_drawn').length} 份`,
            tone: 'bg-amber-100 text-amber-800',
            description: '当前纳入处理的手绘原稿数量，可继续转正式平面图。'
          },
          {
            label: '业务热度',
            value: recentActivitiesLabel(buildings.length, houses.length, floorPlans.length),
            tone: 'bg-purple-100 text-purple-800',
            description: '根据项目、房屋和平面图总体数据规模给出的活跃度判断。'
          }
        ]

        this.recentActivities = [
          ...floorPlans.slice(0, 4).map((item, index) => ({
            id: `fp-${index}`,
            icon: '📐',
            title: `平面图：${item.name || '未命名'} · ${item.statusLabel}`,
            time: item.updatedAt || item.createdAt
          })),
          ...houses.slice(0, 3).map((item, index) => ({
            id: `house-${index}`,
            icon: '🏠',
            title: `房屋：${item.buildingName || '未分配楼盘'} ${item.unitNumber || ''}`.trim(),
            time: item.updatedAt || item.createdAt
          })),
          ...blocks.slice(0, 2).map((item, index) => ({
            id: `block-${index}`,
            icon: '🏬',
            title: `楼栋：${item.buildingName} ${item.blockNumber}`,
            time: item.updatedAt || item.createdAt
          }))
        ].sort((a, b) => String(b.time).localeCompare(String(a.time))).slice(0, 8)

        this.systemStatus = [
          {
            label: '后台 API',
            status: health?.success ? '运行中' : '不可达',
            tone: health?.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          },
          {
            label: '数据库连接',
            status: health?.success ? '正常' : '待检查',
            tone: health?.success ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
          },
          {
            label: 'AI 解析链路',
            status: floorPlans.length > 0 ? '已接入' : '待联调',
            tone: floorPlans.length > 0 ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'
          }
        ]
      } catch (error) {
        console.error('获取统计数据失败:', error)
      }
    }
  }
}

function statsValue(value) {
  return value || 0
}

function recentActivitiesLabel(buildingCount, houseCount, floorPlanCount) {
  const score = buildingCount + houseCount + floorPlanCount

  if (score >= 20) {
    return '高'
  }

  if (score >= 8) {
    return '中'
  }

  return '低'
}

async function fetchBlocksForBuildings(buildings, concurrency = 4) {
  const normalizedConcurrency = Math.max(1, concurrency)
  const collectedBlocks = []

  for (let index = 0; index < buildings.length; index += normalizedConcurrency) {
    const batch = buildings.slice(index, index + normalizedConcurrency)
    const blockGroups = await Promise.all(
      batch.map(async (building) => {
        const blocks = await adminService.getBlocksByBuilding(building.id)
        return blocks.map((block) => ({
          ...block,
          buildingName: building.name
        }))
      })
    )

    collectedBlocks.push(...blockGroups.flat())
  }

  return collectedBlocks
}
</script>
