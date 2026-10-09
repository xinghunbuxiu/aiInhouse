<template>
  <div class="mx-auto max-w-2xl">
    <div class="rounded-lg bg-white p-6 shadow">
      <h2 class="mb-6 text-2xl font-bold text-gray-800">
        {{ isEdit ? '编辑楼盘' : '创建楼盘' }}
      </h2>

      <form @submit.prevent="handleSubmit" class="space-y-6">
        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700">楼盘名称 *</label>
          <input
            v-model="form.name"
            type="text"
            required
            class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="请输入社区或楼盘名称"
          />
        </div>

        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700">地址 *</label>
          <input
            v-model="form.address"
            type="text"
            required
            class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="请输入项目地址"
          />
        </div>

        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700">开发商 *</label>
          <input
            v-model="form.developer"
            type="text"
            required
            class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="请输入开发商名称"
          />
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
            placeholder="请输入楼盘描述"
          />
        </div>

        <div class="flex gap-4">
          <button
            type="submit"
            :disabled="isSubmitting"
            class="flex-1 rounded-lg bg-blue-500 px-4 py-2 text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {{ isSubmitting ? '保存中...' : isEdit ? '保存修改' : '创建楼盘' }}
          </button>
          <router-link
            to="/admin/buildings"
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
  name: 'BuildingForm',
  data() {
    return {
      isSubmitting: false,
      form: {
        name: '',
        address: '',
        developer: '',
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
  mounted() {
    if (this.isEdit) {
      this.fetchBuilding()
    }
  },
  methods: {
    async fetchBuilding() {
      try {
        const building = await adminService.getBuilding(this.$route.params.id)
        this.form = {
          name: building.name || '',
          address: building.address || '',
          developer: building.developer || '',
          status: building.status ?? 1,
          description: building.description || ''
        }
      } catch (error) {
        console.error('获取楼盘信息失败:', error)
      }
    },
    async handleSubmit() {
      this.isSubmitting = true

      try {
        const payload = {
          name: this.form.name,
          address: this.form.address,
          developer: this.form.developer,
          description: this.form.description
        }

        if (this.isEdit) {
          await adminService.updateBuilding(this.$route.params.id, {
            ...payload,
            status: this.form.status
          })
        } else {
          await adminService.createBuilding(payload)
        }

        this.$router.push('/admin/buildings')
      } catch (error) {
        console.error('保存楼盘失败:', error)
        alert(error.response?.data?.message || '保存失败')
      } finally {
        this.isSubmitting = false
      }
    }
  }
}
</script>
