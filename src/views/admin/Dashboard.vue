<template>
  <div class="space-y-6">
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <div class="bg-white rounded-lg shadow p-6">
        <div class="flex items-center">
          <div class="p-3 rounded-full bg-blue-100 text-blue-600">
            <span class="text-2xl">🏢</span>
          </div>
          <div class="ml-4">
            <p class="text-sm text-gray-600">楼盘总数</p>
            <p class="text-2xl font-bold text-gray-800">{{ stats.buildings }}</p>
          </div>
        </div>
      </div>
      
      <div class="bg-white rounded-lg shadow p-6">
        <div class="flex items-center">
          <div class="p-3 rounded-full bg-green-100 text-green-600">
            <span class="text-2xl">🏠</span>
          </div>
          <div class="ml-4">
            <p class="text-sm text-gray-600">房屋总数</p>
            <p class="text-2xl font-bold text-gray-800">{{ stats.houses }}</p>
          </div>
        </div>
      </div>
      
      <div class="bg-white rounded-lg shadow p-6">
        <div class="flex items-center">
          <div class="p-3 rounded-full bg-purple-100 text-purple-600">
            <span class="text-2xl">📐</span>
          </div>
          <div class="ml-4">
            <p class="text-sm text-gray-600">平面图总数</p>
            <p class="text-2xl font-bold text-gray-800">{{ stats.floorPlans }}</p>
          </div>
        </div>
      </div>
      
      <div class="bg-white rounded-lg shadow p-6">
        <div class="flex items-center">
          <div class="p-3 rounded-full bg-amber-100 text-amber-600">
            <span class="text-2xl">🎨</span>
          </div>
          <div class="ml-4">
            <p class="text-sm text-gray-600">已完成效果图</p>
            <p class="text-2xl font-bold text-gray-800">{{ stats.completedFloorPlans }}</p>
          </div>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="bg-white rounded-lg shadow p-6">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="text-lg font-semibold text-gray-800">最近活动</h3>
          <router-link to="/admin/statistics" class="text-sm text-blue-600 hover:text-blue-800">
            查看完整统计
          </router-link>
        </div>
        <div class="space-y-3">
          <div v-for="(activity, index) in recentActivities" :key="index" class="flex items-center p-3 bg-gray-50 rounded">
            <span class="text-2xl mr-3">{{ activity.icon }}</span>
            <div class="flex-1">
              <p class="text-sm font-medium text-gray-800">{{ activity.title }}</p>
              <p class="text-xs text-gray-500">{{ activity.time }}</p>
            </div>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-lg shadow p-6">
        <h3 class="text-lg font-semibold text-gray-800 mb-4">业务推进概览</h3>
        <div class="space-y-4">
          <div v-for="item in businessHighlights" :key="item.label" class="rounded-lg border border-gray-200 p-4">
            <div class="flex items-center justify-between">
              <span class="text-gray-600">{{ item.label }}</span>
              <span :class="['px-3 py-1 rounded-full text-sm', item.tone]">{{ item.value }}</span>
            </div>
            <p class="mt-2 text-sm text-gray-500">{{ item.description }}</p>
          </div>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
      <div class="bg-white rounded-lg shadow p-6">
        <h3 class="text-lg font-semibold text-gray-800 mb-4">快速操作</h3>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <router-link
            to="/admin/buildings/create"
            class="flex flex-col items-center p-4 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
          >
            <span class="text-3xl mb-2">🏢</span>
            <span class="text-sm text-gray-700">添加楼盘</span>
          </router-link>
          <router-link
            to="/admin/houses/create"
            class="flex flex-col items-center p-4 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
          >
            <span class="text-3xl mb-2">🏠</span>
            <span class="text-sm text-gray-700">添加房屋</span>
          </router-link>
          <router-link
            to="/admin/floor-plans/create"
            class="flex flex-col items-center p-4 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors"
          >
            <span class="text-3xl mb-2">📐</span>
            <span class="text-sm text-gray-700">上传平面图</span>
          </router-link>
          <router-link
            to="/admin/users/create"
            class="flex flex-col items-center p-4 bg-yellow-50 rounded-lg hover:bg-yellow-100 transition-colors"
          >
            <span class="text-3xl mb-2">👤</span>
            <span class="text-sm text-gray-700">添加用户</span>
          </router-link>
        </div>
      </div>

      <div class="bg-white rounded-lg shadow p-6">
        <h3 class="text-lg font-semibold text-gray-800 mb-4">进入分析页</h3>
        <div class="space-y-4">
          <router-link
            to="/admin/statistics"
            class="block rounded-xl border border-blue-200 bg-blue-50 p-4 transition-colors hover:bg-blue-100"
          >
            <p class="font-medium text-blue-900">统计分析</p>
            <p class="mt-1 text-sm text-blue-700">查看楼盘经营概览、AI成熟度、处理状态和系统健康。</p>
          </router-link>
          <router-link
            to="/admin/floor-plans"
            class="block rounded-xl border border-purple-200 bg-purple-50 p-4 transition-colors hover:bg-purple-100"
          >
            <p class="font-medium text-purple-900">交付中心</p>
            <p class="mt-1 text-sm text-purple-700">继续处理平面图、导出正式图、管理交付快照和版本对比。</p>
          </router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { adminService } from '@/services/adminService'

