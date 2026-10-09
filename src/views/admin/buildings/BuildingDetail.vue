<template>
  <div class="space-y-6">
    <div class="flex items-center">
      <router-link
        to="/admin/buildings"
        class="flex items-center text-gray-600 transition-colors hover:text-gray-800"
      >
        <span class="mr-2">←</span>
        返回楼盘列表
      </router-link>
    </div>

    <div class="rounded-lg bg-white p-6 shadow">
      <div class="mb-6 flex justify-between items-start">
        <div>
          <h1 class="mb-2 text-3xl font-bold text-gray-800">{{ building.name }}</h1>
          <p class="text-gray-600">{{ building.address }}</p>
        </div>
        <span
          :class="[
            'rounded-full px-4 py-2 text-sm font-medium',
            building.status === 1 ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
          ]"
        >
          {{ building.statusLabel }}
        </span>
      </div>

      <div class="mb-6 grid grid-cols-1 gap-6 md:grid-cols-4">
        <div class="rounded-lg bg-gray-50 p-4">
          <p class="mb-1 text-sm text-gray-600">开发商</p>
          <p class="text-lg font-semibold text-gray-800">{{ building.developer || '未填写' }}</p>
        </div>
        <div class="rounded-lg bg-blue-50 p-4">
          <p class="mb-1 text-sm text-blue-600">楼栋数量</p>
          <p class="text-lg font-semibold text-blue-800">{{ blockStats.totalBlocks }}</p>
        </div>
        <div class="rounded-lg bg-emerald-50 p-4">
          <p class="mb-1 text-sm text-emerald-600">房屋数量</p>
          <p class="text-lg font-semibold text-emerald-800">{{ houseTotal }}</p>
        </div>
        <div class="rounded-lg bg-amber-50 p-4">
          <p class="mb-1 text-sm text-amber-600">总户数配置</p>
          <p class="text-lg font-semibold text-amber-800">{{ blockStats.totalUnits }}</p>
        </div>
      </div>

      <div class="mb-6">
        <h3 class="mb-2 text-lg font-semibold text-gray-800">楼盘描述</h3>
        <p class="leading-relaxed text-gray-600">{{ building.description || '暂无描述' }}</p>
      </div>

      <div class="flex gap-4">
        <router-link
          :to="`/admin/buildings/${building.id}/edit`"
          class="rounded-lg bg-blue-500 px-4 py-2 text-white transition-colors hover:bg-blue-600"
        >
          编辑楼盘
        </router-link>
        <button
          @click="deleteBuilding"
          class="rounded-lg bg-red-500 px-4 py-2 text-white transition-colors hover:bg-red-600"
        >
          删除楼盘
        </button>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div class="rounded-lg bg-white p-6 shadow xl:col-span-1">
        <div class="mb-6 flex items-center justify-between">
          <h2 class="text-xl font-semibold text-gray-800">楼栋概览</h2>
          <router-link
            :to="`/admin/blocks/create?buildingId=${building.id}`"
            class="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-600 transition-colors hover:bg-blue-100"
          >
            + 新增楼栋
          </router-link>
        </div>

        <div v-if="blocks.length === 0" class="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
          当前楼盘还没有楼栋，请先补充楼栋信息。
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="block in blocks"
            :key="block.id"
            class="rounded-lg border border-gray-200 p-4 transition-colors hover:border-blue-200 hover:bg-blue-50/40"
          >
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="font-semibold text-gray-900">{{ block.blockNumber }}</p>
                <p class="mt-1 text-sm text-gray-500">
                  {{ block.totalFloors || '未设置' }} 层 · {{ block.totalUnits || '未设置' }} 户
                </p>
              </div>
              <span
                :class="[
                  'rounded-full px-2 py-1 text-xs',
                  block.status === 1 ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                ]"
              >
                {{ block.status === 1 ? '启用' : '禁用' }}
              </span>
            </div>

            <div class="mt-3 flex items-center justify-between text-sm">
              <span class="text-gray-500">已录入房屋 {{ getBlockHouseCount(block.id) }} 套</span>
              <div class="flex gap-3">
                <router-link :to="`/admin/houses/create?buildingId=${building.id}`" class="text-blue-600 hover:text-blue-800">
                  加房屋
                </router-link>
                <router-link :to="`/admin/blocks/${block.id}/edit`" class="text-indigo-600 hover:text-indigo-800">
                  编辑
                </router-link>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="rounded-lg bg-white p-6 shadow xl:col-span-2">
        <div class="mb-6 flex items-center justify-between">
          <h2 class="text-xl font-semibold text-gray-800">房屋列表</h2>
          <router-link
            :to="`/admin/houses/create?buildingId=${building.id}`"
            class="rounded-lg bg-green-500 px-4 py-2 text-white transition-colors hover:bg-green-600"
          >
            + 添加房屋
          </router-link>
        </div>

        <div class="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div class="rounded-lg bg-slate-50 p-4">
            <p class="text-sm text-slate-500">在售房屋</p>
            <p class="mt-1 text-2xl font-bold text-slate-800">{{ houseStats.available }}</p>
          </div>
          <div class="rounded-lg bg-rose-50 p-4">
            <p class="text-sm text-rose-500">已售房屋</p>
            <p class="mt-1 text-2xl font-bold text-rose-700">{{ houseStats.sold }}</p>
          </div>
          <div class="rounded-lg bg-amber-50 p-4">
            <p class="text-sm text-amber-600">预留房屋</p>
            <p class="mt-1 text-2xl font-bold text-amber-700">{{ houseStats.reserved }}</p>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="min-w-full">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">楼栋</th>
                <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">单元号</th>
                <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">楼层</th>
                <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">面积</th>
                <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">房号</th>
                <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">户型</th>
                <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">状态</th>
                <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 bg-white">
              <tr v-for="house in paginatedHouses" :key="house.id" class="hover:bg-gray-50">
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{{ house.blockNumber || '未分配' }}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{{ house.unitNumber }}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{{ house.floor }} 层</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{{ house.area }} m²</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{{ house.roomNumber || '未设置' }}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{{ house.layoutLabel }}</td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <span
                    :class="[
                      'rounded-full px-2 py-1 text-xs',
                      house.status === 'available' ? 'bg-green-100 text-green-800' : '',
                      house.status === 'sold' ? 'bg-red-100 text-red-800' : '',
                      house.status === 'reserved' ? 'bg-yellow-100 text-yellow-800' : ''
                    ]"
                  >
                    {{ house.statusLabel }}
                  </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <router-link :to="`/admin/houses/${house.id}`" class="mr-3 text-blue-600 hover:text-blue-900">
                    查看
                  </router-link>
                  <router-link :to="`/admin/houses/${house.id}/edit`" class="text-indigo-600 hover:text-indigo-900">
                    编辑
                  </router-link>
                </td>
              </tr>
              <tr v-if="paginatedHouses.length === 0">
                <td colspan="8" class="px-6 py-12 text-center text-gray-500">
                  当前楼盘还没有房屋记录，请先添加楼栋与房屋。
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="mt-6 flex items-center justify-between">
          <div class="text-sm text-gray-500">
            显示 {{ houseStartCount }} 到 {{ houseEndCount }} 条，共 {{ houseTotal }} 条
          </div>
          <div class="flex gap-2">
            <button
              @click="prevHousePage"
              :disabled="housePage === 1"
              class="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              上一页
            </button>
            <span class="px-3 py-1">{{ housePage }} / {{ houseTotalPages }}</span>
            <button
              @click="nextHousePage"
              :disabled="housePage === houseTotalPages"
              class="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              下一页
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { adminService } from '@/services/adminService'

