<template>
  <div class="mx-auto max-w-2xl">
    <div class="rounded-lg bg-white p-6 shadow">
      <h2 class="mb-6 text-2xl font-bold text-gray-800">
        {{ isEdit ? '编辑楼栋' : '创建楼栋' }}
      </h2>

      <form @submit.prevent="handleSubmit" class="space-y-6">
        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700">所属楼盘 *</label>
          <select
            v-model="form.buildingId"
            required
            class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">请选择楼盘</option>
            <option v-for="building in buildings" :key="building.id" :value="building.id">
              {{ building.name }}
            </option>
          </select>
        </div>

        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700">楼栋号 *</label>
          <input
            v-model="form.blockNumber"
            type="text"
            required
            class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="例如：1号楼、A栋"
          />
        </div>

        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700">总层数</label>
            <input
              v-model.number="form.totalFloors"
              type="number"
              min="1"
              class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="例如：18"
            />
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700">总户数</label>
            <input
              v-model.number="form.totalUnits"
              type="number"
              min="1"
              class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="例如：72"
            />
          </div>
        </div>

        <div v-if="isEdit">
          <label class="mb-2 block text-sm font-medium text-gray-700">状态</label>
          <select
            v-model.number="form.status"
            class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option :value="1">启用</option>
            <option :value="0">禁用</option>
          </select>
        </div>

        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700">描述</label>
          <textarea
            v-model="form.description"
            rows="4"
            class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="请输入楼栋描述"
          />
        </div>

        <div class="flex gap-4">
          <button
            type="submit"
            :disabled="isSubmitting"
            class="flex-1 rounded-lg bg-blue-500 px-4 py-2 text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {{ isSubmitting ? '保存中...' : isEdit ? '保存修改' : '创建楼栋' }}
          </button>
          <router-link
            to="/admin/blocks"
            class="flex-1 rounded-lg bg-gray-300 px-4 py-2 text-center text-gray-700 transition-colors hover:bg-gray-400"
          >
            取消
          </router-link>
        </div>
      </form>
    </div>
  </div>
</template>

<script>
import { adminService } from '@/services/adminService'

export default {
  name: 'BlockForm',
  data() {
    return {
      buildings: [],
      isSubmitting: false,
      form: {
        buildingId: '',
        blockNumber: '',
        totalFloors: null,
        totalUnits: null,
        status: 1,
        description: ''
      }
    }
  },
  computed: {
    isEdit() {
      return this.$route.params.id !== undefined
    }
  },
  async mounted() {
    await this.fetchBuildings()

    const buildingId = this.$route.query.buildingId
    if (buildingId && !this.isEdit) {
      this.form.buildingId = Number(buildingId)
    }

    if (this.isEdit) {
      await this.fetchBlock()
    }
  },
  methods: {
    async fetchBuildings() {
      this.buildings = await adminService.getBuildings()
    },
    async fetchBlock() {
      try {
        const block = await adminService.getBlock(this.$route.params.id)
        this.form = {
          buildingId: block.buildingId,
          blockNumber: block.blockNumber,
          totalFloors: block.totalFloors,
          totalUnits: block.totalUnits,
          status: block.status,
          description: block.description || ''
        }
      } catch (error) {
        console.error('获取楼栋信息失败:', error)
      }
    },
    async handleSubmit() {
      this.isSubmitting = true

      try {
        const payload = {
          building_id: this.form.buildingId,
          block_number: this.form.blockNumber,
          total_floors: this.form.totalFloors || null,
          total_units: this.form.totalUnits || null,
          description: this.form.description || ''
        }

        if (this.isEdit) {
          await adminService.updateBlock(this.$route.params.id, {
            ...payload,
            status: this.form.status
          })
        } else {
          await adminService.createBlock(payload)
        }

        this.$router.push('/admin/blocks')
      } catch (error) {
        console.error('保存楼栋失败:', error)
        alert(error.response?.data?.message || '保存失败')
      } finally {
        this.isSubmitting = false
      }
    }
  }
}
</script>
