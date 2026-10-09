<template>
  <div class="space-y-6">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div class="flex flex-col gap-3 sm:flex-row">
        <select
          v-model="selectedBuilding"
          class="rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">全部社区/楼盘</option>
          <option v-for="building in buildings" :key="building.id" :value="building.id">
            {{ building.name }}
          </option>
        </select>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索楼栋号..."
          class="rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          @keyup.enter="handleSearch"
        />
        <button
          @click="handleSearch"
          class="rounded-lg bg-blue-500 px-4 py-2 text-white transition-colors hover:bg-blue-600"
        >
          搜索
        </button>
      </div>
      <router-link
        to="/admin/blocks/create"
        class="rounded-lg bg-green-500 px-4 py-2 text-white transition-colors hover:bg-green-600"
      >
        + 新增楼栋
      </router-link>
    </div>

    <div class="overflow-hidden rounded-lg bg-white shadow">
      <table class="min-w-full">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">楼栋号</th>
            <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">所属楼盘</th>
            <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">总层数</th>
            <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">总户数</th>
            <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">状态</th>
            <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 bg-white">
          <tr v-for="block in paginatedBlocks" :key="block.id" class="hover:bg-gray-50">
            <td class="px-6 py-4 text-sm font-medium text-gray-900">{{ block.blockNumber }}</td>
            <td class="px-6 py-4 text-sm text-gray-500">{{ block.buildingName }}</td>
            <td class="px-6 py-4 text-sm text-gray-500">{{ block.totalFloors || '未设置' }}</td>
            <td class="px-6 py-4 text-sm text-gray-500">{{ block.totalUnits || '未设置' }}</td>
            <td class="px-6 py-4 whitespace-nowrap">
              <span
                :class="[
                  'rounded-full px-2 py-1 text-xs',
                  block.status === 1 ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                ]"
              >
                {{ block.status === 1 ? '启用' : '禁用' }}
              </span>
            </td>
            <td class="px-6 py-4 text-sm font-medium">
              <router-link :to="`/admin/blocks/${block.id}/edit`" class="mr-3 text-indigo-600 hover:text-indigo-900">
                编辑
              </router-link>
              <button @click="deleteBlock(block.id)" class="text-red-600 hover:text-red-900">
                删除
              </button>
            </td>
          </tr>
          <tr v-if="paginatedBlocks.length === 0">
            <td colspan="6" class="px-6 py-12 text-center text-gray-500">
              暂无楼栋数据，请先创建楼栋以便录入房屋。
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="flex items-center justify-between">
      <div class="text-sm text-gray-500">
        显示 {{ startCount }} 到 {{ endCount }} 条，共 {{ total }} 条
      </div>
      <div class="flex gap-2">
        <button
          @click="prevPage"
          :disabled="currentPage === 1"
          class="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          上一页
        </button>
        <span class="px-3 py-1">{{ currentPage }} / {{ totalPages }}</span>
        <button
          @click="nextPage"
          :disabled="currentPage === totalPages"
          class="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
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
  name: 'BlockList',
  data() {
    return {
      buildings: [],
      blocks: [],
      selectedBuilding: '',
      searchQuery: '',
      currentPage: 1,
      pageSize: 10,
      total: 0
    }
  },
  computed: {
    filteredBlocks() {
      const keyword = this.searchQuery.trim().toLowerCase()

      return this.blocks.filter((block) => {
        const buildingMatched = !this.selectedBuilding || String(block.buildingId) === String(this.selectedBuilding)
        const keywordMatched = !keyword || [block.blockNumber, block.buildingName]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(keyword))

        return buildingMatched && keywordMatched
      })
    },
    paginatedBlocks() {
      const start = (this.currentPage - 1) * this.pageSize
      return this.filteredBlocks.slice(start, start + this.pageSize)
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
    this.fetchData()
  },
  methods: {
    async fetchData() {
      try {
        this.buildings = await adminService.getBuildings()

        const blockGroups = await Promise.all(
          this.buildings.map(async (building) => {
            const blocks = await adminService.getBlocksByBuilding(building.id)
            return blocks.map((block) => ({
              ...block,
              buildingName: building.name
            }))
          })
        )

        this.blocks = blockGroups.flat()
        this.total = this.filteredBlocks.length
      } catch (error) {
        console.error('获取楼栋列表失败:', error)
      }
    },
    handleSearch() {
      this.currentPage = 1
      this.total = this.filteredBlocks.length
    },
    prevPage() {
      if (this.currentPage > 1) {
        this.currentPage--
      }
    },
    nextPage() {
      if (this.currentPage < this.totalPages) {
        this.currentPage++
      }
    },
    async deleteBlock(id) {
      if (!confirm('确定要删除这个楼栋吗？')) {
        return
      }

      try {
        await adminService.deleteBlock(id)
        this.blocks = this.blocks.filter((item) => item.id !== id)
        this.total = this.filteredBlocks.length
      } catch (error) {
        console.error('删除楼栋失败:', error)
        alert(error.response?.data?.message || '删除失败')
      }
    }
  }
}
</script>
