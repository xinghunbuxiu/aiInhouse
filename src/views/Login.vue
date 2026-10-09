<template>
  <div class="min-h-screen flex items-center justify-center bg-[radial-gradient(circle_at_top,#dbeafe_0%,#f8fafc_45%,#e2e8f0_100%)] px-4">
    <div class="w-full max-w-md rounded-3xl border border-white/70 bg-white/90 p-8 shadow-2xl shadow-slate-300/40 backdrop-blur">
      <!-- Logo和标题 -->
      <div class="text-center mb-8">
        <div class="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-400 shadow-lg shadow-blue-200">
          <span class="text-4xl">🏠</span>
        </div>
        <h1 class="text-2xl font-bold text-slate-800">AI 房屋管理平台</h1>
        <p class="mt-2 text-sm leading-6 text-slate-500">统一管理楼盘、楼栋、房屋和平面图交付流程</p>
      </div>

      <!-- 登录表单 -->
      <form @submit.prevent="handleLogin" class="space-y-6">
        <div
          v-if="errorMessage"
          class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600"
        >
          {{ errorMessage }}
        </div>

        <div>
          <label class="mb-2 block text-sm font-medium text-slate-700">用户名</label>
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">👤</span>
            <input
              v-model="form.username"
              type="text"
              required
              class="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-slate-800 outline-none transition-all focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
              placeholder="请输入用户名"
            />
          </div>
        </div>

        <div>
          <label class="mb-2 block text-sm font-medium text-slate-700">密码</label>
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔒</span>
            <input
              v-model="form.password"
              :type="showPassword ? 'text' : 'password'"
              required
              class="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-12 text-slate-800 outline-none transition-all focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
              placeholder="请输入密码"
            />
            <button
              type="button"
              @click="showPassword = !showPassword"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {{ showPassword ? '🙈' : '👁️' }}
            </button>
          </div>
        </div>

        <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
          仅保留账号密码登录。管理员可登录后维护用户，普通用户仅可查看与处理业务数据。
        </div>

        <button
          type="submit"
          :disabled="isLoading"
          class="w-full rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 py-3 font-medium text-white transition-all hover:from-blue-700 hover:to-cyan-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {{ isLoading ? '登录中...' : '登录' }}
        </button>
      </form>
    </div>
  </div>
</template>

<script>
import { adminService } from '@/services/adminService'

export default {
  name: 'Login',
  data() {
    return {
      form: {
        username: '',
        password: ''
      },
      showPassword: false,
      isLoading: false,
      errorMessage: ''
    }
  },
  methods: {
    async handleLogin() {
      this.isLoading = true
      this.errorMessage = ''

      try {
        const data = await adminService.login({
          username: this.form.username,
          password: this.form.password
        })

        localStorage.setItem('token', data.token)
        localStorage.setItem('user', JSON.stringify(data.user))

        this.$router.replace({ name: 'Dashboard' })
      } catch (error) {
        console.error('登录失败:', error)
        this.errorMessage = error.response?.data?.message || error.message || '登录失败，请检查用户名和密码'
      } finally {
        this.isLoading = false
      }
    }
  }
}
</script>
