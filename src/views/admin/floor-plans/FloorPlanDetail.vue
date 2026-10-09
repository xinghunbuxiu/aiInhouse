<template>
  <div class="min-w-0 space-y-6">
    <div
      v-if="loading"
      class="rounded-3xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 shadow-sm"
    >
      正在加载平面图详情...
    </div>

    <div
      v-else-if="errorMessage"
      class="rounded-3xl border border-rose-200 bg-rose-50 p-10 text-center shadow-sm"
    >
      <p class="text-base font-semibold text-rose-700">{{ notFound ? '平面图不存在' : '平面图详情加载失败' }}</p>
      <p class="mt-2 text-sm text-rose-600">{{ errorMessage }}</p>
      <div class="mt-4 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          class="rounded-xl bg-rose-600 px-4 py-2 text-sm text-white transition hover:bg-rose-700"
          @click="fetchFloorPlan"
          v-if="!notFound"
        >
          重新加载
        </button>
        <router-link
          to="/admin/floor-plans"
          class="rounded-xl border border-rose-300 bg-white px-4 py-2 text-sm text-rose-700 transition hover:bg-rose-100"
        >
          返回平面图列表
        </router-link>
        <router-link
          to="/admin/floor-plans/create"
          class="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white transition hover:bg-slate-800"
          v-if="notFound"
        >
          去上传新平面图
        </router-link>
      </div>
    </div>

    <template v-else>
    <div class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="space-y-5">
        <div class="min-w-0">
          <router-link
            to="/admin/floor-plans"
            class="inline-flex max-w-full items-center gap-2 text-sm text-gray-500 transition-colors hover:text-gray-800"
          >
            <span class="shrink-0">←</span>
            返回平面图列表
          </router-link>
          <div class="mt-4 flex flex-wrap items-center gap-3">
            <h1 class="min-w-0 text-2xl font-bold text-slate-900 sm:text-3xl">{{ floorPlan.name || '平面图详情' }}</h1>
            <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{{ floorPlan.sourceTypeLabel }}</span>
            <span :class="['rounded-full px-3 py-1 text-xs font-medium', floorPlan.parse_status === 'completed' ? 'bg-emerald-100 text-emerald-700' : floorPlan.parse_status === 'processing' ? 'bg-sky-100 text-sky-700' : floorPlan.parse_status === 'failed' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700']">
              {{ floorPlan.statusLabel }}
            </span>
          </div>
          <p class="mt-3 max-w-4xl text-sm leading-6 text-slate-500">
            当前链路按串行交付推进：原始平面图/手稿 -> CAD/正式图 -> 全屋 3D 设计图 -> 3D 全景漫游数据。只有上一阶段完成，下一阶段结果才具备交付价值。
          </p>
        </div>

        <div class="grid gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(260px,0.75fr)]">
          <div class="grid min-w-0 gap-3 sm:grid-cols-3">
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p class="text-xs uppercase tracking-[0.14em] text-slate-400">当前阶段</p>
              <p class="mt-2 text-sm font-semibold text-slate-900">{{ activeStageLabel }}</p>
            </div>
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p class="text-xs uppercase tracking-[0.14em] text-slate-400">下一步</p>
              <p class="mt-2 text-sm font-semibold text-slate-900">{{ nextStageLabel }}</p>
            </div>
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p class="text-xs uppercase tracking-[0.14em] text-slate-400">任务状态</p>
              <p class="mt-2 text-sm font-semibold text-slate-900">{{ aiJobs.length > 0 ? `最近 ${aiJobs.length} 条` : '暂无任务' }}</p>
            </div>
          </div>

          <div class="flex min-w-0 flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p class="text-sm font-medium text-slate-800">操作入口</p>
            <p class="text-sm leading-6 text-slate-500">首屏只保留流程信息，具体处理动作统一放在下方“下一步动作”。</p>
            <div class="flex flex-wrap gap-2">
              <a
                href="#next-actions"
                class="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white transition-colors hover:bg-slate-800"
              >
                去处理当前阶段
              </a>
              <router-link
                :to="`/admin/floor-plans/${floorPlan.id}/edit`"
                class="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100"
              >
                编辑基础信息
              </router-link>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
      <div
        v-for="stage in serialStages"
        :key="stage.key"
        :class="['min-w-0 rounded-3xl border p-5 shadow-sm', stage.cardTone]"
      >
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="text-[11px] uppercase tracking-[0.16em] opacity-70">Stage {{ stage.order }}</p>
            <p class="mt-2 break-words text-lg font-semibold">{{ stage.label }}</p>
          </div>
          <span :class="['shrink-0 rounded-full px-3 py-1 text-xs font-medium', stage.badgeTone]">{{ stage.statusText }}</span>
        </div>
        <p class="mt-3 break-words text-sm leading-6">{{ stage.message }}</p>
        <p v-if="stage.updatedAt" class="mt-3 text-xs opacity-70">更新时间 {{ stage.updatedAt }}</p>
      </div>
    </div>

    <div class="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_360px]">
      <div class="space-y-6">
        <div id="next-actions" class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div class="min-w-0">
              <h3 class="text-lg font-semibold text-slate-900">流程总览</h3>
              <p class="mt-1 text-sm text-slate-500">页面只保留当前最关键的流转状态、产物和下一步动作。</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <span class="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{{ floorPlan.sourceTypeLabel }}</span>
              <span class="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{{ floorPlan.houseName }}</span>
            </div>
          </div>

          <div class="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div class="rounded-2xl bg-slate-50 p-4">
              <p class="text-sm text-slate-500">房间</p>
              <p class="mt-1 text-2xl font-semibold text-slate-900">{{ floorPlan.parseData?.rooms?.length || 0 }}</p>
            </div>
            <div class="rounded-2xl bg-slate-50 p-4">
              <p class="text-sm text-slate-500">墙体</p>
              <p class="mt-1 text-2xl font-semibold text-slate-900">{{ floorPlan.parseData?.walls?.length || 0 }}</p>
            </div>
            <div class="rounded-2xl bg-slate-50 p-4">
              <p class="text-sm text-slate-500">门窗</p>
              <p class="mt-1 text-2xl font-semibold text-slate-900">{{ openingCount }}</p>
            </div>
            <div class="rounded-2xl bg-slate-50 p-4">
              <p class="text-sm text-slate-500">面积</p>
              <p class="mt-1 text-2xl font-semibold text-slate-900">{{ totalArea }}<span class="ml-1 text-sm font-medium">m²</span></p>
            </div>
          </div>

          <div class="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p class="text-sm font-medium text-slate-700">当前建议</p>
            <p class="mt-2 text-sm leading-6 text-slate-600">{{ deliveryAdvice }}</p>
            <p v-if="floorPlan.processNotes" class="mt-3 text-sm leading-6 text-slate-500">备注：{{ floorPlan.processNotes }}</p>
          </div>

          <div v-if="floorPlan.recognitionConfidence || recognitionIssues.length" class="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div class="flex flex-wrap items-center gap-2">
              <p class="text-sm font-medium text-amber-800">识别质量</p>
              <span v-if="floorPlan.recognitionConfidence?.geometry" class="rounded-full bg-white px-3 py-1 text-xs text-amber-700">
                几何 {{ formatPercent(floorPlan.recognitionConfidence.geometry) }}
              </span>
              <span v-if="floorPlan.recognitionConfidence?.semantics" class="rounded-full bg-white px-3 py-1 text-xs text-amber-700">
                语义 {{ formatPercent(floorPlan.recognitionConfidence.semantics) }}
              </span>
              <span v-if="recognitionAssetMatchCount" class="rounded-full bg-white px-3 py-1 text-xs text-amber-700">
                图例匹配 {{ recognitionAssetMatchCount }}
              </span>
            </div>
            <p class="mt-2 text-sm leading-6 text-amber-700">
              当前识别先由本地几何草稿给出结构，再由 Codex/GPT 做语义校对。低置信度或异常项建议先人工复核，再输出 CAD 和后续效果。
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <a
                v-if="recognitionDiagnosticsUrl"
                :href="recognitionDiagnosticsUrl"
                target="_blank"
                rel="noreferrer"
                class="inline-flex rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-800 transition hover:bg-amber-100"
              >
                打开识别诊断报告
              </a>
              <router-link
                to="/admin/recognition-assets"
                class="inline-flex rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-800 transition hover:bg-amber-100"
              >
                查看制图标准图例库
              </router-link>
            </div>
            <ul v-if="recognitionIssues.length" class="mt-3 space-y-2 text-sm leading-6 text-amber-800">
              <li v-for="(issue, index) in recognitionIssues.slice(0, 3)" :key="`${index}-${issue}`">
                {{ issue }}
              </li>
            </ul>
            <p v-if="reviewOpeningCount" class="mt-3 text-sm font-medium text-rose-700">
              当前有 {{ reviewOpeningCount }} 个门窗需要贴墙复核，已在 Formal Plan 中用红点标记。
            </p>
          </div>

          <div v-if="recognitionImageItems.length" class="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p class="text-sm font-medium text-slate-800">原图识别图列表</p>
                <p class="mt-1 text-xs text-slate-500">按识别链路罗列原图叠加、墙体候选、房间候选和阳台候选等中间图。</p>
              </div>
              <a
                v-if="recognitionDiagnosticsUrl"
                :href="recognitionDiagnosticsUrl"
                target="_blank"
                rel="noreferrer"
                class="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
              >
                完整诊断报告
              </a>
            </div>
            <div class="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <a
                v-for="item in recognitionImageItems"
                :key="item.key"
                :href="item.url"
                target="_blank"
                rel="noreferrer"
                class="group overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 transition hover:border-slate-300 hover:bg-white"
              >
                <div class="aspect-video bg-slate-100">
                  <img
                    :src="item.url"
                    :alt="item.label"
                    class="h-full w-full object-contain"
                  />
                </div>
                <div class="flex items-center justify-between gap-3 px-3 py-2">
                  <span class="text-sm font-medium text-slate-700">{{ item.label }}</span>
                  <span class="text-xs text-slate-400 group-hover:text-slate-600">打开</span>
                </div>
              </a>
            </div>
          </div>
        </div>

        <div class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 class="text-lg font-semibold text-slate-900">核心产物</h3>
              <p class="mt-1 text-sm text-slate-500">按串行流程查看当前已经沉淀下来的关键成果。</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <router-link
                :to="`/admin/floor-plans/${floorPlan.id}/edit`"
                class="rounded-xl bg-indigo-500 px-4 py-2 text-sm text-white transition-colors hover:bg-indigo-600"
              >
                编辑
              </router-link>
              <router-link
                :to="`/admin/floor-plans/${floorPlan.id}/design-site`"
                class="rounded-xl bg-slate-950 px-4 py-2 text-sm text-white transition-colors hover:bg-slate-800"
              >
                装修交付页
              </router-link>
            </div>
          </div>

          <div class="mt-5 grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-5">
            <div class="rounded-2xl border border-slate-200 p-4">
              <div class="flex items-center justify-between gap-3">
                <h4 class="font-medium text-slate-900">原始图</h4>
                <span class="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">Stage 1</span>
              </div>
              <div class="mt-4 aspect-video overflow-hidden rounded-2xl bg-slate-100">
                <img
                  v-if="currentSourceImageUrl"
                  :src="currentSourceImageUrl"
                  :alt="floorPlan.name"
                  class="h-full w-full object-contain"
                  @error="handleSourceImageError"
                />
                <div v-else class="flex h-full items-center justify-center text-5xl text-slate-300">📐</div>
              </div>
            </div>

            <div class="rounded-2xl border border-slate-200 p-4">
              <div class="flex items-center justify-between gap-3">
                <h4 class="font-medium text-slate-900">CAD / 正式图</h4>
                <span :class="['rounded-full px-3 py-1 text-xs font-medium', floorPlan.cadOk ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600']">
                  {{ floorPlan.cadOk ? '已完成' : '待生成' }}
                </span>
              </div>
              <div class="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                <FormalFloorPlanPreview ref="formalPlanPreview" :parse-data="floorPlan.parseData" @opening-updated="handleOpeningUpdated" />
              </div>
              <p v-if="reviewOpeningCount" class="mt-3 text-xs leading-5 text-slate-500">
                红色门窗点可拖动修正位置，拖到正确墙线后点击保存修正。
              </p>
              <div class="mt-4 flex flex-wrap gap-2">
                <button
                  v-if="floorPlan.parseData"
                  @click="exportFormalPlan"
                  class="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50"
                >
                  导出 SVG
                </button>
                <button
                  v-if="floorPlan.parseData"
                  @click="exportFormalPlanPng"
                  class="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50"
                >
                  导出 PNG
                </button>
                <button
                  v-if="floorPlan.parseData"
                  @click="exportCorrectedFormalPlanJson"
                  class="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50"
                >
                  导出修正 JSON
                </button>
                <button
                  v-if="floorPlan.parseData"
                  @click="saveFormalPlanCorrections"
                  class="rounded-xl bg-slate-950 px-3 py-2 text-sm text-white transition-colors hover:bg-slate-800"
                >
                  保存修正
                </button>
                <a
                  v-if="floorPlan.cadFileUrl"
                  :href="floorPlan.cadFileUrl"
                  target="_blank"
                  rel="noreferrer"
                  class="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
                >
                  下载 DXF
                </a>
              </div>
            </div>

            <div class="rounded-2xl border border-slate-200 p-4">
              <div class="flex items-center justify-between gap-3">
                <h4 class="font-medium text-slate-900">全屋 3D / 渲染交付</h4>
                <span :class="['rounded-full px-3 py-1 text-xs font-medium', activeRenderImageUrl || floorPlan.panoramaOk ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600']">
                  {{ activeRenderImageUrl || floorPlan.panoramaOk ? '已有结果' : '待生成' }}
                </span>
              </div>
              <div class="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  :class="['rounded-full px-3 py-1.5 text-xs font-medium transition', activeRenderTab === 'birdseye' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600']"
                  @click="activeRenderTab = 'birdseye'"
                >
                  俯瞰渲染
                </button>
                <button
                  type="button"
                  :class="['rounded-full px-3 py-1.5 text-xs font-medium transition', activeRenderTab === 'effect' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600']"
                  @click="activeRenderTab = 'effect'"
                >
                  平面效果
                </button>
                <button
                  type="button"
                  :class="['rounded-full px-3 py-1.5 text-xs font-medium transition', activeRenderTab === 'interior' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600']"
                  @click="activeRenderTab = 'interior'"
                >
                  室内观赏 {{ interiorGallery.length ? `(${interiorGallery.length})` : '' }}
                </button>
              </div>
              <p class="mt-3 text-xs text-slate-500">{{ activeRenderLabel }}</p>
              <div class="mt-3 flex aspect-video min-h-[180px] max-h-[320px] overflow-hidden rounded-2xl bg-[radial-gradient(circle_at_top,#dbeafe_0%,#f8fafc_48%,#e2e8f0_100%)]">
                <img
                  v-if="activeRenderImageUrl"
                  :src="activeRenderImageUrl"
                  :alt="activeRenderLabel"
                  class="h-full w-full object-contain"
                  @error="handlePreviewImageError"
                />
                <div v-else class="flex h-full items-center justify-center px-6 text-center text-sm leading-6 text-slate-500">
                  {{ floorPlan.generated3DConfig ? '已生成 3D 场景配置，可打开 3D 预览查看。' : '当前还没有生成渲染图，请先完成 CAD/正式图阶段。' }}
                </div>
              </div>
              <div v-if="activeRenderTab === 'interior' && interiorGallery.length > 1" class="mt-3 flex gap-2 overflow-x-auto pb-1">
                <button
                  v-for="(imageUrl, index) in interiorGallery"
                  :key="`${imageUrl}-${index}`"
                  type="button"
                  :class="['shrink-0 rounded-xl border px-3 py-2 text-xs transition', selectedInteriorIndex === index ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600']"
                  @click="selectedInteriorIndex = index"
                >
                  室内 {{ index + 1 }}
                </button>
              </div>
              <div class="mt-4 flex flex-wrap gap-2">
                <button
                  v-if="floorPlan.parse_status === 'completed' && floorPlan.parseData"
                  @click="show3DView = true"
                  class="rounded-xl bg-blue-500 px-3 py-2 text-sm text-white transition-colors hover:bg-blue-600"
                >
                  3D 预览
                </button>
                <button
                  v-if="floorPlan.parse_status === 'completed' && (floorPlan.panoramaUrl || floorPlan.panoramaConfig)"
                  @click="showPanorama = true"
                  class="rounded-xl bg-purple-500 px-3 py-2 text-sm text-white transition-colors hover:bg-purple-600"
                >
                  查看全景
                </button>
                <a
                  v-if="floorPlan.vrTourUrl"
                  :href="floorPlan.vrTourUrl"
                  target="_blank"
                  rel="noreferrer"
                  class="rounded-xl border border-purple-200 bg-purple-50 px-3 py-2 text-sm text-purple-700 transition hover:bg-purple-100"
                >
                  打开 VR 漫游页
                </a>
                <button
                  v-if="floorPlan.parseData"
                  @click="downloadDeliveryPackage"
                  class="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50"
                >
                  下载结果包
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="space-y-6">
        <div class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h3 class="text-lg font-semibold text-slate-900">下一步动作</h3>
              <p class="mt-1 text-sm text-slate-500">根据当前阶段，继续推进串行交付。</p>
            </div>
            <router-link
              to="/admin/ai-jobs"
              class="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50"
            >
              任务中心
            </router-link>
          </div>

          <div class="mt-5 space-y-3">
            <div
              v-if="latestJobHint"
              class="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800"
            >
              {{ latestJobHint }}
            </div>

            <button
              @click="submitAiJob('parse_floor_plan')"
              :disabled="jobCreationLoading === 'parse_floor_plan'"
              class="flex w-full items-center justify-between rounded-2xl bg-slate-900 px-4 py-4 text-left text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
            >
              <span>
                <span class="block text-sm font-semibold">识别 2D 图</span>
                <span class="mt-1 block text-xs text-slate-300">重新抓墙体、房间、门窗，并复核阳台、客厅等空间语义</span>
              </span>
              <span class="text-sm">{{ jobCreationLoading === 'parse_floor_plan' ? '创建中...' : '执行' }}</span>
            </button>

            <div class="grid gap-3 sm:grid-cols-2">
              <button
                @click="submitAiJob('direct_visual_preview')"
                :disabled="jobCreationLoading === 'direct_visual_preview'"
                class="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 transition-colors hover:bg-emerald-100 disabled:opacity-50"
              >
                {{ jobCreationLoading === 'direct_visual_preview' ? '生成中...' : '直接生成 AI 俯瞰/全景' }}
              </button>
              <button
                @click="handleReparse"
                :disabled="actionLoading === 'parse'"
                class="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50"
              >
                {{ actionLoading === 'parse' ? '提交中...' : '重新识别 2D 图' }}
              </button>
              <button
                @click="submitAiJob('full_pipeline')"
                :disabled="jobCreationLoading === 'full_pipeline'"
                class="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
              >
                {{ jobCreationLoading === 'full_pipeline' ? '创建中...' : '识别后生成 3D/全景' }}
              </button>
              <button
                @click="handleRegenerate3D"
                :disabled="actionLoading === '3d' || !floorPlan.parseData"
                class="rounded-2xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100 disabled:opacity-50"
              >
                {{ actionLoading === '3d' ? '生成中...' : '生成全屋 3D 图' }}
              </button>
              <button
                @click="handleRegeneratePanorama"
                :disabled="actionLoading === 'panorama' || !floorPlan.parseData"
                class="rounded-2xl border border-fuchsia-300 bg-fuchsia-50 px-4 py-3 text-sm font-medium text-fuchsia-700 transition-colors hover:bg-fuchsia-100 disabled:opacity-50"
              >
                {{ actionLoading === 'panorama' ? '生成中...' : '生成全景配置' }}
              </button>
              <select
                v-model="selectedAiDeviceId"
                class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
              >
                <option value="">自动分配在线设备</option>
                <option v-for="device in aiDevices" :key="device.id" :value="String(device.id)">
                  {{ device.device_name }} · {{ device.status }}
                </option>
              </select>
            </div>
          </div>
        </div>

        <div class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h3 class="text-lg font-semibold text-slate-900">最近任务</h3>
              <p class="mt-1 text-sm text-slate-500">只保留最近的桌面端处理记录，方便跟进。</p>
            </div>
            <span class="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{{ aiJobs.length }} 条</span>
          </div>

          <div v-if="aiJobs.length === 0" class="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
            暂无桌面端任务记录，可以先提交一个全流程任务试跑。
          </div>

          <div v-else class="mt-4 space-y-3">
            <div
              v-for="job in aiJobs.slice(0, 5)"
              :key="job.id"
              class="rounded-2xl border border-slate-200 bg-slate-50 p-4"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="min-w-0">
                  <p class="text-sm font-medium text-slate-900">{{ jobTypeLabel(job.job_type) }}</p>
                  <p class="mt-1 truncate text-xs text-slate-500">{{ job.job_no }} · {{ job.device_name || '自动分配设备' }}</p>
                </div>
                <span :class="['rounded-full px-3 py-1 text-xs font-medium', jobStatusTone(job.status)]">
                  {{ jobStatusLabel(job.status) }}
                </span>
              </div>
              <p v-if="job.error_message" class="mt-2 text-xs text-rose-600">{{ job.error_message }}</p>
              <div v-if="job.status === 'failed'" class="mt-3 flex flex-wrap gap-2">
                <button
                  v-if="job.status === 'failed'"
                  type="button"
                  class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-700 transition hover:bg-amber-100"
                  @click="retryAiDesktopJob(job)"
                >
                  重试任务
                </button>
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="currentPreviewImageUrl || floorPlan.reviewFileUrl || floorPlan.reviewNotes"
          class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <div class="flex items-center justify-between gap-3">
            <div>
              <h3 class="text-lg font-semibold text-slate-900">交付备注</h3>
              <p class="mt-1 text-sm text-slate-500">保留复核说明和结果文件入口。</p>
            </div>
            <span
              :class="[
                'rounded-full px-3 py-1 text-xs font-medium',
                floorPlan.reviewStatus === 'approved'
                  ? 'bg-emerald-100 text-emerald-700'
                  : floorPlan.reviewStatus === 'needs_revision'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-slate-200 text-slate-700'
              ]"
            >
              {{ reviewStatusLabel(floorPlan.reviewStatus) }}
            </span>
          </div>
          <p class="mt-4 text-sm leading-6 text-slate-600">
            {{ floorPlan.reviewNotes || '当前暂无额外审核备注。' }}
          </p>
          <div class="mt-4 flex flex-wrap gap-2">
            <a
              v-if="floorPlan.reviewFileUrl"
              :href="floorPlan.reviewFileUrl"
              target="_blank"
              rel="noreferrer"
              class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
            >
              打开审核说明
            </a>
            <a
              v-if="recognitionDiagnosticsUrl"
              :href="recognitionDiagnosticsUrl"
              target="_blank"
              rel="noreferrer"
              class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
            >
              识别诊断报告
            </a>
            <a
              v-if="floorPlan.formalPlanJsonUrl"
              :href="floorPlan.formalPlanJsonUrl"
              target="_blank"
              rel="noreferrer"
              class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
            >
              正式图 JSON
            </a>
            <a
              v-if="floorPlan.threeDConfigUrl"
              :href="floorPlan.threeDConfigUrl"
              target="_blank"
              rel="noreferrer"
              class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
            >
              3D 配置
            </a>
            <a
              v-if="floorPlan.panoramaConfigUrl"
              :href="floorPlan.panoramaConfigUrl"
              target="_blank"
              rel="noreferrer"
              class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
            >
              全景配置
            </a>
          </div>
        </div>
      </div>
    </div>

    <div v-if="show3DView" class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div class="flex h-[90vh] w-full max-w-6xl flex-col rounded-lg bg-white">
        <div class="flex items-center justify-between border-b p-4">
          <h3 class="text-lg font-semibold">3D场景预览</h3>
          <button @click="show3DView = false" class="text-2xl text-gray-500 hover:text-gray-700">×</button>
        </div>
        <div class="min-h-0 flex-1 overflow-hidden p-4">
          <ThreeDScene
            v-if="floorPlan.parseData || floorPlan.generated3DConfig"
            :parse-data="floorPlan.parseData"
            :scene-config="floorPlan.generated3DConfig"
            :material-data="{ style: floorPlan.materialStyle || 'modern' }"
          />
          <div v-else class="flex h-full items-center justify-center text-gray-500">暂无3D数据</div>
        </div>
      </div>
    </div>

    <div v-if="showPanorama" class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div class="flex h-[90vh] w-full max-w-6xl flex-col rounded-lg bg-white">
        <div class="flex items-center justify-between border-b p-4">
          <h3 class="text-lg font-semibold">全景效果图</h3>
          <button @click="showPanorama = false" class="text-2xl text-gray-500 hover:text-gray-700">×</button>
        </div>
        <div class="min-h-0 flex-1 overflow-hidden p-4">
          <PanoramaViewer
            v-if="floorPlan.panoramaUrl || floorPlan.panoramaConfig"
            :image-url="floorPlan.panoramaUrl"
            :panorama-config="floorPlan.panoramaConfig"
          />
          <div v-else class="flex h-full items-center justify-center text-gray-500">暂无全景图数据</div>
        </div>
      </div>
    </div>
    </template>
  </div>
