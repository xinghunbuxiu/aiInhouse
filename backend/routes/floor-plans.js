const express = require('express');
const fs = require('fs');
const path = require('path');
const { pool, executeWithRetry } = require('../config/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

const router = express.Router();

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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizePublicAssetUrl(url, baseUrl = '') {
  if (!url) {
    return '';
  }

  if (/^(https?:)?\/\//.test(url) || String(url).startsWith('data:')) {
    return url;
  }

  const normalized = String(url).replace(/\\/g, '/').trim();
  if (normalized.startsWith('/')) {
    return normalized;
  }

  if (baseUrl) {
    const baseDir = String(baseUrl).replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    return `${baseDir}/${normalized.replace(/^\.?\//, '')}`;
  }

  const aiResultsMatch = normalized.match(/(?:^|\/)(ai-results\/.+)$/);
  if (aiResultsMatch?.[1]) {
    return `/${aiResultsMatch[1]}`;
  }

  const uploadsMatch = normalized.match(/(?:^|\/)(uploads\/.+)$/);
  if (uploadsMatch?.[1]) {
    return `/${uploadsMatch[1]}`;
  }

  return `/uploads/${normalized.replace(/^\.?\//, '')}`;
}

function getDefaultRenderEngines() {
  return [
    {
      name: 'Pannellum',
      url: 'https://pannellum.org/',
      useCase: '轻量开源 Web 全景查看器，适合直接交付 VR 漫游热点配置。'
    },
    {
      name: 'BlenderProc',
      url: 'https://github.com/DLR-RM/BlenderProc',
      useCase: '基于 Blender 的程序化真实渲染管线，适合批量生成装修效果图和 2:1 全景图。'
    },
    {
      name: 'Sweet Home 3D',
      url: 'https://www.sweethome3d.com/',
      useCase: '成熟开源室内设计建模工具，适合平面图到室内 3D 布置的人工/半自动工作流。'
    }
  ];
}

function copyPannellumAssets(exportDir) {
  const sourceDir = path.resolve(__dirname, '..', '..', 'node_modules', 'pannellum', 'build');
  if (!fs.existsSync(sourceDir)) {
    return false;
  }

  const vendorDir = path.join(exportDir, 'vendor', 'pannellum');
  fs.mkdirSync(vendorDir, { recursive: true });
  for (const fileName of ['pannellum.css', 'pannellum.js']) {
    fs.copyFileSync(path.join(sourceDir, fileName), path.join(vendorDir, fileName));
  }
  return true;
}

function writeTourAssets(exportDir, panoramaImage, hotspots = []) {
  if (!panoramaImage) {
    return;
  }

  const config = {
    panorama: panoramaImage,
    hotSpots: hotspots
  };
  fs.writeFileSync(path.join(exportDir, 'tour-config.json'), JSON.stringify(config, null, 2), 'utf8');
  fs.writeFileSync(path.join(exportDir, 'tour.js'), `fetch('./tour-config.json')
  .then(function(response){ return response.json(); })
  .then(function(config){
    if (!window.pannellum) return;
    var fallback = document.querySelector('.tour-fallback');
    if (fallback) fallback.style.display = 'none';
    window.pannellum.viewer('pano', {
      type: 'equirectangular',
      panorama: config.panorama,
      autoLoad: true,
      autoRotate: -1,
      hfov: 105,
      showControls: true,
      compass: true,
      hotSpots: config.hotSpots || []
    });
  });`, 'utf8');
}

function buildDesignSiteHtml(floorPlan) {
  const parseResult = parseJsonField(floorPlan.parse_result, {});
  const threeDConfig = parseResult?.generated3DConfig || {};
  const panoramaConfig = parseResult?.panoramaConfig || {};
  const rooms = Array.isArray(parseResult?.rooms) ? parseResult.rooms : [];
  const walls = Array.isArray(parseResult?.walls) ? parseResult.walls : [];
  const cameras = Array.isArray(panoramaConfig?.cameraPositions) ? panoramaConfig.cameraPositions : [];
  const hotspots = Array.isArray(panoramaConfig?.hotspots) ? panoramaConfig.hotspots : [];
  const colors = threeDConfig.colors || {};
  const materials = threeDConfig.materials || {};
  const effectImages = (Array.isArray(threeDConfig?.deliverables?.effectImages) ? threeDConfig.deliverables.effectImages : [])
    .map((image) => normalizePublicAssetUrl(image, floorPlan.three_d_config_url));
  const sceneViewerUrl = normalizePublicAssetUrl(threeDConfig?.deliverables?.sceneViewer || '', floorPlan.three_d_config_url);
  const modelFiles = (Array.isArray(threeDConfig?.deliverables?.modelFiles) ? threeDConfig.deliverables.modelFiles : [])
    .map((file) => normalizePublicAssetUrl(file, floorPlan.three_d_config_url));
  const panoramaImages = (Array.isArray(panoramaConfig?.deliverables?.panoramaImages) ? panoramaConfig.deliverables.panoramaImages : [])
    .map((image) => normalizePublicAssetUrl(image, floorPlan.panorama_config_url));
  const rendererEngines = Array.isArray(threeDConfig?.renderer?.recommendedEngines) ? threeDConfig.renderer.recommendedEngines : [];
  const viewerEngines = Array.isArray(panoramaConfig?.viewer?.recommendedEngines) ? panoramaConfig.viewer.recommendedEngines : [];
  const engineMap = new Map([...rendererEngines, ...viewerEngines, ...getDefaultRenderEngines()].filter((engine) => engine?.name).map((engine) => [engine.name, engine]));
  const roomCards = rooms.map((room, index) => `
    <article class="card">
      <h3>${escapeHtml(room.name || `空间 ${index + 1}`)}</h3>
      <p>${escapeHtml(room.type || 'space')} · ${escapeHtml(room.area || 0)} m²</p>
      <span>已纳入全屋结构、材质和漫游机位配置；交付前建议复核门窗、家具尺度和隐私展示范围。</span>
    </article>
  `).join('');
  const hotspotItems = hotspots.map((hotspot) => `
    <li><strong>${escapeHtml(hotspot.text || hotspot.id || '热点')}</strong><span>target ${escapeHtml(hotspot.target || '-')}</span></li>
  `).join('');
  const pannellumHotspots = hotspots.map((hotspot, index) => ({
    pitch: Number(hotspot.position?.pitch ?? hotspot.pitch ?? 0),
    yaw: Number(hotspot.position?.yaw ?? hotspot.yaw ?? index * 45),
    type: 'info',
    text: hotspot.text || hotspot.id || `热点 ${index + 1}`
  }));
  const effectGallery = effectImages.map((image, index) => `
    <figure class="media-card"><img src="${escapeHtml(image)}" alt="装修效果图 ${index + 1}" /><figcaption>装修效果图 ${index + 1}</figcaption></figure>
  `).join('');
  const panoramaGallery = panoramaImages.map((image, index) => `
    <figure class="media-card"><img src="${escapeHtml(image)}" alt="VR 全景图 ${index + 1}" /><figcaption>VR 全景图 ${index + 1}</figcaption></figure>
  `).join('');
  const engineCards = [...engineMap.values()].map((engine) => `
    <a class="card link-card" href="${escapeHtml(engine.url || '#')}" target="_blank" rel="noreferrer"><h3>${escapeHtml(engine.name)}</h3><span>${escapeHtml(engine.useCase || '')}</span></a>
  `).join('');

  const recognitionConfidence = parseResult?.meta?.recognitionConfidence || {};
  const deliveryLevel = rooms.length && threeDConfig?.deliverables && panoramaConfig?.deliverables
    ? '可预览交付'
    : '待补齐';
  const commercialNotes = [
    '本交付页包含正式平面图、3D 效果配置、VR 漫游配置和客户预览素材。',
    '照片级商用成片需使用已授权素材并通过 imagegen / Blender / 外部渲染器输出 PNG/JPG 后终审。',
    '发布前请确认户型结构、门窗、厨房卫生间位置、家具尺度和全景热点均已通过人工复核。'
  ];

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(floorPlan.name || '装修交付页')} - AIInHouse</title>
  <style>
    *{box-sizing:border-box} body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#020617;color:#f8fafc}
    .hero{min-height:72vh;padding:56px 7vw;display:flex;flex-direction:column;justify-content:flex-end;background:linear-gradient(135deg,#020617,#0f172a 48%,#1e3a8a)}
    .eyebrow{letter-spacing:.22em;text-transform:uppercase;color:#67e8f9;font-size:13px}.hero h1{font-size:clamp(40px,7vw,82px);line-height:1;margin:18px 0}.hero p{max-width:780px;color:#cbd5e1;line-height:1.8}
    .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;max-width:760px;margin-top:28px}.stat{border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.09);border-radius:20px;padding:18px}.stat b{font-size:34px}
    section{padding:54px 7vw}.light{background:#fff;color:#0f172a}.muted{background:#f1f5f9;color:#0f172a}.section-title{font-size:34px;margin:10px 0 22px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}.card{border:1px solid #e2e8f0;background:#fff;border-radius:22px;padding:22px}.card p{color:#64748b}.card span{color:#475569;line-height:1.7}
    .swatch{height:96px;border-radius:18px;border:1px solid rgba(15,23,42,.12)}.stage{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);border-radius:28px;padding:28px}.vr{min-height:420px;border-radius:30px;background:radial-gradient(circle at 50% 40%,#2563eb,#020617 58%);position:relative;overflow:hidden;border:1px solid rgba(255,255,255,.14)}.vr:before,.vr:after{content:"";position:absolute;inset:60px;border:1px solid rgba(103,232,249,.28);border-radius:999px}.vr:after{inset:110px;opacity:.65}.hotspots{display:grid;gap:10px;margin-top:20px}.hotspots li{display:flex;justify-content:space-between;gap:18px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.08);border-radius:16px;padding:14px;list-style:none}.hotspots span{color:#cbd5e1}
    .media-card{overflow:hidden;border:1px solid #e2e8f0;background:#fff;border-radius:22px;margin:0}.media-card img{display:block;width:100%;aspect-ratio:16/10;object-fit:cover}.media-card figcaption{padding:14px 18px;color:#64748b}.link-card{text-decoration:none;color:inherit}
    .tour{position:relative;min-height:680px;overflow:hidden;border-radius:30px;background:#020617;border:1px solid rgba(255,255,255,.14)}.tour-viewer{position:absolute;inset:0}.tour-fallback{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.tour-top{position:absolute;z-index:2;inset:0 0 auto 0;padding:24px;background:linear-gradient(180deg,rgba(0,0,0,.72),rgba(0,0,0,0));pointer-events:none}.tour-top h3{margin:8px 0 0;font-size:30px}.tour-top p{margin:8px 0 0;color:#cbd5e1}.tour-bottom{position:absolute;z-index:2;inset:auto 0 0 0;padding:22px;background:linear-gradient(0deg,rgba(0,0,0,.82),rgba(0,0,0,0));display:flex;gap:14px;align-items:end;justify-content:space-between;flex-wrap:wrap}.tour-scenes{display:flex;gap:10px;overflow:auto}.tour-scene{width:150px;border:1px solid rgba(255,255,255,.18);border-radius:16px;background:rgba(255,255,255,.1);padding:8px;color:#fff}.tour-thumb{height:64px;border-radius:12px;background:linear-gradient(135deg,#0f172a,#334155 48%,#c8a676);margin-bottom:8px}.tour-hotspots{min-width:260px;max-width:360px;border:1px solid rgba(255,255,255,.18);border-radius:18px;background:rgba(0,0,0,.38);padding:14px;backdrop-filter:blur(10px)}.tour-hotspots p{margin:0 0 10px}.tour-hotspots span{display:inline-block;margin:4px;padding:7px 10px;border-radius:999px;background:rgba(255,255,255,.12);color:#fff;font-size:13px}
  </style>
  ${panoramaImages[0] ? '<link rel="stylesheet" href="./vendor/pannellum/pannellum.css" />' : ''}
</head>
<body>
  <main>
    <section class="hero">
      <div class="eyebrow">AIInHouse Design Delivery</div>
      <h1>${escapeHtml(floorPlan.name || '全屋装修效果方案')}</h1>
      <p>基于平面图识别、墙体拓扑、素材装配、3D 效果配置和 VR 漫游配置生成的全屋装修交付页，用于客户方案预览、内部复核和渲染器交接。</p>
      <div class="stats"><div class="stat"><span>Delivery</span><br/><b>${escapeHtml(deliveryLevel)}</b></div><div class="stat"><span>Rooms</span><br/><b>${rooms.length}</b></div><div class="stat"><span>VR Cameras</span><br/><b>${cameras.length}</b></div></div>
    </section>
    <section class="light"><div class="eyebrow">Design Style</div><h2 class="section-title">装修设计板</h2><div class="grid">
      <div class="card"><div class="swatch" style="background:${escapeHtml(colors.primary || '#c97342')}"></div><h3>主色</h3><p>${escapeHtml(colors.primary || '#c97342')}</p></div>
      <div class="card"><div class="swatch" style="background:${escapeHtml(colors.accent || '#2f5d50')}"></div><h3>强调色</h3><p>${escapeHtml(colors.accent || '#2f5d50')}</p></div>
      <div class="card"><div class="swatch" style="background:${escapeHtml(colors.base || '#f4efe8')}"></div><h3>基底色</h3><p>${escapeHtml(colors.base || '#f4efe8')}</p></div>
    </div></section>
    <section class="muted"><div class="eyebrow">Materials</div><h2 class="section-title">材料建议</h2><div class="grid">
      <div class="card"><h3>地面</h3><p>${escapeHtml(materials.floor?.texture || 'wood')}</p></div>
      <div class="card"><h3>墙面</h3><p>${escapeHtml(materials.wall?.texture || 'paint')}</p></div>
      <div class="card"><h3>天花</h3><p>${escapeHtml(materials.ceiling?.texture || 'matte')}</p></div>
    </div></section>
    <section><div class="eyebrow">3D Effect</div><h2 class="section-title">全屋 3D 装修效果</h2>${effectGallery ? `<div class="grid">${effectGallery}</div>` : `<div class="stage">当前静态模板已绑定 3D 场景配置：${escapeHtml(floorPlan.three_d_config_url || '3d-config.json')}。在后台交付页可查看可交互 Three.js 效果。</div>`}<div class="hotspots">${sceneViewerUrl ? `<li><strong>装配预览</strong><span><a href="${escapeHtml(sceneViewerUrl)}" target="_blank" rel="noreferrer">打开</a></span></li>` : ''}${modelFiles[0] ? `<li><strong>场景 JSON</strong><span><a href="${escapeHtml(modelFiles[0])}" target="_blank" rel="noreferrer">打开</a></span></li>` : ''}</div></section>
    <section><div class="eyebrow">VR Tour</div><h2 class="section-title">VR 全景漫游图</h2>${panoramaImages[0] ? `<div class="tour"><div id="pano" class="tour-viewer"></div><img class="tour-fallback" src="${escapeHtml(panoramaImages[0])}" alt="VR 全景图" /><div class="tour-top"><div class="eyebrow">AIInHouse VR Tour</div><h3>${escapeHtml(cameras[0]?.name || '全屋漫游')}</h3><p>${escapeHtml(panoramaConfig.description || '全屋装修全景漫游预览')}</p></div><div class="tour-bottom"><div class="tour-scenes">${cameras.map((camera, index) => `<div class="tour-scene"><div class="tour-thumb"></div>${escapeHtml(camera.name || `视角 ${index + 1}`)}</div>`).join('')}</div><div class="tour-hotspots"><p>热点导航</p>${hotspots.map((hotspot) => `<span>${escapeHtml(hotspot.text || hotspot.id || '热点')}</span>`).join('')}</div></div></div>` : '<div class="vr"></div>'}<ul class="hotspots">${hotspotItems || '<li><strong>暂无热点</strong><span>待生成</span></li>'}</ul></section>
    <section class="light"><div class="eyebrow">Room Plan</div><h2 class="section-title">房间装修建议</h2><div class="grid">${roomCards}</div></section>
    <section class="light"><div class="eyebrow">Commercial Review</div><h2 class="section-title">商用交付复核</h2><div class="grid">
      <article class="card"><h3>识别置信度</h3><p>几何 ${escapeHtml(recognitionConfidence.geometry ?? '-')} · 语义 ${escapeHtml(recognitionConfidence.semantics ?? '-')}</p><span>置信度低于项目标准时，需先人工修正 Formal Plan，再进入照片级渲染。</span></article>
      <article class="card"><h3>授权与素材</h3><p>仅使用自有或明确可商用素材</p><span>模型、贴图、家具、图片素材均需保留来源和 license 记录。</span></article>
      <article class="card"><h3>发布前检查</h3><p>结构、热点、图片比例、隐私区域</p><span>VR 图片必须为 2:1 equirectangular，并在 Pannellum 中完成加载测试。</span></article>
    </div><ul class="hotspots">${commercialNotes.map((note) => `<li><strong>提示</strong><span>${escapeHtml(note)}</span></li>`).join('')}</ul></section>
    <section class="muted"><div class="eyebrow">Render Pipeline</div><h2 class="section-title">成熟渲染方案接入点</h2><div class="grid">${engineCards}</div></section>
  </main>
  ${panoramaImages[0] ? '<script src="./vendor/pannellum/pannellum.js"></script><script src="./tour.js"></script>' : ''}
</body>
</html>`;
}

async function queryFloorPlansWithCompatibility(baseQuery, values) {
  try {
    const [floorPlans] = await executeWithRetry(baseQuery, values);
    return floorPlans;
  } catch (error) {
    if (error.code !== 'ER_BAD_FIELD_ERROR') {
      throw error;
    }

    const fallbackQuery = baseQuery
      .replace('bb.block_number, ', '')
      .replace(', bb.block_number', '')
      .replace(', h.block_id', '')
      .replace('h.block_id, ', '')
      .replace(' LEFT JOIN building_blocks bb ON h.block_id = bb.id', '')
      .replace(' AND h.block_id = ?', '')
      .replace(', bb.block_number ASC', '')
      .replace('ASC ASC', 'ASC');

    const [floorPlans] = await executeWithRetry(fallbackQuery, values);
    return floorPlans.map((floorPlan) => ({
      ...floorPlan,
      block_id: null,
      block_number: null
    }));
  }
}

// 获取平面图列表
router.get('/', authMiddleware, async (req, res) => {
  const { house_id, building_id, block_id, floor_number, parse_status } = req.query;
  let query = 'SELECT f.*, h.building_id, h.block_id, h.unit_number, h.floor_number, h.room_number, bb.block_number, b.name as building_name FROM floor_plans f LEFT JOIN houses h ON f.house_id = h.id LEFT JOIN buildings b ON h.building_id = b.id LEFT JOIN building_blocks bb ON h.block_id = bb.id WHERE 1=1';
  const values = [];

  if (house_id) {
    query += ' AND f.house_id = ?';
    values.push(house_id);
  }
  if (building_id) {
    query += ' AND h.building_id = ?';
    values.push(building_id);
  }
  if (block_id) {
    query += ' AND h.block_id = ?';
    values.push(block_id);
  }
  if (floor_number) {
    query += ' AND h.floor_number = ?';
    values.push(floor_number);
  }
  if (parse_status) {
    query += ' AND f.parse_status = ?';
    values.push(parse_status);
  }

  query += ' ORDER BY b.name ASC, bb.block_number ASC, h.floor_number DESC, h.unit_number ASC, h.room_number ASC, f.created_at DESC';

  try {
    const floorPlans = await queryFloorPlansWithCompatibility(query, values);

    res.json({
      success: true,
      data: floorPlans
    });
  } catch (error) {
    console.error('获取平面图列表失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

router.post('/:id/design-site/export', authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const floorPlans = await queryFloorPlansWithCompatibility(
      'SELECT f.*, h.building_id, h.block_id, h.unit_number, h.floor_number, h.room_number, bb.block_number, b.name as building_name FROM floor_plans f LEFT JOIN houses h ON f.house_id = h.id LEFT JOIN buildings b ON h.building_id = b.id LEFT JOIN building_blocks bb ON h.block_id = bb.id WHERE f.id = ?',
      [id]
    );

    if (floorPlans.length === 0) {
      return res.status(404).json({
        success: false,
        message: '平面图不存在'
      });
    }

    const exportDir = path.join(process.cwd(), 'uploads', 'ai-results', 'design-sites', `floor-plan-${id}`);
    fs.mkdirSync(exportDir, { recursive: true });
    copyPannellumAssets(exportDir);
    const parseResult = parseJsonField(floorPlans[0].parse_result, {});
    const panoramaConfig = parseResult?.panoramaConfig || {};
    const panoramaImages = (Array.isArray(panoramaConfig?.deliverables?.panoramaImages) ? panoramaConfig.deliverables.panoramaImages : [])
      .map((image) => normalizePublicAssetUrl(image, floorPlans[0].panorama_config_url));
    const hotspots = (Array.isArray(panoramaConfig?.hotspots) ? panoramaConfig.hotspots : []).map((hotspot, index) => ({
      pitch: Number(hotspot.position?.pitch ?? hotspot.pitch ?? 0),
      yaw: Number(hotspot.position?.yaw ?? hotspot.yaw ?? index * 45),
      type: 'info',
      text: hotspot.text || hotspot.id || `热点 ${index + 1}`
    }));
    writeTourAssets(exportDir, panoramaImages[0], hotspots);
    const html = buildDesignSiteHtml(floorPlans[0]);
    fs.writeFileSync(path.join(exportDir, 'index.html'), html, 'utf8');

    res.json({
      success: true,
      message: '装修交付页已生成',
      data: {
        url: `/ai-results/design-sites/floor-plan-${id}/index.html`
      }
    });
  } catch (error) {
    console.error('导出装修交付页失败:', error);
    res.status(500).json({
      success: false,
      message: '导出装修交付页失败'
    });
  }
});

// 获取平面图详情
router.get('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const floorPlans = await queryFloorPlansWithCompatibility(
      'SELECT f.*, h.building_id, h.block_id, h.unit_number, h.floor_number, h.room_number, bb.block_number, b.name as building_name FROM floor_plans f LEFT JOIN houses h ON f.house_id = h.id LEFT JOIN buildings b ON h.building_id = b.id LEFT JOIN building_blocks bb ON h.block_id = bb.id WHERE f.id = ?',
      [id]
    );

    if (floorPlans.length === 0) {
      return res.status(404).json({
        success: false,
        message: '平面图不存在'
      });
    }

    res.json({
      success: true,
      data: floorPlans[0]
    });
  } catch (error) {
    console.error('获取平面图详情失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 创建平面图（仅管理员）
router.post('/', authMiddleware, adminMiddleware, [
  body('house_id').notEmpty().withMessage('房屋ID不能为空'),
  body('name').optional().isString(),
  body('image_url').notEmpty().withMessage('平面图图片URL不能为空'),
  body('thumbnail_url').optional().isString(),
  body('file_size').optional().isInt(),
  body('file_type').optional().isString(),
  body('parse_status').optional().isIn(['pending', 'processing', 'completed', 'failed']),
  body('parse_result').optional().isString()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: '参数验证失败',
      errors: errors.array()
    });
  }

  const { house_id, name, image_url, thumbnail_url, file_size, file_type, parse_status, parse_result, panorama_url } = req.body;

  try {
    // 检查房屋是否存在
    const [houses] = await pool.execute('SELECT id FROM houses WHERE id = ?', [house_id]);
    if (houses.length === 0) {
      return res.status(400).json({
        success: false,
        message: '房屋不存在'
      });
    }

    const [result] = await pool.execute(
      'INSERT INTO floor_plans (house_id, name, image_url, thumbnail_url, file_size, file_type, parse_status, parse_result, panorama_url, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [house_id, name ?? null, image_url, thumbnail_url ?? null, file_size ?? null, file_type ?? null, parse_status || 'pending', parse_result ?? null, panorama_url ?? null, req.user.id]
    );

    res.status(201).json({
      success: true,
      message: '平面图创建成功',
      data: { id: result.insertId }
    });
  } catch (error) {
    console.error('创建平面图失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 更新平面图（仅管理员）
router.put('/:id', authMiddleware, adminMiddleware, [
  body('house_id').optional().notEmpty(),
  body('name').optional().isString(),
  body('image_url').optional().isString(),
  body('thumbnail_url').optional().isString(),
  body('file_size').optional().isInt(),
  body('file_type').optional().isString(),
  body('parse_status').optional().isIn(['pending', 'processing', 'completed', 'failed']),
  body('parse_result').optional().isString(),
  body('panorama_url').optional().isString(),
  body('status').optional().isIn([0, 1])
], async (req, res) => {
  const { id } = req.params;
  const { house_id, name, image_url, thumbnail_url, file_size, file_type, parse_status, parse_result, panorama_url, status } = req.body;

  try {
    const updates = [];
    const values = [];

    if (house_id !== undefined) {
      // 检查房屋是否存在
      const [houses] = await pool.execute('SELECT id FROM houses WHERE id = ?', [house_id]);
      if (houses.length === 0) {
        return res.status(400).json({
          success: false,
          message: '房屋不存在'
        });
      }
      updates.push('house_id = ?');
      values.push(house_id);
    }
    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (image_url !== undefined) {
      updates.push('image_url = ?');
      values.push(image_url);
    }
    if (thumbnail_url !== undefined) {
      updates.push('thumbnail_url = ?');
      values.push(thumbnail_url);
    }
    if (file_size !== undefined) {
      updates.push('file_size = ?');
      values.push(file_size);
    }
    if (file_type !== undefined) {
      updates.push('file_type = ?');
      values.push(file_type);
    }
    if (parse_status !== undefined) {
      updates.push('parse_status = ?');
      values.push(parse_status);
    }
    if (parse_result !== undefined) {
      updates.push('parse_result = ?');
      values.push(parse_result);
    }
    if (panorama_url !== undefined) {
      updates.push('panorama_url = ?');
      values.push(panorama_url);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      values.push(status);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: '没有要更新的字段'
      });
    }

    values.push(id);
    await pool.execute(
      `UPDATE floor_plans SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      values
    );

    res.json({
      success: true,
      message: '平面图更新成功'
    });
  } catch (error) {
    console.error('更新平面图失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 获取交付快照列表
router.get('/:id/delivery-snapshots', authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const [snapshots] = await pool.execute(
      `SELECT id, floor_plan_id, version, summary, source_type, has_3d_config, has_panorama_config,
              room_count, hotspot_count, snapshot_data, created_by, created_at, updated_at
       FROM delivery_snapshots
       WHERE floor_plan_id = ?
       ORDER BY version DESC, created_at DESC`,
      [id]
    );

    res.json({
      success: true,
      data: snapshots
    });
  } catch (error) {
    console.error('获取交付快照列表失败:', error);
    res.status(500).json({
      success: false,
      message: '获取交付快照列表失败'
    });
  }
});

// 获取单个交付快照详情
router.get('/:id/delivery-snapshots/:snapshotId', authMiddleware, async (req, res) => {
  const { id, snapshotId } = req.params;

  try {
    const [snapshots] = await pool.execute(
      `SELECT id, floor_plan_id, version, summary, source_type, has_3d_config, has_panorama_config,
              room_count, hotspot_count, snapshot_data, created_by, created_at, updated_at
       FROM delivery_snapshots
       WHERE id = ? AND floor_plan_id = ?`,
      [snapshotId, id]
    );

    if (snapshots.length === 0) {
      return res.status(404).json({
        success: false,
        message: '交付快照不存在'
      });
    }

    res.json({
      success: true,
      data: snapshots[0]
    });
  } catch (error) {
    console.error('获取交付快照详情失败:', error);
    res.status(500).json({
      success: false,
      message: '获取交付快照详情失败'
    });
  }
});

// 创建交付快照
router.post('/:id/delivery-snapshots', authMiddleware, adminMiddleware, [
  body('summary').optional().isString(),
  body('source_type').optional().isIn(['digital', 'hand_drawn']),
  body('has_3d_config').optional().isIn([0, 1, '0', '1', true, false]),
  body('has_panorama_config').optional().isIn([0, 1, '0', '1', true, false]),
  body('room_count').optional().isInt({ min: 0 }),
  body('hotspot_count').optional().isInt({ min: 0 }),
  body('snapshot_data').notEmpty().withMessage('快照数据不能为空')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: '参数验证失败',
      errors: errors.array()
    });
  }

  const { id } = req.params;
  const {
    summary,
    source_type,
    has_3d_config,
    has_panorama_config,
    room_count,
    hotspot_count,
    snapshot_data
  } = req.body;

  try {
    const [floorPlans] = await pool.execute('SELECT id FROM floor_plans WHERE id = ?', [id]);
    if (floorPlans.length === 0) {
      return res.status(404).json({
        success: false,
        message: '平面图不存在'
      });
    }

    const [maxVersionRows] = await pool.execute(
      'SELECT COALESCE(MAX(version), 0) AS maxVersion FROM delivery_snapshots WHERE floor_plan_id = ?',
      [id]
    );

    const nextVersion = Number(maxVersionRows[0]?.maxVersion || 0) + 1;

    const [result] = await pool.execute(
      `INSERT INTO delivery_snapshots (
        floor_plan_id, version, summary, source_type, has_3d_config, has_panorama_config,
        room_count, hotspot_count, snapshot_data, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        nextVersion,
        summary || null,
        source_type || 'digital',
        Number(Boolean(has_3d_config)),
        Number(Boolean(has_panorama_config)),
        room_count || 0,
        hotspot_count || 0,
        snapshot_data,
        req.user.id
      ]
    );

    res.status(201).json({
      success: true,
      message: '交付快照创建成功',
      data: {
        id: result.insertId,
        version: nextVersion
      }
    });
  } catch (error) {
    console.error('创建交付快照失败:', error);
    res.status(500).json({
      success: false,
      message: '创建交付快照失败'
    });
  }
});

// 删除指定交付快照
router.delete('/:id/delivery-snapshots/:snapshotId', authMiddleware, adminMiddleware, async (req, res) => {
  const { id, snapshotId } = req.params;

  try {
    const [result] = await pool.execute(
      'DELETE FROM delivery_snapshots WHERE id = ? AND floor_plan_id = ?',
      [snapshotId, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: '交付快照不存在'
      });
    }

    res.json({
      success: true,
      message: '交付快照删除成功'
    });
  } catch (error) {
    console.error('删除交付快照失败:', error);
    res.status(500).json({
      success: false,
      message: '删除交付快照失败'
    });
  }
});

// 恢复到指定交付快照
router.post('/:id/delivery-snapshots/:snapshotId/restore', authMiddleware, adminMiddleware, async (req, res) => {
  const { id, snapshotId } = req.params;

  try {
    const [snapshots] = await pool.execute(
      'SELECT snapshot_data FROM delivery_snapshots WHERE id = ? AND floor_plan_id = ?',
      [snapshotId, id]
    );

    if (snapshots.length === 0) {
      return res.status(404).json({
        success: false,
        message: '交付快照不存在'
      });
    }

    const snapshotData =
      typeof snapshots[0].snapshot_data === 'string'
        ? snapshots[0].snapshot_data
        : JSON.stringify(snapshots[0].snapshot_data);

    await pool.execute(
      'UPDATE floor_plans SET parse_status = ?, parse_result = ?, updated_at = NOW() WHERE id = ?',
      ['completed', snapshotData, id]
    );

    res.json({
      success: true,
      message: '交付快照恢复成功'
    });
  } catch (error) {
    console.error('恢复交付快照失败:', error);
    res.status(500).json({
      success: false,
      message: '恢复交付快照失败'
    });
  }
});

// 删除平面图（仅管理员）
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    await pool.execute('DELETE FROM floor_plans WHERE id = ?', [id]);

    res.json({
      success: true,
      message: '平面图删除成功'
    });
  } catch (error) {
    console.error('删除平面图失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

module.exports = router;
