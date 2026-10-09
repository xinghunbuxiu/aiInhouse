<template>
  <div class="max-w-2xl mx-auto">
    <div class="bg-white rounded-lg shadow p-6">
      <h2 class="text-2xl font-bold text-gray-800 mb-6">
        {{ isEdit ? '编辑用户' : '创建用户' }}
      </h2>

      <form @submit.prevent="handleSubmit" class="space-y-6">
        <!-- 用户名 -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">用户名 *</label>
          <input
            v-model="form.username"
            type="text"
            required
            :disabled="isEdit"
            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            placeholder="请输入用户名"
          />
        </div>

        <!-- 邮箱 -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">邮箱 *</label>
          <input
            v-model="form.email"
            type="email"
            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="请输入邮箱，可选"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">手机号</label>
          <input
            v-model="form.phone"
            type="text"
            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="请输入手机号，可选"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">
            {{ isEdit ? '重置密码' : '密码 *' }}
          </label>
          <input
            v-model="form.password"
            type="password"
            :required="!isEdit"
            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            :placeholder="isEdit ? '留空则不修改密码' : '请输入密码，至少6位'"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">角色 *</label>
          <select
            v-model="form.role"
            required
            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="admin">管理员</option>
            <option value="user">普通用户</option>
          </select>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">状态 *</label>
          <select
            v-model="form.status"
            required
            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option :value="1">启用</option>
            <option :value="0">禁用</option>
          </select>
        </div>

        <div class="flex gap-4">
          <button
            type="submit"
            :disabled="submitting || loading"
            class="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            {{ submitting ? '提交中...' : isEdit ? '保存修改' : '创建用户' }}
          </button>
          <router-link
            to="/admin/users"
            class="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors text-center"
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
  name: 'UserForm',
  data() {
    return {
      form: {
        username: '',
        email: '',
        phone: '',
        password: '',
        role: 'user',
        status: 1
      },
      loading: false,
      submitting: false
    }
  },
  computed: {
    isEdit() {
      return this.$route.params.id !== undefined
    }
  },
  mounted() {
    if (this.isEdit) {
      this.fetchUser()
    }
  },
  methods: {
    async fetchUser() {
      this.loading = true

      try {
        const id = this.$route.params.id
        const user = await adminService.getUser(id)
        this.form = {
          username: user.username || '',
          email: user.email || '',
          phone: user.phone || '',
          password: '',
          role: user.role || 'user',
          status: Number(user.status) === 1 ? 1 : 0
        }
      } catch (error) {
        console.error('获取用户信息失败:', error)
        alert(error.response?.data?.message || error.message || '获取用户信息失败')
      } finally {
        this.loading = false
      }
    },
    async handleSubmit() {
      if (!this.isEdit && this.form.password.length < 6) {
        alert('密码至少需要 6 位')
        return
      }

      this.submitting = true

      try {
        const payload = {
          email: this.form.email || null,
          phone: this.form.phone || null,
          role: this.form.role,
          status: Number(this.form.status)
        }

        if (this.isEdit) {
          if (this.form.password) {
            payload.password = this.form.password
          }
          await adminService.updateUser(this.$route.params.id, payload)
        } else {
          await adminService.createUser({
            username: this.form.username,
            password: this.form.password,
            email: this.form.email || null,
            phone: this.form.phone || null,
            role: this.form.role,
            status: Number(this.form.status)
          })
        }

        this.$router.push('/admin/users')
      } catch (error) {
        console.error('保存用户失败:', error)
        alert(error.response?.data?.message || error.message || '保存失败')
      } finally {
        this.submitting = false
      }
    }
  }
}
</script>
