<template>
  <div class="space-y-6">
    <!-- 返回按钮 -->
    <div class="flex items-center">
      <router-link
        to="/admin/houses"
        class="flex items-center text-gray-600 hover:text-gray-800 transition-colors"
      >
        <span class="mr-2">←</span>
        返回房屋列表
      </router-link>
    </div>

    <!-- 房屋信息卡片 -->
    <div class="bg-white rounded-lg shadow p-6">
      <div class="flex justify-between items-start mb-6">
        <div>
          <h1 class="text-3xl font-bold text-gray-800 mb-2">{{ house.unitNumber }}</h1>
          <p class="text-gray-600">{{ house.buildingName }}</p>
        </div>
        <span
          :class="{
            'px-4 py-2 rounded-full text-sm font-medium': true,
            'bg-green-100 text-green-800': house.status === 'available',
            'bg-red-100 text-red-800': house.status === 'sold',
            'bg-yellow-100 text-yellow-800': house.status === 'reserved'
          }"
        >
          {{ house.statusLabel }}
        </span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        <div class="bg-gray-50 rounded-lg p-4">
          <p class="text-sm text-gray-600 mb-1">楼层</p>
          <p class="text-lg font-semibold text-gray-800">{{ house.floor }} 层</p>
        </div>
        <div class="bg-gray-50 rounded-lg p-4">
          <p class="text-sm text-gray-600 mb-1">面积</p>
          <p class="text-lg font-semibold text-gray-800">{{ house.area }} m²</p>
        </div>
        <div class="bg-gray-50 rounded-lg p-4">
          <p class="text-sm text-gray-600 mb-1">房间数</p>
          <p class="text-lg font-semibold text-gray-800">{{ house.rooms }} 室</p>
        </div>
        <div class="bg-gray-50 rounded-lg p-4">
          <p class="text-sm text-gray-600 mb-1">户型</p>
          <p class="text-lg font-semibold text-gray-800">{{ house.layoutLabel }}</p>
        </div>
      </div>

      <div class="mb-6">
        <h3 class="text-lg font-semibold text-gray-800 mb-2">房屋描述</h3>
        <p class="text-gray-600 leading-relaxed">{{ house.description }}</p>
      </div>

      <div class="flex gap-4">
        <router-link
          :to="`/admin/houses/${house.id}/edit`"
          class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          编辑房屋
        </router-link>
        <button
          @click="deleteHouse"
          class="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
        >
          删除房屋
        </button>
      </div>
    </div>

    <!-- 平面图列表 -->
    <div class="bg-white rounded-lg shadow p-6">
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-xl font-semibold text-gray-800">平面图列表</h2>
        <router-link
          :to="`/admin/floor-plans/create?houseId=${house.id}`"
          class="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
        >
          + 上传平面图
        </router-link>
      </div>

      <div v-if="floorPlans.length === 0" class="text-center py-8 text-gray-500">
        暂无平面图，请点击"上传平面图"按钮添加
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div
          v-for="plan in floorPlans"
          :key="plan.id"
          class="border border-gray-200 rounded-lg overflow-hidden hover:shadow-lg transition-shadow"
        >
          <div class="aspect-video bg-gray-100 flex items-center justify-center">
            <img
              v-if="plan.imageUrl"
              :src="plan.imageUrl"
              :alt="plan.name"
              class="w-full h-full object-cover"
            />
            <span v-else class="text-gray-400 text-4xl">📐</span>
          </div>
          <div class="p-4">
            <h3 class="font-semibold text-gray-800 mb-2">{{ plan.name }}</h3>
            <div class="flex items-center justify-between mb-3">
              <span
                :class="{
                  'px-2 py-1 text-xs rounded-full': true,
                  'bg-yellow-100 text-yellow-800': plan.parse_status === 'pending',
                  'bg-blue-100 text-blue-800': plan.parse_status === 'processing',
                  'bg-green-100 text-green-800': plan.parse_status === 'completed',
                  'bg-red-100 text-red-800': plan.parse_status === 'failed'
                }"
              >
                {{ plan.statusLabel }}
              </span>
              <span class="text-sm text-gray-500">{{ plan.createdAt }}</span>
            </div>
            <div class="mb-3 flex flex-wrap gap-2 text-xs">
              <span :class="['rounded-full px-2 py-1', plan.parseOk ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700']">
                解析 {{ plan.parseOk ? 'OK' : '待处理' }}
              </span>
              <span :class="['rounded-full px-2 py-1', plan.threeDOk ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600']">
                3D {{ plan.threeDOk ? 'OK' : '未生成' }}
              </span>
              <span :class="['rounded-full px-2 py-1', plan.panoramaOk ? 'bg-fuchsia-100 text-fuchsia-700' : 'bg-slate-100 text-slate-600']">
                全景 {{ plan.panoramaOk ? 'OK' : '未生成' }}
              </span>
            </div>
            <div class="flex gap-2">
              <router-link
                :to="`/admin/floor-plans/${plan.id}`"
                class="flex-1 px-3 py-2 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 transition-colors text-center"
              >
                查看详情
              </router-link>
              <button
                v-if="plan.panoramaOk"
                @click="viewPanorama(plan)"
                class="flex-1 px-3 py-2 bg-purple-500 text-white text-sm rounded hover:bg-purple-600 transition-colors"
              >
                查看全景配置
              </button>
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
  name: 'HouseDetail',
  data() {
    return {
      house: {
        id: '',
        unitNumber: '',
        buildingName: '',
        floor: 0,
        area: 0,
        rooms: 0,
        layoutLabel: '',
        status: 'available',
        statusLabel: '在售',
        description: ''
      },
      floorPlans: []
    }
  },
  mounted() {
    this.fetchHouse()
    this.fetchFloorPlans()
  },
  methods: {
    async fetchHouse() {
      try {
        const id = this.$route.params.id
        this.house = await adminService.getHouse(id)
      } catch (error) {
        console.error('获取房屋信息失败:', error)
      }
    },
    async fetchFloorPlans() {
      try {
        const houseId = this.$route.params.id
        this.floorPlans = await adminService.getFloorPlans({ house_id: houseId })
      } catch (error) {
        console.error('获取平面图列表失败:', error)
      }
    },
    viewPanorama(plan) {
      if (!plan.panoramaOk) {
        alert('当前平面图还没有生成全景配置')
        return
      }

      this.$router.push(`/admin/floor-plans/${plan.id}`)
    },
    async deleteHouse() {
      if (!confirm('确定要删除这个房屋吗？此操作不可恢复。')) return

      try {
        await adminService.deleteHouse(this.house.id)
        this.$router.push('/admin/houses')
      } catch (error) {
        console.error('删除房屋失败:', error)
        alert(error.response?.data?.message || '删除失败')
      }
    }
  }
}
</script>
