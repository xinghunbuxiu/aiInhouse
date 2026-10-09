<template>
  <div class="space-y-6">
    <!-- 操作栏 -->
    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
      <div class="flex gap-2">
        <select
          v-model="selectedBuilding"
          class="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">所有楼盘</option>
          <option v-for="building in buildings" :key="building.id" :value="building.id">
            {{ building.name }}
          </option>
        </select>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索房号..."
          class="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          @keyup.enter="handleSearch"
        />
        <button
          @click="handleSearch"
          class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          搜索
        </button>
      </div>
      <router-link
        to="/admin/houses/create"
        class="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
      >
        + 添加房屋
      </router-link>
    </div>

    <!-- 数据表格 -->
    <div class="bg-white rounded-lg shadow overflow-hidden">
      <table class="min-w-full">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">房号</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">所属楼盘</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">楼层</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">面积</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">房号</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">户型</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
          </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
          <tr v-for="house in paginatedHouses" :key="house.id" class="hover:bg-gray-50">
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="text-sm font-medium text-gray-900">{{ house.unitNumber }}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="text-sm text-gray-500">{{ house.buildingName }}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="text-sm text-gray-500">{{ house.floor }} 层</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="text-sm text-gray-500">{{ house.area }} m²</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="text-sm text-gray-500">{{ house.roomNumber || '未设置' }}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="text-sm text-gray-500">{{ house.layoutLabel }}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <span
                :class="{
                  'px-2 py-1 text-xs rounded-full': true,
                  'bg-green-100 text-green-800': house.status === 'available',
                  'bg-red-100 text-red-800': house.status === 'sold',
                  'bg-yellow-100 text-yellow-800': house.status === 'reserved'
                }"
              >
                {{ house.statusLabel }}
              </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
              <router-link
                :to="`/admin/houses/${house.id}`"
                class="text-blue-600 hover:text-blue-900 mr-3"
              >
                查看
              </router-link>
              <router-link
                :to="`/admin/houses/${house.id}/edit`"
                class="text-indigo-600 hover:text-indigo-900 mr-3"
              >
                编辑
              </router-link>
              <button
                @click="deleteHouse(house.id)"
                class="text-red-600 hover:text-red-900"
              >
                删除
              </button>
            </td>
          </tr>
          <tr v-if="paginatedHouses.length === 0">
            <td colspan="8" class="px-6 py-12 text-center">
              <div class="flex flex-col items-center justify-center space-y-4">
                <div class="text-6xl text-gray-300">🏢</div>
                <h3 class="text-lg font-medium text-gray-900">暂无房屋数据</h3>
                <p class="text-gray-500">点击上方的 "添加房屋" 按钮开始创建第一个房屋</p>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 分页 -->
    <div class="flex justify-between items-center">
      <div class="text-sm text-gray-500">
        显示 {{ startCount }} 到 {{ endCount }} 条，共 {{ total }} 条
      </div>
      <div class="flex gap-2">
        <button
          @click="prevPage"
          :disabled="currentPage === 1"
          class="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          上一页
        </button>
        <span class="px-3 py-1">{{ currentPage }} / {{ totalPages }}</span>
        <button
          @click="nextPage"
          :disabled="currentPage === totalPages"
          class="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          下一页
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { adminService } from '@/services/adminService'

export default {
  name: 'HouseList',
  data() {
    return {
      selectedBuilding: '',
      searchQuery: '',
      buildings: [],
      houses: [],
      currentPage: 1,
      pageSize: 10,
      total: 0
    }
  },
  computed: {
    filteredHouses() {
      const keyword = this.searchQuery.trim().toLowerCase()

      return this.houses.filter((house) => {
        const buildingMatched = !this.selectedBuilding || String(house.building_id) === String(this.selectedBuilding)
        const keywordMatched = !keyword || [house.unitNumber, house.roomNumber, house.buildingName, house.layout]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(keyword))

        return buildingMatched && keywordMatched
      })
    },
    paginatedHouses() {
      const start = (this.currentPage - 1) * this.pageSize
      return this.filteredHouses.slice(start, start + this.pageSize)
    },
    totalPages() {
      return Math.max(1, Math.ceil(this.total / this.pageSize))
    },
    startCount() {
      return this.total === 0 ? 0 : (this.currentPage - 1) * this.pageSize + 1
    },
    endCount() {
      return Math.min(this.currentPage * this.pageSize, this.total)
    }
  },
  mounted() {
    this.fetchBuildings()
    this.fetchHouses()
  },
  methods: {
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
        this.total = this.filteredHouses.length
      } catch (error) {
        console.error('获取房屋列表失败:', error)
      }
    },
    handleSearch() {
      this.currentPage = 1
      this.total = this.filteredHouses.length
    },
    prevPage() {
      if (this.currentPage > 1) {
        this.currentPage--
        this.fetchHouses()
      }
    },
    nextPage() {
      if (this.currentPage < this.totalPages) {
        this.currentPage++
        this.fetchHouses()
      }
    },
    async deleteHouse(id) {
      if (!confirm('确定要删除这个房屋吗？')) return

      try {
        await adminService.deleteHouse(id)
        this.houses = this.houses.filter(h => h.id !== id)
        this.total = this.filteredHouses.length
      } catch (error) {
        console.error('删除房屋失败:', error)
        alert(error.response?.data?.message || '删除失败')
      }
    }
  }
}
</script>
