<template>
  <div class="space-y-6">
    <section class="rounded-3xl bg-slate-900 p-6 text-white shadow-lg">
      <div class="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div class="max-w-3xl">
          <p class="text-sm uppercase tracking-[0.25em] text-slate-300">Codex Desktop Pipeline</p>
          <h1 class="mt-3 text-3xl font-bold">AI 任务中心</h1>
          <p class="mt-3 text-sm leading-7 text-slate-300">
            后台现在主要负责排队、分配、审核和追踪，本地桌面端负责真正执行平面图解析、正式图整理、3D 配置和全景配置。
          </p>
        </div>

        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div class="rounded-2xl bg-white/10 p-4 backdrop-blur">
            <p class="text-xs text-slate-300">总任务</p>
            <p class="mt-2 text-2xl font-semibold">{{ stats.total }}</p>
          </div>
          <div class="rounded-2xl bg-emerald-400/15 p-4">
            <p class="text-xs text-emerald-100">待审核</p>
            <p class="mt-2 text-2xl font-semibold text-emerald-50">{{ stats.reviewRequired }}</p>
          </div>
          <div class="rounded-2xl bg-sky-400/15 p-4">
            <p class="text-xs text-sky-100">运行中</p>
            <p class="mt-2 text-2xl font-semibold text-sky-50">{{ stats.running }}</p>
          </div>
          <div class="rounded-2xl bg-amber-400/15 p-4">
            <p class="text-xs text-amber-100">在线设备</p>
            <p class="mt-2 text-2xl font-semibold text-amber-50">{{ stats.onlineDevices }}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="grid grid-cols-1 gap-6 2xl:grid-cols-[0.9fr_1.1fr]">
      <div class="rounded-2xl bg-white p-5 shadow 2xl:col-span-2">
        <div class="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div class="max-w-3xl">
            <h2 class="text-lg font-semibold text-slate-900">本地运行指引</h2>
            <p class="mt-1 text-sm leading-6 text-slate-500">
              下面这组命令可以直接把桌面端 worker 准备起来。默认是 mock 处理模式，链路跑通后再把 `codex-worker/.env` 切到真实 Codex 命令。
            </p>
          </div>
          <div class="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
            后台地址: `http://127.0.0.1:3002/api`
          </div>
        </div>

        <div class="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p class="text-sm font-medium text-slate-900">1. 初始化配置</p>
            <pre class="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-3 text-xs leading-6 text-slate-100"><code>npm run setup:workers</code></pre>
          </div>
          <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p class="text-sm font-medium text-slate-900">2. 启动桌面 worker</p>
            <pre class="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-3 text-xs leading-6 text-slate-100"><code>npm run worker:start</code></pre>
          </div>
          <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p class="text-sm font-medium text-slate-900">3. 单次试跑</p>
            <pre class="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-3 text-xs leading-6 text-slate-100"><code>npm run worker:start:once</code></pre>
          </div>
        </div>
      </div>

      <div class="rounded-2xl bg-white p-5 shadow">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-lg font-semibold text-slate-900">桌面设备</h2>
            <p class="mt-1 text-sm text-slate-500">本地 Codex worker 注册后会在这里显示。</p>
          </div>
          <button
            type="button"
            class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
            @click="loadData"
          >
            刷新
          </button>
        </div>

        <div v-if="loading" class="mt-4 rounded-xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">
          正在加载设备信息...
        </div>
        <div v-else-if="devices.length === 0" class="mt-4 rounded-xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">
          还没有注册的桌面端设备。启动 `desktop-worker` 后会自动登记。
        </div>
        <div v-else class="mt-4 space-y-3">
          <article
            v-for="device in devices"
            :key="device.id"
            class="rounded-2xl border border-slate-200 bg-slate-50 p-4"
          >
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p class="font-medium text-slate-900">{{ device.device_name }}</p>
                <p class="mt-1 text-xs text-slate-500">{{ device.device_code }} · {{ device.processor_type || 'codex' }}</p>
              </div>
              <span :class="['rounded-full px-3 py-1 text-xs font-medium', deviceStatusTone(device.status)]">
                {{ deviceStatusLabel(device.status) }}
              </span>
            </div>
            <div class="mt-3 grid grid-cols-1 gap-2 text-sm text-slate-600 sm:grid-cols-2">
              <p>系统: {{ device.os_name || '未知' }} {{ device.os_version || '' }}</p>
              <p>最近心跳: {{ formatDateTime(device.last_heartbeat_at) }}</p>
            </div>
          </article>
        </div>
      </div>

      <div class="rounded-2xl bg-white p-5 shadow">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 class="text-lg font-semibold text-slate-900">任务队列</h2>
            <p class="mt-1 text-sm text-slate-500">支持查看执行状态，并对待审核结果做人工确认。</p>
            <p class="mt-2 text-xs text-slate-400">
              {{ autoRefreshEnabled ? `自动刷新已开启，每 ${autoRefreshSeconds} 秒同步一次运行中任务。` : '当前没有运行中任务，自动刷新已暂停。' }}
            </p>
          </div>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <select
              v-model="filters.status"
              class="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              <option value="">全部状态</option>
              <option value="pending">待领取</option>
              <option value="claimed">已领取</option>
              <option value="running">运行中</option>
              <option value="review_required">待审核</option>
              <option value="failed">失败</option>
            </select>
            <select
              v-model="filters.jobType"
              class="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              <option value="">全部类型</option>
              <option value="full_pipeline">全流程</option>
              <option value="parse_floor_plan">解析</option>
              <option value="generate_3d">3D</option>
              <option value="generate_panorama">全景</option>
              <option value="direct_visual_preview">AI直出预览</option>
            </select>
            <button
              type="button"
              class="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white transition hover:bg-slate-800"
              @click="loadJobs"
            >
              应用筛选
            </button>
          </div>
        </div>

        <div v-if="jobLoading" class="mt-4 rounded-xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">
          正在加载任务...
        </div>
        <div v-else-if="jobs.length === 0" class="mt-4 rounded-xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">
          当前没有匹配的任务记录。
        </div>
        <div v-else class="mt-4 space-y-4">
          <article
            v-for="job in jobs"
            :key="job.id"
            class="rounded-2xl border border-slate-200 p-4"
          >
            <div class="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="text-base font-semibold text-slate-900">{{ job.job_no }}</p>
                  <span :class="['rounded-full px-3 py-1 text-xs font-medium', jobStatusTone(job.status)]">
                    {{ jobStatusLabel(job.status) }}
                  </span>
                  <span class="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                    {{ jobTypeLabel(job.job_type) }}
                  </span>
                </div>
                <p class="mt-2 text-sm text-slate-600">
                  {{ [job.building_name, job.floor_plan_name, job.unit_number].filter(Boolean).join(' · ') || '未关联业务信息' }}
                </p>
                <div class="mt-3 grid grid-cols-1 gap-2 text-sm text-slate-500 sm:grid-cols-2 xl:grid-cols-4">
                  <p>设备: {{ job.device_name || '自动分配' }}</p>
                  <p>优先级: {{ job.priority }}</p>
                  <p>创建时间: {{ job.createdAt }}</p>
                  <p>完成时间: {{ job.finishedAt }}</p>
                </div>
                <div class="mt-3 grid grid-cols-1 gap-2 text-sm text-slate-500 sm:grid-cols-2 xl:grid-cols-4">
                  <p>执行器: {{ job.processorLabel }}</p>
                  <p>耗时: {{ job.durationLabel }}</p>
                  <p>房间数: {{ job.roomCount || '未识别' }}</p>
                  <p>来源: {{ job.inputPayload.sourceType || 'digital' }}</p>
                </div>
                <div class="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span class="rounded-full bg-slate-100 px-3 py-1 text-slate-500">
                    最后更新 {{ job.updateLabel }}
                  </span>
                  <span
                    v-if="job.isTimeoutRisk"
                    class="rounded-full bg-rose-100 px-3 py-1 font-medium text-rose-700"
                  >
                    运行超时预警
                  </span>
                </div>
                <div class="mt-3 flex flex-wrap gap-2 text-xs">
                  <span :class="deliveryTagTone(job.hasFormalPlan)">
                    正式图 {{ job.hasFormalPlan ? '已生成' : '未生成' }}
                  </span>
                  <span :class="deliveryTagTone(job.hasThreeD)">
                    3D 配置 {{ job.hasThreeD ? '已生成' : '未生成' }}
                  </span>
                  <span :class="deliveryTagTone(job.hasPanorama)">
                    全景配置 {{ job.hasPanorama ? '已生成' : '未生成' }}
                  </span>
                </div>
                <p v-if="job.error_message" class="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {{ job.error_message }}
                </p>
              </div>

              <div class="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
                  @click="openDetail(job)"
                >
                  查看详情
                </button>
                <button
                  v-if="canMarkFailed(job)"
                  type="button"
                  class="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 transition hover:bg-rose-100"
                  @click="markJobFailed(job)"
                >
                  人工标记失败
                </button>
                <router-link
                  v-if="job.floor_plan_id"
                  :to="`/admin/floor-plans/${job.floor_plan_id}`"
                  class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
                >
                  查看平面图
                </router-link>
                <button
                  v-if="job.status === 'review_required'"
                  type="button"
                  class="rounded-lg bg-emerald-500 px-3 py-2 text-sm text-white transition hover:bg-emerald-600"
                  @click="reviewJob(job, 'approved')"
                >
                  通过
                </button>
                <button
                  v-if="job.status === 'review_required'"
                  type="button"
                  class="rounded-lg bg-amber-500 px-3 py-2 text-sm text-white transition hover:bg-amber-600"
                  @click="reviewJob(job, 'needs_revision')"
                >
                  打回
                </button>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>

    <div
      v-if="selectedJob"
      class="fixed inset-0 z-40 flex justify-end bg-slate-950/40 backdrop-blur-sm"
      @click.self="closeDetail"
    >
      <aside class="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl">
        <div class="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-6 py-4 backdrop-blur">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-xs uppercase tracking-[0.2em] text-slate-400">任务详情</p>
              <h2 class="mt-2 text-xl font-semibold text-slate-900">{{ selectedJob.job_no }}</h2>
              <p class="mt-1 text-sm text-slate-500">{{ selectedJob.processorLabel }} · {{ selectedJob.durationLabel }}</p>
            </div>
            <button
              type="button"
              class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50"
              @click="closeDetail"
            >
              关闭
            </button>
          </div>
        </div>

        <div v-if="detailLoading" class="p-6 text-sm text-slate-500">
          正在加载任务详情...
        </div>

        <div v-else class="space-y-6 p-6">
          <section class="flex flex-wrap gap-3">
            <button
              v-if="canRetry(selectedJob)"
              type="button"
              class="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white transition hover:bg-slate-800"
              @click="retryJob(selectedJob)"
            >
              重新创建任务
            </button>
            <button
              type="button"
              class="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
              @click="copyLogs(selectedJob)"
            >
              复制日志
            </button>
            <button
              v-if="canMarkFailed(selectedJob)"
              type="button"
              class="rounded-lg border border-rose-300 px-4 py-2 text-sm text-rose-700 transition hover:bg-rose-50"
              @click="markJobFailed(selectedJob)"
            >
              标记失败
            </button>
            <button
              v-if="hasAnyArtifact(selectedJob)"
              type="button"
              class="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
              @click="openArtifacts(selectedJob)"
            >
              打开全部产物
            </button>
            <button
              type="button"
              class="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
              @click="exportJobSummary(selectedJob)"
            >
              导出任务摘要
            </button>
          </section>

          <section class="grid grid-cols-2 gap-3">
            <div class="rounded-2xl bg-slate-50 p-4">
              <p class="text-xs text-slate-400">状态</p>
              <p class="mt-2 text-sm font-medium text-slate-900">{{ jobStatusLabel(selectedJob.status) }}</p>
            </div>
            <div class="rounded-2xl bg-slate-50 p-4">
              <p class="text-xs text-slate-400">房间数</p>
              <p class="mt-2 text-sm font-medium text-slate-900">{{ selectedJob.roomCount || '未识别' }}</p>
            </div>
            <div class="rounded-2xl bg-slate-50 p-4">
              <p class="text-xs text-slate-400">创建时间</p>
              <p class="mt-2 text-sm font-medium text-slate-900">{{ selectedJob.createdAt }}</p>
            </div>
            <div class="rounded-2xl bg-slate-50 p-4">
              <p class="text-xs text-slate-400">完成时间</p>
              <p class="mt-2 text-sm font-medium text-slate-900">{{ selectedJob.finishedAt }}</p>
            </div>
          </section>

          <section class="rounded-2xl border border-slate-200 p-4">
            <h3 class="text-sm font-semibold text-slate-900">交付产物</h3>
            <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <a v-if="selectedJob.artifacts.formalPlanUrl" :href="selectedJob.artifacts.formalPlanUrl" target="_blank" rel="noreferrer" class="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 transition hover:bg-slate-100">查看正式图</a>
              <a v-if="selectedJob.artifacts.formalPlanJsonUrl" :href="selectedJob.artifacts.formalPlanJsonUrl" target="_blank" rel="noreferrer" class="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 transition hover:bg-slate-100">查看正式图 JSON</a>
              <a v-if="selectedJob.artifacts.threeDConfigUrl" :href="selectedJob.artifacts.threeDConfigUrl" target="_blank" rel="noreferrer" class="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 transition hover:bg-slate-100">查看 3D 配置</a>
              <a v-if="selectedJob.artifacts.panoramaConfigUrl" :href="selectedJob.artifacts.panoramaConfigUrl" target="_blank" rel="noreferrer" class="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 transition hover:bg-slate-100">查看全景配置</a>
              <a v-if="selectedJob.artifacts.reviewFileUrl" :href="selectedJob.artifacts.reviewFileUrl" target="_blank" rel="noreferrer" class="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 transition hover:bg-slate-100">查看复核文件</a>
              <a v-if="selectedJob.artifacts.recognitionDiagnosticsUrl" :href="selectedJob.artifacts.recognitionDiagnosticsUrl" target="_blank" rel="noreferrer" class="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 transition hover:bg-slate-100">查看识别诊断</a>
              <a v-if="selectedJob.artifacts.previewImageUrl" :href="selectedJob.artifacts.previewImageUrl" target="_blank" rel="noreferrer" class="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 transition hover:bg-slate-100">查看预览图</a>
            </div>
          </section>

          <section v-if="selectedJob.floorPlanContext" class="rounded-2xl border border-slate-200 p-4">
            <h3 class="text-sm font-semibold text-slate-900">关联平面图</h3>
            <div class="mt-3 space-y-2 text-sm text-slate-600">
              <p>名称: {{ selectedJob.floorPlanContext.name || '未命名' }}</p>
              <p>来源图: {{ selectedJob.floorPlanContext.imageUrl || '暂无' }}</p>
              <p>审核状态: {{ selectedJob.floorPlanContext.review_status || 'pending' }}</p>
            </div>
          </section>

          <section class="rounded-2xl border border-slate-200 p-4">
            <div class="flex items-center justify-between gap-4">
              <h3 class="text-sm font-semibold text-slate-900">执行日志</h3>
              <span class="text-xs text-slate-400">{{ selectedJob.logs.length }} 条</span>
            </div>

            <div v-if="selectedJob.logs.length === 0" class="mt-4 rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
              暂无日志
            </div>

            <div v-else class="mt-4 space-y-3">
              <article
                v-for="log in selectedJob.logs"
                :key="log.id"
                class="rounded-xl bg-slate-50 p-4"
              >
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div class="flex items-center gap-2">
                    <span class="rounded-full bg-slate-200 px-2 py-1 text-xs text-slate-600">{{ log.stage }}</span>
                    <span :class="logLevelTone(log.level)">{{ log.level }}</span>
                  </div>
                  <span class="text-xs text-slate-400">{{ log.createdAt }}</span>
                </div>
                <p class="mt-3 text-sm text-slate-700">{{ log.message }}</p>
                <pre v-if="log.payloadData" class="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-3 text-xs leading-6 text-slate-100"><code>{{ formatJson(log.payloadData) }}</code></pre>
              </article>
            </div>
          </section>
        </div>
      </aside>
    </div>
  </div>
