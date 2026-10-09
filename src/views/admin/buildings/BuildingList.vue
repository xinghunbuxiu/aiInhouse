<template>
  <div class="space-y-6">
    <!-- 操作栏 -->
    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
      <div class="flex gap-2">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索楼盘名称..."
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
        to="/admin/buildings/create"
        class="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
      >
        + 添加楼盘
      </router-link>
    </div>

    <!-- 数据表格 -->
    <div class="bg-white rounded-lg shadow overflow-hidden">
      <table class="min-w-full">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">楼盘名称</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">地址</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">开发商</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">描述</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
          </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
          <tr v-for="building in paginatedBuildings" :key="building.id" class="hover:bg-gray-50">
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="text-sm font-medium text-gray-900">{{ building.name }}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="text-sm text-gray-500">{{ building.address }}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="text-sm text-gray-500">{{ building.developer }}</div>
            </td>
            <td class="px-6 py-4">
              <div class="text-sm text-gray-500 truncate max-w-xs">{{ building.description || '无' }}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <span
                :class="{
                  'px-2 py-1 text-xs rounded-full': true,
                  'bg-green-100 text-green-800': building.status === 1,
                  'bg-gray-100 text-gray-800': building.status === 0
                }"
              >
                {{ building.statusLabel }}
              </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
              <router-link
                :to="`/admin/buildings/${building.id}`"
                class="text-blue-600 hover:text-blue-900 mr-3"
              >
                查看
              </router-link>
              <router-link
                :to="`/admin/buildings/${building.id}/edit`"
                class="text-indigo-600 hover:text-indigo-900 mr-3"
              >
                编辑
              </router-link>
              <button
                @click="deleteBuilding(building.id)"
                class="text-red-600 hover:text-red-900"
              >
                删除
              </button>
            </td>
          </tr>
          <tr v-if="paginatedBuildings.length === 0">
            <td colspan="6" class="px-6 py-12 text-center">
              <div class="flex flex-col items-center justify-center space-y-4">
                <div class="text-6xl text-gray-300">🏠</div>
                <h3 class="text-lg font-medium text-gray-900">暂无楼盘数据</h3>
                <p class="text-gray-500">点击上方的 "添加楼盘" 按钮开始创建第一个楼盘</p>
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
  name: 'BuildingList',
  data() {
    return {
      searchQuery: '',
      buildings: [],
      currentPage: 1,
      pageSize: 10,
      total: 0
    }
  },
  computed: {
    filteredBuildings() {
      const keyword = this.searchQuery.trim().toLowerCase()

      return this.buildings.filter((building) => {
        if (!keyword) {
          return true
        }

        return [building.name, building.address, building.developer]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(keyword))
      })
    },
    paginatedBuildings() {
      const start = (this.currentPage - 1) * this.pageSize
      return this.filteredBuildings.slice(start, start + this.pageSize)
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
  },
  methods: {
    async fetchBuildings() {
      try {
        this.buildings = await adminService.getBuildings()
        this.total = this.filteredBuildings.length
      } catch (error) {
        console.error('获取楼盘列表失败:', error)
      }
    },
    handleSearch() {
      this.currentPage = 1
      this.total = this.filteredBuildings.length
    },
    prevPage() {
      if (this.currentPage > 1) {
        this.currentPage--
        this.fetchBuildings()
      }
    },
    nextPage() {
      if (this.currentPage < this.totalPages) {
        this.currentPage++
        this.fetchBuildings()
      }
    },
    async deleteBuilding(id) {
      if (!confirm('确定要删除这个楼盘吗？')) return
      
      try {
        await adminService.deleteBuilding(id)
        this.buildings = this.buildings.filter(b => b.id !== id)
        this.total = this.filteredBuildings.length
      } catch (error) {
        console.error('删除楼盘失败:', error)
        alert(error.response?.data?.message || '删除失败')
      }
    }
  }
}
</script>
