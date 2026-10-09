<template>
  <div class="space-y-6">
    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
      <div class="flex gap-2">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索用户名或邮箱..."
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
        v-if="isAdmin"
        to="/admin/users/create"
        class="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
      >
        + 添加用户
      </router-link>
    </div>

    <div class="bg-white rounded-lg shadow overflow-hidden">
      <div v-if="loading" class="px-6 py-12 text-center text-gray-500">
        正在加载用户数据...
      </div>

      <div v-else-if="errorMessage" class="px-6 py-12 text-center text-red-500">
        {{ errorMessage }}
      </div>

      <table v-else class="min-w-full">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">用户名</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">邮箱</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">手机号</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">角色</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">最后登录</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">创建时间</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
          </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
          <tr v-for="user in paginatedUsers" :key="user.id" class="hover:bg-gray-50">
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="flex items-center">
                <div class="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-medium mr-3">
                  {{ user.username.charAt(0).toUpperCase() }}
                </div>
                <div class="text-sm font-medium text-gray-900">{{ user.username }}</div>
              </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="text-sm text-gray-500">{{ user.email || '暂无' }}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="text-sm text-gray-500">{{ user.phone || '暂无' }}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <span
                :class="{
                  'px-2 py-1 text-xs rounded-full': true,
                  'bg-red-100 text-red-800': user.role === 'admin',
                  'bg-gray-100 text-gray-800': user.role === 'user'
                }"
              >
                {{ user.roleLabel }}
              </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <span
                :class="{
                  'px-2 py-1 text-xs rounded-full': true,
                  'bg-green-100 text-green-800': Number(user.status) === 1,
                  'bg-red-100 text-red-800': Number(user.status) !== 1
                }"
              >
                {{ user.statusLabel }}
              </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="text-sm text-gray-500">{{ user.lastLoginAt }}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="text-sm text-gray-500">{{ user.createdAt }}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
              <router-link
                :to="`/admin/users/${user.id}/edit`"
                class="text-indigo-600 hover:text-indigo-900 mr-3"
              >
                编辑
              </router-link>
              <button
                @click="toggleUserStatus(user)"
                :class="{
                  'mr-3': true,
                  'text-green-600 hover:text-green-900': Number(user.status) !== 1,
                  'text-yellow-600 hover:text-yellow-900': Number(user.status) === 1
                }"
                :disabled="updatingUserId === user.id"
              >
                {{ Number(user.status) === 1 ? '禁用' : '启用' }}
              </button>
              <button
                @click="deleteUser(user.id)"
                class="text-red-600 hover:text-red-900 disabled:text-gray-400 disabled:cursor-not-allowed"
                :disabled="isCurrentUser(user)"
              >
                删除
              </button>
            </td>
          </tr>
          <tr v-if="paginatedUsers.length === 0">
            <td colspan="8" class="px-6 py-12 text-center text-gray-500">
              暂无符合条件的用户
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="flex justify-between items-center">
      <div class="text-sm text-gray-500">
        显示 {{ displayRangeStart }} 到 {{ displayRangeEnd }} 条，共 {{ total }} 条
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
  name: 'UserList',
  data() {
    return {
      searchQuery: '',
      users: [],
      currentPage: 1,
      pageSize: 10,
      loading: false,
      errorMessage: '',
      updatingUserId: null,
      currentUserId: null,
      currentUserRole: 'user'
    }
  },
  computed: {
    isAdmin() {
      return this.currentUserRole === 'admin'
    },
    filteredUsers() {
      const keyword = this.searchQuery.trim().toLowerCase()

      if (!keyword) {
        return this.users
      }

      return this.users.filter((user) => {
        const haystacks = [user.username, user.email, user.phone].filter(Boolean)
        return haystacks.some((value) => value.toLowerCase().includes(keyword))
      })
    },
    paginatedUsers() {
      const start = (this.currentPage - 1) * this.pageSize
      return this.filteredUsers.slice(start, start + this.pageSize)
    },
    total() {
      return this.filteredUsers.length
    },
    totalPages() {
      return Math.max(1, Math.ceil(this.total / this.pageSize))
    },
    displayRangeStart() {
      if (this.total === 0) {
        return 0
      }
      return (this.currentPage - 1) * this.pageSize + 1
    },
    displayRangeEnd() {
      if (this.total === 0) {
        return 0
      }
      return Math.min(this.currentPage * this.pageSize, this.total)
    }
  },
  mounted() {
    this.loadCurrentUser()
    this.fetchUsers()
  },
  methods: {
    loadCurrentUser() {
      try {
        const rawUser = localStorage.getItem('user')
        const currentUser = rawUser ? JSON.parse(rawUser) : null
        this.currentUserId = currentUser?.id || null
        this.currentUserRole = currentUser?.role || 'user'
      } catch (error) {
        console.warn('读取当前用户失败:', error)
        this.currentUserId = null
        this.currentUserRole = 'user'
      }
    },
    async fetchUsers() {
      this.loading = true
      this.errorMessage = ''

      try {
        this.users = await adminService.getUsers()
        if (this.currentPage > this.totalPages) {
          this.currentPage = this.totalPages
        }
      } catch (error) {
        console.error('获取用户列表失败:', error)
        this.errorMessage = error.response?.data?.message || error.message || '获取用户列表失败'
      } finally {
        this.loading = false
      }
    },
    handleSearch() {
      this.currentPage = 1
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
    isCurrentUser(user) {
      return Number(user.id) === Number(this.currentUserId)
    },
    async toggleUserStatus(user) {
      this.updatingUserId = user.id

      try {
        const newStatus = Number(user.status) === 1 ? 0 : 1
        await adminService.updateUser(user.id, { status: newStatus })
        await this.fetchUsers()
      } catch (error) {
        console.error('更新用户状态失败:', error)
        alert(error.response?.data?.message || error.message || '操作失败')
      } finally {
        this.updatingUserId = null
      }
    },
    async deleteUser(id) {
      if (!confirm('确定要删除这个用户吗？')) return

      try {
        await adminService.deleteUser(id)
        await this.fetchUsers()
      } catch (error) {
        console.error('删除用户失败:', error)
        alert(error.response?.data?.message || error.message || '删除失败')
      }
    }
  }
}
</script>
