const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const { pool } = require('../config/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function parseJsonField(value, fallback = null) {
  if (!value) {
    return fallback;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function normalizeAssetPath(value) {
  if (!value) {
    return '';
  }

  if (/^(https?:)?\/\//.test(String(value))) {
    return String(value);
  }

  return `/${String(value).replace(/^\/+/, '')}`;
}

function resolveArtifactDiskPath(assetUrl) {
  if (!assetUrl || /^https?:\/\//.test(String(assetUrl))) {
    return '';
  }

  const normalizedPath = String(assetUrl).replace(/^\/+/, '');
  const candidates = [
    path.join(process.cwd(), normalizedPath),
    path.join(process.cwd(), 'uploads', normalizedPath),
    path.join(process.cwd(), '..', normalizedPath),
    path.join(process.cwd(), '..', 'uploads', normalizedPath)
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function readJsonArtifact(assetUrl) {
  const filePath = resolveArtifactDiskPath(assetUrl);
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function writeJsonArtifact(assetUrl, data) {
  const filePath = resolveArtifactDiskPath(assetUrl);
  if (!filePath || !data) {
    return;
  }

  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    // Optional artifact metadata should not fail the worker callback.
  }
}

function basenameIfLocal(value) {
  if (!value || typeof value !== 'string') {
    return value;
  }

  if (/^(https?:)?\/\//.test(value) || value.startsWith('/ai-results/') || value.startsWith('/uploads/')) {
    return value;
  }

  return path.basename(value);
}

function withUniqueArtifacts(items = []) {
  const seen = new Set();
  return items.filter(Boolean).filter((item) => {
    const key = String(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function rewriteRenderableArtifacts(threeDConfig, panoramaConfig, artifacts) {
  const nextThreeDConfig = threeDConfig ? { ...threeDConfig } : threeDConfig;
  const nextPanoramaConfig = panoramaConfig ? { ...panoramaConfig } : panoramaConfig;

  if (nextThreeDConfig?.deliverables) {
    const effectFile = artifacts.effect_image_url ? path.basename(artifacts.effect_image_url) : '';
    const birdseyeFile = artifacts.birdseye_image_url ? path.basename(artifacts.birdseye_image_url) : '';
    const interiorFiles = (artifacts.interior_image_urls || []).map((url) => path.basename(url));
    nextThreeDConfig.deliverables = {
      ...nextThreeDConfig.deliverables,
      effectImages: withUniqueArtifacts([
        effectFile,
        ...(nextThreeDConfig.deliverables.effectImages || []).map(basenameIfLocal)
      ]),
      birdseyeImages: withUniqueArtifacts([
        birdseyeFile,
        effectFile,
        ...(nextThreeDConfig.deliverables.birdseyeImages || []).map(basenameIfLocal)
      ]),
      interiorImages: withUniqueArtifacts([
        ...interiorFiles,
        ...(nextThreeDConfig.deliverables.interiorImages || []).map(basenameIfLocal)
      ])
    };
  }

  if (nextPanoramaConfig?.deliverables) {
    const panoramaFile = artifacts.panorama_image_url ? path.basename(artifacts.panorama_image_url) : '';
    nextPanoramaConfig.deliverables = {
      ...nextPanoramaConfig.deliverables,
      panoramaImages: withUniqueArtifacts([
        panoramaFile,
        ...(nextPanoramaConfig.deliverables.panoramaImages || []).map(basenameIfLocal)
      ])
    };
  }

  return {
    threeDConfig: nextThreeDConfig,
    panoramaConfig: nextPanoramaConfig
  };
}

function toParseResultRooms(formalPlanJson) {
  return (formalPlanJson?.rooms || []).map((room) => ({
    id: room.id,
    name: room.name,
    type: room.type || 'space',
    area: Number(room.area || 0),
    width: Number(room.width || 0),
    length: Number(room.height || room.length || 0),
    position: {
      x: Number(room.x || 0),
      y: Number(room.y || 0)
    }
  }));
}

function toParseResultWalls(formalPlanJson) {
  return (formalPlanJson?.walls || []).map((wall) => ({
    id: wall.id,
    start: {
      x: Number(wall.from?.[0] || wall.start?.x || 0),
      y: Number(wall.from?.[1] || wall.start?.y || 0)
    },
    end: {
      x: Number(wall.to?.[0] || wall.end?.x || 0),
      y: Number(wall.to?.[1] || wall.end?.y || 0)
    },
    thickness: Number(wall.thickness || 12)
  }));
}

function toParseResultOpenings(formalPlanJson, type) {
  return (formalPlanJson?.openings || [])
    .filter((opening) => opening.type === type)
    .map((opening, index) => ({
      id: opening.id || `${type}-${index + 1}`,
      type,
      position: {
        x: Number(opening.position?.x ?? opening.x ?? 0),
        y: Number(opening.position?.y ?? opening.y ?? 0)
      },
      width: Number(opening.width || 12),
      height: Number(opening.height || 8),
      confidence: Number(opening.confidence || 0),
      attachedWallId: opening.attachedWallId || '',
      wallDistance: opening.wallDistance ?? null,
      orientation: opening.orientation || '',
      needsWallAttachmentReview: Boolean(opening.needsWallAttachmentReview),
      reviewReasons: opening.reviewReasons || []
    }));
}

function buildNextParseResult(existingParseResult, formalPlanJson, threeDConfig, panoramaConfig, deliveryManifest, resultPayload = {}) {
  const previousMeta = existingParseResult?.meta || {};
  const summary = resultPayload?.summary || {};
  const nextMeta = {
    ...previousMeta,
    sourceType: previousMeta.sourceType || formalPlanJson?.sourceType || 'digital',
    convertedToFormal: Boolean(formalPlanJson?.meta?.convertedToFormal),
    processNotes: formalPlanJson?.meta?.processNotes || previousMeta.processNotes || '',
    recognitionConfidence:
      formalPlanJson?.meta?.recognitionConfidence ||
      previousMeta.recognitionConfidence ||
      {
        geometry: Number(summary.recognitionGeometryConfidence || 0),
        semantics: Number(summary.recognitionSemanticsConfidence || 0)
      },
    recognitionIssues:
      formalPlanJson?.meta?.recognitionIssues ||
      previousMeta.recognitionIssues ||
      [],
    pipeline: {
      ...(previousMeta.pipeline || {}),
      parse: {
        status: 'success',
        message: '桌面端解析与正式图整理完成',
        updatedAt: new Date().toISOString()
      },
      cad: formalPlanJson
        ? {
            status: 'success',
            message: 'CAD/DXF 与正式图文件已生成',
            updatedAt: new Date().toISOString()
          }
        : {
            status: 'pending',
            message: '待生成 CAD/DXF 文件',
            updatedAt: new Date().toISOString()
          },
      threeD: threeDConfig
        ? {
            status: 'success',
            message: '3D 配置已生成',
            updatedAt: new Date().toISOString()
          }
        : {
            status: 'pending',
            message: '待生成 3D 配置',
            updatedAt: new Date().toISOString()
          },
      panorama: panoramaConfig
        ? {
            status: 'success',
            message: '全景配置已生成',
            updatedAt: new Date().toISOString()
          }
        : {
            status: 'pending',
            message: '待生成全景配置',
            updatedAt: new Date().toISOString()
          },
      delivery: deliveryManifest
        ? {
            status: deliveryManifest.commercialReady ? 'success' : 'review',
            message: deliveryManifest.commercialReady ? '商用交付包已通过自动门槛' : '交付包已生成，仍需真实渲染或人工终审',
            updatedAt: new Date().toISOString()
          }
        : {
            status: 'pending',
            message: '待生成交付清单',
            updatedAt: new Date().toISOString()
          }
    }
  };

  if (!formalPlanJson) {
    return {
      ...(existingParseResult || {}),
      generated3DConfig: threeDConfig || existingParseResult?.generated3DConfig || null,
      panoramaConfig: panoramaConfig || existingParseResult?.panoramaConfig || null,
      deliveryManifest: deliveryManifest || existingParseResult?.deliveryManifest || null,
      meta: nextMeta
    };
  }

  return {
    ...(existingParseResult || {}),
    rooms: toParseResultRooms(formalPlanJson),
    walls: toParseResultWalls(formalPlanJson),
    doors: toParseResultOpenings(formalPlanJson, 'door'),
    windows: toParseResultOpenings(formalPlanJson, 'window'),
    generated3DConfig: threeDConfig || existingParseResult?.generated3DConfig || null,
    panoramaConfig: panoramaConfig || existingParseResult?.panoramaConfig || null,
    deliveryManifest: deliveryManifest || existingParseResult?.deliveryManifest || null,
    meta: nextMeta
  };
}

async function getJobContext(jobId) {
  let rows;

  try {
    [rows] = await pool.execute(
      `SELECT
         j.*,
         f.name AS floor_plan_name,
         f.image_url,
         f.thumbnail_url,
         f.parse_result,
         f.panorama_url,
         f.formal_plan_url,
         f.cad_file_url,
         f.formal_plan_json_url,
         f.three_d_config_url,
         f.panorama_config_url,
         f.review_file_url,
         f.preview_image_url,
         f.review_status,
         f.review_notes,
         h.id AS house_ref_id,
         h.unit_number,
         h.floor_number,
         h.room_number,
         h.area,
         h.room_count,
         h.layout,
         h.description AS house_description,
         h.building_id,
         h.block_id,
         b.name AS building_name,
         b.address AS building_address,
         b.developer AS building_developer,
         bb.block_number,
         bb.total_floors,
         bb.total_units,
         d.device_name,
         d.device_code
       FROM ai_jobs j
       LEFT JOIN floor_plans f ON j.floor_plan_id = f.id
       LEFT JOIN houses h ON j.house_id = h.id
       LEFT JOIN buildings b ON h.building_id = b.id
       LEFT JOIN building_blocks bb ON h.block_id = bb.id
       LEFT JOIN ai_devices d ON j.assigned_device_id = d.id
       WHERE j.id = ?`,
      [jobId]
    );
  } catch (error) {
    if (error.code !== 'ER_BAD_FIELD_ERROR') {
      throw error;
    }

    [rows] = await pool.execute(
      `SELECT
         j.*,
         f.name AS floor_plan_name,
         f.image_url,
         f.thumbnail_url,
         f.parse_result,
         f.panorama_url,
         f.formal_plan_url,
         f.cad_file_url,
         f.formal_plan_json_url,
         f.three_d_config_url,
         f.panorama_config_url,
         f.review_file_url,
         f.preview_image_url,
         f.review_status,
         f.review_notes,
         h.id AS house_ref_id,
         h.unit_number,
         h.floor_number,
         h.room_number,
         h.area,
         h.room_count,
         h.layout,
         h.description AS house_description,
         h.building_id,
         b.name AS building_name,
         b.address AS building_address,
         b.developer AS building_developer,
         d.device_name,
         d.device_code
       FROM ai_jobs j
       LEFT JOIN floor_plans f ON j.floor_plan_id = f.id
       LEFT JOIN houses h ON j.house_id = h.id
       LEFT JOIN buildings b ON h.building_id = b.id
       LEFT JOIN ai_devices d ON j.assigned_device_id = d.id
       WHERE j.id = ?`,
      [jobId]
    );
    rows = rows.map((row) => ({
      ...row,
      block_id: null,
      block_number: null,
      total_floors: null,
      total_units: null
    }));
  }

  if (!rows.length) {
    return null;
  }

  const row = rows[0];
  const inputPayload = parseJsonField(row.input_payload, {});
  const resultPayload = parseJsonField(row.result_payload, {});
  const parseResult = parseJsonField(row.parse_result, {});

  return {
    job: {
      id: row.id,
      job_no: row.job_no,
      job_type: row.job_type,
      source_type: row.source_type,
      status: row.status,
      priority: row.priority,
      created_by: row.created_by,
      assigned_device_id: row.assigned_device_id,
      assigned_user_id: row.assigned_user_id,
      device_name: row.device_name,
      device_code: row.device_code,
      retry_count: row.retry_count,
      input_payload: inputPayload,
      result_payload: resultPayload,
      error_message: row.error_message,
      started_at: row.started_at,
      finished_at: row.finished_at,
      created_at: row.created_at,
      updated_at: row.updated_at
    },
    floor_plan: {
      id: row.floor_plan_id,
      name: row.floor_plan_name,
      image_url: row.image_url,
      thumbnail_url: row.thumbnail_url,
      panorama_url: row.panorama_url,
      formal_plan_url: row.formal_plan_url,
      cad_file_url: row.cad_file_url,
      formal_plan_json_url: row.formal_plan_json_url,
      three_d_config_url: row.three_d_config_url,
      panorama_config_url: row.panorama_config_url,
      review_file_url: row.review_file_url,
      preview_image_url: row.preview_image_url,
      review_status: row.review_status,
      review_notes: row.review_notes,
      parse_result: parseResult
    },
    house: row.house_ref_id ? {
      id: row.house_ref_id,
      unit_number: row.unit_number,
      floor_number: row.floor_number,
      room_number: row.room_number,
      area: row.area,
      room_count: row.room_count,
      layout: row.layout,
      description: row.house_description,
      building_id: row.building_id,
      block_id: row.block_id
    } : null,
    building: row.building_id ? {
      id: row.building_id,
      name: row.building_name,
      address: row.building_address,
      developer: row.building_developer
    } : null,
    block: row.block_id ? {
      id: row.block_id,
      block_number: row.block_number,
      total_floors: row.total_floors,
      total_units: row.total_units
    } : null,
    assets: {
      source_url: normalizeAssetPath(row.image_url),
      thumbnail_url: normalizeAssetPath(row.thumbnail_url),
      panorama_url: normalizeAssetPath(row.panorama_url),
      formal_plan_url: normalizeAssetPath(row.formal_plan_url),
      cad_file_url: normalizeAssetPath(row.cad_file_url),
      formal_plan_json_url: normalizeAssetPath(row.formal_plan_json_url),
      three_d_config_url: normalizeAssetPath(row.three_d_config_url),
      panorama_config_url: normalizeAssetPath(row.panorama_config_url),
      review_file_url: normalizeAssetPath(row.review_file_url),
      preview_image_url: normalizeAssetPath(row.preview_image_url)
    }
  };
}

function makeJobNo() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('');

  return `JOB-${stamp}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

const artifactStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'ai-results', `job-${req.params.id}`);
    ensureDir(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^\w.\-]/g, '_');
    cb(null, safeName);
  }
});

const artifactUpload = multer({ storage: artifactStorage });

router.get('/', authMiddleware, async (req, res) => {
  const { status, job_type, floor_plan_id } = req.query;
  let query = `
    SELECT j.*, f.name AS floor_plan_name, h.unit_number, h.floor_number, h.room_number, b.name AS building_name,
           d.device_name, d.device_code
    FROM ai_jobs j
    LEFT JOIN floor_plans f ON j.floor_plan_id = f.id
    LEFT JOIN houses h ON j.house_id = h.id
    LEFT JOIN buildings b ON h.building_id = b.id
    LEFT JOIN ai_devices d ON j.assigned_device_id = d.id
    WHERE 1=1
  `;
  const values = [];

  if (status) {
    query += ' AND j.status = ?';
    values.push(status);
  }
  if (job_type) {
    query += ' AND j.job_type = ?';
    values.push(job_type);
  }
  if (floor_plan_id) {
    query += ' AND j.floor_plan_id = ?';
    values.push(floor_plan_id);
  }

  query += ' ORDER BY j.created_at DESC';

  try {
    const [rows] = await pool.execute(query, values);
    res.json({
      success: true,
      data: rows
    });
  } catch (error) {
    console.error('获取AI任务列表失败:', error);
    res.status(500).json({
      success: false,
      message: '获取AI任务列表失败'
    });
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const context = await getJobContext(req.params.id);
    if (!context) {
      return res.status(404).json({
        success: false,
        message: '任务不存在'
      });
    }

    const [logs] = await pool.execute(
      'SELECT * FROM ai_job_logs WHERE job_id = ? ORDER BY created_at ASC',
      [req.params.id]
    );

    res.json({
      success: true,
      data: {
        ...context,
        logs
      }
    });
  } catch (error) {
    console.error('获取AI任务详情失败:', error);
    res.status(500).json({
      success: false,
      message: '获取AI任务详情失败'
    });
  }
});

router.post(
  '/',
  authMiddleware,
  adminMiddleware,
  [
    body('floor_plan_id').notEmpty().withMessage('平面图ID不能为空'),
    body('job_type').notEmpty().withMessage('任务类型不能为空'),
    body('priority').optional().isInt(),
    body('assigned_device_id').optional().isInt(),
    body('input_payload').isObject().withMessage('输入参数不能为空')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: '参数验证失败',
        errors: errors.array()
      });
    }

    const { floor_plan_id, job_type, priority, assigned_device_id, input_payload } = req.body;

    try {
      const [floorPlans] = await pool.execute('SELECT * FROM floor_plans WHERE id = ?', [floor_plan_id]);
      if (!floorPlans.length) {
        return res.status(404).json({
          success: false,
          message: '平面图不存在'
        });
      }

      const floorPlan = floorPlans[0];
      const jobNo = makeJobNo();

      const [result] = await pool.execute(
        `INSERT INTO ai_jobs
        (job_no, floor_plan_id, house_id, job_type, source_type, status, priority, created_by, assigned_device_id, input_payload)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
        [
          jobNo,
          floor_plan_id,
          floorPlan.house_id,
          job_type,
          input_payload.sourceType || 'digital',
          priority || 50,
          req.user.id,
          assigned_device_id || null,
          JSON.stringify(input_payload)
        ]
      );

      await pool.execute(
        'UPDATE floor_plans SET latest_job_id = ?, review_status = ? WHERE id = ?',
        [result.insertId, 'pending', floor_plan_id]
      );

      res.status(201).json({
        success: true,
        message: 'AI任务创建成功',
        data: { id: result.insertId, job_no: jobNo }
      });
    } catch (error) {
      console.error('创建AI任务失败:', error);
      res.status(500).json({
        success: false,
        message: '创建AI任务失败'
      });
    }
  }
);

router.post('/:id/retry', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM ai_jobs WHERE id = ?', [req.params.id]);
    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: '任务不存在'
      });
    }

    const source = rows[0];
    const jobNo = makeJobNo();

    const [result] = await pool.execute(
      `INSERT INTO ai_jobs
      (job_no, floor_plan_id, house_id, job_type, source_type, status, priority, created_by, assigned_device_id, input_payload, retry_count)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      [
        jobNo,
        source.floor_plan_id,
        source.house_id,
        source.job_type,
        source.source_type,
        source.priority,
        req.user.id,
        source.assigned_device_id,
        source.input_payload,
        Number(source.retry_count || 0) + 1
      ]
    );

    await pool.execute(
      'UPDATE floor_plans SET latest_job_id = ?, review_status = ? WHERE id = ?',
      [result.insertId, 'pending', source.floor_plan_id]
    );

    res.json({
      success: true,
      message: '任务已重新创建',
      data: { id: result.insertId, job_no: jobNo }
    });
  } catch (error) {
    console.error('重试AI任务失败:', error);
    res.status(500).json({
      success: false,
      message: '重试AI任务失败'
    });
  }
});

router.post('/:id/review', authMiddleware, adminMiddleware, async (req, res) => {
  const { review_status, review_notes } = req.body;

  try {
    const [rows] = await pool.execute('SELECT floor_plan_id FROM ai_jobs WHERE id = ?', [req.params.id]);
    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: '任务不存在'
      });
    }

    await pool.execute(
      'UPDATE floor_plans SET review_status = ?, review_notes = ? WHERE id = ?',
      [review_status || 'approved', review_notes || '', rows[0].floor_plan_id]
    );

    res.json({
      success: true,
      message: '复核结果已提交'
    });
  } catch (error) {
    console.error('提交AI任务复核结果失败:', error);
    res.status(500).json({
      success: false,
      message: '提交AI任务复核结果失败'
    });
  }
});

router.post(
  '/:id/artifacts',
  authMiddleware,
  artifactUpload.fields([
    { name: 'formal_plan_svg', maxCount: 1 },
    { name: 'cad_file', maxCount: 1 },
    { name: 'formal_plan_json', maxCount: 1 },
    { name: 'three_d_config', maxCount: 1 },
    { name: 'panorama_config', maxCount: 1 },
    { name: 'delivery_manifest', maxCount: 1 },
    { name: 'delivery_approval', maxCount: 1 },
    { name: 'review_file', maxCount: 1 },
    { name: 'preview_image', maxCount: 1 },
    { name: 'recognition_diagnostics', maxCount: 1 },
    { name: 'recognition_overlay', maxCount: 1 },
    { name: 'recognition_edges', maxCount: 1 },
    { name: 'recognition_binary', maxCount: 1 },
    { name: 'recognition_wall_bands', maxCount: 1 },
    { name: 'recognition_structural_walls', maxCount: 1 },
    { name: 'recognition_balcony_candidates', maxCount: 1 },
    { name: 'recognition_room_interiors', maxCount: 1 },
    { name: 'recognition_window_candidates', maxCount: 1 },
    { name: 'recognition_door_candidates', maxCount: 1 },
    { name: 'recognition_symbol_candidates', maxCount: 1 },
    { name: 'effect_image', maxCount: 1 },
    { name: 'birdseye_image', maxCount: 1 },
    { name: 'interior_image', maxCount: 12 },
    { name: 'panorama_image', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const [rows] = await pool.execute('SELECT id FROM ai_jobs WHERE id = ?', [req.params.id]);

      if (!rows.length) {
        return res.status(404).json({
          success: false,
          message: '任务不存在'
        });
      }

      const artifactFolder = `job-${req.params.id}`;
      const files = req.files || {};

      const artifactResult = {
        formal_plan_url: files.formal_plan_svg?.[0] ? `/ai-results/${artifactFolder}/${files.formal_plan_svg[0].filename}` : null,
        cad_file_url: files.cad_file?.[0] ? `/ai-results/${artifactFolder}/${files.cad_file[0].filename}` : null,
        formal_plan_json_url: files.formal_plan_json?.[0] ? `/ai-results/${artifactFolder}/${files.formal_plan_json[0].filename}` : null,
        three_d_config_url: files.three_d_config?.[0] ? `/ai-results/${artifactFolder}/${files.three_d_config[0].filename}` : null,
        panorama_config_url: files.panorama_config?.[0] ? `/ai-results/${artifactFolder}/${files.panorama_config[0].filename}` : null,
        delivery_manifest_url: files.delivery_manifest?.[0] ? `/ai-results/${artifactFolder}/${files.delivery_manifest[0].filename}` : null,
        delivery_approval_url: files.delivery_approval?.[0] ? `/ai-results/${artifactFolder}/${files.delivery_approval[0].filename}` : null,
        review_file_url: files.review_file?.[0] ? `/ai-results/${artifactFolder}/${files.review_file[0].filename}` : null,
        preview_image_url: files.preview_image?.[0] ? `/ai-results/${artifactFolder}/${files.preview_image[0].filename}` : null,
        recognition_diagnostics_url: files.recognition_diagnostics?.[0] ? `/ai-results/${artifactFolder}/${files.recognition_diagnostics[0].filename}` : null,
        recognition_overlay_url: files.recognition_overlay?.[0] ? `/ai-results/${artifactFolder}/${files.recognition_overlay[0].filename}` : null,
        recognition_edges_url: files.recognition_edges?.[0] ? `/ai-results/${artifactFolder}/${files.recognition_edges[0].filename}` : null,
        recognition_binary_url: files.recognition_binary?.[0] ? `/ai-results/${artifactFolder}/${files.recognition_binary[0].filename}` : null,
        recognition_wall_bands_url: files.recognition_wall_bands?.[0] ? `/ai-results/${artifactFolder}/${files.recognition_wall_bands[0].filename}` : null,
        recognition_structural_walls_url: files.recognition_structural_walls?.[0] ? `/ai-results/${artifactFolder}/${files.recognition_structural_walls[0].filename}` : null,
        recognition_balcony_candidates_url: files.recognition_balcony_candidates?.[0] ? `/ai-results/${artifactFolder}/${files.recognition_balcony_candidates[0].filename}` : null,
        recognition_room_interiors_url: files.recognition_room_interiors?.[0] ? `/ai-results/${artifactFolder}/${files.recognition_room_interiors[0].filename}` : null,
        recognition_window_candidates_url: files.recognition_window_candidates?.[0] ? `/ai-results/${artifactFolder}/${files.recognition_window_candidates[0].filename}` : null,
        recognition_door_candidates_url: files.recognition_door_candidates?.[0] ? `/ai-results/${artifactFolder}/${files.recognition_door_candidates[0].filename}` : null,
        recognition_symbol_candidates_url: files.recognition_symbol_candidates?.[0] ? `/ai-results/${artifactFolder}/${files.recognition_symbol_candidates[0].filename}` : null,
        effect_image_url: files.effect_image?.[0] ? `/ai-results/${artifactFolder}/${files.effect_image[0].filename}` : null,
        birdseye_image_url: files.birdseye_image?.[0] ? `/ai-results/${artifactFolder}/${files.birdseye_image[0].filename}` : null,
        interior_image_urls: (files.interior_image || []).map((file) => `/ai-results/${artifactFolder}/${file.filename}`),
        panorama_image_url: files.panorama_image?.[0] ? `/ai-results/${artifactFolder}/${files.panorama_image[0].filename}` : null
      };

      res.json({
        success: true,
        message: '任务产物上传成功',
        data: artifactResult
      });
    } catch (error) {
      console.error('上传AI任务产物失败:', error);
      res.status(500).json({
        success: false,
        message: '上传AI任务产物失败'
      });
    }
  }
);

router.post('/claim', authMiddleware, async (req, res) => {
  const { device_code } = req.body;

  if (!device_code) {
    return res.status(400).json({
      success: false,
      message: '设备编码不能为空'
    });
  }

  try {
    const [devices] = await pool.execute(
      'SELECT * FROM ai_devices WHERE device_code = ? AND status IN ("online", "busy")',
      [device_code]
    );

    if (!devices.length) {
      return res.status(400).json({
        success: false,
        message: '设备未注册或不在线'
      });
    }

    const [jobs] = await pool.execute(
      `SELECT * FROM ai_jobs
       WHERE status = 'pending'
       AND (assigned_device_id IS NULL OR assigned_device_id = ?)
       ORDER BY priority DESC, created_at ASC
       LIMIT 1`,
      [devices[0].id]
    );

    if (!jobs.length) {
      return res.json({
        success: true,
        data: null
      });
    }

    const job = jobs[0];

    await pool.execute(
      `UPDATE ai_jobs
       SET status = 'claimed', assigned_device_id = ?, assigned_user_id = ?, updated_at = NOW()
       WHERE id = ?`,
      [devices[0].id, req.user.id, job.id]
    );

    await pool.execute(
      `UPDATE ai_devices
       SET status = 'busy', last_heartbeat_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [devices[0].id]
    );

    const context = await getJobContext(job.id);

    res.json({
      success: true,
      data: context
    });
  } catch (error) {
    console.error('领取AI任务失败:', error);
    res.status(500).json({
      success: false,
      message: '领取AI任务失败'
    });
  }
});

