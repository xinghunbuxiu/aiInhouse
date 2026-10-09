<template>
  <div class="max-w-4xl mx-auto space-y-6">
    <div
      v-if="desktopAvailable"
      class="bg-slate-900 rounded-lg shadow p-6 text-white"
    >
      <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h3 class="text-lg font-semibold">桌面运行时</h3>
          <p class="mt-2 text-sm text-slate-300">
            当前页面运行在 Tauri 桌面壳中，可直接管理后台服务与本地桌面 worker。
          </p>
        </div>
        <button
          type="button"
          class="rounded-lg border border-white/20 px-4 py-2 text-sm text-white transition hover:bg-white/10"
          @click="fetchRuntimeStatus"
        >
          刷新运行时状态
        </button>
      </div>

      <div v-if="runtimeLoading && !runtimeStatus" class="mt-4 rounded-xl bg-white/5 p-4 text-sm text-slate-300">
        正在读取桌面运行时状态...
      </div>

      <div v-else class="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <article
          v-for="(service, key) in runtimeStatus"
          v-if="key === 'backend' || key === 'worker'"
          :key="key"
          class="rounded-2xl bg-white/5 p-4"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="text-base font-medium">{{ service.label }}</p>
              <p class="mt-1 text-xs text-slate-400">PID: {{ service.pid || '未启动' }}</p>
            </div>
            <span :class="['rounded-full px-3 py-1 text-xs font-medium', runtimeStatusTone(service.status)]">
              {{ runtimeStatusLabel(service.status) }}
            </span>
          </div>

          <div class="mt-4 grid grid-cols-1 gap-2 text-sm text-slate-300 sm:grid-cols-2">
            <p>启动时间: {{ service.startedAt || '暂无' }}</p>
            <p>退出时间: {{ service.stoppedAt || '暂无' }}</p>
            <p>退出码: {{ service.exitCode ?? '暂无' }}</p>
          </div>

          <div class="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-lg bg-emerald-500 px-3 py-2 text-sm text-white transition hover:bg-emerald-600 disabled:opacity-60"
              :disabled="runtimeAction === `${key}:start`"
              @click="controlRuntime(key, 'start')"
            >
              启动
            </button>
            <button
              type="button"
              class="rounded-lg bg-amber-500 px-3 py-2 text-sm text-white transition hover:bg-amber-600 disabled:opacity-60"
              :disabled="runtimeAction === `${key}:restart`"
              @click="controlRuntime(key, 'restart')"
            >
              重启
            </button>
            <button
              type="button"
              class="rounded-lg bg-rose-500 px-3 py-2 text-sm text-white transition hover:bg-rose-600 disabled:opacity-60"
              :disabled="runtimeAction === `${key}:stop`"
              @click="controlRuntime(key, 'stop')"
            >
              停止
            </button>
          </div>

          <div class="mt-4">
            <p class="text-xs uppercase tracking-[0.18em] text-slate-400">最近日志</p>
            <pre class="mt-2 max-h-56 overflow-auto rounded-xl bg-slate-950 p-3 text-xs leading-6 text-slate-100"><code>{{ (service.logs || []).join('\n') || '暂无日志' }}</code></pre>
          </div>
        </article>
      </div>

      <div class="mt-6 rounded-2xl bg-white/5 p-4">
        <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h4 class="text-base font-semibold">桌面运行参数</h4>
            <p class="mt-1 text-sm text-slate-300">保存后会用于下次启动后台和桌面 Worker。</p>
          </div>
          <button
            type="button"
            class="rounded-lg bg-white px-4 py-2 text-sm text-slate-900 transition hover:bg-slate-100 disabled:opacity-60"
            :disabled="desktopConfigSaving"
            @click="saveDesktopConfig"
          >
            保存桌面配置
          </button>
        </div>

        <div class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label class="block text-sm font-medium text-slate-200 mb-2">后台端口</label>
            <input
              v-model="desktopConfig.backendPort"
              type="text"
              class="w-full rounded-lg border border-white/10 bg-slate-950 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-sky-400"
              placeholder="3002"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-200 mb-2">后台 API 地址</label>
            <input
              v-model="desktopConfig.backendApiUrl"
              type="text"
              class="w-full rounded-lg border border-white/10 bg-slate-950 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-sky-400"
              placeholder="http://127.0.0.1:3002/api"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-200 mb-2">Worker 认证模式</label>
            <select
              v-model="desktopConfig.workerAuthMode"
              class="w-full rounded-lg border border-white/10 bg-slate-950 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
              <option value="mock">mock</option>
              <option value="auto">auto</option>
              <option value="login">login</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-200 mb-2">设备名称</label>
            <input
              v-model="desktopConfig.workerDeviceName"
              type="text"
              class="w-full rounded-lg border border-white/10 bg-slate-950 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-sky-400"
              placeholder="AIInHouse 桌面工作站"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-200 mb-2">登录账号</label>
            <input
              v-model="desktopConfig.workerUsername"
              type="text"
              class="w-full rounded-lg border border-white/10 bg-slate-950 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-sky-400"
              placeholder="admin"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-200 mb-2">登录密码</label>
            <input
              v-model="desktopConfig.workerPassword"
              type="password"
              class="w-full rounded-lg border border-white/10 bg-slate-950 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-sky-400"
              placeholder="admin123"
            />
          </div>
          <div class="md:col-span-2">
            <label class="block text-sm font-medium text-slate-200 mb-2">Worker 工作目录</label>
            <input
              v-model="desktopConfig.workerWorkspaceDir"
              type="text"
              class="w-full rounded-lg border border-white/10 bg-slate-950 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-sky-400"
              placeholder="./workspace"
            />
          </div>
          <div class="md:col-span-2">
            <label class="block text-sm font-medium text-slate-200 mb-2">Codex 命令</label>
            <input
              v-model="desktopConfig.codexCommand"
              type="text"
              class="w-full rounded-lg border border-white/10 bg-slate-950 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-sky-400"
              placeholder="node ../codex-worker/src/index.js"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 基础设置 -->
    <div class="bg-white rounded-lg shadow p-6">
      <h3 class="text-lg font-semibold text-gray-800 mb-4">基础设置</h3>
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">系统名称</label>
          <input
            v-model="settings.systemName"
            type="text"
            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="请输入系统名称"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">系统Logo</label>
          <div class="flex items-center gap-4">
            <div class="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center">
              <span v-if="!settings.logo" class="text-gray-400 text-2xl">🖼️</span>
              <img v-else :src="settings.logo" class="w-full h-full object-contain" />
            </div>
            <button
              type="button"
              class="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              上传Logo
            </button>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">系统描述</label>
          <textarea
            v-model="settings.description"
            rows="3"
            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="请输入系统描述"
          ></textarea>
        </div>
      </div>
    </div>

    <!-- AI设置 -->
    <div class="bg-white rounded-lg shadow p-6">
      <h3 class="text-lg font-semibold text-gray-800 mb-4">AI解析设置</h3>
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">目标检测模型</label>
          <select
            v-model="settings.ai.detectionModel"
            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="efficientdet">EfficientDet</option>
            <option value="yolov8">YOLOv8</option>
            <option value="yolov10">YOLOv10</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">OCR模型</label>
          <select
            v-model="settings.ai.ocrModel"
            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="easyocr">EasyOCR</option>
            <option value="paddleocr">PaddleOCR</option>
            <option value="tesseract">Tesseract</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">置信度阈值</label>
          <input
            v-model.number="settings.ai.confidenceThreshold"
            type="range"
            min="0"
            max="1"
            step="0.1"
            class="w-full"
          />
          <div class="flex justify-between text-sm text-gray-500">
            <span>0</span>
            <span>{{ settings.ai.confidenceThreshold }}</span>
            <span>1</span>
          </div>
        </div>
        <div class="flex items-center">
          <input
            id="autoProcess"
            v-model="settings.ai.autoProcess"
            type="checkbox"
            class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
          />
          <label for="autoProcess" class="ml-2 text-sm text-gray-700">
            上传后自动开始处理
          </label>
        </div>
      </div>
    </div>

    <!-- AI服务配置 -->
    <div class="bg-white rounded-lg shadow p-6">
      <h3 class="text-lg font-semibold text-gray-800 mb-4">AI服务配置</h3>
      <div class="space-y-6">
        <!-- 解析服务选择 -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">解析服务选择</label>
          <div class="space-y-2">
            <div class="flex items-center">
              <input
                id="service_local"
                v-model="settings.aiService.parseService"
                type="radio"
                value="local"
                class="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
              />
              <label for="service_local" class="ml-2 text-sm text-gray-700">
                本地AI服务
              </label>
            </div>
            <div class="flex items-center">
              <input
                id="service_openai"
                v-model="settings.aiService.parseService"
                type="radio"
                value="openai"
                class="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
              />
              <label for="service_openai" class="ml-2 text-sm text-gray-700">
                OpenAI服务
              </label>
            </div>
          </div>
        </div>

        <!-- OpenAI API配置 -->
        <div v-if="settings.aiService.parseService === 'openai'" class="space-y-4">
          <h4 class="font-medium text-gray-700">OpenAI API配置</h4>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">API Key</label>
            <input
              v-model="settings.aiService.openai.apiKey"
              type="password"
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="sk-..."
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">模型</label>
            <select
              v-model="settings.aiService.openai.model"
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="gpt-4-turbo">GPT-4 Turbo</option>
              <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">超时时间 (ms)</label>
            <input
              v-model.number="settings.aiService.openai.timeout"
              type="number"
              min="1000"
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="30000"
            />
          </div>
        </div>

        <!-- 本地AI服务配置 -->
        <div class="space-y-4">
          <h4 class="font-medium text-gray-700">本地AI服务配置</h4>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">服务地址</label>
            <input
              v-model="settings.aiService.localService.endpoint"
              type="text"
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="http://localhost:8000"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">超时时间 (ms)</label>
            <input
              v-model.number="settings.aiService.localService.timeout"
              type="number"
              min="1000"
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="60000"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 风格配置 -->
    <div class="bg-white rounded-lg shadow p-6">
      <h3 class="text-lg font-semibold text-gray-800 mb-4">3D风格配置</h3>
      <div class="space-y-4">
        <div v-for="(style, key) in settings.styles" :key="key" class="border border-gray-200 rounded-lg p-4">
          <div class="flex justify-between items-center mb-2">
            <h4 class="font-medium text-gray-700">{{ style.name }}</h4>
            <button
              @click="removeStyle(key)"
              class="text-red-500 hover:text-red-700 text-sm"
            >
              删除
            </button>
          </div>
          <div class="space-y-2">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">风格名称</label>
              <input
                v-model="settings.styles[key].name"
                type="text"
                class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="风格名称"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">风格描述</label>
              <textarea
                v-model="settings.styles[key].description"
                rows="2"
                class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="风格描述"
              ></textarea>
            </div>
          </div>
        </div>
        <button
          @click="addStyle"
          class="px-4 py-2 border border-dashed border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          添加风格
        </button>
      </div>
    </div>

    <!-- 提示模板配置 -->
    <div class="bg-white rounded-lg shadow p-6">
      <h3 class="text-lg font-semibold text-gray-800 mb-4">提示模板配置</h3>
      <div class="space-y-6">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">平面图解析提示</label>
          <textarea
            v-model="settings.prompts.floorPlanParser"
            rows="10"
            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="平面图解析提示模板"
          ></textarea>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">3D场景配置提示</label>
          <textarea
            v-model="settings.prompts.sceneConfigGenerator"
            rows="10"
            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="3D场景配置提示模板"
          ></textarea>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">全景图配置提示</label>
          <textarea
            v-model="settings.prompts.panoramaConfigGenerator"
            rows="10"
            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="全景图配置提示模板"
          ></textarea>
        </div>
      </div>
    </div>

    <!-- 存储设置 -->
    <div class="bg-white rounded-lg shadow p-6">
      <h3 class="text-lg font-semibold text-gray-800 mb-4">存储设置</h3>
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">存储类型</label>
          <select
            v-model="settings.storage.type"
            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="local">本地存储</option>
            <option value="oss">阿里云OSS</option>
            <option value="cos">腾讯云COS</option>
            <option value="s3">AWS S3</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">最大文件大小 (MB)</label>
          <input
            v-model.number="settings.storage.maxFileSize"
            type="number"
            min="1"
            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">允许的文件类型</label>
          <div class="space-y-2">
            <div class="flex items-center">
              <input
                id="type_jpg"
                v-model="settings.storage.allowedTypes"
                type="checkbox"
                value="image/jpeg"
                class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label for="type_jpg" class="ml-2 text-sm text-gray-700">JPG</label>
            </div>
            <div class="flex items-center">
              <input
                id="type_png"
                v-model="settings.storage.allowedTypes"
                type="checkbox"
                value="image/png"
                class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label for="type_png" class="ml-2 text-sm text-gray-700">PNG</label>
            </div>
            <div class="flex items-center">
              <input
                id="type_pdf"
                v-model="settings.storage.allowedTypes"
                type="checkbox"
                value="application/pdf"
                class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label for="type_pdf" class="ml-2 text-sm text-gray-700">PDF</label>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 通知设置 -->
    <div class="bg-white rounded-lg shadow p-6">
      <h3 class="text-lg font-semibold text-gray-800 mb-4">通知设置</h3>
      <div class="space-y-4">
        <div class="flex items-center">
          <input
            id="emailNotification"
            v-model="settings.notifications.email"
            type="checkbox"
            class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
          />
          <label for="emailNotification" class="ml-2 text-sm text-gray-700">
            启用邮件通知
          </label>
        </div>
        <div v-if="settings.notifications.email" class="ml-6 space-y-3">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">SMTP服务器</label>
            <input
              v-model="settings.notifications.smtpServer"
              type="text"
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="smtp.example.com"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">SMTP端口</label>
            <input
              v-model.number="settings.notifications.smtpPort"
              type="number"
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="587"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">发件人邮箱</label>
            <input
              v-model="settings.notifications.senderEmail"
              type="email"
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="noreply@example.com"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 保存按钮 -->
    <div class="flex gap-4">
      <button
        @click="saveSettings"
        class="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
      >
        保存设置
      </button>
      <button
        @click="resetSettings"
        class="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors"
      >
        重置
      </button>
    </div>
  </div>
