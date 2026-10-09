import apiClient, { API_ROOT_URL } from './apiClient'

const houseStatusMap = {
  available: '在售',
  sold: '已售',
  reserved: '预留'
}

const houseStatusReverseMap = Object.fromEntries(
  Object.entries(houseStatusMap).map(([key, value]) => [value, key])
)

const floorPlanStatusMap = {
  pending: '待处理',
  processing: '处理中',
  completed: '已完成',
  failed: '失败'
}

const buildingStatusMap = {
  0: '禁用',
  1: '启用'
}

const userRoleMap = {
  admin: '管理员',
  user: '普通用户'
}

export function normalizeAssetUrl(url) {
  if (!url) {
    return ''
  }

  if (/^(https?:)?\/\//.test(url) || url.startsWith('data:')) {
    return url
  }

  const normalizedPath = String(url)
    .replace(/\\/g, '/')
    .trim()

  const uploadsMatch = normalizedPath.match(/(?:^|\/)(uploads\/.+)$/)
  if (uploadsMatch?.[1]) {
    return `${API_ROOT_URL}/${uploadsMatch[1]}`
  }

  const aiResultsMatch = normalizedPath.match(/(?:^|\/)(ai-results\/.+)$/)
  if (aiResultsMatch?.[1]) {
    return `${API_ROOT_URL}/${aiResultsMatch[1]}`
  }

  const cleanedPath = normalizedPath.replace(/^\.?\//, '')

  if (!cleanedPath.includes('/')) {
    return `${API_ROOT_URL}/uploads/${cleanedPath}`
  }

  const publicPath = cleanedPath.startsWith('/')
    ? cleanedPath
    : `/${cleanedPath}`

  return `${API_ROOT_URL}${publicPath}`
}

export function normalizeArtifactUrl(url, baseUrl = '') {
  if (!url) {
    return ''
  }

  if (/^(https?:)?\/\//.test(url) || url.startsWith('data:')) {
    return url
  }

  const normalizedPath = String(url)
    .replace(/\\/g, '/')
    .trim()

  if (normalizedPath.startsWith('/')) {
    return normalizeAssetUrl(normalizedPath)
  }

  if (!baseUrl) {
    return normalizeAssetUrl(normalizedPath)
  }

  const baseDirectory = baseUrl.split('/').slice(0, -1).join('/')
  return `${baseDirectory}/${normalizedPath.replace(/^\.?\//, '')}`
}

function normalizeArtifactList(items, baseUrl = '') {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeArtifactUrl(item, baseUrl))
    .filter(Boolean)
}

export function buildAssetUrlCandidates(url) {
  if (!url) {
    return []
  }

  if (/^(https?:)?\/\//.test(url) || url.startsWith('data:')) {
    return [url]
  }

  const normalizedPath = String(url)
    .replace(/\\/g, '/')
    .trim()

  const candidates = new Set()
  const basename = normalizedPath.split('/').filter(Boolean).pop()
  const uploadsMatch = normalizedPath.match(/(?:^|\/)(uploads\/.+)$/)
  const aiResultsMatch = normalizedPath.match(/(?:^|\/)(ai-results\/.+)$/)

  candidates.add(normalizeAssetUrl(normalizedPath))

  if (uploadsMatch?.[1]) {
    candidates.add(`${API_ROOT_URL}/${uploadsMatch[1]}`)
  }

  if (aiResultsMatch?.[1]) {
    candidates.add(`${API_ROOT_URL}/${aiResultsMatch[1]}`)
  }

  if (basename) {
    candidates.add(`${API_ROOT_URL}/uploads/${basename}`)
    candidates.add(`${API_ROOT_URL}/${basename}`)
  }

  return [...candidates].filter(Boolean)
}

