<template>
  <div class="space-y-6 overflow-x-hidden">
    <!-- 操作栏 -->
    <div class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div class="min-w-0">
          <p class="text-sm font-medium text-slate-500">平面图管理</p>
          <h1 class="mt-2 text-2xl font-bold text-slate-900">楼层图纸、CAD 与 3D 交付总览</h1>
          <p class="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            在这里统一查看楼层覆盖情况、原始图上传情况，以及 CAD、全屋 3D 图、全景漫游的交付进度。
          </p>
        </div>
        <div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <router-link
            to="/admin/recognition-assets"
            class="inline-flex w-full items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 sm:w-auto"
          >
            制图标准图例
          </router-link>
          <router-link
            to="/admin/floor-plans/create"
            class="inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-800 sm:w-auto"
          >
            + 上传平面图
          </router-link>
        </div>
      </div>

      <div class="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <select
          v-model="selectedBuilding"
          class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-slate-400"
          @change="handleBuildingChange"
        >
          <option value="">所有楼盘</option>
          <option v-for="building in buildings" :key="building.id" :value="String(building.id)">
            {{ building.name }}
          </option>
        </select>
        <select
          v-model="selectedBlock"
          :disabled="!selectedBuilding"
          class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100"
        >
          <option value="">所有楼栋</option>
          <option v-for="block in blocks" :key="block.id" :value="String(block.id)">
            {{ block.blockNumber }} 栋
          </option>
        </select>
        <select
          v-model="selectedFloor"
          class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-slate-400"
        >
          <option value="">所有楼层</option>
          <option v-for="floor in floorOptions" :key="floor" :value="String(floor)">
            {{ floor }} 层
          </option>
        </select>
        <select
          v-model="selectedStatus"
          class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-slate-400"
        >
          <option value="">所有状态</option>
          <option value="待处理">待处理</option>
          <option value="处理中">处理中</option>
          <option value="已完成">已完成</option>
          <option value="失败">失败</option>
        </select>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索平面图名称..."
          class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-slate-400 xl:col-span-2 2xl:col-span-1"
          @keyup.enter="handleSearch"
        />
        <button
          @click="handleSearch"
          class="rounded-2xl bg-blue-500 px-4 py-3 text-white transition-colors hover:bg-blue-600"
        >
          搜索
        </button>
      </div>
    </div>

    <div class="rounded-lg bg-white p-6 shadow">
      <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 class="text-lg font-semibold text-gray-800">楼层平面图台账</h2>
          <p class="mt-1 text-sm text-gray-500">按楼盘、楼栋、楼层汇总房屋和平面图覆盖情况，快速定位缺图楼层与 AI 未完成楼层。</p>
        </div>
        <div class="flex flex-wrap gap-2 text-xs">
          <span class="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">解析 OK</span>
          <span class="rounded-full bg-sky-100 px-3 py-1 text-sky-700">3D OK</span>
          <span class="rounded-full bg-fuchsia-100 px-3 py-1 text-fuchsia-700">全景 OK</span>
        </div>
      </div>

      <div v-if="floorLedger.length > 0" class="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div
          v-for="summary in ledgerSummaryCards"
          :key="summary.label"
          :class="['rounded-xl border p-4', summary.cardTone]"
        >
          <p class="text-sm">{{ summary.label }}</p>
          <p class="mt-2 text-3xl font-bold">{{ summary.value }}</p>
          <p class="mt-2 text-xs opacity-80">{{ summary.description }}</p>
        </div>
      </div>

      <div v-if="allFloorLedger.length > 0" class="mt-5 flex flex-wrap gap-2">
        <button
          v-for="filter in ledgerQuickFilters"
          :key="filter.value"
          type="button"
          :class="[
            'rounded-full px-4 py-2 text-sm transition-colors',
            ledgerFocus === filter.value
              ? 'bg-slate-900 text-white'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          ]"
          @click="ledgerFocus = filter.value"
        >
          {{ filter.label }}
        </button>
      </div>

      <div v-if="floorLedger.length === 0" class="mt-4 rounded-lg border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
        还没有可汇总的楼层数据，请先补录房屋信息。
      </div>

      <div v-else class="mt-4 hidden overflow-x-auto xl:block">
        <table class="min-w-full">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">楼层</th>
              <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">状态</th>
              <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">房屋数</th>
              <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">已上传图纸</th>
              <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">AI 完成</th>
              <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">3D / 全景</th>
              <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">缺口</th>
              <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 bg-white">
            <tr v-for="row in floorLedger" :key="row.key" class="hover:bg-gray-50">
              <td class="px-4 py-4">
                <div class="text-sm font-medium text-gray-900">{{ row.locationLabel }}</div>
                <div class="mt-1 text-xs text-gray-400">{{ row.houseLabels.slice(0, 3).join(' / ') || '暂无房屋标签' }}</div>
              </td>
              <td class="px-4 py-4">
                <div class="flex flex-col gap-2">
                  <span :class="['inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium', row.statusTone]">
                    {{ row.statusLabel }}
                  </span>
                  <p class="text-xs text-gray-500">{{ row.statusDescription }}</p>
                </div>
              </td>
              <td class="px-4 py-4 text-sm text-gray-700">{{ row.houseCount }}</td>
              <td class="px-4 py-4 text-sm text-gray-700">{{ row.planCount }}</td>
              <td class="px-4 py-4">
                <span :class="['rounded-full px-2 py-1 text-xs', row.parseCompletedCount > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600']">
                  {{ row.parseCompletedCount }}/{{ row.planCount }}
                </span>
              </td>
              <td class="px-4 py-4">
                <div class="flex flex-wrap gap-2 text-xs">
                  <span :class="['rounded-full px-2 py-1', row.threeDCount > 0 ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600']">3D {{ row.threeDCount }}</span>
                  <span :class="['rounded-full px-2 py-1', row.panoramaCount > 0 ? 'bg-fuchsia-100 text-fuchsia-700' : 'bg-slate-100 text-slate-600']">全景 {{ row.panoramaCount }}</span>
                </div>
              </td>
              <td class="px-4 py-4">
                <div class="text-sm text-gray-700">{{ row.missingCount === 0 ? '已覆盖' : `缺 ${row.missingCount} 套` }}</div>
                <div v-if="row.missingHouseLabels.length" class="mt-1 text-xs text-amber-600">
                  {{ row.missingHouseLabels.slice(0, 3).join(' / ') }}
                </div>
                <button
                  v-if="row.missingHouseDetails.length"
                  type="button"
                  class="mt-2 text-xs text-blue-600 transition-colors hover:text-blue-800"
                  @click="openMissingHouseDrawer(row)"
                >
                  查看缺图房屋明细
                </button>
              </td>
              <td class="px-4 py-4">
                <div class="flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-700 transition hover:bg-blue-100"
                    @click="applyLedgerFilter(row)"
                  >
                    查看本层图纸
                  </button>
                  <button
                    type="button"
                    class="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700 transition hover:bg-emerald-100"
                    @click="goToUploadForRow(row)"
                  >
                    去上传本层图纸
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="floorLedger.length > 0" class="mt-4 grid grid-cols-1 gap-4 xl:hidden">
        <div
          v-for="row in floorLedger"
          :key="`${row.key}-mobile`"
          class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="break-words text-base font-semibold text-slate-900">{{ row.locationLabel }}</p>
              <p class="mt-1 text-xs text-slate-400">{{ row.houseLabels.slice(0, 3).join(' / ') || '暂无房屋标签' }}</p>
            </div>
            <span :class="['rounded-full px-2.5 py-1 text-xs font-medium', row.statusTone]">
              {{ row.statusLabel }}
            </span>
          </div>
          <p class="mt-3 text-sm leading-6 text-slate-500">{{ row.statusDescription }}</p>
          <div class="mt-4 grid grid-cols-2 gap-3">
            <div class="rounded-xl bg-slate-50 p-3">
              <p class="text-xs text-slate-500">房屋数</p>
              <p class="mt-1 text-lg font-semibold text-slate-900">{{ row.houseCount }}</p>
            </div>
            <div class="rounded-xl bg-slate-50 p-3">
              <p class="text-xs text-slate-500">已上传图纸</p>
              <p class="mt-1 text-lg font-semibold text-slate-900">{{ row.planCount }}</p>
            </div>
            <div class="rounded-xl bg-emerald-50 p-3">
              <p class="text-xs text-emerald-600">AI 完成</p>
              <p class="mt-1 text-lg font-semibold text-emerald-900">{{ row.parseCompletedCount }}/{{ row.planCount }}</p>
            </div>
            <div class="rounded-xl bg-sky-50 p-3">
              <p class="text-xs text-sky-600">3D / 全景</p>
              <p class="mt-1 text-lg font-semibold text-sky-900">{{ row.threeDCount }} / {{ row.panoramaCount }}</p>
            </div>
          </div>
          <div class="mt-4 flex flex-wrap gap-2 text-xs">
            <span :class="['rounded-full px-2 py-1', row.parseCompletedCount > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600']">
              解析 {{ row.parseCompletedCount }}/{{ row.planCount }}
            </span>
            <span :class="['rounded-full px-2 py-1', row.threeDCount > 0 ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600']">
              3D {{ row.threeDCount }}
            </span>
            <span :class="['rounded-full px-2 py-1', row.panoramaCount > 0 ? 'bg-fuchsia-100 text-fuchsia-700' : 'bg-slate-100 text-slate-600']">
              全景 {{ row.panoramaCount }}
            </span>
          </div>
          <div class="mt-4 rounded-xl border border-dashed border-amber-200 bg-amber-50 p-3">
            <p class="text-sm text-amber-700">{{ row.missingCount === 0 ? '当前楼层房屋图纸已覆盖' : `仍缺 ${row.missingCount} 套房屋图纸` }}</p>
            <p v-if="row.missingHouseLabels.length" class="mt-1 text-xs text-amber-600">
              {{ row.missingHouseLabels.slice(0, 3).join(' / ') }}
            </p>
          </div>
          <div class="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 transition hover:bg-blue-100"
              @click="applyLedgerFilter(row)"
            >
              查看本层图纸
            </button>
            <button
              type="button"
              class="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 transition hover:bg-emerald-100"
              @click="goToUploadForRow(row)"
            >
              去上传图纸
            </button>
            <button
              v-if="row.missingHouseDetails.length"
              type="button"
              class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
              @click="openMissingHouseDrawer(row)"
            >
              查看缺图房屋
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 数据表格 -->
    <div class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div class="border-b border-slate-200 px-6 py-5">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 class="text-lg font-semibold text-slate-900">图纸明细</h2>
            <p class="mt-1 text-sm text-slate-500">逐张查看原始图、CAD/正式图、全屋 3D 与全景状态，窄屏下自动切换为卡片视图。</p>
          </div>
          <div class="flex flex-wrap gap-2 text-xs">
            <span class="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">解析 OK</span>
            <span class="rounded-full bg-slate-100 px-3 py-1 text-slate-700">CAD / 正式图</span>
            <span class="rounded-full bg-sky-100 px-3 py-1 text-sky-700">全屋 3D</span>
            <span class="rounded-full bg-fuchsia-100 px-3 py-1 text-fuchsia-700">全景</span>
          </div>
        </div>
      </div>

      <table class="hidden min-w-full xl:table">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">平面图</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">名称</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">位置</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">AI交付</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">创建时间</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
          </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
          <tr v-for="plan in paginatedFloorPlans" :key="plan.id" class="hover:bg-gray-50">
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden">
                <img
                  v-if="getPlanImageSrc(plan)"
                  :src="getPlanImageSrc(plan)"
                  :alt="plan.name"
                  class="w-full h-full object-cover"
                  @error="handlePlanImageError(plan)"
                />
                <span v-else class="text-gray-400 text-2xl">📐</span>
              </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="text-sm font-medium text-gray-900">{{ plan.name }}</div>
            </td>
            <td class="px-6 py-4">
              <div class="text-sm text-gray-700">{{ plan.locationLabel || plan.houseName }}</div>
              <div class="mt-1 text-xs text-gray-400">{{ plan.houseName }}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <span
                :class="{
                  'px-2 py-1 text-xs rounded-full': true,
                  'bg-yellow-100 text-yellow-800': plan.parse_status === 'pending',
                  'bg-blue-100 text-blue-800': plan.parse_status === 'processing',
                  'bg-green-100 text-green-800': plan.parse_status === 'completed',
                  'bg-red-100 text-red-800': plan.parse_status === 'failed'
                }"
              >
                {{ plan.statusLabel }}
              </span>
            </td>
            <td class="px-6 py-4">
              <div class="flex flex-wrap gap-2 text-xs">
                <span :class="['rounded-full px-2 py-1', plan.parseOk ? 'bg-emerald-100 text-emerald-700' : plan.parse_status === 'failed' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700']">
                  解析 {{ plan.parseOk ? 'OK' : plan.parse_status === 'failed' ? '失败' : '待处理' }}
                </span>
                <span :class="['rounded-full px-2 py-1', plan.cadOk ? 'bg-slate-200 text-slate-700' : 'bg-slate-100 text-slate-500']">
                  CAD {{ plan.cadOk ? 'OK' : '未生成' }}
                </span>
                <span :class="['rounded-full px-2 py-1', plan.threeDOk ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600']">
                  3D {{ plan.threeDOk ? 'OK' : '未生成' }}
                </span>
                <span :class="['rounded-full px-2 py-1', plan.panoramaOk ? 'bg-fuchsia-100 text-fuchsia-700' : 'bg-slate-100 text-slate-600']">
                  全景 {{ plan.panoramaOk ? 'OK' : '未生成' }}
                </span>
              </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="text-sm text-gray-500">{{ plan.createdAt }}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
              <router-link
                :to="`/admin/floor-plans/${plan.id}`"
                class="text-blue-600 hover:text-blue-900 mr-3"
              >
                查看
              </router-link>
              <button
                v-if="plan.parse_status === 'failed' || plan.parse_status === 'pending'"
                @click="retryAi(plan)"
                :disabled="retryingId === plan.id"
                class="text-amber-600 hover:text-amber-900 mr-3 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {{ retryingId === plan.id ? '重试中...' : '重试AI' }}
              </button>
              <button
                v-if="plan.parse_status === 'completed'"
                @click="viewPanorama(plan)"
                class="text-purple-600 hover:text-purple-900 mr-3"
              >
                全景
              </button>
              <button
                @click="deleteFloorPlan(plan.id)"
                class="text-red-600 hover:text-red-900"
              >
                删除
              </button>
            </td>
          </tr>
          <tr v-if="paginatedFloorPlans.length === 0">
            <td colspan="7" class="px-6 py-12 text-center">
              <div class="flex flex-col items-center justify-center space-y-4">
                <div class="text-6xl text-gray-300">📐</div>
                <h3 class="text-lg font-medium text-gray-900">暂无平面图数据</h3>
                <p class="text-gray-500">点击上方的 "上传平面图" 按钮开始上传第一个平面图</p>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="grid grid-cols-1 gap-4 p-4 xl:hidden">
        <div
          v-for="plan in paginatedFloorPlans"
          :key="`${plan.id}-card`"
          class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div class="flex gap-4">
            <div class="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-100">
              <img
                v-if="getPlanImageSrc(plan)"
                :src="getPlanImageSrc(plan)"
                :alt="plan.name"
                class="h-full w-full object-contain"
                @error="handlePlanImageError(plan)"
              />
              <span v-else class="text-3xl text-slate-400">📐</span>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <p class="break-words text-base font-semibold text-slate-900">{{ plan.name }}</p>
                <span
                  :class="{
                    'px-2 py-1 text-xs rounded-full': true,
                    'bg-yellow-100 text-yellow-800': plan.parse_status === 'pending',
                    'bg-blue-100 text-blue-800': plan.parse_status === 'processing',
                    'bg-green-100 text-green-800': plan.parse_status === 'completed',
                    'bg-red-100 text-red-800': plan.parse_status === 'failed'
                  }"
                >
                  {{ plan.statusLabel }}
                </span>
              </div>
              <p class="mt-2 break-words text-sm text-slate-600">{{ plan.locationLabel || plan.houseName }}</p>
              <p class="mt-1 text-xs text-slate-400">{{ plan.createdAt }}</p>
            </div>
          </div>
          <div class="mt-4 flex flex-wrap gap-2 text-xs">
            <span :class="['rounded-full px-2 py-1', plan.parseOk ? 'bg-emerald-100 text-emerald-700' : plan.parse_status === 'failed' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700']">
              解析 {{ plan.parseOk ? 'OK' : plan.parse_status === 'failed' ? '失败' : '待处理' }}
            </span>
            <span :class="['rounded-full px-2 py-1', plan.cadOk ? 'bg-slate-200 text-slate-700' : 'bg-slate-100 text-slate-500']">
              CAD {{ plan.cadOk ? 'OK' : '未生成' }}
            </span>
            <span :class="['rounded-full px-2 py-1', plan.threeDOk ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600']">
              3D {{ plan.threeDOk ? 'OK' : '未生成' }}
            </span>
            <span :class="['rounded-full px-2 py-1', plan.panoramaOk ? 'bg-fuchsia-100 text-fuchsia-700' : 'bg-slate-100 text-slate-600']">
              全景 {{ plan.panoramaOk ? 'OK' : '未生成' }}
            </span>
          </div>
          <div class="mt-4 flex flex-wrap gap-3 text-sm font-medium">
            <router-link
              :to="`/admin/floor-plans/${plan.id}`"
              class="text-blue-600 hover:text-blue-900"
            >
              查看
            </router-link>
            <button
              v-if="plan.parse_status === 'failed' || plan.parse_status === 'pending'"
              @click="retryAi(plan)"
              :disabled="retryingId === plan.id"
              class="text-amber-600 hover:text-amber-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {{ retryingId === plan.id ? '重试中...' : '重试AI' }}
            </button>
            <button
              v-if="plan.parse_status === 'completed'"
              @click="viewPanorama(plan)"
              class="text-purple-600 hover:text-purple-900"
            >
              全景
            </button>
            <button
              @click="deleteFloorPlan(plan.id)"
              class="text-red-600 hover:text-red-900"
            >
              删除
            </button>
          </div>
        </div>

        <div v-if="paginatedFloorPlans.length === 0" class="rounded-2xl border border-dashed border-slate-200 px-6 py-12 text-center">
          <div class="flex flex-col items-center justify-center space-y-4">
            <div class="text-6xl text-gray-300">📐</div>
            <h3 class="text-lg font-medium text-gray-900">暂无平面图数据</h3>
            <p class="text-gray-500">点击上方的“上传平面图”开始上传第一张图纸。</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 分页 -->
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="text-sm text-gray-500">
        显示 {{ startCount }} 到 {{ endCount }} 条，共 {{ total }} 条
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

    <div v-if="selectedLedgerRow" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
      <div class="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div class="flex items-start justify-between border-b border-gray-200 px-6 py-5">
          <div>
            <h3 class="text-xl font-semibold text-gray-900">待上传房屋明细</h3>
            <p class="mt-1 text-sm text-gray-500">{{ selectedLedgerRow.locationLabel }}，当前缺 {{ selectedLedgerRow.missingCount }} 套房屋平面图。</p>
          </div>
          <button
            type="button"
            class="rounded-lg px-3 py-1 text-2xl leading-none text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            @click="closeMissingHouseDrawer"
          >
            ×
          </button>
        </div>

        <div class="overflow-y-auto px-6 py-5">
          <div class="mb-4 flex flex-wrap gap-2 text-xs">
            <span class="rounded-full bg-amber-100 px-3 py-1 text-amber-700">缺图 {{ selectedLedgerRow.missingCount }} 套</span>
            <span class="rounded-full bg-slate-100 px-3 py-1 text-slate-600">已上传 {{ selectedLedgerRow.planCount }} 份</span>
            <span class="rounded-full bg-blue-100 px-3 py-1 text-blue-700">AI 完成 {{ selectedLedgerRow.parseCompletedCount }} 份</span>
          </div>

          <div class="overflow-x-auto rounded-xl border border-gray-200">
            <table class="min-w-full">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">房屋</th>
                  <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">位置</th>
                  <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">面积</th>
                  <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">户型</th>
                  <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 bg-white">
                <tr v-for="house in selectedLedgerRow.missingHouseDetails" :key="house.id">
                  <td class="px-4 py-4 text-sm font-medium text-gray-900">{{ house.unitNumber || house.roomNumber || `房屋 ${house.id}` }}</td>
                  <td class="px-4 py-4 text-sm text-gray-600">{{ house.locationLabel }}</td>
                  <td class="px-4 py-4 text-sm text-gray-600">{{ house.area || 0 }} m²</td>
                  <td class="px-4 py-4 text-sm text-gray-600">{{ house.layoutLabel }}</td>
                  <td class="px-4 py-4">
                    <button
                      type="button"
                      class="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700 transition hover:bg-emerald-100"
                      @click="goToUploadForHouse(house)"
                    >
                      上传此房屋图纸
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-6 py-4">
          <p class="text-sm text-gray-500">建议先上传同层中面积和户型最典型的房屋平面图，后续可作为楼层参考模板。</p>
          <div class="flex gap-2">
            <button
              type="button"
              class="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700 transition hover:bg-blue-100"
              @click="applyLedgerFilter(selectedLedgerRow)"
            >
              查看本层图纸
            </button>
            <button
              type="button"
              class="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white transition hover:bg-slate-800"
              @click="closeMissingHouseDrawer"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { adminService, buildAssetUrlCandidates } from '@/services/adminService'

