<template>
  <div class="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
    <!-- 导航栏 -->
    <nav class="bg-white shadow-sm">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between h-16">
          <div class="flex items-center">
            <span class="text-2xl font-bold text-blue-600">🏠 平面图管理系统</span>
          </div>
          <div class="flex items-center space-x-4">
            <router-link
              to="/admin"
              class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              进入管理系统
            </router-link>
          </div>
        </div>
      </div>
    </nav>

    <!-- 主要内容 -->
    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <!-- Hero区域 -->
      <div class="text-center mb-16">
        <h1 class="text-4xl md:text-6xl font-bold text-gray-900 mb-6">
          平面图转3D全景
        </h1>
        <p class="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
          上传您的平面图，AI自动识别并生成逼真的3D场景和720°全景效果图
        </p>
        <div class="flex justify-center gap-4">
          <router-link
            to="/admin/floor-plans/create"
            class="px-8 py-4 bg-blue-500 text-white text-lg rounded-lg hover:bg-blue-600 transition-colors shadow-lg"
          >
            立即体验
          </router-link>
          <router-link
            to="/admin"
            class="px-8 py-4 bg-white text-blue-600 text-lg rounded-lg hover:bg-gray-50 transition-colors border border-blue-200"
          >
            查看演示
          </router-link>
        </div>
      </div>

      <!-- 功能特点 -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
        <div class="bg-white rounded-xl shadow-lg p-8 text-center">
          <div class="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span class="text-3xl">🤖</span>
          </div>
          <h3 class="text-xl font-semibold text-gray-800 mb-3">AI智能识别</h3>
          <p class="text-gray-600">
            自动识别房间、墙体、门窗位置，准确率高达95%以上
          </p>
        </div>

        <div class="bg-white rounded-xl shadow-lg p-8 text-center">
          <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span class="text-3xl">🎨</span>
          </div>
          <h3 class="text-xl font-semibold text-gray-800 mb-3">3D场景生成</h3>
          <p class="text-gray-600">
            基于识别结果自动生成逼真的3D场景，支持多种材质风格
          </p>
        </div>

        <div class="bg-white rounded-xl shadow-lg p-8 text-center">
          <div class="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span class="text-3xl">🌐</span>
          </div>
          <h3 class="text-xl font-semibold text-gray-800 mb-3">全景效果图</h3>
          <p class="text-gray-600">
            生成720°全景效果图，沉浸式体验未来家居空间
          </p>
        </div>
      </div>

      <!-- 使用流程 -->
      <div class="bg-white rounded-xl shadow-lg p-8 mb-16">
        <h2 class="text-3xl font-bold text-gray-800 text-center mb-8">使用流程</h2>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div class="text-center">
            <div class="w-12 h-12 bg-blue-500 text-white rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-3">
              1
            </div>
            <h4 class="font-semibold text-gray-800 mb-2">上传平面图</h4>
            <p class="text-sm text-gray-600">支持JPG、PNG、PDF格式</p>
          </div>
          <div class="text-center">
            <div class="w-12 h-12 bg-blue-500 text-white rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-3">
              2
            </div>
            <h4 class="font-semibold text-gray-800 mb-2">AI自动识别</h4>
            <p class="text-sm text-gray-600">智能识别房间布局</p>
          </div>
          <div class="text-center">
            <div class="w-12 h-12 bg-blue-500 text-white rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-3">
              3
            </div>
            <h4 class="font-semibold text-gray-800 mb-2">生成3D场景</h4>
            <p class="text-sm text-gray-600">自动渲染3D效果</p>
          </div>
          <div class="text-center">
            <div class="w-12 h-12 bg-blue-500 text-white rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-3">
              4
            </div>
            <h4 class="font-semibold text-gray-800 mb-2">查看全景</h4>
            <p class="text-sm text-gray-600">720°全景体验</p>
          </div>
        </div>
      </div>

      <!-- 支持的材质风格 -->
      <div class="bg-white rounded-xl shadow-lg p-8">
        <h2 class="text-3xl font-bold text-gray-800 text-center mb-8">支持多种材质风格</h2>
        <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div class="text-center p-4 bg-gray-50 rounded-lg">
            <span class="text-4xl mb-2 block">🏢</span>
            <span class="text-gray-800 font-medium">现代风格</span>
          </div>
          <div class="text-center p-4 bg-gray-50 rounded-lg">
            <span class="text-4xl mb-2 block">🏛️</span>
            <span class="text-gray-800 font-medium">经典风格</span>
          </div>
          <div class="text-center p-4 bg-gray-50 rounded-lg">
            <span class="text-4xl mb-2 block">⬜</span>
            <span class="text-gray-800 font-medium">极简风格</span>
          </div>
          <div class="text-center p-4 bg-gray-50 rounded-lg">
            <span class="text-4xl mb-2 block">🏭</span>
            <span class="text-gray-800 font-medium">工业风格</span>
          </div>
          <div class="text-center p-4 bg-gray-50 rounded-lg">
            <span class="text-4xl mb-2 block">🌲</span>
            <span class="text-gray-800 font-medium">北欧风格</span>
          </div>
        </div>
      </div>
    </main>

    <!-- 页脚 -->
    <footer class="bg-gray-800 text-white py-8">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <p>&copy; 2024 平面图管理系统. All rights reserved.</p>
      </div>
    </footer>
  </div>
</template>

<script>
export default {
  name: 'Home'
}
</script>