router.post('/:id/start', authMiddleware, async (req, res) => {
  try {
    const [jobs] = await pool.execute('SELECT assigned_device_id FROM ai_jobs WHERE id = ?', [req.params.id]);
    await pool.execute(
      `UPDATE ai_jobs
       SET status = 'running', started_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [req.params.id]
    );

    if (jobs[0]?.assigned_device_id) {
      await pool.execute(
        `UPDATE ai_devices
         SET status = 'busy', last_heartbeat_at = NOW(), updated_at = NOW()
         WHERE id = ?`,
        [jobs[0].assigned_device_id]
      );
    }

    res.json({
      success: true,
      message: '任务已开始'
    });
  } catch (error) {
    console.error('启动AI任务失败:', error);
    res.status(500).json({
      success: false,
      message: '启动AI任务失败'
    });
  }
});

router.post('/:id/logs', authMiddleware, async (req, res) => {
  const { stage, level, message, payload } = req.body;

  try {
    await pool.execute(
      'INSERT INTO ai_job_logs (job_id, stage, level, message, payload) VALUES (?, ?, ?, ?, ?)',
      [req.params.id, stage || 'worker', level || 'info', message || '', payload ? JSON.stringify(payload) : null]
    );

    res.json({
      success: true,
      message: '日志已记录'
    });
  } catch (error) {
    console.error('写入AI任务日志失败:', error);
    res.status(500).json({
      success: false,
      message: '写入AI任务日志失败'
    });
  }
});

router.post('/:id/result', authMiddleware, async (req, res) => {
  const { result_payload } = req.body;

  try {
    const [jobs] = await pool.execute('SELECT * FROM ai_jobs WHERE id = ?', [req.params.id]);
    if (!jobs.length) {
      return res.status(404).json({
        success: false,
        message: '任务不存在'
      });
    }

    const job = jobs[0];
    const artifacts = result_payload?.artifacts || {};
    const [floorPlans] = await pool.execute('SELECT parse_result FROM floor_plans WHERE id = ?', [job.floor_plan_id]);
    const existingParseResult = parseJsonField(floorPlans[0]?.parse_result, {});
    const formalPlanJson = readJsonArtifact(artifacts.formal_plan_json_url);
    const rawThreeDConfig = readJsonArtifact(artifacts.three_d_config_url);
    const rawPanoramaConfig = readJsonArtifact(artifacts.panorama_config_url);
    const { threeDConfig, panoramaConfig } = rewriteRenderableArtifacts(rawThreeDConfig, rawPanoramaConfig, artifacts);
    writeJsonArtifact(artifacts.three_d_config_url, threeDConfig);
    writeJsonArtifact(artifacts.panorama_config_url, panoramaConfig);
    const deliveryManifest = readJsonArtifact(artifacts.delivery_manifest_url);
    const nextParseResult = buildNextParseResult(existingParseResult, formalPlanJson, threeDConfig, panoramaConfig, deliveryManifest, result_payload);

    await pool.execute(
      `UPDATE ai_jobs
       SET status = ?, result_payload = ?, finished_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      ['review_required', JSON.stringify(result_payload || {}), req.params.id]
    );

    await pool.execute(
      `UPDATE floor_plans
       SET formal_plan_url = ?, cad_file_url = ?, formal_plan_json_url = ?, three_d_config_url = ?, panorama_config_url = ?,
           review_file_url = ?, preview_image_url = ?, panorama_url = ?,
           parse_result = ?, review_status = 'pending',
           ai_processor = 'codex-desktop', ai_processed_at = NOW(), parse_status = 'completed'
       WHERE id = ?`,
      [
        artifacts.formal_plan_url || null,
        artifacts.cad_file_url || null,
        artifacts.formal_plan_json_url || null,
        artifacts.three_d_config_url || null,
        artifacts.panorama_config_url || null,
        artifacts.review_file_url || null,
        artifacts.effect_image_url || artifacts.preview_image_url || null,
        artifacts.panorama_image_url || null,
        JSON.stringify(nextParseResult),
        job.floor_plan_id
      ]
    );

    if (job.assigned_device_id) {
      await pool.execute(
        `UPDATE ai_devices
         SET status = 'online', last_heartbeat_at = NOW(), updated_at = NOW()
         WHERE id = ?`,
        [job.assigned_device_id]
      );
    }

    res.json({
      success: true,
      message: '结果已回传'
    });
  } catch (error) {
    console.error('回传AI任务结果失败:', error);
    res.status(500).json({
      success: false,
      message: '回传AI任务结果失败'
    });
  }
});

