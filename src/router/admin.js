import { createRouter, createWebHistory } from 'vue-router'
import AdminLayout from '@/layouts/AdminLayout.vue'

const adminRoutes = [
  {
    path: '/admin',
    component: AdminLayout,
    redirect: '/admin/dashboard',
    children: [
      // 经营看板
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('@/views/admin/statistics/Statistics.vue'),
        meta: { title: '经营看板', icon: 'dashboard' }
      },
      // 楼盘管理
      {
        path: 'buildings',
        name: 'Buildings',
        component: () => import('@/views/admin/buildings/BuildingList.vue'),
        meta: { title: '楼盘管理', icon: 'building' }
      },
      {
        path: 'buildings/create',
        name: 'BuildingCreate',
        component: () => import('@/views/admin/buildings/BuildingForm.vue'),
        meta: { title: '创建楼盘', hidden: true }
      },
      {
        path: 'buildings/:id',
        name: 'BuildingDetail',
        component: () => import('@/views/admin/buildings/BuildingDetail.vue'),
        meta: { title: '楼盘详情', hidden: true }
      },
      {
        path: 'buildings/:id/edit',
        name: 'BuildingEdit',
        component: () => import('@/views/admin/buildings/BuildingForm.vue'),
        meta: { title: '编辑楼盘', hidden: true }
      },
      // 楼栋管理
      {
        path: 'blocks',
        name: 'Blocks',
        component: () => import('@/views/admin/blocks/BlockList.vue'),
        meta: { title: '楼栋管理', icon: 'block' }
      },
      {
        path: 'blocks/create',
        name: 'BlockCreate',
        component: () => import('@/views/admin/blocks/BlockForm.vue'),
        meta: { title: '创建楼栋', hidden: true }
      },
      {
        path: 'blocks/:id/edit',
        name: 'BlockEdit',
        component: () => import('@/views/admin/blocks/BlockForm.vue'),
        meta: { title: '编辑楼栋', hidden: true }
      },
      // 房屋管理
      {
        path: 'houses',
        name: 'Houses',
        component: () => import('@/views/admin/houses/HouseList.vue'),
        meta: { title: '房屋管理', icon: 'home' }
      },
      {
        path: 'houses/create',
        name: 'HouseCreate',
        component: () => import('@/views/admin/houses/HouseForm.vue'),
        meta: { title: '创建房屋', hidden: true }
      },
      {
        path: 'houses/:id',
        name: 'HouseDetail',
        component: () => import('@/views/admin/houses/HouseDetail.vue'),
        meta: { title: '房屋详情', hidden: true }
      },
      {
        path: 'houses/:id/edit',
        name: 'HouseEdit',
        component: () => import('@/views/admin/houses/HouseForm.vue'),
        meta: { title: '编辑房屋', hidden: true }
      },
      // 平面图管理
      {
        path: 'floor-plans',
        name: 'FloorPlans',
        component: () => import('@/views/admin/floor-plans/FloorPlanList.vue'),
        meta: { title: '平面图管理', icon: 'floor-plan' }
      },
      {
        path: 'ai-jobs',
        name: 'AiJobs',
        component: () => import('@/views/admin/ai/AiJobCenter.vue'),
        meta: { title: 'AI 任务中心', icon: 'ai' }
      },
      {
        path: 'design-assets',
        name: 'DesignAssets',
        component: () => import('@/views/admin/design-assets/DesignAssetLibrary.vue'),
        meta: { title: '装修素材库', icon: 'assets', roles: ['admin', 'user'] }
      },
      {
        path: 'recognition-assets',
        name: 'RecognitionAssets',
        component: () => import('@/views/admin/recognition-assets/RecognitionSymbolLibrary.vue'),
        meta: { title: '识别图例库', icon: 'symbols', roles: ['admin', 'user'] }
      },
      {
        path: 'floor-plans/create',
        name: 'FloorPlanCreate',
        component: () => import('@/views/admin/floor-plans/FloorPlanForm.vue'),
        meta: { title: '上传平面图', hidden: true }
      },
      {
        path: 'floor-plans/:id',
        name: 'FloorPlanDetail',
        component: () => import('@/views/admin/floor-plans/FloorPlanDetail.vue'),
        meta: { title: '平面图详情', hidden: true }
      },
      {
        path: 'floor-plans/:id/design-site',
        name: 'FloorPlanDesignSite',
        component: () => import('@/views/admin/floor-plans/FloorPlanDesignSite.vue'),
        meta: { title: '装修交付页', hidden: true }
      },
      {
        path: 'floor-plans/:id/edit',
        name: 'FloorPlanEdit',
        component: () => import('@/views/admin/floor-plans/FloorPlanForm.vue'),
        meta: { title: '编辑平面图', hidden: true }
      },
      // 用户管理
      {
        path: 'users',
        name: 'Users',
        component: () => import('@/views/admin/users/UserList.vue'),
        meta: { title: '用户管理', icon: 'users', roles: ['admin'] }
      },
      {
        path: 'users/create',
        name: 'UserCreate',
        component: () => import('@/views/admin/users/UserForm.vue'),
        meta: { title: '创建用户', hidden: true, roles: ['admin'] }
      },
      {
        path: 'users/:id/edit',
        name: 'UserEdit',
        component: () => import('@/views/admin/users/UserForm.vue'),
        meta: { title: '编辑用户', hidden: true, roles: ['admin'] }
      },
      // 数据统计兼容跳转
      {
        path: 'statistics',
        redirect: { name: 'Dashboard' },
        meta: { hidden: true }
      },
      // 系统设置
      {
        path: 'settings',
        name: 'Settings',
        component: () => import('@/views/admin/settings/Settings.vue'),
        meta: { title: '系统设置', icon: 'settings', roles: ['admin'] }
      }
    ]
  }
]

export default adminRoutes