export default {
  name: 'FloorPlanList',
  data() {
    return {
      buildings: [],
      blocks: [],
      houses: [],
      selectedBuilding: '',
      selectedBlock: '',
      selectedFloor: '',
      selectedStatus: '',
      ledgerFocus: 'all',
      searchQuery: '',
      floorPlans: [],
      planImageState: {},
      selectedLedgerRow: null,
      retryingId: null,
      currentPage: 1,
      pageSize: 10,
      total: 0
    }
  },
  computed: {
    filteredFloorPlans() {
      const keyword = this.searchQuery.trim().toLowerCase()

      return this.floorPlans.filter((plan) => {
        const buildingMatched = !this.selectedBuilding || String(plan.building_id) === String(this.selectedBuilding)
        const blockMatched = !this.selectedBlock || String(plan.block_id) === String(this.selectedBlock)
        const floorMatched = !this.selectedFloor || String(plan.floorNumber) === String(this.selectedFloor)
        const statusMatched = !this.selectedStatus || plan.statusLabel === this.selectedStatus
        const keywordMatched = !keyword || [plan.name, plan.houseName]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(keyword))

        return buildingMatched && blockMatched && floorMatched && statusMatched && keywordMatched
      })
    },
    allFloorLedger() {
      const grouped = new Map()

      this.houses.forEach((house) => {
        const key = [
          house.building_id || 'unknown-building',
          house.block_id || 'unknown-block',
          house.floor || 'unknown-floor'
        ].join('-')

        if (!grouped.has(key)) {
          grouped.set(key, {
            key,
            buildingId: house.building_id ? String(house.building_id) : '',
            blockId: house.block_id ? String(house.block_id) : '',
            floorNumber: house.floor ? String(house.floor) : '',
            locationLabel: [house.buildingName, house.blockNumber ? `${house.blockNumber} 栋` : '', house.floor ? `${house.floor} 层` : '未录入楼层']
              .filter(Boolean)
              .join(' · '),
            houseCount: 0,
            houseIds: [],
            houseLabels: [],
            planCount: 0,
            parseCompletedCount: 0,
            threeDCount: 0,
            panoramaCount: 0,
            missingCount: 0,
            missingHouseLabels: [],
            statusLabel: '待补录',
            statusDescription: '当前楼层还没有建立平面图覆盖。',
            statusTone: 'bg-amber-100 text-amber-700'
          })
        }

        const row = grouped.get(key)
        row.houseCount += 1
        row.houseIds.push(String(house.id))
        row.houseLabels.push(house.unitNumber || house.roomNumber || house.locationLabel)
      })

      this.floorPlans.forEach((plan) => {
        const key = [
          plan.building_id || 'unknown-building',
          plan.block_id || 'unknown-block',
          plan.floorNumber || 'unknown-floor'
        ].join('-')

        if (!grouped.has(key)) {
          grouped.set(key, {
            key,
            buildingId: plan.building_id ? String(plan.building_id) : '',
            blockId: plan.block_id ? String(plan.block_id) : '',
            floorNumber: plan.floorNumber ? String(plan.floorNumber) : '',
            locationLabel: [plan.building_name || plan.buildingName, plan.blockNumber ? `${plan.blockNumber} 栋` : '', plan.floorNumber ? `${plan.floorNumber} 层` : '未录入楼层']
              .filter(Boolean)
              .join(' · '),
            houseCount: 0,
            houseIds: [],
            houseLabels: [],
            planCount: 0,
            parseCompletedCount: 0,
            threeDCount: 0,
            panoramaCount: 0,
            missingCount: 0,
            missingHouseLabels: [],
            statusLabel: '待补录',
            statusDescription: '当前楼层还没有建立平面图覆盖。',
            statusTone: 'bg-amber-100 text-amber-700'
          })
        }

        const row = grouped.get(key)
        row.planCount += 1
        if (plan.parseOk) {
          row.parseCompletedCount += 1
        }
        if (plan.threeDOk) {
          row.threeDCount += 1
        }
        if (plan.panoramaOk) {
          row.panoramaCount += 1
        }
      })

      return Array.from(grouped.values())
        .map((row) => {
          const matchedPlans = this.floorPlans.filter((plan) => {
            return row.houseIds.includes(String(plan.house_id))
          })
          const coveredHouseIds = new Set(matchedPlans.map((plan) => String(plan.house_id)))
          row.missingHouseLabels = this.houses
            .filter((house) => row.houseIds.includes(String(house.id)) && !coveredHouseIds.has(String(house.id)))
            .map((house) => house.unitNumber || house.roomNumber || house.locationLabel)
          row.missingHouseDetails = this.houses
            .filter((house) => row.houseIds.includes(String(house.id)) && !coveredHouseIds.has(String(house.id)))
          row.missingCount = row.houseCount - coveredHouseIds.size
          Object.assign(row, this.resolveLedgerStatus(row))
          return row
        })
        .sort((a, b) => {
          const priorityDelta = this.ledgerStatusPriority(a.statusLabel) - this.ledgerStatusPriority(b.statusLabel)
          if (priorityDelta !== 0) {
            return priorityDelta
          }

          const floorDelta = Number(b.floorNumber || 0) - Number(a.floorNumber || 0)
          if (!Number.isNaN(floorDelta) && floorDelta !== 0) {
            return floorDelta
          }

          return a.locationLabel.localeCompare(b.locationLabel, 'zh-CN')
        })
    },
    floorLedger() {
      return this.allFloorLedger
        .filter((row) => {
          const buildingMatched = !this.selectedBuilding || row.buildingId === String(this.selectedBuilding)
          const blockMatched = !this.selectedBlock || row.blockId === String(this.selectedBlock)
          const floorMatched = !this.selectedFloor || row.floorNumber === String(this.selectedFloor)
          const ledgerFocusMatched = this.matchLedgerFocus(row)
          return buildingMatched && blockMatched && floorMatched && ledgerFocusMatched
        })
    },
    ledgerQuickFilters() {
      return [
        { label: '全部楼层', value: 'all' },
        { label: '仅看缺图', value: 'missing' },
        { label: '仅看 AI 未完成', value: 'ai_pending' },
        { label: '仅看交付未完成', value: 'delivery_pending' },
        { label: '仅看已完成', value: 'done' }
      ]
    },
    ledgerSummaryCards() {
      const summaries = [
        {
          label: '完全缺图楼层',
          key: '完全缺图',
          value: 0,
          description: '还没有任何图纸，需要优先补录。',
          cardTone: 'border-rose-200 bg-rose-50 text-rose-700'
        },
        {
          label: '部分缺图楼层',
          key: '部分缺图',
          value: 0,
          description: '有房屋未覆盖到平面图。',
          cardTone: 'border-amber-200 bg-amber-50 text-amber-700'
        },
        {
          label: 'AI 未完成楼层',
          key: 'AI 未完成',
          value: 0,
          description: '图纸已上传，但解析还没跑完。',
          cardTone: 'border-blue-200 bg-blue-50 text-blue-700'
        },
        {
          label: '交付未完成楼层',
          key: '交付未完成',
          value: 0,
          description: '3D 或全景还没全部交付。',
          cardTone: 'border-purple-200 bg-purple-50 text-purple-700'
        },
        {
          label: '已完成楼层',
          key: '已完成',
          value: 0,
          description: '图纸、3D、全景已齐备。',
          cardTone: 'border-emerald-200 bg-emerald-50 text-emerald-700'
        }
      ]

      this.floorLedger.forEach((row) => {
        const target = summaries.find((item) => item.key === row.statusLabel)
        if (target) {
          target.value += 1
        }
      })

      return summaries
    },
    floorOptions() {
      const floors = this.houses
        .filter((house) => {
          const buildingMatched = !this.selectedBuilding || String(house.building_id) === String(this.selectedBuilding)
          const blockMatched = !this.selectedBlock || String(house.block_id) === String(this.selectedBlock)
          return buildingMatched && blockMatched && house.floor !== null && house.floor !== undefined && house.floor !== ''
        })
        .map((house) => Number(house.floor))
        .filter((value) => !Number.isNaN(value))

      return [...new Set(floors)].sort((a, b) => b - a)
    },
    paginatedFloorPlans() {
      const start = (this.currentPage - 1) * this.pageSize
      return this.filteredFloorPlans.slice(start, start + this.pageSize)
    },
    totalPages() {
      return Math.max(1, Math.ceil(this.total / this.pageSize))
    },
    startCount() {
      return this.total === 0 ? 0 : (this.currentPage - 1) * this.pageSize + 1
    },
    endCount() {
      return Math.min(this.currentPage * this.pageSize, this.total)
    }
  },
  mounted() {
    this.bootstrap()
  },
  methods: {
    async bootstrap() {
      await Promise.all([
        this.fetchBuildings(),
        this.fetchHouses(),
        this.fetchFloorPlans()
      ])
    },
    async fetchBuildings() {
      try {
        this.buildings = await adminService.getBuildings()
      } catch (error) {
        console.error('获取楼盘列表失败:', error)
      }
    },
    async fetchFloorPlans() {
      try {
        this.floorPlans = await adminService.getFloorPlans()
        this.initializePlanImageState()
        this.total = this.filteredFloorPlans.length
      } catch (error) {
        console.error('获取平面图列表失败:', error)
      }
    },
    initializePlanImageState() {
      this.planImageState = this.floorPlans.reduce((accumulator, plan) => {
        accumulator[plan.id] = {
          candidates: buildAssetUrlCandidates(plan.imageUrl),
          index: 0
        }
        return accumulator
      }, {})
    },
    getPlanImageSrc(plan) {
      return this.planImageState[plan.id]?.candidates?.[this.planImageState[plan.id]?.index || 0] || ''
    },
    handlePlanImageError(plan) {
      const state = this.planImageState[plan.id]
      if (!state) {
        return
      }

      if (state.index < state.candidates.length - 1) {
        this.planImageState = {
          ...this.planImageState,
          [plan.id]: {
            ...state,
            index: state.index + 1
          }
        }
        return
      }

      this.planImageState = {
        ...this.planImageState,
        [plan.id]: {
          candidates: [],
          index: 0
        }
      }
    },
    async fetchHouses() {
      try {
        this.houses = await adminService.getHouses()
      } catch (error) {
        console.error('获取房屋列表失败:', error)
      }
    },
    async handleBuildingChange() {
      await this.loadBlocksForSelectedBuilding()
      this.selectedBlock = ''
      this.selectedFloor = ''
      this.handleSearch()
    },
    async applyLedgerFilter(row) {
      this.selectedBuilding = row.buildingId
      await this.loadBlocksForSelectedBuilding()
      this.selectedBlock = row.blockId
      this.selectedFloor = row.floorNumber
      this.handleSearch()
    },
    goToUploadForRow(row) {
      this.$router.push({
        path: '/admin/floor-plans/create',
        query: {
          buildingId: row.buildingId || undefined,
          blockId: row.blockId || undefined,
          floorNumber: row.floorNumber || undefined
        }
      })
    },
    goToUploadForHouse(house) {
      this.$router.push({
        path: '/admin/floor-plans/create',
        query: {
          houseId: house.id,
          buildingId: house.building_id || undefined,
          blockId: house.block_id || undefined,
          floorNumber: house.floor || undefined
        }
      })
    },
    openMissingHouseDrawer(row) {
      this.selectedLedgerRow = row
    },
    closeMissingHouseDrawer() {
      this.selectedLedgerRow = null
    },
    async loadBlocksForSelectedBuilding() {
      if (!this.selectedBuilding) {
        this.blocks = []
        return
      }

      try {
        this.blocks = await adminService.getBlocksByBuilding(this.selectedBuilding)
      } catch (error) {
        console.error('获取楼栋列表失败:', error)
        this.blocks = []
      }
    },
    handleSearch() {
      this.currentPage = 1
      this.total = this.filteredFloorPlans.length
    },
    resolveLedgerStatus(row) {
      if (row.planCount === 0 || row.missingCount === row.houseCount) {
        return {
          statusLabel: '完全缺图',
          statusDescription: '这一层还没有任何可用平面图，建议优先补图。',
          statusTone: 'bg-rose-100 text-rose-700'
        }
      }

      if (row.missingCount > 0) {
        return {
          statusLabel: '部分缺图',
          statusDescription: `还有 ${row.missingCount} 套房屋缺少平面图覆盖。`,
          statusTone: 'bg-amber-100 text-amber-700'
        }
      }

      if (row.parseCompletedCount < row.planCount) {
        return {
          statusLabel: 'AI 未完成',
          statusDescription: '图纸已上传，但还有解析任务未完成。',
          statusTone: 'bg-blue-100 text-blue-700'
        }
      }

      if (row.threeDCount < row.planCount || row.panoramaCount < row.planCount) {
        return {
          statusLabel: '交付未完成',
          statusDescription: '解析已完成，但 3D 或全景交付仍有缺口。',
          statusTone: 'bg-purple-100 text-purple-700'
        }
      }

      return {
        statusLabel: '已完成',
        statusDescription: '本层图纸、3D 和全景交付已经齐备。',
        statusTone: 'bg-emerald-100 text-emerald-700'
      }
    },
    ledgerStatusPriority(statusLabel) {
      const priorities = {
        完全缺图: 0,
        部分缺图: 1,
        'AI 未完成': 2,
        交付未完成: 3,
        已完成: 4
      }

      return priorities[statusLabel] ?? 99
    },
    matchLedgerFocus(row) {
      if (this.ledgerFocus === 'all') {
        return true
      }

      if (this.ledgerFocus === 'missing') {
        return row.statusLabel === '完全缺图' || row.statusLabel === '部分缺图'
      }

      if (this.ledgerFocus === 'ai_pending') {
        return row.statusLabel === 'AI 未完成'
      }

      if (this.ledgerFocus === 'delivery_pending') {
        return row.statusLabel === '交付未完成'
      }

      if (this.ledgerFocus === 'done') {
        return row.statusLabel === '已完成'
      }

      return true
    },
    prevPage() {
      if (this.currentPage > 1) {
        this.currentPage--
        this.fetchFloorPlans()
      }
    },
    nextPage() {
      if (this.currentPage < this.totalPages) {
        this.currentPage++
        this.fetchFloorPlans()
      }
    },
    viewPanorama(plan) {
      if (!plan.panoramaOk) {
        alert('当前平面图还没有生成全景配置')
        return
      }

      this.$router.push(`/admin/floor-plans/${plan.id}`)
    },
    async retryAi(plan) {
      this.retryingId = plan.id

      try {
        const updated = await adminService.rerunFloorPlanParse(plan)
        this.floorPlans = this.floorPlans.map((item) => (item.id === updated.id ? updated : item))
        this.initializePlanImageState()
        this.total = this.filteredFloorPlans.length
      } catch (error) {
        console.error('重试AI失败:', error)
        alert(error.response?.data?.message || error.message || '重试失败')
      } finally {
        this.retryingId = null
      }
    },
    async deleteFloorPlan(id) {
      if (!confirm('确定要删除这个平面图吗？')) return

      try {
        await adminService.deleteFloorPlan(id)
        this.floorPlans = this.floorPlans.filter(p => p.id !== id)
        this.initializePlanImageState()
        this.total = this.filteredFloorPlans.length
      } catch (error) {
        console.error('删除平面图失败:', error)
        alert(error.response?.data?.message || '删除失败')
      }
    }
  },
  watch: {
    selectedBlock() {
      this.handleSearch()
    },
    selectedFloor() {
      this.handleSearch()
    },
    selectedStatus() {
      this.handleSearch()
    }
  }
}
</script>
