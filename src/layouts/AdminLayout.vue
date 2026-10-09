<template>
  <div class="flex h-screen overflow-hidden bg-gray-50">
    <!-- 侧边栏 -->
    <aside 
      :class="[
        'bg-white border-r border-gray-200 transition-all duration-300 ease-in-out fixed h-full z-30',
        sidebarCollapsed ? 'w-16' : 'w-64'
      ]"
    >
      <!-- 侧边栏头部 -->
      <div class="flex items-center justify-between p-4 border-b border-gray-200">
        <div v-if="!sidebarCollapsed" class="flex items-center space-x-2">
          <div class="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
            <span class="text-white font-bold">AI</span>
          </div>
          <h1 class="text-lg font-semibold text-gray-800">AI全景设计</h1>
        </div>
        <div v-else class="flex items-center justify-center w-full">
          <div class="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
            <span class="text-white font-bold">AI</span>
          </div>
        </div>
      </div>

      <!-- 侧边栏菜单 -->
      <nav class="mt-4">
        <ul>
          <li v-for="item in visibleSidebarItems" :key="item.path">
            <router-link 
              :to="item.path"
              :class="[
                'flex items-center px-4 py-3 text-gray-700 hover:bg-gray-100 transition-colors',
                $route.path.startsWith(item.path) ? 'bg-blue-50 text-blue-600' : ''
              ]"
            >
              <span class="mr-3 text-lg">{{ item.icon }}</span>
              <span v-if="!sidebarCollapsed" class="font-medium">{{ item.name }}</span>
            </router-link>
          </li>
        </ul>
      </nav>

      <!-- 侧边栏底部 -->
      <div class="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-200">
        <button 
          @click="toggleSidebar"
          class="flex items-center justify-center w-full p-2 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <span class="text-gray-600 text-lg">
            {{ sidebarCollapsed ? '→' : '←' }}
          </span>
        </button>
      </div>
    </aside>

    <!-- 主内容区 -->
    <div 
      :class="[
        'min-w-0 flex-1 overflow-hidden transition-all duration-300 ease-in-out',
        sidebarCollapsed ? 'ml-16' : 'ml-64'
      ]"
    >
      <!-- 顶部导航栏 -->
      <header class="flex flex-col gap-3 border-b border-gray-200 bg-white px-4 py-3 sm:px-6 xl:flex-row xl:items-center xl:justify-between">
        <div class="min-w-0 flex items-center">
          <h2 class="truncate text-xl font-semibold text-gray-800">{{ pageTitle }}</h2>
        </div>
        <div class="flex w-full items-center justify-between gap-3 xl:w-auto xl:justify-end xl:space-x-4">
          <button class="text-gray-600 hover:text-gray-800 transition-colors">
            <span class="text-xl">🔔</span>
          </button>
          <div class="min-w-0 flex items-center space-x-2">
            <div class="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
              <span class="text-gray-600 font-medium">{{ userInitial }}</span>
            </div>
            <div class="min-w-0 flex flex-col leading-tight">
              <span class="truncate text-gray-700 font-medium">{{ currentUser.username || '未登录用户' }}</span>
              <span class="text-xs text-gray-500">{{ currentUserRoleLabel }}</span>
            </div>
          </div>
        </div>
      </header>

      <!-- 内容区域 -->
      <main class="h-[calc(100vh-65px)] overflow-y-auto overflow-x-hidden p-4 sm:p-6">
        <div class="mx-auto w-full max-w-[1600px] min-w-0">
          <router-view />
        </div>
      </main>
    </div>
  </div>
</template>

<script>
export default {
  name: 'AdminLayout',
  data() {
    return {
      sidebarCollapsed: false,
      currentUser: {},
      sidebarItems: [
        { name: '经营看板', path: '/admin/dashboard', icon: '📊', roles: ['admin', 'user'] },
        { name: '楼盘管理', path: '/admin/buildings', icon: '🏢', roles: ['admin', 'user'] },
        { name: '楼栋管理', path: '/admin/blocks', icon: '🏬', roles: ['admin', 'user'] },
        { name: '房屋管理', path: '/admin/houses', icon: '🏠', roles: ['admin', 'user'] },
        { name: '平面图管理', path: '/admin/floor-plans', icon: '📐', roles: ['admin', 'user'] },
        { name: 'AI 任务中心', path: '/admin/ai-jobs', icon: '🧠', roles: ['admin', 'user'] },
        { name: '装修素材库', path: '/admin/design-assets', icon: '🧩', roles: ['admin', 'user'] },
        { name: '识别图例库', path: '/admin/recognition-assets', icon: '🗺', roles: ['admin', 'user'] },
        { name: '用户管理', path: '/admin/users', icon: '👥', roles: ['admin'] },
        { name: '系统设置', path: '/admin/settings', icon: '⚙️', roles: ['admin'] }
      ]
    }
  },
  computed: {
    currentRole() {
      return this.currentUser.role || 'user'
    },
    currentUserRoleLabel() {
      return this.currentRole === 'admin' ? '管理员' : '普通用户'
    },
    userInitial() {
      const username = this.currentUser.username || 'U'
      return username.charAt(0).toUpperCase()
    },
    visibleSidebarItems() {
      return this.sidebarItems.filter((item) => item.roles.includes(this.currentRole))
    },
    pageTitle() {
      return this.$route.meta?.title || '管理中心'
    }
  },
  mounted() {
    this.loadCurrentUser()
  },
  watch: {
    $route() {
      this.loadCurrentUser()
    }
  },
  methods: {
    loadCurrentUser() {
      try {
        const rawUser = localStorage.getItem('user')
        this.currentUser = rawUser ? JSON.parse(rawUser) : {}
      } catch (error) {
        console.warn('读取当前登录用户失败:', error)
        this.currentUser = {}
      }
    },
    toggleSidebar() {
      this.sidebarCollapsed = !this.sidebarCollapsed
    }
  }
}
</script>

<style scoped>
/* 自定义滚动条 */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: #f1f1f1;
}

::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}
</style>
