import { createRouter, createWebHashHistory, createWebHistory } from 'vue-router'
import adminRoutes from './admin'

const routes = [
  {
    path: '/',
    redirect: () => (localStorage.getItem('token') ? '/admin/dashboard' : '/login')
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue')
  },
  // 管理系统路由
  ...adminRoutes
]

function createAppHistory() {
  if (typeof window !== 'undefined') {
    const isFileProtocol = window.location.protocol === 'file:'
    const isDesktopRuntime = Boolean(window.__TAURI_INTERNALS__)

    if (isFileProtocol || isDesktopRuntime) {
      return createWebHashHistory()
    }
  }

  return createWebHistory()
}

const router = createRouter({
  history: createAppHistory(),
  routes
})

// 路由守卫
router.beforeEach((to, from, next) => {
  if (to.path === '/login' && localStorage.getItem('token')) {
    next('/admin/dashboard')
    return
  }

  if (to.path.startsWith('/admin') && to.path !== '/login') {
    const token = localStorage.getItem('token')
    if (!token) {
      next('/login')
      return
    }

    const requiredRoles = to.matched
      .flatMap((record) => record.meta?.roles || [])
      .filter(Boolean)

    if (requiredRoles.length > 0) {
      try {
        const rawUser = localStorage.getItem('user')
        const currentUser = rawUser ? JSON.parse(rawUser) : null

        if (!currentUser || !requiredRoles.includes(currentUser.role)) {
          next('/admin/dashboard')
          return
        }
      } catch (error) {
        console.warn('解析登录用户信息失败:', error)
        next('/login')
        return
      }
    }
  }
  next()
})

export default router