router.post('/:id/fail', authMiddleware, async (req, res) => {
  const { error_message, stage, payload } = req.body;

  try {
    const [jobs] = await pool.execute('SELECT assigned_device_id FROM ai_jobs WHERE id = ?', [req.params.id]);
    await pool.execute(
      `UPDATE ai_jobs
       SET status = 'failed', error_message = ?, finished_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [error_message || '任务失败', req.params.id]
    );

    await pool.execute(
      'INSERT INTO ai_job_logs (job_id, stage, level, message, payload) VALUES (?, ?, ?, ?, ?)',
      [
        req.params.id,
        stage || 'fail',
        'error',
        error_message || '任务失败',
        payload ? JSON.stringify(payload) : null
      ]
    );

    if (jobs[0]?.assigned_device_id) {
      await pool.execute(
        `UPDATE ai_devices
         SET status = 'online', last_heartbeat_at = NOW(), updated_at = NOW()
         WHERE id = ?`,
        [jobs[0].assigned_device_id]
      );
    }

    res.json({
      success: true,
      message: '任务已标记失败'
    });
  } catch (error) {
    console.error('标记AI任务失败状态失败:', error);
    res.status(500).json({
      success: false,
      message: '标记AI任务失败状态失败'
    });
  }
});

module.exports = router;