</template>

<script>
import { configService } from '@/services/configService.js'
import {
  getDesktopRuntimeConfig,
  getDesktopRuntimeStatus,
  isDesktopRuntimeAvailable,
  restartDesktopService,
  saveDesktopRuntimeConfig,
  startDesktopService,
  stopDesktopService
} from '@/services/desktopRuntime.js'

export default {
  name: 'Settings',
  data() {
    return {
      desktopAvailable: false,
      runtimeLoading: false,
      runtimeAction: '',
      runtimeStatus: null,
      desktopConfigSaving: false,
      desktopConfig: {
        backendPort: '3002',
        backendApiUrl: 'http://127.0.0.1:3002/api',
        workerAuthMode: 'mock',
        workerUsername: 'admin',
        workerPassword: 'admin123',
        workerDeviceName: 'AIInHouse 桌面工作站',
        workerWorkspaceDir: '',
        codexCommand: 'node ../codex-worker/src/index.js'
      },
      settings: {
        systemName: '平面图管理系统',
        logo: '',
        description: '专业的平面图管理和3D全景生成系统',
        ai: {
          detectionModel: 'efficientdet',
          ocrModel: 'easyocr',
          confidenceThreshold: 0.7,
          autoProcess: true
        },
        aiService: {
          parseService: 'local',
          openai: {
            apiKey: '',
            model: 'gpt-4-turbo',
            timeout: 30000
          },
          localService: {
            endpoint: 'http://localhost:8000',
            timeout: 60000
          }
        },
        styles: {
          modern: {
            name: '现代风格',
            description: '简约、时尚的现代设计风格'
          },
          classic: {
            name: '经典风格',
            description: '传统、典雅的经典设计风格'
          },
          minimalist: {
            name: '极简风格',
            description: '简洁、纯净的极简设计风格'
          }
        },
        prompts: {
          floorPlanParser: `你是一个专业的建筑设计师和室内设计师，擅长分析平面图并将其转换为详细的空间数据。
请分析提供的平面图，识别房间、墙体、门窗等元素，并输出结构化的JSON数据。
输出格式必须严格按照以下结构：
{
  "rooms": [
    {
      "name": "房间名称",
      "type": "房间类型（如living、bedroom、kitchen、bathroom等）",
      "area": 面积（平方米）,
      "width": 宽度（米）,
      "length": 长度（米）,
      "position": {"x": x坐标, "y": y坐标}
    }
  ],
  "walls": [
    {
      "start": {"x": x1, "y": y1},
      "end": {"x": x2, "y": y2},
      "thickness": 墙体厚度（米）
    }
  ],
  "doors": [
    {
      "position": {"x": x, "y": y},
      "width": 宽度（米）,
      "type": "门类型（如main、room、bathroom等）"
    }
  ],
  "windows": [
    {
      "position": {"x": x, "y": y},
      "width": 宽度（米）
    }
  ]
}`,
          sceneConfigGenerator: `你是一个专业的3D室内设计师，擅长根据平面图和指定风格生成详细的3D场景配置。
请根据提供的平面图解析数据和风格要求，生成3D场景的详细配置，包括：
1. 材质选择
2. 家具布局
3. 灯光设置
4. 色彩方案

输出格式必须严格按照以下结构：
{
  "materials": {
    "floor": {"color": "颜色值", "texture": "纹理类型", "roughness": 粗糙度值},
    "wall": {"color": "颜色值", "texture": "纹理类型", "roughness": 粗糙度值},
    "ceiling": {"color": "颜色值", "texture": "纹理类型", "roughness": 粗糙度值}
  },
  "furniture": [
    {
      "type": "家具类型",
      "position": {"x": x, "y": y, "z": z},
      "rotation": {"x": x, "y": y, "z": z},
      "scale": {"x": x, "y": y, "z": z},
      "material": "材质类型"
    }
  ],
  "lighting": {
    "ambient": {"intensity": 强度值, "color": "颜色值"},
    "directional": {"intensity": 强度值, "color": "颜色值", "position": {"x": x, "y": y, "z": z}},
    "point": [
      {"intensity": 强度值, "color": "颜色值", "position": {"x": x, "y": y, "z": z}}
    ]
  },
  "colors": {
    "primary": "主色调",
    "secondary": "辅助色",
    "accent": "强调色"
  }
}`,
          panoramaConfigGenerator: `你是一个专业的全景图设计师，擅长根据3D场景数据生成全景图配置。
请根据提供的3D场景数据，生成全景图的详细配置，包括：
1. 相机位置和角度
2. 热点标记（如房间切换点）
3. 场景描述

输出格式必须严格按照以下结构：
{
  "cameraPositions": [
    {
      "id": "位置ID",
      "name": "位置名称",
      "position": {"x": x, "y": y, "z": z},
      "lookAt": {"x": x, "y": y, "z": z}
    }
  ],
  "hotspots": [
    {
      "id": "热点ID",
      "type": "热点类型",
      "position": {"pitch": 俯仰角, "yaw": 偏航角},
      "text": "热点文本",
      "target": "目标位置ID"
    }
  ],
  "description": "场景描述"
}`
        },
        storage: {
          type: 'local',
          maxFileSize: 50,
          allowedTypes: ['image/jpeg', 'image/png', 'application/pdf']
        },
        notifications: {
          email: false,
          smtpServer: '',
          smtpPort: 587,
          senderEmail: ''
        }
      }
    }
  },
  mounted() {
    this.fetchSettings()
    this.desktopAvailable = isDesktopRuntimeAvailable()
    if (this.desktopAvailable) {
      this.fetchDesktopConfig()
      this.fetchRuntimeStatus()
    }
  },
  methods: {
    runtimeStatusLabel(status) {
      const labels = {
        running: '运行中',
        starting: '启动中',
        stopping: '停止中',
        stopped: '已停止',
        failed: '异常退出'
      }
      return labels[status] || status || '未知'
    },
    runtimeStatusTone(status) {
      const tones = {
        running: 'bg-emerald-100 text-emerald-700',
        starting: 'bg-sky-100 text-sky-700',
        stopping: 'bg-amber-100 text-amber-700',
        stopped: 'bg-slate-100 text-slate-600',
        failed: 'bg-rose-100 text-rose-700'
      }
      return tones[status] || 'bg-slate-100 text-slate-600'
    },
    async fetchRuntimeStatus() {
      if (!this.desktopAvailable) {
        return
      }

      this.runtimeLoading = true
      try {
        this.runtimeStatus = await getDesktopRuntimeStatus()
      } catch (error) {
        console.error('获取桌面运行时状态失败:', error)
      } finally {
        this.runtimeLoading = false
      }
    },
    async fetchDesktopConfig() {
      if (!this.desktopAvailable) {
        return
      }

      try {
        const config = await getDesktopRuntimeConfig()
        if (config) {
          this.desktopConfig = {
            ...this.desktopConfig,
            ...config
          }
        }
      } catch (error) {
        console.error('获取桌面配置失败:', error)
      }
    },
    async saveDesktopConfig() {
      this.desktopConfigSaving = true
      try {
        const result = await saveDesktopRuntimeConfig(this.desktopConfig)
        if (result?.config) {
          this.desktopConfig = {
            ...this.desktopConfig,
            ...result.config
          }
        }
        alert('桌面运行时配置已保存')
        await this.fetchRuntimeStatus()
      } catch (error) {
        console.error('保存桌面配置失败:', error)
        alert(error.message || '保存桌面配置失败')
      } finally {
        this.desktopConfigSaving = false
      }
    },
    async controlRuntime(serviceName, action) {
      this.runtimeAction = `${serviceName}:${action}`
      try {
        if (action === 'start') {
          this.runtimeStatus = await startDesktopService(serviceName)
        } else if (action === 'stop') {
          this.runtimeStatus = await stopDesktopService(serviceName)
        } else {
          this.runtimeStatus = await restartDesktopService(serviceName)
        }
      } catch (error) {
        console.error('更新桌面运行时状态失败:', error)
        alert(error.message || '操作失败')
      } finally {
        this.runtimeAction = ''
      }
    },
    async fetchSettings() {
      try {
        // 从本地存储获取配置
        const config = configService.loadConfig()
        if (config) {
          this.settings = { ...this.settings, ...config }
        }
      } catch (error) {
        console.error('获取设置失败:', error)
      }
    },
    async saveSettings() {
      try {
        // 保存配置到本地存储
        configService.saveConfig(this.settings)
        alert('设置保存成功！')
      } catch (error) {
        console.error('保存设置失败:', error)
        alert('保存失败')
      }
    },
    addStyle() {
      const newKey = `style_${Date.now()}`;
      this.settings.styles[newKey] = {
        name: '新风格',
        description: '风格描述'
      };
    },
    removeStyle(key) {
      if (confirm('确定要删除这个风格吗？')) {
        delete this.settings.styles[key];
      }
    },
    resetSettings() {
      if (confirm('确定要重置所有设置吗？')) {
        configService.resetConfig()
        this.fetchSettings()
      }
    }
  }
}
</script>