</template>

<script>
import { adminService, formatDateTime } from '@/services/adminService'

export default {
  name: 'AiJobCenter',
  data() {
    return {
      loading: false,
      jobLoading: false,
      detailLoading: false,
      devices: [],
      jobs: [],
      selectedJob: null,
      refreshTimer: null,
      autoRefreshSeconds: 12,
      filters: {
        status: '',
        jobType: ''
      }
    }
  },
  computed: {
    stats() {
      return {
        total: this.jobs.length,
        reviewRequired: this.jobs.filter((item) => item.status === 'review_required').length,
        running: this.jobs.filter((item) => ['claimed', 'running'].includes(item.status)).length,
        onlineDevices: this.devices.filter((item) => ['online', 'busy'].includes(item.status)).length
      }
    },
    autoRefreshEnabled() {
      return this.jobs.some((item) => ['claimed', 'running'].includes(item.status))
    }
  },
  mounted() {
    this.loadData()
  },
  beforeUnmount() {
    this.stopAutoRefresh()
  },
  methods: {
    formatDateTime,
    jobTypeLabel(type) {
      const labels = {
        full_pipeline: '全流程任务',
        parse_floor_plan: '解析任务',
        generate_3d: '3D 任务',
        generate_panorama: '全景任务',
        direct_visual_preview: 'AI 直出概念预览'
      }
      return labels[type] || type || '未知任务'
    },
    jobStatusLabel(status) {
      const labels = {
        pending: '待领取',
        claimed: '已领取',
        running: '运行中',
        review_required: '待审核',
        failed: '失败'
      }
      return labels[status] || status || '未知'
    },
    jobStatusTone(status) {
      const tones = {
        pending: 'bg-slate-100 text-slate-700',
        claimed: 'bg-amber-100 text-amber-700',
        running: 'bg-sky-100 text-sky-700',
        review_required: 'bg-emerald-100 text-emerald-700',
        failed: 'bg-rose-100 text-rose-700'
      }
      return tones[status] || 'bg-slate-100 text-slate-700'
    },
    deviceStatusLabel(status) {
      const labels = {
        online: '在线',
        busy: '忙碌',
        offline: '离线'
      }
      return labels[status] || status || '未知'
    },
    deviceStatusTone(status) {
      const tones = {
        online: 'bg-emerald-100 text-emerald-700',
        busy: 'bg-sky-100 text-sky-700',
        offline: 'bg-slate-100 text-slate-700'
      }
      return tones[status] || 'bg-slate-100 text-slate-700'
    },
    deliveryTagTone(isReady) {
      return isReady
        ? 'rounded-full bg-emerald-100 px-3 py-1 font-medium text-emerald-700'
        : 'rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-500'
    },
    logLevelTone(level) {
      const tones = {
        error: 'rounded-full bg-rose-100 px-2 py-1 text-xs text-rose-700',
        warn: 'rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-700',
        info: 'rounded-full bg-sky-100 px-2 py-1 text-xs text-sky-700'
      }
      return tones[level] || 'rounded-full bg-slate-200 px-2 py-1 text-xs text-slate-600'
    },
    formatJson(value) {
      return JSON.stringify(value, null, 2)
    },
    canRetry(job) {
      return ['failed', 'review_required'].includes(job?.status)
    },
    canMarkFailed(job) {
      return ['pending', 'claimed', 'running'].includes(job?.status)
    },
    hasAnyArtifact(job) {
      const artifacts = job?.artifacts || {}
      return [
        artifacts.formalPlanUrl,
        artifacts.formalPlanJsonUrl,
        artifacts.threeDConfigUrl,
        artifacts.panoramaConfigUrl,
        artifacts.reviewFileUrl,
        artifacts.recognitionDiagnosticsUrl,
        artifacts.previewImageUrl
      ].some(Boolean)
    },
    startAutoRefresh() {
      if (this.refreshTimer || !this.autoRefreshEnabled) {
        return
      }

      this.refreshTimer = window.setInterval(async () => {
        try {
          await this.loadJobs({ silent: true })
          if (this.selectedJob?.id) {
            this.selectedJob = await adminService.getAiJob(this.selectedJob.id)
          }
        } catch (error) {
          console.error('自动刷新 AI 任务失败:', error)
        }
      }, this.autoRefreshSeconds * 1000)
    },
    stopAutoRefresh() {
      if (!this.refreshTimer) {
        return
      }

      window.clearInterval(this.refreshTimer)
      this.refreshTimer = null
    },
    syncAutoRefresh() {
      if (this.autoRefreshEnabled) {
        this.startAutoRefresh()
        return
      }

      this.stopAutoRefresh()
    },
    async loadData() {
      this.loading = true
      try {
        await Promise.all([this.loadDevices(), this.loadJobs()])
      } catch (error) {
        console.error('加载 AI 任务中心失败:', error)
        alert(error.message || '加载失败')
      } finally {
        this.loading = false
      }
    },
    async loadDevices() {
      this.devices = await adminService.getAiDevices()
    },
    async loadJobs(options = {}) {
      if (!options.silent) {
        this.jobLoading = true
      }
      try {
        this.jobs = await adminService.getAiJobs({
          status: this.filters.status || undefined,
          job_type: this.filters.jobType || undefined
        })
        this.syncAutoRefresh()
      } finally {
        if (!options.silent) {
          this.jobLoading = false
        }
      }
    },
    async openDetail(job) {
      this.selectedJob = {
        ...job,
        logs: []
      }
      this.detailLoading = true
      try {
        this.selectedJob = await adminService.getAiJob(job.id)
      } catch (error) {
        console.error('加载任务详情失败:', error)
        alert(error.message || '加载任务详情失败')
      } finally {
        this.detailLoading = false
      }
    },
    closeDetail() {
      this.selectedJob = null
      this.detailLoading = false
    },
    async retryJob(job) {
      try {
        const result = await adminService.retryAiJob(job.id)
        alert(`任务已重新创建：${result.data.job_no}`)
        await this.loadJobs()
        const nextJob = this.jobs.find((item) => item.id === result.data.id)
        if (nextJob) {
          await this.openDetail(nextJob)
        }
      } catch (error) {
        console.error('重试任务失败:', error)
        alert(error.response?.data?.message || error.message || '重试任务失败')
      }
    },
    async markJobFailed(job) {
      const reason = window.prompt('请输入失败原因，便于后续排查：', job.error_message || '人工终止任务，等待重新调度。')

      if (reason === null) {
        return
      }

      try {
        await adminService.failAiJob(job.id, {
          error_message: reason.trim() || '人工终止任务，等待重新调度。',
          stage: 'manual_intervention',
          payload: {
            source: 'admin_ai_job_center',
            action: 'mark_failed'
          }
        })

        alert('任务已标记失败')
        await this.loadJobs()

        if (this.selectedJob?.id === job.id) {
          await this.openDetail(this.jobs.find((item) => item.id === job.id) || job)
        }
      } catch (error) {
        console.error('人工标记失败失败:', error)
        alert(error.response?.data?.message || error.message || '操作失败')
      }
    },
    async copyLogs(job) {
      try {
        const content = (job.logs || [])
          .map((log) => {
            const payload = log.payloadData ? `\n${JSON.stringify(log.payloadData, null, 2)}` : ''
            return `[${log.createdAt}] ${log.stage}/${log.level}: ${log.message}${payload}`
          })
          .join('\n\n')

        await navigator.clipboard.writeText(content || '暂无日志')
        alert('任务日志已复制')
      } catch (error) {
        console.error('复制日志失败:', error)
        alert('复制失败，请稍后重试')
      }
    },
    openArtifacts(job) {
      const urls = [
        job?.artifacts?.formalPlanUrl,
        job?.artifacts?.formalPlanJsonUrl,
        job?.artifacts?.threeDConfigUrl,
        job?.artifacts?.panoramaConfigUrl,
        job?.artifacts?.reviewFileUrl,
        job?.artifacts?.recognitionDiagnosticsUrl,
        job?.artifacts?.previewImageUrl
      ].filter(Boolean)

      if (!urls.length) {
        alert('当前任务还没有可打开的产物')
        return
      }

      urls.forEach((url) => {
        window.open(url, '_blank', 'noopener,noreferrer')
      })
    },
    exportJobSummary(job) {
      const summary = {
        jobNo: job.job_no,
        status: job.status,
        jobType: job.job_type,
        processor: job.processorLabel,
        priority: job.priority,
        durationMinutes: job.durationMinutes,
        roomCount: job.roomCount,
        sourceType: job.inputPayload?.sourceType || 'digital',
        timeoutRisk: job.isTimeoutRisk,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        finishedAt: job.finishedAt,
        artifacts: job.artifacts,
        summary: job.summary,
        logs: (job.logs || []).map((log) => ({
          stage: log.stage,
          level: log.level,
          message: log.message,
          createdAt: log.createdAt,
          payload: log.payloadData || null
        }))
      }

      const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${job.job_no || 'ai-job'}-summary.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    },
    async reviewJob(job, reviewStatus) {
      const reviewNotes = reviewStatus === 'approved'
        ? '已在 AI 任务中心人工确认通过。'
        : '需要本地桌面端重新调整结果并再次提交。'

      try {
        await adminService.reviewAiJob(job.id, {
          review_status: reviewStatus,
          review_notes: reviewNotes
        })
        alert(reviewStatus === 'approved' ? '已通过审核' : '已打回任务')
        await this.loadJobs()
        if (this.selectedJob?.id === job.id) {
          await this.openDetail(job)
        }
      } catch (error) {
        console.error('提交审核失败:', error)
        alert(error.message || '提交审核失败')
      }
    }
  }
}
</script>