export default {
  name: 'BuildingDetail',
  data() {
    return {
      building: {
        id: '',
        name: '',
        address: '',
        developer: '',
        status: 1,
        statusLabel: '启用',
        description: '',
        createdAt: ''
      },
      blocks: [],
      houses: [],
      housePage: 1,
      housePageSize: 10,
      houseTotal: 0
    }
  },
  computed: {
    blockStats() {
      return {
        totalBlocks: this.blocks.length,
        totalUnits: this.blocks.reduce((sum, block) => sum + (Number(block.totalUnits) || 0), 0)
      }
    },
    houseStats() {
      return {
        available: this.houses.filter((house) => house.status === 'available').length,
        sold: this.houses.filter((house) => house.status === 'sold').length,
        reserved: this.houses.filter((house) => house.status === 'reserved').length
      }
    },
    paginatedHouses() {
      const start = (this.housePage - 1) * this.housePageSize
      return this.houses.slice(start, start + this.housePageSize)
    },
    houseTotalPages() {
      return Math.max(1, Math.ceil(this.houseTotal / this.housePageSize))
    },
    houseStartCount() {
      return this.houseTotal === 0 ? 0 : (this.housePage - 1) * this.housePageSize + 1
    },
    houseEndCount() {
      return Math.min(this.housePage * this.housePageSize, this.houseTotal)
    }
  },
  mounted() {
    this.fetchBuilding()
    this.fetchBlocks()
    this.fetchHouses()
  },
  methods: {
    async fetchBuilding() {
      try {
        this.building = await adminService.getBuilding(this.$route.params.id)
      } catch (error) {
        console.error('获取楼盘信息失败:', error)
      }
    },
    async fetchBlocks() {
      try {
        this.blocks = await adminService.getBlocksByBuilding(this.$route.params.id)
      } catch (error) {
        console.error('获取楼栋列表失败:', error)
      }
    },
    async fetchHouses() {
      try {
        this.houses = await adminService.getHouses({ building_id: this.$route.params.id })
        this.houseTotal = this.houses.length
      } catch (error) {
        console.error('获取房屋列表失败:', error)
      }
    },
    getBlockHouseCount(blockId) {
      return this.houses.filter((house) => String(house.block_id) === String(blockId)).length
    },
    prevHousePage() {
      if (this.housePage > 1) {
        this.housePage--
      }
    },
    nextHousePage() {
      if (this.housePage < this.houseTotalPages) {
        this.housePage++
      }
    },
    async deleteBuilding() {
      if (!confirm('确定要删除这个楼盘吗？此操作不可恢复。')) {
        return
      }

      try {
        await adminService.deleteBuilding(this.building.id)
        this.$router.push('/admin/buildings')
      } catch (error) {
        console.error('删除楼盘失败:', error)
        alert(error.response?.data?.message || '删除失败')
      }
    }
  }
}
</script>
