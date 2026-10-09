<template>
  <div class="mx-auto max-w-2xl">
    <div class="rounded-lg bg-white p-6 shadow">
      <h2 class="mb-6 text-2xl font-bold text-gray-800">
        {{ isEdit ? '编辑房屋' : '创建房屋' }}
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
          <div class="mb-2 flex items-center justify-between">
            <label class="block text-sm font-medium text-gray-700">所属楼栋 *</label>
            <router-link
              v-if="form.buildingId"
              :to="`/admin/blocks/create?buildingId=${form.buildingId}`"
              class="text-sm text-blue-600 hover:text-blue-800"
            >
              去新增楼栋
            </router-link>
          </div>
          <select
            v-model="form.blockId"
            required
            :disabled="blocks.length === 0"
            class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
          >
            <option value="">请选择楼栋</option>
            <option v-for="block in blocks" :key="block.id" :value="block.id">
              {{ block.blockNumber }}
            </option>
          </select>
          <p v-if="form.buildingId && blocks.length === 0" class="mt-2 text-sm text-amber-600">
            当前楼盘还没有楼栋，请先创建楼栋后再录入房屋。
          </p>
        </div>

        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700">单元号 *</label>
            <input
              v-model="form.unitNumber"
              type="text"
              required
              class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="例如：1单元"
            />
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700">房号</label>
            <input
              v-model="form.roomNumber"
              type="text"
              class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="例如：101"
            />
          </div>
        </div>

        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700">楼层 *</label>
            <input
              v-model.number="form.floor"
              type="number"
              required
              min="1"
              class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700">面积 (m²) *</label>
            <input
              v-model.number="form.area"
              type="number"
              required
              min="1"
              step="0.01"
              class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700">房间数 *</label>
            <input
              v-model.number="form.rooms"
              type="number"
              required
              min="1"
              class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700">户型</label>
            <input
              v-model="form.layout"
              type="text"
              class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="例如：3室2厅2卫"
            />
          </div>
        </div>

        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700">状态 *</label>
          <select
            v-model="form.status"
            required
            class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="available">在售</option>
            <option value="sold">已售</option>
            <option value="reserved">预留</option>
          </select>
        </div>

        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700">描述</label>
          <textarea
            v-model="form.description"
            rows="4"
            class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="请输入房屋描述"
          />
        </div>

        <div class="flex gap-4">
          <button
            type="submit"
            :disabled="isSubmitting || !form.blockId"
            class="flex-1 rounded-lg bg-blue-500 px-4 py-2 text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {{ isSubmitting ? '保存中...' : isEdit ? '保存修改' : '创建房屋' }}
          </button>
          <router-link
            to="/admin/houses"
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
  name: 'HouseForm',
  data() {
    return {
      buildings: [],
      blocks: [],
      isSubmitting: false,
      form: {
        buildingId: '',
        blockId: '',
        unitNumber: '',
        roomNumber: '',
        floor: 1,
        area: 0,
        rooms: 2,
        layout: '',
        status: 'available',
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
      await this.fetchBlocks(buildingId)
    }

    if (this.isEdit) {
      await this.fetchHouse()
    }
  },
  watch: {
    'form.buildingId': {
      async handler(newValue, oldValue) {
        if (!newValue) {
          this.blocks = []
          this.form.blockId = ''
          return
        }

        await this.fetchBlocks(newValue)

        if (String(oldValue) !== String(newValue)) {
          const exists = this.blocks.some((block) => String(block.id) === String(this.form.blockId))
          if (!exists) {
            this.form.blockId = ''
          }
        }
      }
    }
  },
  methods: {
    async fetchBuildings() {
      this.buildings = await adminService.getBuildings()
    },
    async fetchBlocks(buildingId) {
      try {
        this.blocks = await adminService.getBlocksByBuilding(buildingId)
      } catch (error) {
        console.error('获取楼栋列表失败:', error)
        this.blocks = []
      }
    },
    async fetchHouse() {
      try {
        const house = await adminService.getHouse(this.$route.params.id)
        await this.fetchBlocks(house.building_id)
        this.form = {
          buildingId: house.building_id,
          blockId: house.block_id,
          unitNumber: house.unitNumber || '',
          roomNumber: house.roomNumber || '',
          floor: house.floor || 1,
          area: Number(house.area || 0),
          rooms: house.rooms || 2,
          layout: house.layout || '',
          status: house.status || 'available',
          description: house.description || ''
        }
      } catch (error) {
        console.error('获取房屋信息失败:', error)
      }
    },
    async handleSubmit() {
      this.isSubmitting = true

      try {
        const payload = {
          building_id: this.form.buildingId,
          block_id: this.form.blockId,
          unit_number: this.form.unitNumber,
          room_number: this.form.roomNumber || null,
          floor_number: this.form.floor,
          area: this.form.area,
          room_count: this.form.rooms,
          layout: this.form.layout || null,
          status: this.form.status,
          description: this.form.description || ''
        }

        if (this.isEdit) {
          await adminService.updateHouse(this.$route.params.id, payload)
        } else {
          await adminService.createHouse(payload)
        }

        this.$router.push('/admin/houses')
      } catch (error) {
        console.error('保存房屋失败:', error)
        alert(error.response?.data?.message || '保存失败')
      } finally {
        this.isSubmitting = false
      }
    }
  }
}
</script>
