const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();
const dataFile = path.resolve(__dirname, '..', 'data', 'design-assets.json');
const assetUploadDir = path.resolve(process.cwd(), 'uploads', 'design-assets');

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      fs.mkdirSync(assetUploadDir, { recursive: true });
      cb(null, assetUploadDir);
    },
    filename(req, file, cb) {
      const ext = path.extname(file.originalname || '');
      const safeName = path.basename(file.originalname || 'asset', ext)
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'asset';
      cb(null, `${file.fieldname}-${safeName}-${Date.now()}${ext}`);
    }
  }),
  limits: {
    fileSize: Number(process.env.DESIGN_ASSET_MAX_FILE_SIZE || 120 * 1024 * 1024)
  },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExtensions = new Set([
      '.glb', '.gltf', '.obj', '.fbx', '.blend',
      '.jpg', '.jpeg', '.png', '.webp', '.svg',
      '.hdr', '.exr', '.zip'
    ]);

    if (allowedExtensions.has(ext)) {
      cb(null, true);
      return;
    }

    cb(new Error('不支持的素材文件类型'));
  }
});

function ensureDataFile() {
  const dir = path.dirname(dataFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, '[]', 'utf8');
  }
}

function readAssets() {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  } catch (error) {
    return [];
  }
}

function writeAssets(assets) {
  ensureDataFile();
  fs.writeFileSync(dataFile, JSON.stringify(assets, null, 2), 'utf8');
}

function normalizeAsset(payload, existing = {}) {
  const id = String(payload.id || existing.id || payload.name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return {
    ...existing,
    id,
    name: String(payload.name || existing.name || '').trim(),
    category: payload.category || existing.category || 'furniture',
    usage: payload.usage || existing.usage || '',
    sceneTypes: Array.isArray(payload.sceneTypes) ? payload.sceneTypes : (existing.sceneTypes || []),
    placement: payload.placement || existing.placement || '',
    aiDescription: payload.aiDescription || existing.aiDescription || '',
    tags: Array.isArray(payload.tags) ? payload.tags : (existing.tags || []),
    styleTags: Array.isArray(payload.styleTags) ? payload.styleTags : (existing.styleTags || []),
    domesticTags: Array.isArray(payload.domesticTags) ? payload.domesticTags : (existing.domesticTags || []),
    styleProfile: payload.styleProfile && typeof payload.styleProfile === 'object' ? payload.styleProfile : (existing.styleProfile || {}),
    properties: payload.properties && typeof payload.properties === 'object' ? payload.properties : (existing.properties || {}),
    assetUrl: payload.assetUrl || existing.assetUrl || '',
    modelUrl: payload.modelUrl || existing.modelUrl || '',
    textureUrl: payload.textureUrl || existing.textureUrl || '',
    pbrTextures: payload.pbrTextures && typeof payload.pbrTextures === 'object' ? payload.pbrTextures : (existing.pbrTextures || {}),
    previewUrl: payload.previewUrl || existing.previewUrl || '',
    sourceType: payload.sourceType || existing.sourceType || 'manual',
    sourceUrl: payload.sourceUrl || existing.sourceUrl || '',
    license: payload.license || existing.license || '',
    createdAt: existing.createdAt || payload.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

router.get('/', authMiddleware, (req, res) => {
  const { category, sceneType, style, q } = req.query;
  let assets = readAssets();

  if (category) {
    assets = assets.filter((asset) => asset.category === category);
  }
  if (sceneType) {
    assets = assets.filter((asset) => asset.sceneTypes?.includes(sceneType));
  }
  if (style) {
    assets = assets.filter((asset) => asset.styleTags?.includes(style));
  }
  if (q) {
    const keyword = String(q).toLowerCase();
    assets = assets.filter((asset) => [
      asset.name,
      asset.usage,
      asset.aiDescription,
      ...(asset.tags || []),
      ...(asset.styleTags || []),
      ...(asset.domesticTags || [])
    ].some((value) => String(value || '').toLowerCase().includes(keyword)));
  }

  res.json({ success: true, data: assets });
});

router.get('/ai-context', authMiddleware, (req, res) => {
  const assets = readAssets();
  res.json({
    success: true,
    data: {
      version: '0.1.0',
      purpose: 'AI装修素材库。每个素材都说明用途、适用空间、放置方式和AI语义，供平面图转3D/效果图/VR时选择与装配。',
      categories: [...new Set(assets.map((asset) => asset.category))],
      assets: assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        category: asset.category,
        usage: asset.usage,
        sceneTypes: asset.sceneTypes,
        placement: asset.placement,
        aiDescription: asset.aiDescription,
        tags: asset.tags,
        styleTags: asset.styleTags,
        domesticTags: asset.domesticTags,
        styleProfile: asset.styleProfile,
        properties: asset.properties,
        assetUrl: asset.assetUrl,
        modelUrl: asset.modelUrl,
        textureUrl: asset.textureUrl,
        pbrTextures: asset.pbrTextures,
        previewUrl: asset.previewUrl,
        sourceType: asset.sourceType,
        sourceUrl: asset.sourceUrl,
        license: asset.license
      }))
    }
  });
});

router.post(
  '/upload',
  authMiddleware,
  adminMiddleware,
  upload.fields([
    { name: 'modelFile', maxCount: 1 },
    { name: 'textureFile', maxCount: 1 },
    { name: 'previewImage', maxCount: 1 }
  ]),
  (req, res) => {
    const files = req.files || {};
    const toUrl = (file) => file ? `/uploads/design-assets/${file.filename}` : '';

    res.json({
      success: true,
      data: {
        modelUrl: toUrl(files.modelFile?.[0]),
        textureUrl: toUrl(files.textureFile?.[0]),
        previewUrl: toUrl(files.previewImage?.[0])
      }
    });
  }
);

router.post('/', authMiddleware, adminMiddleware, (req, res) => {
  const assets = readAssets();
  const nextAsset = normalizeAsset(req.body);

  if (!nextAsset.id || !nextAsset.name) {
    return res.status(400).json({
      success: false,
      message: '素材名称和ID不能为空'
    });
  }

  if (assets.some((asset) => asset.id === nextAsset.id)) {
    return res.status(409).json({
      success: false,
      message: '素材ID已存在'
    });
  }

  assets.unshift(nextAsset);
  writeAssets(assets);
  res.json({ success: true, data: nextAsset });
});

router.put('/:id', authMiddleware, adminMiddleware, (req, res) => {
  const assets = readAssets();
  const index = assets.findIndex((asset) => asset.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({
      success: false,
      message: '素材不存在'
    });
  }

  const nextAsset = normalizeAsset({ ...req.body, id: req.params.id }, assets[index]);
  assets[index] = nextAsset;
  writeAssets(assets);
  res.json({ success: true, data: nextAsset });
});

router.delete('/:id', authMiddleware, adminMiddleware, (req, res) => {
  const assets = readAssets();
  const nextAssets = assets.filter((asset) => asset.id !== req.params.id);

  if (nextAssets.length === assets.length) {
    return res.status(404).json({
      success: false,
      message: '素材不存在'
    });
  }

  writeAssets(nextAssets);
  res.json({ success: true, message: '素材已删除' });
});

module.exports = router;