export function formatDateTime(value) {
  if (!value) {
    return '暂无'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function parseMaybeJson(value) {
  if (!value) {
    return null
  }

  if (typeof value === 'object') {
    return value
  }

  try {
    return JSON.parse(value)
  } catch (error) {
    console.warn('解析 JSON 失败:', error)
    return null
  }
}

function ensurePipeline(meta = {}) {
  return {
    parse: { status: 'pending', message: '', updatedAt: '' },
    cad: { status: 'pending', message: '', updatedAt: '' },
    threeD: { status: 'pending', message: '', updatedAt: '' },
    panorama: { status: 'pending', message: '', updatedAt: '' },
    ...meta.pipeline
  }
}

function createPipelineStage(status, message = '') {
  return {
    status,
    message,
    updatedAt: new Date().toISOString()
  }
}

function buildPipelineMeta(baseParseData, updates = {}) {
  const meta = baseParseData?.meta || {}
  return {
    ...meta,
    pipeline: {
      ...ensurePipeline(meta),
      ...updates
    }
  }
}

export function mapBuilding(building) {
  return {
    ...building,
    statusLabel: buildingStatusMap[building.status] || '未知',
    createdAt: formatDateTime(building.created_at),
    updatedAt: formatDateTime(building.updated_at),
    coverImage: normalizeAssetUrl(building.cover_image)
  }
}

export function mapHouse(house) {
  return {
    ...house,
    unitNumber: house.unit_number,
    blockNumber: house.block_number,
    roomNumber: house.room_number,
    floor: house.floor_number,
    floorLabel: house.floor_number ? `${house.floor_number} 层` : '楼层未录入',
    rooms: house.room_count,
    buildingName: house.building_name,
    locationLabel: [house.building_name, house.block_number ? `${house.block_number} 栋` : '', house.floor_number ? `${house.floor_number} 层` : '', house.unit_number, house.room_number ? `房号 ${house.room_number}` : '']
      .filter(Boolean)
      .join(' · '),
    layoutLabel: house.layout || `${house.room_count || 0} 室`,
    statusLabel: houseStatusMap[house.status] || house.status || '未知',
    createdAt: formatDateTime(house.created_at),
    updatedAt: formatDateTime(house.updated_at)
  }
}

export function mapFloorPlan(floorPlan) {
  const parseData = parseMaybeJson(floorPlan.parse_result)
  const houseParts = [floorPlan.building_name, floorPlan.unit_number, floorPlan.room_number].filter(Boolean)
  const sourceType = parseData?.meta?.sourceType || 'digital'
  const deliveryHistory = Array.isArray(parseData?.meta?.deliveryHistory) ? parseData.meta.deliveryHistory : []
  const panoramaConfigUrl = normalizeAssetUrl(floorPlan.panorama_config_url)
  const threeDConfigUrl = normalizeAssetUrl(floorPlan.three_d_config_url)
  const deliveryManifest = parseData?.deliveryManifest || null
  const panoramaImageUrls = normalizeArtifactList(
    parseData?.panoramaConfig?.deliverables?.panoramaImages,
    panoramaConfigUrl
  )
  const effectImageUrls = normalizeArtifactList(
    [
      ...(parseData?.generated3DConfig?.deliverables?.effectImages || []),
      ...(parseData?.generated3DConfig?.deliverables?.birdseyeImages || []),
      ...(parseData?.deliveryManifest?.files?.effectImages || []).map((file) => file.file)
    ],
    threeDConfigUrl
  );
  const birdseyeImageUrls = normalizeArtifactList(
    [
      ...(parseData?.generated3DConfig?.deliverables?.birdseyeImages || []),
      ...(parseData?.deliveryManifest?.files?.effectImages || [])
        .map((file) => file.file)
        .filter((file) => /birdseye/i.test(String(file || '')))
    ],
    threeDConfigUrl
  );
  const interiorImageUrls = normalizeArtifactList(
    [
      ...(parseData?.generated3DConfig?.deliverables?.interiorImages || []),
      ...(parseData?.deliveryManifest?.files?.effectImages || [])
        .map((file) => file.file)
        .filter((file) => /interior/i.test(String(file || '')))
    ],
    threeDConfigUrl
  );
  const vrTourUrl = normalizeArtifactUrl('vr-tour.html', threeDConfigUrl);

  return {
    ...floorPlan,
    imageUrl: normalizeAssetUrl(floorPlan.image_url),
    thumbnailUrl: normalizeAssetUrl(floorPlan.thumbnail_url),
    panoramaUrl: normalizeAssetUrl(floorPlan.panorama_url) || panoramaImageUrls[0] || '',
    formalPlanUrl: normalizeAssetUrl(floorPlan.formal_plan_url),
    cadFileUrl: normalizeAssetUrl(floorPlan.cad_file_url),
    formalPlanJsonUrl: normalizeAssetUrl(floorPlan.formal_plan_json_url),
    threeDConfigUrl,
    panoramaConfigUrl,
    reviewFileUrl: normalizeAssetUrl(floorPlan.review_file_url),
    previewImageUrl: normalizeAssetUrl(floorPlan.preview_image_url),
    building_id: floorPlan.building_id,
    block_id: floorPlan.block_id,
    blockNumber: floorPlan.block_number,
    floorNumber: floorPlan.floor_number,
    roomNumber: floorPlan.room_number,
    houseName: houseParts.join(' / ') || '未关联房屋',
    locationLabel: [floorPlan.building_name, floorPlan.block_number ? `${floorPlan.block_number} 栋` : '', floorPlan.floor_number ? `${floorPlan.floor_number} 层` : '', floorPlan.unit_number, floorPlan.room_number ? `房号 ${floorPlan.room_number}` : '']
      .filter(Boolean)
      .join(' · '),
    statusLabel: floorPlanStatusMap[floorPlan.parse_status] || floorPlan.parse_status || '未知',
    sourceType,
    sourceTypeLabel: sourceType === 'hand_drawn' ? '手绘原稿' : '电子图纸',
    convertedToFormal: Boolean(parseData?.meta?.convertedToFormal),
    processNotes: parseData?.meta?.processNotes || '',
    recognitionConfidence: parseData?.meta?.recognitionConfidence || null,
    recognitionAssetVersion: parseData?.meta?.recognitionAssetVersion || parseData?.quality?.recognitionAssetVersion || '',
    recognitionAssetMatchCount: Number(parseData?.meta?.recognitionAssetMatchCount || parseData?.quality?.recognitionAssetMatchCount || 0),
    recognitionIssues: Array.isArray(parseData?.meta?.recognitionIssues) ? parseData.meta.recognitionIssues : [],
    reviewStatus: floorPlan.review_status || 'pending',
    reviewNotes: floorPlan.review_notes || '',
    deliveryHistory: deliveryHistory.map((item) => ({
      ...item,
      snapshotData: item.snapshotData || null,
      savedAtLabel: formatDateTime(item.savedAt)
    })),
    parseData,
    generated3DConfig: parseData?.generated3DConfig || null,
    panoramaConfig: parseData?.panoramaConfig || null,
    deliveryManifest,
    deliveryStatus: deliveryManifest?.deliveryStatus || parseData?.meta?.pipeline?.delivery?.status || 'pending',
    commercialReady: Boolean(deliveryManifest?.commercialReady),
    effectImageUrls,
    birdseyeImageUrls,
    interiorImageUrls,
    vrTourUrl,
    panoramaImageUrls,
    pipeline: ensurePipeline(parseData?.meta || {}),
    parseOk: floorPlan.parse_status === 'completed' && Boolean(parseData),
    cadOk: Boolean(floorPlan.cad_file_url || floorPlan.formal_plan_url),
    threeDOk: Boolean(parseData?.generated3DConfig),
    panoramaOk: Boolean(parseData?.panoramaConfig),
    createdAt: formatDateTime(floorPlan.created_at),
    updatedAt: formatDateTime(floorPlan.updated_at)
  }
}

export function mapUser(user) {
  return {
    ...user,
    roleLabel: userRoleMap[user.role] || user.role || '未知',
    statusLabel: Number(user.status) === 1 ? '启用' : '禁用',
    createdAt: formatDateTime(user.created_at),
    updatedAt: formatDateTime(user.updated_at),
    lastLoginAt: formatDateTime(user.last_login_at)
  }
}

function unwrap(response) {
  if (!response.data?.success) {
    throw new Error(response.data?.message || '请求失败')
  }

  return response.data.data
}

function normalizeDeliverySnapshot(snapshot) {
  return {
    ...snapshot,
    sourceType: snapshot.source_type || snapshot.sourceType || 'digital',
    has3DConfig: Boolean(snapshot.has_3d_config ?? snapshot.has3DConfig),
    hasPanoramaConfig: Boolean(snapshot.has_panorama_config ?? snapshot.hasPanoramaConfig),
    roomCount: Number(snapshot.room_count ?? snapshot.roomCount ?? 0),
    hotspotCount: Number(snapshot.hotspot_count ?? snapshot.hotspotCount ?? 0),
    snapshotData: parseMaybeJson(snapshot.snapshot_data) || snapshot.snapshotData || null,
    savedAt: snapshot.created_at || snapshot.saved_at || snapshot.savedAt || null,
    savedAtLabel: formatDateTime(snapshot.created_at || snapshot.saved_at || snapshot.savedAt)
  }
}

function calcDurationMinutes(startedAt, finishedAt) {
  if (!startedAt) {
    return null
  }

  const start = new Date(startedAt)
  const end = finishedAt ? new Date(finishedAt) : new Date()

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null
  }

  return Math.max(Math.round((end.getTime() - start.getTime()) / 60000), 0)
}

function calcMinutesSince(value) {
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return Math.max(Math.round((Date.now() - date.getTime()) / 60000), 0)
}

function mapAiJob(job) {
  const row = job.job
    ? {
        ...job.job,
        floor_plan_id: job.floor_plan?.id || null,
        floor_plan_name: job.floor_plan?.name || '',
        building_name: job.building?.name || '',
        unit_number: job.house?.unit_number || '',
        room_number: job.house?.room_number || '',
        device_name: job.job.device_name || '',
        result_payload: job.job.result_payload,
        created_at: job.job.created_at,
        updated_at: job.job.updated_at,
        started_at: job.job.started_at,
        finished_at: job.job.finished_at
      }
    : job

  const inputPayload = parseMaybeJson(row.input_payload) || {}
  const resultPayload = parseMaybeJson(row.result_payload) || {}
  const summary = resultPayload.summary || {}
  const artifacts = {
    formalPlanUrl: normalizeAssetUrl(resultPayload.artifacts?.formal_plan_url || job.assets?.formal_plan_url),
    cadFileUrl: normalizeAssetUrl(resultPayload.artifacts?.cad_file_url || job.assets?.cad_file_url),
    formalPlanJsonUrl: normalizeAssetUrl(resultPayload.artifacts?.formal_plan_json_url || job.assets?.formal_plan_json_url),
    threeDConfigUrl: normalizeAssetUrl(resultPayload.artifacts?.three_d_config_url || job.assets?.three_d_config_url),
    panoramaConfigUrl: normalizeAssetUrl(resultPayload.artifacts?.panorama_config_url || job.assets?.panorama_config_url),
    deliveryManifestUrl: normalizeAssetUrl(resultPayload.artifacts?.delivery_manifest_url || job.assets?.delivery_manifest_url),
    reviewFileUrl: normalizeAssetUrl(resultPayload.artifacts?.review_file_url || job.assets?.review_file_url),
    recognitionDiagnosticsUrl: normalizeAssetUrl(resultPayload.artifacts?.recognition_diagnostics_url || job.assets?.recognition_diagnostics_url),
    recognitionOverlayUrl: normalizeAssetUrl(resultPayload.artifacts?.recognition_overlay_url || job.assets?.recognition_overlay_url),
    recognitionEdgesUrl: normalizeAssetUrl(resultPayload.artifacts?.recognition_edges_url || job.assets?.recognition_edges_url),
    recognitionBinaryUrl: normalizeAssetUrl(resultPayload.artifacts?.recognition_binary_url || job.assets?.recognition_binary_url),
    recognitionWallBandsUrl: normalizeAssetUrl(resultPayload.artifacts?.recognition_wall_bands_url || job.assets?.recognition_wall_bands_url),
    recognitionStructuralWallsUrl: normalizeAssetUrl(resultPayload.artifacts?.recognition_structural_walls_url || job.assets?.recognition_structural_walls_url),
    recognitionBalconyCandidatesUrl: normalizeAssetUrl(resultPayload.artifacts?.recognition_balcony_candidates_url || job.assets?.recognition_balcony_candidates_url),
    recognitionRoomInteriorsUrl: normalizeAssetUrl(resultPayload.artifacts?.recognition_room_interiors_url || job.assets?.recognition_room_interiors_url),
    recognitionWindowCandidatesUrl: normalizeAssetUrl(resultPayload.artifacts?.recognition_window_candidates_url || job.assets?.recognition_window_candidates_url),
    recognitionDoorCandidatesUrl: normalizeAssetUrl(resultPayload.artifacts?.recognition_door_candidates_url || job.assets?.recognition_door_candidates_url),
    recognitionSymbolCandidatesUrl: normalizeAssetUrl(resultPayload.artifacts?.recognition_symbol_candidates_url || job.assets?.recognition_symbol_candidates_url),
    previewImageUrl: normalizeAssetUrl(resultPayload.artifacts?.preview_image_url || job.assets?.preview_image_url)
  }
  const recognitionImageItems = [
    { key: 'overlay', label: '原图识别叠图', url: artifacts.recognitionOverlayUrl },
    { key: 'formal', label: '正式识别图', url: artifacts.formalPlanUrl },
    { key: 'edges', label: '边缘图', url: artifacts.recognitionEdgesUrl },
    { key: 'binary', label: '二值墙体图', url: artifacts.recognitionBinaryUrl },
    { key: 'roomInteriors', label: '房间内腔候选', url: artifacts.recognitionRoomInteriorsUrl },
    { key: 'windowCandidates', label: '窗户符号候选', url: artifacts.recognitionWindowCandidatesUrl },
    { key: 'doorCandidates', label: '门洞候选', url: artifacts.recognitionDoorCandidatesUrl },
    { key: 'symbolCandidates', label: '家具洁具候选', url: artifacts.recognitionSymbolCandidatesUrl },
    { key: 'wallBands', label: '厚墙候选', url: artifacts.recognitionWallBandsUrl },
    { key: 'structuralWalls', label: '结构墙向量', url: artifacts.recognitionStructuralWallsUrl },
    { key: 'balconyCandidates', label: '阳台候选', url: artifacts.recognitionBalconyCandidatesUrl }
  ].filter((item) => item.url)
  const durationMinutes = calcDurationMinutes(row.started_at, row.finished_at)
  const minutesSinceUpdate = calcMinutesSince(row.updated_at)
  const isActive = ['claimed', 'running'].includes(row.status)
  const isTimeoutRisk = isActive && durationMinutes !== null && durationMinutes >= 20

  return {
    ...job,
    ...row,
    inputPayload,
    resultPayload,
    summary,
    artifacts,
    recognitionImageItems,
    startedAt: formatDateTime(row.started_at),
    finishedAt: formatDateTime(row.finished_at),
    createdAt: formatDateTime(row.created_at),
    updatedAt: formatDateTime(row.updated_at),
    durationMinutes,
    durationLabel: durationMinutes === null ? '未开始' : `${durationMinutes} 分钟`,
    minutesSinceUpdate,
    updateLabel: minutesSinceUpdate === null ? '暂无更新' : `${minutesSinceUpdate} 分钟前`,
    isTimeoutRisk,
    hasFormalPlan: Boolean(artifacts.formalPlanUrl || summary.hasFormalPlan),
    hasCad: Boolean(artifacts.cadFileUrl || summary.hasCad),
    hasThreeD: Boolean(artifacts.threeDConfigUrl || summary.hasThreeD),
    hasPanorama: Boolean(artifacts.panoramaConfigUrl || summary.hasPanorama),
    commercialReady: Boolean(summary.commercialReady),
    roomCount: Number(summary.roomCount || 0),
    processorLabel: resultPayload.processor || row.device_name || '未分配',
    logs: Array.isArray(job.logs)
      ? job.logs.map((log) => ({
          ...log,
          payloadData: parseMaybeJson(log.payload) || log.payload || null,
          createdAt: formatDateTime(log.created_at)
        }))
      : [],
    floorPlanContext: job.floor_plan
      ? {
          ...job.floor_plan,
          imageUrl: normalizeAssetUrl(job.floor_plan.image_url),
          formalPlanUrl: normalizeAssetUrl(job.floor_plan.formal_plan_url),
          cadFileUrl: normalizeAssetUrl(job.floor_plan.cad_file_url),
          formalPlanJsonUrl: normalizeAssetUrl(job.floor_plan.formal_plan_json_url),
          threeDConfigUrl: normalizeAssetUrl(job.floor_plan.three_d_config_url),
          panoramaConfigUrl: normalizeAssetUrl(job.floor_plan.panorama_config_url),
          reviewFileUrl: normalizeAssetUrl(job.floor_plan.review_file_url),
          previewImageUrl: normalizeAssetUrl(job.floor_plan.preview_image_url)
        }
      : null
  }
}

export const adminService = {
  async login(credentials) {
    const response = await apiClient.post('/auth/login', credentials)
    return unwrap(response)
  },

  async getHealth() {
    const response = await fetch(`${API_ROOT_URL}/health`)
    if (!response.ok) {
      throw new Error('服务不可用')
    }
    return response.json()
  },

  async getAiJobs(params = {}) {
    const response = await apiClient.get('/ai-jobs', { params })
    return unwrap(response).map(mapAiJob)
  },

  async getAiJob(id) {
    const response = await apiClient.get(`/ai-jobs/${id}`)
    return mapAiJob(unwrap(response))
  },

  async createAiJob(payload) {
    const response = await apiClient.post('/ai-jobs', payload)
    return response.data
  },

  async retryAiJob(id) {
    const response = await apiClient.post(`/ai-jobs/${id}/retry`)
    return response.data
  },

  async reviewAiJob(id, payload) {
    const response = await apiClient.post(`/ai-jobs/${id}/review`, payload)
    return response.data
  },

  async failAiJob(id, payload) {
    const response = await apiClient.post(`/ai-jobs/${id}/fail`, payload)
    return response.data
  },

  async getAiDevices() {
    const response = await apiClient.get('/ai-devices')
    return unwrap(response)
  },

  async getRecognitionAssets(params = {}) {
    const response = await apiClient.get('/recognition-assets', { params })
    return unwrap(response)
  },

  async getRecognitionAssetCatalog() {
    const response = await apiClient.get('/recognition-assets/catalog')
    return unwrap(response)
  },

  async getRecognitionAsset(id) {
    const response = await apiClient.get(`/recognition-assets/${id}`)
    return unwrap(response)
  },

  async getDesignAssets(params = {}) {
    const response = await apiClient.get('/design-assets', { params })
    return unwrap(response)
  },

  async getDesignAssetAiContext() {
    const response = await apiClient.get('/design-assets/ai-context')
    return unwrap(response)
  },

  async createDesignAsset(payload) {
    const response = await apiClient.post('/design-assets', payload)
    return unwrap(response)
  },

  async uploadDesignAssetFiles(files = {}) {
    const formData = new FormData()
    Object.entries(files).forEach(([key, file]) => {
      if (file) {
        formData.append(key, file)
      }
    })

    const response = await apiClient.post('/design-assets/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    })
    return unwrap(response)
  },

  async updateDesignAsset(id, payload) {
    const response = await apiClient.put(`/design-assets/${id}`, payload)
    return unwrap(response)
  },

  async deleteDesignAsset(id) {
    const response = await apiClient.delete(`/design-assets/${id}`)
    return response.data
  },

  async getBuildings() {
    const response = await apiClient.get('/buildings')
    return unwrap(response).map(mapBuilding)
  },

  async getBuilding(id) {
    const response = await apiClient.get(`/buildings/${id}`)
    return mapBuilding(unwrap(response))
  },

  async deleteBuilding(id) {
    const response = await apiClient.delete(`/buildings/${id}`)
    return response.data
  },

  async createBuilding(payload) {
    const response = await apiClient.post('/buildings', payload)
    return response.data
  },

  async updateBuilding(id, payload) {
    const response = await apiClient.put(`/buildings/${id}`, payload)
    return response.data
  },

  async getUsers(params = {}) {
    const response = await apiClient.get('/users', { params })
    return unwrap(response).map(mapUser)
  },

  async getUser(id) {
    const response = await apiClient.get(`/users/${id}`)
    return mapUser(unwrap(response))
  },

  async createUser(payload) {
    const response = await apiClient.post('/users', payload)
    return response.data
  },

  async updateUser(id, payload) {
    const response = await apiClient.put(`/users/${id}`, payload)
    return response.data
  },

  async deleteUser(id) {
    const response = await apiClient.delete(`/users/${id}`)
    return response.data
  },

  async getBlocksByBuilding(buildingId) {
    const response = await apiClient.get(`/building-blocks/building/${buildingId}`)
    return unwrap(response).map((block) => ({
      ...block,
      buildingId: block.building_id,
      blockNumber: block.block_number,
      totalFloors: block.total_floors,
      totalUnits: block.total_units,
      createdAt: formatDateTime(block.created_at),
      updatedAt: formatDateTime(block.updated_at)
    }))
  },

  async getBlock(id) {
    const response = await apiClient.get(`/building-blocks/${id}`)
    const block = unwrap(response)
    return {
      ...block,
      buildingId: block.building_id,
      blockNumber: block.block_number,
      totalFloors: block.total_floors,
      totalUnits: block.total_units,
      createdAt: formatDateTime(block.created_at),
      updatedAt: formatDateTime(block.updated_at)
    }
  },

  async createBlock(payload) {
    const response = await apiClient.post('/building-blocks', payload)
    return response.data
  },

  async updateBlock(id, payload) {
    const response = await apiClient.put(`/building-blocks/${id}`, payload)
    return response.data
  },

  async deleteBlock(id) {
    const response = await apiClient.delete(`/building-blocks/${id}`)
    return response.data
  },

  async getHouses(params = {}) {
    const response = await apiClient.get('/houses', { params })
    return unwrap(response).map(mapHouse)
  },

  async getHouse(id) {
    const response = await apiClient.get(`/houses/${id}`)
    return mapHouse(unwrap(response))
  },

  async deleteHouse(id) {
    const response = await apiClient.delete(`/houses/${id}`)
    return response.data
  },

  async createHouse(payload) {
    const response = await apiClient.post('/houses', payload)
    return response.data
  },

  async updateHouse(id, payload) {
    const response = await apiClient.put(`/houses/${id}`, payload)
    return response.data
  },

  async getFloorPlans(params = {}) {
    const response = await apiClient.get('/floor-plans', { params })
    return unwrap(response).map(mapFloorPlan)
  },

  async getFloorPlan(id) {
    const response = await apiClient.get(`/floor-plans/${id}`)
    return mapFloorPlan(unwrap(response))
  },

  async deleteFloorPlan(id) {
    const response = await apiClient.delete(`/floor-plans/${id}`)
    return response.data
  },

  async createFloorPlan(payload) {
    const response = await apiClient.post('/floor-plans', payload)
    return response.data
  },

  async updateFloorPlan(id, payload) {
    const response = await apiClient.put(`/floor-plans/${id}`, payload)
    return response.data
  },

  async exportFloorPlanDesignSite(id) {
    const response = await apiClient.post(`/floor-plans/${id}/design-site/export`)
    return unwrap(response)
  },

  async getFloorPlanDeliverySnapshots(floorPlanId) {
    const response = await apiClient.get(`/floor-plans/${floorPlanId}/delivery-snapshots`)
    return unwrap(response).map(normalizeDeliverySnapshot)
  },

  async getFloorPlanDeliverySnapshot(floorPlanId, snapshotId) {
    const response = await apiClient.get(`/floor-plans/${floorPlanId}/delivery-snapshots/${snapshotId}`)
    return normalizeDeliverySnapshot(unwrap(response))
  },

  async deleteFloorPlanDeliverySnapshot(floorPlanId, snapshotId) {
    const response = await apiClient.delete(`/floor-plans/${floorPlanId}/delivery-snapshots/${snapshotId}`)
    return response.data
  },

  async uploadFloorPlan(file) {
    const formData = new FormData()
    formData.append('file', file)

    const response = await apiClient.post('/upload/floor-plan', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    })

    return unwrap(response)
  },

  async parseFloorPlan(imageUrl, prompt = '') {
    const response = await apiClient.post('/ai/parse-floor-plan', { imageUrl, prompt })
    return unwrap(response)
  },

  async generate3DConfig(parseData, style = 'modern') {
    const response = await apiClient.post('/ai/generate-3d-config', { parseData, style })
    return unwrap(response)
  },

  async generatePanoramaConfig(sceneData) {
    const response = await apiClient.post('/ai/generate-panorama-config', { sceneData })
    return unwrap(response)
  },

  async rerunFloorPlanParse(floorPlan, options = {}) {
    const prompt = options.prompt || floorPlan.houseName || floorPlan.name || ''

    await this.updateFloorPlan(floorPlan.id, {
      parse_status: 'processing'
    })

    try {
      const parseResult = await this.parseFloorPlan(floorPlan.imageUrl, prompt)
      const nextParseResult = {
        ...parseResult,
        meta: buildPipelineMeta(parseResult, {
          parse: createPipelineStage('success', 'AI 解析完成'),
          cad: createPipelineStage('success', '已生成正式图基础结构，待桌面端输出 CAD/DXF'),
          threeD: createPipelineStage('pending', '等待生成 3D 配置'),
          panorama: createPipelineStage('pending', '等待生成全景配置')
        })
      }

      await this.updateFloorPlan(floorPlan.id, {
        parse_status: 'completed',
        parse_result: JSON.stringify(nextParseResult)
      })

      return this.getFloorPlan(floorPlan.id)
    } catch (error) {
      const failedParseResult = {
        ...(floorPlan.parseData || {}),
        meta: buildPipelineMeta(floorPlan.parseData, {
          parse: createPipelineStage('failed', error.message || 'AI 解析失败')
        })
      }

      await this.updateFloorPlan(floorPlan.id, {
        parse_status: 'failed',
        parse_result: JSON.stringify(failedParseResult)
      })
      throw error
    }
  },

  async regenerateFloorPlan3D(floorPlan, style = 'modern') {
    if (!floorPlan.parseData) {
      throw new Error('当前平面图还没有解析结果，无法生成3D配置')
    }

    const generated3DConfig = await this.generate3DConfig(floorPlan.parseData, style)
    const nextParseResult = {
      ...floorPlan.parseData,
      generated3DConfig,
      meta: buildPipelineMeta(floorPlan.parseData, {
        cad: createPipelineStage('success', 'CAD/DXF 与正式图文件已就绪'),
        threeD: createPipelineStage('success', `3D 配置生成完成，风格 ${style}`),
        panorama: createPipelineStage('pending', '等待生成全景配置')
      })
    }

    await this.updateFloorPlan(floorPlan.id, {
      parse_status: 'completed',
      parse_result: JSON.stringify(nextParseResult)
    })

    return this.getFloorPlan(floorPlan.id)
  },

  async regenerateFloorPlanPanorama(floorPlan, style = 'modern') {
    let base3DConfig = floorPlan.generated3DConfig

    if (!base3DConfig) {
      if (!floorPlan.parseData) {
        throw new Error('当前平面图还没有解析结果，无法生成全景配置')
      }

      base3DConfig = await this.generate3DConfig(floorPlan.parseData, style)
    }

    const panoramaConfig = await this.generatePanoramaConfig(base3DConfig)
    const nextParseResult = {
      ...floorPlan.parseData,
      generated3DConfig: base3DConfig,
      panoramaConfig,
      meta: buildPipelineMeta(floorPlan.parseData, {
        cad: createPipelineStage('success', 'CAD/DXF 与正式图文件已就绪'),
        threeD: createPipelineStage('success', `3D 配置生成完成，风格 ${style}`),
        panorama: createPipelineStage('success', '全景配置生成完成')
      })
    }

    await this.updateFloorPlan(floorPlan.id, {
      parse_status: 'completed',
      parse_result: JSON.stringify(nextParseResult)
    })

    return this.getFloorPlan(floorPlan.id)
  },

  async saveFloorPlanDeliverySnapshot(floorPlan, summary = '') {
    const baseParseData = floorPlan.parseData || {}
    const meta = baseParseData.meta || {}
    const currentHistory = Array.isArray(meta.deliveryHistory) ? meta.deliveryHistory : []
    const { deliveryHistory: _deliveryHistory, ...metaWithoutHistory } = meta
    const snapshot = {
      id: `delivery-${Date.now()}`,
      version: currentHistory.length + 1,
      savedAt: new Date().toISOString(),
      summary: summary || '手动保存交付版本',
      sourceType: floorPlan.sourceType || meta.sourceType || 'digital',
      has3DConfig: Boolean(floorPlan.generated3DConfig),
      hasPanoramaConfig: Boolean(floorPlan.panoramaConfig),
      roomCount: floorPlan.parseData?.rooms?.length || 0,
      hotspotCount: floorPlan.panoramaConfig?.hotspots?.length || 0,
      snapshotData: {
        ...baseParseData,
        generated3DConfig: floorPlan.generated3DConfig || baseParseData.generated3DConfig || null,
        panoramaConfig: floorPlan.panoramaConfig || baseParseData.panoramaConfig || null,
        meta: {
          ...metaWithoutHistory
        }
      }
    }

    const nextParseResult = {
      ...baseParseData,
      meta: {
        ...meta,
        deliveryHistory: [snapshot, ...currentHistory].slice(0, 10)
      }
    }

    try {
      await apiClient.post(`/floor-plans/${floorPlan.id}/delivery-snapshots`, {
        summary: snapshot.summary,
        source_type: snapshot.sourceType,
        has_3d_config: snapshot.has3DConfig ? 1 : 0,
        has_panorama_config: snapshot.hasPanoramaConfig ? 1 : 0,
        room_count: snapshot.roomCount,
        hotspot_count: snapshot.hotspotCount,
        snapshot_data: JSON.stringify(snapshot.snapshotData)
      })
    } catch (error) {
      console.warn('写入独立交付快照失败，回退到 parse_result meta:', error)
      await this.updateFloorPlan(floorPlan.id, {
        parse_result: JSON.stringify(nextParseResult)
      })
    }

    return this.getFloorPlan(floorPlan.id)
  },

  async restoreFloorPlanDeliverySnapshot(floorPlan, snapshotId) {
    const snapshot = (floorPlan.deliveryHistory || []).find((item) => item.id === snapshotId)

    if (!snapshot?.snapshotData) {
      throw new Error('该版本没有可恢复的交付快照')
    }

    try {
      await apiClient.post(`/floor-plans/${floorPlan.id}/delivery-snapshots/${snapshotId}/restore`)
    } catch (error) {
      console.warn('恢复独立交付快照失败，回退到 parse_result meta:', error)
      const currentMeta = floorPlan.parseData?.meta || {}
      const currentHistory = Array.isArray(currentMeta.deliveryHistory) ? currentMeta.deliveryHistory : []
      const nextParseResult = {
        ...snapshot.snapshotData,
        meta: {
          ...(snapshot.snapshotData.meta || {}),
          deliveryHistory: currentHistory
        }
      }

      await this.updateFloorPlan(floorPlan.id, {
        parse_status: 'completed',
        parse_result: JSON.stringify(nextParseResult)
      })
    }

    return this.getFloorPlan(floorPlan.id)
  },

  getHouseStatusValue(label) {
    return houseStatusReverseMap[label] || label
  }
}