export default {
  name: 'Dashboard',
  data() {
    return {
      stats: {
        buildings: 0,
        houses: 0,
        floorPlans: 0,
        completedFloorPlans: 0
      },
      recentActivities: [],
      businessHighlights: []
    }
  },
  mounted() {
    this.fetchStats()
  },
  methods: {
    async fetchStats() {
      try {
        const [buildings, houses, floorPlans, health] = await Promise.all([
          adminService.getBuildings(),
          adminService.getHouses(),
          adminService.getFloorPlans(),
          adminService.getHealth().catch(() => null)
        ])

        this.stats = {
          buildings: buildings.length,
          houses: houses.length,
          floorPlans: floorPlans.length,
          completedFloorPlans: floorPlans.filter((item) => item.parse_status === 'completed').length
        }

        this.recentActivities = [
          ...floorPlans.slice(0, 3).map((item) => ({
            icon: '📐',
            title: `上传平面图：${item.name || '未命名平面图'}`,
            time: item.createdAt
          })),
          ...houses.slice(0, 2).map((item) => ({
            icon: '🏠',
            title: `登记房屋：${item.buildingName || '未分配楼盘'} ${item.unitNumber || ''}`.trim(),
            time: item.createdAt
          })),
          ...buildings.slice(0, 2).map((item) => ({
            icon: '🏢',
            title: `新增楼盘：${item.name}`,
            time: item.createdAt
          }))
        ].slice(0, 6)

        this.businessHighlights = [
          {
            label: '后台接口状态',
            value: health?.success ? '正常' : '异常',
            tone: health?.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          },
          {
            label: 'AI 处理进度',
            value: `${this.stats.completedFloorPlans}/${this.stats.floorPlans || 0}`,
            tone: 'bg-blue-100 text-blue-800',
            description: '已完成解析和交付处理的平面图数量。'
          },
          {
            label: '最近业务热度',
            value: recentActivitiesLabel(buildings.length, houses.length, floorPlans.length),
            tone: 'bg-amber-100 text-amber-800',
            description: '根据当前楼盘、房屋和平面图数据量给出的业务活跃度判断。'
          },
          {
            label: '分析入口',
            value: '已收敛',
            tone: 'bg-purple-100 text-purple-800',
            description: '详细统计已集中到“统计分析”页面，仪表盘只保留概览和入口。'
          }
        ]
      } catch (error) {
        console.error('获取统计数据失败:', error)
      }
    }
  }
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
</script>