</template>

<script>
import { defineAsyncComponent } from 'vue'
import FormalFloorPlanPreview from '@/components/FormalFloorPlanPreview.vue'
import { adminService, buildAssetUrlCandidates } from '@/services/adminService'

const ThreeDScene = defineAsyncComponent(() => import('@/components/ThreeDScene.vue'))
const PanoramaViewer = defineAsyncComponent(() => import('@/components/PanoramaViewer.vue'))

export default {
  name: 'FloorPlanDetail',
  components: {
    FormalFloorPlanPreview,
    ThreeDScene,
    PanoramaViewer
  },
  data() {
    return {
      floorPlan: {
        id: '',
        name: '',
        houseName: '',
        imageUrl: '',
        cadFileUrl: '',
        previewImageUrl: '',
        parse_status: 'pending',
        statusLabel: '待处理',
        createdAt: '',
        updatedAt: '',
        materialStyle: 'modern',
        description: '',
        parseData: null,
        generated3DConfig: null,
        panoramaConfig: null,
        birdseyeImageUrls: [],
        interiorImageUrls: [],
        effectImageUrls: [],
        vrTourUrl: '',
        panoramaUrl: '',
        pipeline: {},
        recognitionConfidence: null,
        recognitionIssues: []
      },
      actionLoading: '',
      jobCreationLoading: '',
      sourceImageCandidates: [],
      sourceImageIndex: 0,
      previewImageCandidates: [],
      previewImageIndex: 0,
      aiJobs: [],
      aiDevices: [],
      selectedAiDeviceId: '',
      loading: false,
      notFound: false,
      errorMessage: '',
      show3DView: false,
      showPanorama: false,
      activeRenderTab: 'birdseye',
      selectedInteriorIndex: 0
    }
  },
  computed: {
    openingCount() {
      return (this.floorPlan.parseData?.doors?.length || 0) + (this.floorPlan.parseData?.windows?.length || 0)
    },
    reviewOpeningCount() {
      return [...(this.floorPlan.parseData?.doors || []), ...(this.floorPlan.parseData?.windows || [])]
        .filter((opening) => opening.needsWallAttachmentReview).length
    },
    recognitionIssues() {
      return Array.isArray(this.floorPlan.recognitionIssues) ? this.floorPlan.recognitionIssues : []
    },
    recognitionAssetMatchCount() {
      return Number(this.floorPlan.recognitionAssetMatchCount || this.floorPlan.parseData?.quality?.recognitionAssetMatchCount || 0)
    },
    recognitionDiagnosticsUrl() {
      return this.aiJobs.find((job) => job.artifacts?.recognitionDiagnosticsUrl)?.artifacts?.recognitionDiagnosticsUrl || ''
    },
    recognitionImageItems() {
      const latestWithImages = this.aiJobs.find((job) => job.recognitionImageItems?.length)
      return latestWithImages?.recognitionImageItems || []
    },
    currentSourceImageUrl() {
      return this.sourceImageCandidates[this.sourceImageIndex] || ''
    },
    currentPreviewImageUrl() {
      return this.previewImageCandidates[this.previewImageIndex] || ''
    },
    birdseyeImageUrl() {
      return this.floorPlan.birdseyeImageUrls?.[0] || this.currentPreviewImageUrl || ''
    },
    interiorGallery() {
      return Array.isArray(this.floorPlan.interiorImageUrls) ? this.floorPlan.interiorImageUrls : []
    },
    activeRenderImageUrl() {
      if (this.activeRenderTab === 'interior') {
        return this.interiorGallery[this.selectedInteriorIndex] || ''
      }
      if (this.activeRenderTab === 'effect') {
        return this.floorPlan.effectImageUrls?.[0] || this.currentPreviewImageUrl || ''
      }
      return this.birdseyeImageUrl
    },
    activeRenderLabel() {
      if (this.activeRenderTab === 'interior') {
        const roomName = this.floorPlan.panoramaConfig?.cameraPositions?.[this.selectedInteriorIndex]?.name
        return roomName ? `${roomName} 室内观赏` : `室内观赏 ${this.selectedInteriorIndex + 1}`
      }
      if (this.activeRenderTab === 'effect') {
        return '平面装修效果图'
      }
      return '全屋俯瞰渲染'
    },
    activeStageLabel() {
      const runningStage = this.serialStages.find((stage) => stage.statusText === '进行中')
      if (runningStage) {
        return `${runningStage.label}进行中`
      }

      const pendingStage = this.serialStages.find((stage) => stage.statusText === '待处理')
      if (pendingStage) {
        const previousStage = this.serialStages[pendingStage.order - 2]
        return previousStage?.statusText === 'OK' ? `等待进入${pendingStage.label}` : pendingStage.label
      }

      const failedStage = this.serialStages.find((stage) => stage.statusText === '失败')
      if (failedStage) {
        return `${failedStage.label}异常`
      }

      return '全流程已完成'
    },
    nextStageLabel() {
      const failedStage = this.serialStages.find((stage) => stage.statusText === '失败')
      if (failedStage) {
        return `优先修复${failedStage.label}`
      }

      const pendingStage = this.serialStages.find((stage) => stage.statusText === '待处理')
      if (pendingStage) {
        return pendingStage.label
      }

      const runningStage = this.serialStages.find((stage) => stage.statusText === '进行中')
      if (runningStage) {
        return `等待${runningStage.label}完成`
      }

      return '保存交付版本'
    },
    totalArea() {
      const rooms = this.floorPlan.parseData?.rooms || []
      return rooms.reduce((sum, room) => sum + (Number(room.area) || 0), 0).toFixed(1)
    },
    materialSummary() {
      const materials = this.floorPlan.generated3DConfig?.materials || {}
      return [
        { label: '地板', ...materials.floor },
        { label: '墙面', ...materials.wall },
        { label: '天花', ...materials.ceiling }
      ].filter((item) => item.color || item.texture || item.roughness !== undefined)
    },
    deliveryAdvice() {
      if (this.floorPlan.sourceType === 'hand_drawn') {
        return '这份图纸来自手绘原稿，系统已自动推断闭合墙体和房间边界。建议在交付前重点复核承重墙、门洞方向和尺寸标注，再进入 3D 软装阶段。'
      }

      return '这份图纸来自电子图纸或标准扫描件，当前更适合作为 3D 建模与全景漫游的基础数据。如需施工级交付，建议再补充尺寸线和标高信息。'
    },
    furnitureSummary() {
      return this.floorPlan.generated3DConfig?.furniture || []
    },
    serialStages() {
      const stages = this.floorPlan.pipeline || {}
      return [
        this.toPipelineStage(
          'source',
          1,
          '原始图 / 手稿',
          this.floorPlan.parseOk ? 'success' : this.floorPlan.parse_status === 'failed' ? 'failed' : this.floorPlan.parse_status === 'processing' ? 'processing' : 'pending',
          this.floorPlan.sourceType === 'hand_drawn'
            ? '已接收手绘草图，等待规整为可复核结构图。'
            : '已接收原始平面图，等待进入 CAD/正式图阶段。',
          this.floorPlan.updatedAt || ''
        ),
        this.toPipelineStage(
          'cad',
          2,
          'CAD / 正式图',
          this.floorPlan.cadOk ? 'success' : stages.cad?.status || 'pending',
          stages.cad?.message || '生成 SVG/DXF/JSON 标准图纸，作为后续全屋设计输入。',
          stages.cad?.updatedAt || ''
        ),
        this.toPipelineStage(
          'threeDPreview',
          3,
          '全屋 3D 设计图',
          this.floorPlan.previewImageUrl ? 'success' : stages.threeD?.status || 'pending',
          stages.threeD?.message || '基于 CAD/正式图和房间结构拼装整屋效果图与 3D 配置。',
          stages.threeD?.updatedAt || ''
        ),
        this.toPipelineStage(
          'panoramaDelivery',
          4,
          '3D 全景漫游数据',
          this.floorPlan.panoramaOk ? 'success' : stages.panorama?.status || 'pending',
          stages.panorama?.message || '生成相机位、热点与漫游交付数据。',
          stages.panorama?.updatedAt || ''
        )
      ]
    },
    latestJobHint() {
      const latestJob = this.aiJobs[0]

      if (!latestJob) {
        return this.floorPlan.parse_status === 'processing'
          ? '平面图已上传，正在等待桌面 Worker 领取全流程任务。'
          : ''
      }

      const labels = {
        pending: '任务已创建，等待桌面 Worker 领取。',
        claimed: '任务已被桌面 Worker 领取，准备开始处理。',
        downloading: '桌面 Worker 正在下载原始平面图。',
        running: '桌面 Worker 正在识别图纸并生成 CAD、3D 和全景数据。',
        uploading: '桌面 Worker 正在上传生成结果。',
        failed: latestJob.error_message ? `任务失败：${latestJob.error_message}` : '任务失败，请重试或查看任务中心日志。'
      }

      return labels[latestJob.status] || ''
    }
  },
  mounted() {
    this.fetchFloorPlan()
    window.setTimeout(() => {
      this.fetchAiDevices()
    }, 0)
  },
  methods: {
    reviewStatusLabel(status) {
      const labels = {
        pending: '待复核',
        approved: '已通过',
        needs_revision: '需修改'
      }

      return labels[status] || status || '待复核'
    },
    jobStatusLabel(status) {
      const labels = {
        pending: '待领取',
        claimed: '已领取',
        downloading: '下载中',
        running: '处理中',
        uploading: '上传中',
        review_required: '待复核',
        completed: '已完成',
        failed: '失败',
        cancelled: '已取消'
      }

      return labels[status] || status || '未知'
    },
    jobStatusTone(status) {
      const tones = {
        pending: 'bg-amber-100 text-amber-700',
        claimed: 'bg-blue-100 text-blue-700',
        downloading: 'bg-blue-100 text-blue-700',
        running: 'bg-sky-100 text-sky-700',
        uploading: 'bg-indigo-100 text-indigo-700',
        review_required: 'bg-purple-100 text-purple-700',
        completed: 'bg-emerald-100 text-emerald-700',
        failed: 'bg-rose-100 text-rose-700',
        cancelled: 'bg-slate-100 text-slate-700'
      }

      return tones[status] || 'bg-slate-100 text-slate-700'
    },
    jobTypeLabel(type) {
      const labels = {
        parse_floor_plan: '解析任务',
        convert_hand_drawn: '手绘转正任务',
        generate_3d: '3D 任务',
        generate_panorama: '全景任务',
        direct_visual_preview: 'AI 直出概念预览',
        full_pipeline: '全流程任务'
      }

      return labels[type] || type || '未知任务'
    },
    formatJobTime(value) {
      return value ? new Date(value).toLocaleString('zh-CN') : '暂无'
    },
    formatPercent(value) {
      const numeric = Number(value)
      if (!Number.isFinite(numeric) || numeric <= 0) {
        return '0%'
      }

      return `${Math.round(numeric * 100)}%`
    },
    async fetchAiDevices() {
      try {
        this.aiDevices = await adminService.getAiDevices()
      } catch (error) {
        console.warn('获取AI设备失败，已跳过设备列表:', error)
      }
    },
    async fetchAiJobs() {
      if (!this.floorPlan.id) {
        return
      }

      try {
        this.aiJobs = await adminService.getAiJobs({ floor_plan_id: this.floorPlan.id })
      } catch (error) {
        console.error('获取AI任务失败:', error)
      }
    },
    buildAiJobPayload(jobType) {
      const directVisualPreview = jobType === 'direct_visual_preview'
      const shouldGenerate3D = ['generate_3d', 'generate_panorama', 'full_pipeline', 'direct_visual_preview'].includes(jobType)
      const shouldGeneratePanorama = ['generate_panorama', 'full_pipeline', 'direct_visual_preview'].includes(jobType)

      return {
        floor_plan_id: this.floorPlan.id,
        job_type: jobType,
        assigned_device_id: this.selectedAiDeviceId ? Number(this.selectedAiDeviceId) : null,
        input_payload: {
          sourceType: this.floorPlan.sourceType || 'digital',
          materialStyle: this.floorPlan.materialStyle || 'modern',
          generate3D: shouldGenerate3D,
          generatePanorama: shouldGeneratePanorama,
          recognitionSkipped: directVisualPreview,
          structureValidated: !directVisualPreview,
          targetOutputs: directVisualPreview
            ? ['ai_birdseye_preview', 'ai_panorama_preview']
            : [
                'formal_plan',
                'cad',
                ...(shouldGenerate3D ? ['decorated_3d_effect'] : []),
                ...(shouldGeneratePanorama ? ['panorama_vr'] : [])
              ],
          sourceImageUrl: this.floorPlan.imageUrl || '',
          notes: this.floorPlan.processNotes || '',
          houseName: this.floorPlan.houseName || '',
          locationLabel: this.floorPlan.locationLabel || '',
          floorPlanName: this.floorPlan.name || ''
        }
      }
    },
    async submitAiJob(jobType) {
      this.jobCreationLoading = jobType

      try {
        const result = await adminService.createAiJob(this.buildAiJobPayload(jobType))
        await this.fetchAiJobs()
        alert(`任务已创建：${result.data.job_no}`)
      } catch (error) {
        console.error('创建AI任务失败:', error)
        alert(error.response?.data?.message || error.message || '创建AI任务失败')
      } finally {
        this.jobCreationLoading = ''
      }
    },
    async retryAiDesktopJob(job) {
      try {
        const result = await adminService.retryAiJob(job.id)
        await this.fetchAiJobs()
        alert(`任务已重新创建：${result.data.job_no}`)
      } catch (error) {
        console.error('重试桌面端任务失败:', error)
        alert(error.response?.data?.message || error.message || '重试桌面端任务失败')
      }
    },
    triggerDownload(content, fileName, contentType) {
      const blob = new Blob([content], { type: contentType })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    },
    slugifyFileName(value) {
      return (value || 'floor-plan')
        .toString()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^\w\u4e00-\u9fa5-]/g, '')
    },
    toPipelineStage(key, order, label, statusInput, messageInput, updatedAtInput) {
      const status = statusInput || 'pending'
      const toneMap = {
        pending: {
          cardTone: 'border-slate-200 bg-slate-50 text-slate-700',
          badgeTone: 'bg-slate-200 text-slate-700',
          statusText: '待处理'
        },
        processing: {
          cardTone: 'border-blue-200 bg-blue-50 text-blue-800',
          badgeTone: 'bg-blue-200 text-blue-800',
          statusText: '进行中'
        },
        success: {
          cardTone: 'border-emerald-200 bg-emerald-50 text-emerald-800',
          badgeTone: 'bg-emerald-200 text-emerald-800',
          statusText: 'OK'
        },
        failed: {
          cardTone: 'border-rose-200 bg-rose-50 text-rose-800',
          badgeTone: 'bg-rose-200 text-rose-800',
          statusText: '失败'
        }
      }

      return {
        key,
        order,
        label,
        message: messageInput || '',
        updatedAt: updatedAtInput || '',
        ...(toneMap[status] || toneMap.pending)
      }
    },
    async patchPipelineStage(stageKey, nextStage) {
      const nextParseData = {
        ...(this.floorPlan.parseData || {}),
        meta: {
          ...(this.floorPlan.parseData?.meta || {}),
          pipeline: {
            ...(this.floorPlan.pipeline || {}),
            [stageKey]: {
              ...(this.floorPlan.pipeline?.[stageKey] || {}),
              ...nextStage
            }
          }
        }
      }

      await adminService.updateFloorPlan(this.floorPlan.id, {
        parse_result: JSON.stringify(nextParseData),
        ...(stageKey === 'parse' && nextStage.status === 'processing' ? { parse_status: 'processing' } : {}),
        ...(stageKey === 'parse' && nextStage.status === 'failed' ? { parse_status: 'failed' } : {})
      })
    },
    exportFormalPlan() {
      const svgMarkup = this.$refs.formalPlanPreview?.getSvgMarkup?.()

      if (!svgMarkup) {
        alert('当前暂无可导出的正式平面图')
        return
      }

      const fileName = `${this.slugifyFileName(this.floorPlan.name)}-formal-plan.svg`
      this.triggerDownload(svgMarkup, fileName, 'image/svg+xml;charset=utf-8')
    },
    exportFormalPlanPng() {
      const svgMarkup = this.$refs.formalPlanPreview?.getSvgMarkup?.()

      if (!svgMarkup) {
        alert('当前暂无可导出的正式平面图')
        return
      }

      const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(svgBlob)
      const image = new Image()

      image.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = 1600
        canvas.height = 1120
        const context = canvas.getContext('2d')

        context.fillStyle = '#020617'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(image, 0, 0, canvas.width, canvas.height)

        canvas.toBlob((blob) => {
          if (!blob) {
            alert('PNG 导出失败')
            return
          }

          const pngUrl = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = pngUrl
          link.download = `${this.slugifyFileName(this.floorPlan.name)}-formal-plan.png`
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
          URL.revokeObjectURL(pngUrl)
        }, 'image/png')

        URL.revokeObjectURL(url)
      }

      image.onerror = () => {
        URL.revokeObjectURL(url)
        alert('PNG 导出失败，请稍后重试')
      }

      image.src = url
    },
    getCorrectedParseData() {
      return this.$refs.formalPlanPreview?.getEditedParseData?.() || this.floorPlan.parseData
    },
    handleOpeningUpdated(update) {
      if (!update?.id || !this.floorPlan.parseData) {
        return
      }

      const patchOpenings = (items = []) => items.map((item) => (
        item.id === update.id
          ? {
              ...item,
              ...update,
              position: update.position || item.position,
              needsWallAttachmentReview: false,
              reviewReasons: []
            }
          : item
      ))

      this.floorPlan = {
        ...this.floorPlan,
        parseData: {
          ...this.floorPlan.parseData,
          doors: patchOpenings(this.floorPlan.parseData.doors || []),
          windows: patchOpenings(this.floorPlan.parseData.windows || [])
        }
      }
    },
    exportCorrectedFormalPlanJson() {
      const corrected = this.getCorrectedParseData()
      if (!corrected) {
        alert('当前暂无可导出的修正数据')
        return
      }

      const fileName = `${this.slugifyFileName(this.floorPlan.name)}-formal-plan-corrected.json`
      this.triggerDownload(JSON.stringify(corrected, null, 2), fileName, 'application/json;charset=utf-8')
    },
    async saveFormalPlanCorrections() {
      const corrected = this.getCorrectedParseData()
      if (!corrected) {
        alert('当前暂无可保存的修正数据')
        return
      }

      this.actionLoading = 'save-corrections'
      try {
        const nextParseData = {
          ...corrected,
          meta: {
            ...(corrected.meta || {}),
            recognitionIssues: (corrected.meta?.recognitionIssues || this.recognitionIssues || []).filter((issue) => !String(issue).includes('门窗')),
            manualCorrections: {
              savedAt: new Date().toISOString(),
              source: 'formal-plan-preview'
            }
          }
        }
        await adminService.updateFloorPlan(this.floorPlan.id, {
          parse_result: JSON.stringify(nextParseData),
          parse_status: 'completed'
        })
        this.floorPlan = {
          ...this.floorPlan,
          parseData: nextParseData,
          recognitionIssues: nextParseData.meta.recognitionIssues || []
        }
        alert('修正已保存。后续重新生成 3D/全景时会使用这份修正数据。')
      } catch (error) {
        console.error('保存修正失败:', error)
        alert(error.response?.data?.message || error.message || '保存修正失败')
      } finally {
        this.actionLoading = ''
      }
    },
    downloadDeliveryPackage() {
      const payload = {
        id: this.floorPlan.id,
        name: this.floorPlan.name,
        houseName: this.floorPlan.houseName,
        sourceType: this.floorPlan.sourceType,
        convertedToFormal: this.floorPlan.convertedToFormal,
        createdAt: this.floorPlan.createdAt,
        updatedAt: this.floorPlan.updatedAt,
        processNotes: this.floorPlan.processNotes,
        parseData: this.floorPlan.parseData,
        generated3DConfig: this.floorPlan.generated3DConfig,
        panoramaConfig: this.floorPlan.panoramaConfig
      }

      const fileName = `${this.slugifyFileName(this.floorPlan.name)}-delivery-package.json`
      this.triggerDownload(JSON.stringify(payload, null, 2), fileName, 'application/json;charset=utf-8')
    },
    async fetchFloorPlan() {
      this.loading = true
      this.notFound = false
      this.errorMessage = ''

      try {
        const floorPlan = await adminService.getFloorPlan(this.$route.params.id)
        this.floorPlan = {
          ...this.floorPlan,
          ...floorPlan,
          description: floorPlan.description || `平面图 ${floorPlan.name || ''}`.trim()
        }
        this.resetAssetCandidates()
        await this.fetchAiJobs()
      } catch (error) {
        console.error('获取平面图信息失败:', error)
        this.notFound = error.response?.status === 404
        this.errorMessage = error.response?.data?.message || error.message || '平面图详情加载失败'
      } finally {
        this.loading = false
      }
    },
    resetAssetCandidates() {
      this.sourceImageCandidates = buildAssetUrlCandidates(this.floorPlan.imageUrl)
      this.sourceImageIndex = 0
      this.previewImageCandidates = buildAssetUrlCandidates(
        this.floorPlan.birdseyeImageUrls?.[0] || this.floorPlan.previewImageUrl
      )
      this.previewImageIndex = 0
    },
    handleSourceImageError() {
      if (this.sourceImageIndex < this.sourceImageCandidates.length - 1) {
        this.sourceImageIndex += 1
        return
      }

      this.sourceImageCandidates = []
      this.sourceImageIndex = 0
    },
    handlePreviewImageError() {
      if (this.previewImageIndex < this.previewImageCandidates.length - 1) {
        this.previewImageIndex += 1
        return
      }

      this.previewImageCandidates = []
      this.previewImageIndex = 0
    },
    async handleReparse() {
      this.actionLoading = 'parse'

      try {
        await this.patchPipelineStage('parse', {
          status: 'processing',
          message: '已提交 2D 图重新识别任务，等待桌面 Worker 识别墙体、房间、门窗和空间语义',
          updatedAt: new Date().toISOString()
        })
        const result = await adminService.createAiJob(this.buildAiJobPayload('parse_floor_plan'))
        await this.fetchFloorPlan()
        alert(`2D 识别任务已创建：${result.data.job_no}`)
        this.resetAssetCandidates()
      } catch (error) {
        console.error('重新识别 2D 图失败:', error)
        await this.patchPipelineStage('parse', {
          status: 'failed',
          message: error.response?.data?.message || error.message || '重新识别 2D 图失败',
          updatedAt: new Date().toISOString()
        })
        this.floorPlan = await adminService.getFloorPlan(this.floorPlan.id)
        this.resetAssetCandidates()
        alert(error.response?.data?.message || error.message || '重新识别 2D 图失败')
      } finally {
        this.actionLoading = ''
      }
    },
    async handleRegenerate3D() {
      this.actionLoading = '3d'

      try {
        await this.patchPipelineStage('threeD', {
          status: 'processing',
          message: '正在生成 3D 配置',
          updatedAt: new Date().toISOString()
        })
        this.floorPlan = await adminService.regenerateFloorPlan3D(this.floorPlan, this.floorPlan.materialStyle || 'modern')
        this.resetAssetCandidates()
      } catch (error) {
        console.error('重建3D配置失败:', error)
        await this.patchPipelineStage('threeD', {
          status: 'failed',
          message: error.response?.data?.message || error.message || '重建3D配置失败',
          updatedAt: new Date().toISOString()
        })
        this.floorPlan = await adminService.getFloorPlan(this.floorPlan.id)
        this.resetAssetCandidates()
        alert(error.response?.data?.message || error.message || '重建3D配置失败')
      } finally {
        this.actionLoading = ''
      }
    },
    async handleRegeneratePanorama() {
      this.actionLoading = 'panorama'

      try {
        await this.patchPipelineStage('panorama', {
          status: 'processing',
          message: '正在生成全景配置',
          updatedAt: new Date().toISOString()
        })
        this.floorPlan = await adminService.regenerateFloorPlanPanorama(this.floorPlan, this.floorPlan.materialStyle || 'modern')
        this.resetAssetCandidates()
      } catch (error) {
        console.error('重建全景配置失败:', error)
        await this.patchPipelineStage('panorama', {
          status: 'failed',
          message: error.response?.data?.message || error.message || '重建全景配置失败',
          updatedAt: new Date().toISOString()
        })
        this.floorPlan = await adminService.getFloorPlan(this.floorPlan.id)
        this.resetAssetCandidates()
        alert(error.response?.data?.message || error.message || '重建全景配置失败')
      } finally {
        this.actionLoading = ''
      }
    }
  }
}
</script>
